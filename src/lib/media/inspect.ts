import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { VideoMeta } from '../domain/bitrate';

export class InspectionError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'InspectionError';
	}
}

export type InspectResult = { duration: number; meta: VideoMeta };

export async function inspectFile(file: File): Promise<InspectResult> {
	try {
		const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
		const duration = await input.computeDuration();
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) throw new InspectionError('No video track was found in this file.');
		const audioTrack = await input.getPrimaryAudioTrack();

		const frameRate = await videoTrack
			.computeFrameRateMetrics()
			.then((metrics) => metrics.bestGuessFrameRate)
			.catch(() => null);

		const meta: VideoMeta = {
			displayWidth: await videoTrack.getDisplayWidth(),
			displayHeight: await videoTrack.getDisplayHeight(),
			rotation: await videoTrack.getRotation(),
			frameRate,
			videoCodec: await videoTrack.getCodecParameterString().catch(() => null),
			audioCodec: audioTrack ? await audioTrack.getCodecParameterString().catch(() => null) : null,
			hasAudio: audioTrack !== null,
			audioDecodable: audioTrack ? await audioTrack.canDecode().catch(() => false) : false,
			videoDecodable: await videoTrack.canDecode().catch(() => false)
		};

		return { duration, meta };
	} catch (error) {
		if (error instanceof InspectionError) throw error;
		console.error('[inspect] failed to read media file', error);
		throw new InspectionError('This file could not be read as a video.', { cause: error });
	}
}

export function assertDecodable(
	meta: Pick<VideoMeta, 'videoDecodable' | 'videoCodec'>
): string | null {
	if (meta.videoDecodable) return null;
	const codec = meta.videoCodec ? ` (${meta.videoCodec})` : '';
	return `This video's codec${codec} can't be decoded in this browser. Try Chrome, or convert the file to H.264 MP4 first.`;
}
