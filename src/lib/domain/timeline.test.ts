import { describe, expect, it } from 'vitest';
import { assignLanes, chooseTickStep, generateTicks } from './timeline';
import type { Segment } from './segments';

const seg = (start: number, end: number): Segment => ({ id: `${start}`, start, end });

describe('chooseTickStep', () => {
	it('picks the smallest step that keeps 60px between ticks', () => {
		expect(chooseTickStep(2)).toBe(30);
		expect(chooseTickStep(10)).toBe(10);
		expect(chooseTickStep(60)).toBe(1);
		expect(chooseTickStep(200)).toBe(0.5);
	});
	it('falls back to the largest step', () => {
		expect(chooseTickStep(0.01)).toBe(300);
	});
});

describe('generateTicks', () => {
	it('generates ticks from 0 to duration', () => {
		const ticks = generateTicks(80, 10);
		expect(ticks.map((t) => t.time)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80]);
	});
	it('marks every fifth tick as major', () => {
		const ticks = generateTicks(80, 10);
		expect(ticks.map((t) => t.major)).toEqual([
			true,
			false,
			false,
			false,
			false,
			true,
			false,
			false,
			false
		]);
	});
});

describe('assignLanes', () => {
	it('keeps contiguous clips in lane 0', () => {
		expect(assignLanes([seg(0, 30), seg(30, 60), seg(60, 80)])).toEqual([0, 0, 0]);
	});
	it('offsets overlapping clips', () => {
		expect(assignLanes([seg(0, 30), seg(20, 50)])).toEqual([0, 1]);
	});
	it('reuses lanes once free', () => {
		expect(assignLanes([seg(0, 10), seg(5, 15), seg(20, 30)])).toEqual([0, 1, 0]);
	});
	it('handles nested clips', () => {
		expect(assignLanes([seg(0, 30), seg(5, 10)])).toEqual([0, 1]);
	});
});
