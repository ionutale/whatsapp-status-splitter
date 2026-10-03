import { readFile } from 'node:fs/promises';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';

export async function readMediaMeta(path: string) {
	const bytes = await readFile(path);
	const input = new Input({
		formats: ALL_FORMATS,
		source: new BufferSource(new Uint8Array(bytes))
	});
	const video = await input.getPrimaryVideoTrack();
	return {
		duration: await input.computeDuration(),
		displayWidth: video ? await video.getDisplayWidth() : 0,
		displayHeight: video ? await video.getDisplayHeight() : 0,
		rotation: video ? await video.getRotation() : 0,
		hasAudio: (await input.getPrimaryAudioTrack()) !== null
	};
}
