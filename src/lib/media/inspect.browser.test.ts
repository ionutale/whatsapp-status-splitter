import { describe, expect, it } from 'vitest';
import tiny5sUrl from '../../../static/test-fixtures/tiny-5s.mp4?url';
import noAudioUrl from '../../../static/test-fixtures/tiny-noaudio.mp4?url';
import rotatedUrl from '../../../static/test-fixtures/tiny-portrait-rotated.mp4?url';
import { assertDecodable, inspectFile } from './inspect';

async function loadFixture(url: string, name: string): Promise<File> {
	const blob = await (await fetch(url)).blob();
	return new File([blob], name, { type: 'video/mp4' });
}

describe('inspectFile', () => {
	it('reads duration, dimensions, fps and tracks from tiny-5s.mp4', async () => {
		const { duration, meta } = await inspectFile(await loadFixture(tiny5sUrl, 'tiny-5s.mp4'));
		expect(duration).toBeCloseTo(5, 0);
		expect(meta.displayWidth).toBe(320);
		expect(meta.displayHeight).toBe(240);
		expect(meta.rotation).toBe(0);
		expect(meta.hasAudio).toBe(true);
		expect(meta.audioDecodable).toBe(true);
		expect(meta.videoDecodable).toBe(true);
		expect(meta.frameRate).toBeGreaterThan(25);
		expect(meta.videoCodec).toMatch(/^avc/);
	});

	it('reports 90-degree rotation as portrait display dimensions', async () => {
		const { meta } = await inspectFile(await loadFixture(rotatedUrl, 'rotated.mp4'));
		expect(meta.rotation).toBe(90);
		expect(meta.displayHeight).toBeGreaterThan(meta.displayWidth);
	});

	it('reports no audio track', async () => {
		const { meta } = await inspectFile(await loadFixture(noAudioUrl, 'noaudio.mp4'));
		expect(meta.hasAudio).toBe(false);
		expect(meta.audioDecodable).toBe(false);
	});

	it('throws a friendly InspectionError for non-video data', async () => {
		const file = new File([new Uint8Array([1, 2, 3])], 'nope.mp4', { type: 'video/mp4' });
		await expect(inspectFile(file)).rejects.toThrow(/could not be read/i);
	});
});

describe('assertDecodable', () => {
	it('returns the user-facing message for an undecodable codec', () => {
		const message = assertDecodable({ videoDecodable: false, videoCodec: 'vp9' });
		expect(message).toMatch(/can't be decoded/i);
	});

	it('returns null when decodable', () => {
		expect(assertDecodable({ videoDecodable: true, videoCodec: 'avc1' })).toBeNull();
	});
});
