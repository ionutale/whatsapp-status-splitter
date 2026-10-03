import {
	autoSplit,
	clampSegment,
	computeCoverage,
	nudge,
	setField,
	sortSegments,
	splitInHalf,
	type ClampOpts,
	type Interval,
	type Segment
} from '../domain/segments';
import type { QualityPreset, VideoMeta } from '../domain/bitrate';
import { fileKey, loadSession, loadSettings, saveSession, saveSettings } from './persist';

const PERSIST_DEBOUNCE_MS = 300;
const SEGMENT_EPSILON = 1e-3;

export class ProjectState {
	file = $state<File | null>(null);
	meta = $state<VideoMeta | null>(null);
	duration = $state(0);
	segments = $state<Segment[]>([]);
	selectedId = $state<string | null>(null);
	dirty = $state(false);
	zoom = $state(1);
	loopPreview = $state(true);
	error = $state<string | null>(null);
	notice = $state<string | null>(null);
	thumbs = $state<{ time: number; url: string }[]>([]);

	// Settings are exposed through getters/setters so every mutation (including
	// two-way bindings in components) schedules a debounced persist write.
	#maxClipDuration = $state(30);
	#preset = $state<QualityPreset>('whatsapp');
	#crop916 = $state(false);

	#settingsTimer: ReturnType<typeof setTimeout> | null = null;
	#sessionTimer: ReturnType<typeof setTimeout> | null = null;
	#pendingSession: { key: string; segments: Segment[] } | null = null;

	constructor() {
		// Apply persisted settings before any file loads. Written straight to the
		// backing fields so restoring never triggers a redundant save.
		const stored = loadSettings();
		if (stored) {
			this.#maxClipDuration = stored.maxClipDuration;
			this.#preset = stored.preset;
			this.#crop916 = stored.crop916;
		}
	}

	get maxClipDuration(): number {
		return this.#maxClipDuration;
	}
	set maxClipDuration(value: number) {
		const next = Math.min(300, Math.max(1, Math.round(value)));
		if (next === this.#maxClipDuration) return;
		this.#maxClipDuration = next;
		this.#scheduleSettingsSave();
	}

	get preset(): QualityPreset {
		return this.#preset;
	}
	set preset(value: QualityPreset) {
		if (value === this.#preset) return;
		this.#preset = value;
		this.#scheduleSettingsSave();
	}

	get crop916(): boolean {
		return this.#crop916;
	}
	set crop916(value: boolean) {
		if (value === this.#crop916) return;
		this.#crop916 = value;
		this.#scheduleSettingsSave();
	}

	get selected(): Segment | null {
		return this.segments.find((segment) => segment.id === this.selectedId) ?? null;
	}

	get sortedSegments(): Segment[] {
		return sortSegments(this.segments);
	}

	get coverage(): { gaps: Interval[]; overlaps: Interval[] } {
		return computeCoverage(this.segments, this.duration);
	}

	#opts(): ClampOpts {
		return { duration: this.duration, maxClipDuration: this.maxClipDuration };
	}

	begin(file: File): void {
		// Flush pending edits for the outgoing file before its state is cleared,
		// so a quick file switch within the debounce window cannot lose them.
		if (this.#sessionTimer) {
			clearTimeout(this.#sessionTimer);
			this.#sessionTimer = null;
		}
		this.#writePendingSession();
		this.setThumbs([]);
		this.file = file;
		this.meta = null;
		this.duration = 0;
		this.segments = [];
		this.selectedId = null;
		this.dirty = false;
		this.zoom = 1;
		this.error = null;
		this.notice = null;
	}

	ready(duration: number, meta: VideoMeta): void {
		this.duration = duration;
		this.meta = meta;
		// A stored layout for this exact file replaces the auto-split, unless it
		// no longer fits the real duration/min-max constraints.
		const restored = this.#restoreSegments();
		this.segments = restored ?? autoSplit(duration, this.maxClipDuration);
		this.selectedId = this.segments[0]?.id ?? null;
		this.dirty = false;
		this.#scheduleSessionSave();
		if (meta.hasAudio && !meta.audioDecodable) {
			this.notice = 'The audio track cannot be decoded; exported clips will be silent.';
		}
	}

	#restoreSegments(): Segment[] | null {
		if (!this.file) return null;
		const session = loadSession();
		if (!session) return null;
		if (session.fileKey !== fileKey(this.file)) return null;
		const opts = this.#opts();
		const restored = session.segments.map((segment) => clampSegment(segment, opts));
		// Any segment the clamp had to change (out of range, wrong length) means
		// the whole session is stale: discard it and fall back to auto-split.
		const fits = restored.every(
			(clamped, index) =>
				Math.abs(clamped.start - session.segments[index].start) < SEGMENT_EPSILON &&
				Math.abs(clamped.end - session.segments[index].end) < SEGMENT_EPSILON
		);
		return fits ? restored : null;
	}

	#scheduleSettingsSave(): void {
		if (this.#settingsTimer) clearTimeout(this.#settingsTimer);
		this.#settingsTimer = setTimeout(() => {
			this.#settingsTimer = null;
			saveSettings({
				version: 1,
				preset: this.#preset,
				crop916: this.#crop916,
				maxClipDuration: this.#maxClipDuration
			});
		}, PERSIST_DEBOUNCE_MS);
	}

