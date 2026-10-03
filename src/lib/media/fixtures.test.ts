import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';

const readFixture = async (name: string) => {
	const bytes = await readFile(new URL(`../../../static/test-fixtures/${name}`, import.meta.url));
	return new Input({ formats: ALL_FORMATS, source: new BufferSource(new Uint8Array(bytes)) });
};

describe('fixture metadata', () => {
	it('tiny-5s.mp4 is 5s, 320x240, no rotation, with audio', async () => {
		const input = await readFixture('tiny-5s.mp4');
		expect(await input.computeDuration()).toBeCloseTo(5, 0);
		const video = await input.getPrimaryVideoTrack();
		expect(await video!.getDisplayWidth()).toBe(320);
		expect(await video!.getDisplayHeight()).toBe(240);
		expect(await video!.getRotation()).toBe(0);
		expect(await input.getPrimaryAudioTrack()).not.toBeNull();
	});

	it('tiny-portrait-rotated.mp4 carries 90-degree rotation', async () => {
		const input = await readFixture('tiny-portrait-rotated.mp4');
		const video = await input.getPrimaryVideoTrack();
		expect(await video!.getRotation()).toBe(90);
	});

	it('tiny-noaudio.mp4 has no audio track', async () => {
		const input = await readFixture('tiny-noaudio.mp4');
		expect(await input.getPrimaryAudioTrack()).toBeNull();
	});
});
