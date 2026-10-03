import { describe, expect, it } from 'vitest';
import {
	MIN_CLIP_DURATION,
	autoSplit,
	clampSegment,
	computeCoverage,
	nudge,
	setField,
	splitInHalf,
	type Segment
} from './segments';

const seg = (start: number, end: number): Segment => ({ id: 'x', start, end });
const times = (list: Segment[]) => list.map((s) => [s.start, s.end]);
const opts = { duration: 80, maxClipDuration: 30 };

describe('autoSplit', () => {
	it('splits 80s into 30/30/20', () => {
		expect(times(autoSplit(80, 30))).toEqual([
			[0, 30],
			[30, 60],
			[60, 80]
		]);
	});
	it('handles exact multiples without zero-length clips', () => {
		expect(times(autoSplit(60, 30))).toEqual([
			[0, 30],
			[30, 60]
		]);
	});
	it('keeps short videos as one clip', () => {
		expect(times(autoSplit(20, 30))).toEqual([[0, 20]]);
	});
	it('allows a single clip shorter than the minimum', () => {
		expect(times(autoSplit(0.3, 30))).toEqual([[0, 0.3]]);
	});
	it('returns nothing for non-positive duration', () => {
		expect(autoSplit(0, 30)).toEqual([]);
	});
});

describe('clampSegment', () => {
	it('clamps the end to the video duration', () => {
		expect(times([clampSegment(seg(60, 95), opts, 'end')])).toEqual([[60, 80]]);
	});
	it('caps the length at maxClipDuration when dragging the end', () => {
		expect(times([clampSegment(seg(0, 40), opts, 'end')])).toEqual([[0, 30]]);
	});
	it('caps the length at maxClipDuration when dragging the start left', () => {
		expect(times([clampSegment(seg(20, 60), opts, 'start')])).toEqual([[30, 60]]);
	});
	it('enforces the minimum when dragging the start right', () => {
		expect(times([clampSegment(seg(29.9, 30), opts, 'start')])).toEqual([[29.5, 30]]);
	});
	it('enforces the minimum when dragging the end left', () => {
		expect(times([clampSegment(seg(0, 0.4), opts, 'end')])).toEqual([[0, 0.5]]);
	});
	it('never lets start go below zero', () => {
		expect(times([clampSegment(seg(-5, 10), opts, 'start')])).toEqual([[0, 10]]);
	});
	it('lets the min win when the video is shorter than the min', () => {
		const out = clampSegment(seg(0, 1), { duration: 0.3, maxClipDuration: 30 }, 'end');
		expect(out.end).toBeCloseTo(0.3, 3);
	});
});

describe('nudge', () => {
	it('moves the requested edge by the delta', () => {
		expect(nudge(seg(10, 20), 'start', 0.1, opts).start).toBeCloseTo(10.1, 3);
		expect(nudge(seg(10, 20), 'end', 1, opts).end).toBeCloseTo(21, 3);
	});
	it('clamps at the boundary', () => {
		expect(nudge(seg(0, 20), 'start', -1, opts).start).toBe(0);
	});
});

describe('setField', () => {
	it('sets end directly', () => {
		expect(setField(seg(10, 20), 'end', 25, opts).end).toBe(25);
	});
	it('sets duration by moving the end', () => {
		const out = setField(seg(10, 20), 'duration', 5, opts);
		expect(out.start).toBeCloseTo(10, 3);
		expect(out.end).toBeCloseTo(15, 3);
	});
});

describe('splitInHalf', () => {
	it('splits at the midpoint', () => {
		const out = splitInHalf(seg(10, 20), opts);
		expect(out).not.toBeNull();
		expect(times(out!)).toEqual([
			[10, 15],
			[15, 20]
		]);
	});
	it('refuses when shorter than 2x the minimum', () => {
		expect(splitInHalf(seg(10, 10.9), opts)).toBeNull();
	});
});

describe('computeCoverage', () => {
	it('reports no gaps or overlaps for contiguous clips', () => {
		const out = computeCoverage([seg(30, 60), seg(0, 30), seg(60, 80)], 80);
		expect(out.gaps).toEqual([]);
		expect(out.overlaps).toEqual([]);
	});
	it('finds a gap', () => {
		const out = computeCoverage([seg(0, 30), seg(35, 80)], 80);
		expect(out.gaps).toEqual([{ start: 30, end: 35 }]);
	});
	it('finds overlapping and nested regions', () => {
		const out = computeCoverage([seg(0, 10), seg(2, 4), seg(6, 12)], 12);
		expect(out.overlaps).toEqual([
			{ start: 2, end: 4 },
			{ start: 6, end: 10 }
		]);
	});
	it('finds a trailing gap', () => {
		const out = computeCoverage([seg(0, 60)], 80);
		expect(out.gaps).toEqual([{ start: 60, end: 80 }]);
	});
});

describe('minimum clip guarantee', () => {
	it('rebalances a sub-minimum auto-split tail', () => {
		const chunks = autoSplit(60.01, 30);
		expect(times(chunks)).toEqual([
			[0, 30],
			[30, 45.005],
			[45.005, 60.01]
		]);
		for (const chunk of chunks) {
			expect(chunk.end - chunk.start).toBeGreaterThanOrEqual(MIN_CLIP_DURATION);
		}
	});
	it('rebalances a sub-minimum tail at a larger duration', () => {
		expect(times(autoSplit(60.3, 30))).toEqual([
			[0, 30],
			[30, 45.15],
			[45.15, 60.3]
		]);
	});
	it('lifts a boundary-pinned clampSegment to the minimum', () => {
		const out = clampSegment(seg(60, 60.01), { duration: 60.01, maxClipDuration: 30 }, 'end');
		expect(times([out])).toEqual([[59.51, 60.01]]);
		expect(out.end - out.start).toBeCloseTo(MIN_CLIP_DURATION, 3);
	});
	it('lifts a boundary-pinned nudge to the minimum', () => {
		const out = nudge(seg(60, 60.01), 'end', 1, { duration: 60.01, maxClipDuration: 30 });
		expect(times([out])).toEqual([[59.51, 60.01]]);
		expect(out.end - out.start).toBeCloseTo(MIN_CLIP_DURATION, 3);
	});
});

describe('constants', () => {
	it('minimum is 0.5s', () => {
		expect(MIN_CLIP_DURATION).toBe(0.5);
	});
});