	#scheduleSessionSave(): void {
		if (!this.file) return;
		this.#pendingSession = { key: fileKey(this.file), segments: this.segments };
		if (this.#sessionTimer) clearTimeout(this.#sessionTimer);
		this.#sessionTimer = setTimeout(() => {
			this.#sessionTimer = null;
			this.#writePendingSession();
		}, PERSIST_DEBOUNCE_MS);
	}

	#writePendingSession(): void {
		const pending = this.#pendingSession;
		this.#pendingSession = null;
		if (!pending) return;
		// The file may have changed since the snapshot was taken; never write a
		// layout under a key it does not belong to.
		if (!this.file || fileKey(this.file) !== pending.key) return;
		saveSession({ version: 1, fileKey: pending.key, segments: pending.segments });
	}

	setMaxClipDuration(value: number): void {
		const next = Math.min(300, Math.max(1, Math.round(value)));
		if (next === this.maxClipDuration) return;
		this.maxClipDuration = next;
		this.segments = this.segments.map((segment) => clampSegment(segment, this.#opts()));
		this.dirty = true;
		this.#scheduleSessionSave();
	}

	select(id: string | null): void {
		this.selectedId = id;
	}

	updateSegment(id: string, next: Segment, moved: 'start' | 'end' = 'end'): void {
		const clamped = clampSegment(next, this.#opts(), moved);
		this.segments = this.segments.map((segment) => (segment.id === id ? clamped : segment));
		this.dirty = true;
		this.#scheduleSessionSave();
	}

	nudgeSelected(edge: 'start' | 'end', delta: number): void {
		const selected = this.selected;
		if (!selected) return;
		this.updateSegment(selected.id, nudge(selected, edge, delta, this.#opts()), edge);
	}

	setSelectedField(field: 'start' | 'end' | 'duration', value: number): void {
		const selected = this.selected;
		if (!selected) return;
		this.updateSegment(
			selected.id,
			setField(selected, field, value, this.#opts()),
			field === 'start' ? 'start' : 'end'
		);
	}

	splitSelected(): void {
		const selected = this.selected;
		if (!selected) return;
		const parts = splitInHalf(selected, this.#opts());
		if (!parts) return;
		const index = this.segments.findIndex((segment) => segment.id === selected.id);
		this.segments = [...this.segments.slice(0, index), ...parts, ...this.segments.slice(index + 1)];
		this.selectedId = parts[0].id;
		this.dirty = true;
		this.#scheduleSessionSave();
	}

	deleteSelected(): void {
		const selected = this.selected;
		if (!selected) return;
		const index = this.segments.findIndex((segment) => segment.id === selected.id);
		const remaining = this.segments.filter((segment) => segment.id !== selected.id);
		this.segments = remaining;
		this.selectedId = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
		this.dirty = true;
		this.#scheduleSessionSave();
	}

	resetSplit(): void {
		this.segments = autoSplit(this.duration, this.maxClipDuration);
		this.selectedId = this.segments[0]?.id ?? null;
		this.dirty = false;
		this.#scheduleSessionSave();
	}

	addThumb(thumb: { time: number; url: string }): void {
		this.thumbs = [...this.thumbs, thumb];
	}

	setThumbs(thumbs: { time: number; url: string }[]): void {
		for (const thumb of this.thumbs) {
			try {
				URL.revokeObjectURL(thumb.url);
			} catch (error) {
				console.error('[thumbs] failed to revoke url', error);
			}
		}
		this.thumbs = thumbs;
	}

	setError(message: string | null): void {
		this.error = message;
	}
}

export const project = new ProjectState();
