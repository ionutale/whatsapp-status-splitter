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

export class ProjectState {
	file = $state<File | null>(null);
	meta = $state<VideoMeta | null>(null);
	duration = $state(0);
	segments = $state<Segment[]>([]);
	selectedId = $state<string | null>(null);
	dirty = $state(false);
	maxClipDuration = $state(30);
	preset = $state<QualityPreset>('whatsapp');
	zoom = $state(1);
	loopPreview = $state(true);
	error = $state<string | null>(null);
	notice = $state<string | null>(null);
	thumbs = $state<{ time: number; url: string }[]>([]);

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
		this.segments = autoSplit(duration, this.maxClipDuration);
		this.selectedId = this.segments[0]?.id ?? null;
		this.dirty = false;
		if (meta.hasAudio && !meta.audioDecodable) {
			this.notice = 'The audio track cannot be decoded; exported clips will be silent.';
		}
	}

	setMaxClipDuration(value: number): void {
		const next = Math.min(300, Math.max(1, Math.round(value)));
		if (next === this.maxClipDuration) return;
		this.maxClipDuration = next;
		this.segments = this.segments.map((segment) => clampSegment(segment, this.#opts()));
		this.dirty = true;
	}

	select(id: string | null): void {
		this.selectedId = id;
	}

	updateSegment(id: string, next: Segment, moved: 'start' | 'end' = 'end'): void {
		const clamped = clampSegment(next, this.#opts(), moved);
		this.segments = this.segments.map((segment) => (segment.id === id ? clamped : segment));
		this.dirty = true;
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
	}

	deleteSelected(): void {
		const selected = this.selected;
		if (!selected) return;
		const index = this.segments.findIndex((segment) => segment.id === selected.id);
		const remaining = this.segments.filter((segment) => segment.id !== selected.id);
		this.segments = remaining;
		this.selectedId = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
		this.dirty = true;
	}

	resetSplit(): void {
		this.segments = autoSplit(this.duration, this.maxClipDuration);
		this.selectedId = this.segments[0]?.id ?? null;
		this.dirty = false;
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
