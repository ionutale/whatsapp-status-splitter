import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoMeta } from '../domain/bitrate';
import { ProjectState } from './project.svelte';
import { fileKey, saveSession, setStorageForTests, SESSIONS_STORAGE_KEY } from './persist';

const meta = (overrides: Partial<VideoMeta> = {}): VideoMeta => ({
	displayWidth: 1920,
	displayHeight: 1080,
	rotation: 0,
	frameRate: 30,
	videoCodec: 'avc1.42001f',
	audioCodec: 'mp4a.40.2',
	hasAudio: true,
	audioDecodable: true,
	videoDecodable: true,
	...overrides
});

const loaded = () => {
	const state = new ProjectState();
	state.begin(new File([], 'video.mp4'));
	state.ready(80, meta());
	return state;
};

describe('ProjectState', () => {
	it('auto-splits 80s into 30/30/20 and selects the first clip', () => {
		const state = loaded();
		expect(state.segments.map((s) => [s.start, s.end])).toEqual([
			[0, 30],
			[30, 60],
			[60, 80]
		]);
		expect(state.selectedId).toBe(state.segments[0].id);
		expect(state.dirty).toBe(false);
	});

	it('notices when the audio track cannot be decoded', () => {
		const state = new ProjectState();
		state.begin(new File([], 'video.mp4'));
		state.ready(10, meta({ audioDecodable: false }));
		expect(state.notice).toMatch(/silent/i);
	});

	it('re-clamps all clips when the max length is lowered', () => {
		const state = loaded();
		state.setMaxClipDuration(15);
		expect(state.maxClipDuration).toBe(15);
		for (const segment of state.segments) {
			expect(segment.end - segment.start).toBeLessThanOrEqual(15);
		}
		expect(state.dirty).toBe(true);
	});

	it('clamps updates made through updateSegment', () => {
		const state = loaded();
		const last = state.segments[2];
		state.updateSegment(last.id, { ...last, end: 100 }, 'end');
		expect(state.segments[2].end).toBe(80);
	});

	it('splits the selected clip in half', () => {
		const state = loaded();
		state.select(state.segments[0].id);
		state.splitSelected();
		expect(state.segments.length).toBe(4);
		expect(state.segments.map((s) => [s.start, s.end])).toEqual([
			[0, 15],
			[15, 30],
			[30, 60],
			[60, 80]
		]);
		expect(state.dirty).toBe(true);
	});

	it('deletes the selected clip and selects a neighbor', () => {
		const state = loaded();
		state.select(state.segments[1].id);
		state.deleteSelected();
		expect(state.segments.length).toBe(2);
		expect(state.selectedId).not.toBeNull();
		expect(state.segments.some((s) => s.id === state.selectedId)).toBe(true);
	});

	it('resets to a clean auto-split', () => {
		const state = loaded();
		state.setMaxClipDuration(15);
		state.resetSplit();
		expect(state.segments.map((s) => [s.start, s.end])).toEqual([
			[0, 15],
			[15, 30],
			[30, 45],
			[45, 60],
			[60, 75],
			[75, 80]
		]);
		expect(state.dirty).toBe(false);
	});

	it('reports gaps in coverage', () => {
		const state = loaded();
		state.updateSegment(state.segments[1].id, { ...state.segments[1], start: 35 }, 'start');
		expect(state.coverage.gaps).toEqual([{ start: 30, end: 35 }]);
	});

	it('clears everything on begin', () => {
		const state = loaded();
		state.begin(new File([], 'next.mp4'));
		expect(state.segments).toEqual([]);
		expect(state.selectedId).toBeNull();
		expect(state.dirty).toBe(false);
		expect(state.notice).toBeNull();
	});
});

