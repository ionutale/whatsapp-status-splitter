import { describe, expect, it } from 'vitest';
import { formatClock, parseClock } from './format';

describe('formatClock', () => {
	it('formats sub-minute values', () => {
		expect(formatClock(0)).toBe('00:00.0');
		expect(formatClock(12.34)).toBe('00:12.3');
	});
	it('formats minutes', () => {
		expect(formatClock(72.05)).toBe('01:12.1');
	});
	it('formats hours', () => {
		expect(formatClock(3723.5)).toBe('1:02:03.5');
	});
});

describe('parseClock', () => {
	it('round-trips formatClock output', () => {
		for (const t of [0, 12.3, 72.1, 3723.5]) {
			expect(parseClock(formatClock(t))).toBeCloseTo(t, 1);
		}
	});
	it('accepts plain seconds', () => {
		expect(parseClock('83')).toBe(83);
		expect(parseClock('12.5')).toBe(12.5);
	});
	it('rejects malformed input', () => {
		expect(parseClock('abc')).toBeNull();
		expect(parseClock('1:2:3:4')).toBeNull();
		expect(parseClock('-5')).toBeNull();
		expect(parseClock('')).toBeNull();
	});
});
