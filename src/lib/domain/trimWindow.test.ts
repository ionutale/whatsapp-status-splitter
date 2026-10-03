import { describe, expect, it } from 'vitest';
import { computeTrimWindow } from './trimWindow';

describe('computeTrimWindow', () => {
	it('pads by max(3s, half the clip) and clamps to the video', () => {
		expect(computeTrimWindow(30, 60, 80)).toEqual({ windowStart: 15, windowEnd: 75 });
		expect(computeTrimWindow(0, 30, 80)).toEqual({ windowStart: 0, windowEnd: 45 });
		expect(computeTrimWindow(60, 80, 80)).toEqual({ windowStart: 50, windowEnd: 80 });
		expect(computeTrimWindow(1, 2, 10)).toEqual({ windowStart: 0, windowEnd: 5 });
	});
	it('keeps a sane span for a clip equal to the video', () => {
		expect(computeTrimWindow(0, 5, 5)).toEqual({ windowStart: 0, windowEnd: 5 });
	});
});