describe('ProjectState persistence', () => {
	let storage: Storage;

	const makeStorage = (): Storage => {
		const map = new Map<string, string>();
		return {
			get length() {
				return map.size;
			},
			clear: () => map.clear(),
			getItem: (key: string) => map.get(key) ?? null,
			key: (index: number) => [...map.keys()][index] ?? null,
			removeItem: (key: string) => {
				map.delete(key);
			},
			setItem: (key: string, value: string) => {
				map.set(key, String(value));
			}
		} as Storage;
	};

	const flushDebounce = () => vi.advanceTimersByTime(350);

	beforeEach(() => {
		storage = makeStorage();
		setStorageForTests(storage);
		vi.useFakeTimers();
	});

	afterEach(() => {
		setStorageForTests(null);
		vi.useRealTimers();
	});

	it('applies persisted settings on construction, before any file loads', () => {
		const state = new ProjectState();
		state.preset = 'high';
		state.crop916 = true;
		state.setMaxClipDuration(15);
		flushDebounce();

		const restored = new ProjectState();
		expect(restored.preset).toBe('high');
		expect(restored.crop916).toBe(true);
		expect(restored.maxClipDuration).toBe(15);
	});

	it('restores the stored clip layout when the same file is loaded again', () => {
		const file = new File([], 'video.mp4');
		const state = new ProjectState();
		state.begin(file);
		state.ready(80, meta());
		state.select(state.segments[0].id);
		state.splitSelected();
		flushDebounce();

		const restored = new ProjectState();
		restored.begin(file);
		restored.ready(80, meta());
		expect(restored.segments.map((s) => [s.start, s.end])).toEqual([
			[0, 15],
			[15, 30],
			[30, 60],
			[60, 80]
		]);
		expect(restored.dirty).toBe(false);
	});

	it('auto-splits a different file even when a session is stored', () => {
		// Give fileA a distinctive layout first. Without this the stored layout is
		// identical to what autoSplit would compute for fileB, so the test would
		// stay green even if the per-file key guard were removed.
		const fileA = new File([], 'a.mp4');
		const first = new ProjectState();
		first.begin(fileA);
		first.ready(80, meta());
		first.select(first.segments[0].id);
		first.splitSelected();
		flushDebounce();

		const fileB = new File([], 'b.mp4');
		const second = new ProjectState();
		second.begin(fileB);
		second.ready(80, meta());
		expect(second.segments.map((s) => [s.start, s.end])).toEqual([
			[0, 30],
			[30, 60],
			[60, 80]
		]);
	});

	it("restores fileA's edited layout after loading fileB in between", () => {
		const fileA = new File([], 'a.mp4');
		const fileB = new File([], 'b.mp4');

		const first = new ProjectState();
		first.begin(fileA);
		first.ready(80, meta());
		first.select(first.segments[0].id);
		first.splitSelected();
		flushDebounce();

		const middle = new ProjectState();
		middle.begin(fileB);
		middle.ready(80, meta());
		expect(middle.segments.map((s) => [s.start, s.end])).toEqual([
			[0, 30],
			[30, 60],
			[60, 80]
		]);
		flushDebounce();

		const back = new ProjectState();
		back.begin(fileA);
		back.ready(80, meta());
		expect(back.segments.map((s) => [s.start, s.end])).toEqual([
			[0, 15],
			[15, 30],
			[30, 60],
			[60, 80]
		]);
		expect(back.dirty).toBe(false);
	});

	it('falls back to auto-split when stored segments are out of range', () => {
		const file = new File([], 'video.mp4');
		saveSession(fileKey(file), [{ start: 0, end: 999 }]);

		const state = new ProjectState();
		state.begin(file);
		state.ready(80, meta());
		expect(state.segments.map((s) => [s.start, s.end])).toEqual([
			[0, 30],
			[30, 60],
			[60, 80]
		]);
	});

	it('falls back to auto-split when a stored segment exceeds the max length', () => {
		const file = new File([], 'video.mp4');
		saveSession(fileKey(file), [
			{ start: 0, end: 45 },
			{ start: 45, end: 80 }
		]);

		const state = new ProjectState();
		state.begin(file);
		state.ready(80, meta());
		expect(state.segments.map((s) => [s.start, s.end])).toEqual([
			[0, 30],
			[30, 60],
			[60, 80]
		]);
	});

	it('loads normally when the stored session is corrupt', () => {
		storage.setItem(SESSIONS_STORAGE_KEY, '{broken json');
		const file = new File([], 'video.mp4');
		const state = new ProjectState();
		state.begin(file);
		state.ready(80, meta());
		expect(state.segments.map((s) => [s.start, s.end])).toEqual([
			[0, 30],
			[30, 60],
			[60, 80]
		]);
	});

	it('flushes debounced edits synchronously via flushPendingWrites', () => {
		const file = new File([], 'video.mp4');
		const state = new ProjectState();
		state.begin(file);
		state.ready(80, meta());
		state.select(state.segments[0].id);
		state.splitSelected();
		// No timer advance: the pagehide/visibility flush must write right now.
		state.flushPendingWrites();

		const reloaded = new ProjectState();
		reloaded.begin(file);
		reloaded.ready(80, meta());
		expect(reloaded.segments.map((s) => [s.start, s.end])).toEqual([
			[0, 15],
			[15, 30],
			[30, 60],
			[60, 80]
		]);
	});

	it('flushes pending segment edits when a new file begins', () => {
		const fileA = new File([], 'a.mp4');
		const state = new ProjectState();
		state.begin(fileA);
		state.ready(80, meta());
		state.select(state.segments[0].id);
		state.splitSelected();
		// No flush yet: begin() must write the pending layout synchronously.
		state.begin(new File([], 'b.mp4'));

		const reloaded = new ProjectState();
		reloaded.begin(fileA);
		reloaded.ready(80, meta());
		expect(reloaded.segments.map((s) => [s.start, s.end])).toEqual([
			[0, 15],
			[15, 30],
			[30, 60],
			[60, 80]
		]);
	});
});
