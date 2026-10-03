import { describe, expect, it } from 'vitest';

describe('unit toolchain', () => {
	it('runs in node without DOM', () => {
		expect(typeof document).toBe('undefined');
	});
});
