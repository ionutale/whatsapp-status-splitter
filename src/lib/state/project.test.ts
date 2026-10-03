import { describe, expect, it } from 'vitest';
import type { VideoMeta } from '../domain/bitrate';
import { ProjectState } from './project.svelte';

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
