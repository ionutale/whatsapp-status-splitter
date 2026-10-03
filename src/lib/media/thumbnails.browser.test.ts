import { describe, expect, it } from 'vitest';
import tiny5sUrl from '../../../static/test-fixtures/tiny-5s.mp4?url';
import { extractThumbnails } from './thumbnails';

describe('extractThumbnails', () => {
	it('extracts the requested number of thumbnails with object URLs', async () => {
		const blob = await (await fetch(tiny5sUrl)).blob();
		const file = new File([blob], 'tiny-5s.mp4', { type: 'video/mp4' });
		const progressive: number[] = [];
		const thumbs = await extractThumbnails(file, 4, 160, () => progressive.push(1));
		expect(thumbs).toHaveLength(4);
		expect(progressive).toHaveLength(4);
		for (const thumb of thumbs) {
			expect(thumb.url.startsWith('blob:')).toBe(true);
			expect(thumb.time).toBeGreaterThanOrEqual(0);
			expect(thumb.time).toBeLessThanOrEqual(5);
		}
	});
});
