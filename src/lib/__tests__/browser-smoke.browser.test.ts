import { describe, expect, it } from 'vitest';

describe('browser toolchain', () => {
	it('has WebCodecs available', () => {
		expect(typeof VideoEncoder).toBe('function');
		expect(typeof VideoDecoder).toBe('function');
		expect(typeof AudioEncoder).toBe('function');
	});
});
