import { describe, expect, it } from 'vitest';
import { clipFileName, sanitizeBaseName, zipFileName } from './naming';

describe('sanitizeBaseName', () => {
	it('strips extension and unsafe characters', () => {
		expect(sanitizeBaseName('IMG 1234.MOV')).toBe('IMG_1234');
		expect(sanitizeBaseName('a//b??.mp4')).toBe('a_b');
	});
	it('never returns empty', () => {
		expect(sanitizeBaseName('.mp4')).toBe('video');
	});
});

describe('clipFileName', () => {
	it('zero-pads the part index', () => {
		expect(clipFileName('vid', 0)).toBe('vid_part01.mp4');
		expect(clipFileName('vid', 11)).toBe('vid_part12.mp4');
	});
});

describe('zipFileName', () => {
	it('appends _parts', () => {
		expect(zipFileName('vid')).toBe('vid_parts.zip');
	});
});
