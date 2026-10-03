import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	Conversion,
	Input,
	Mp4OutputFormat,
	Output,
	Quality,
	canEncodeAudio,
	getFirstEncodableVideoCodec
} from 'mediabunny';
import { registerAacEncoder } from '@mediabunny/aac-encoder';
import type { Segment } from '../domain/segments';
import type { OutputPlan } from '../domain/bitrate';

export type EncodeArgs = {
	file: File;
	segment: Segment;
	plan: OutputPlan;
	onProgress: (progress: number) => void;
};

export type EncodeHandle = {
	result: Promise<Blob>;
	cancel: () => Promise<void>;
};

export type EncodeClipFactory = (args: EncodeArgs) => EncodeHandle;

let aacReady: Promise<void> | null = null;

function ensureAacSupport(): Promise<void> {
	aacReady ??= canEncodeAudio('aac').then((supported) => {
		if (!supported) registerAacEncoder();
	});
	return aacReady;
}

export const realEncodeClip: EncodeClipFactory = ({ file, segment, plan, onProgress }) => {
	let conversion: Conversion | null = null;

	const result = (async () => {
		await ensureAacSupport();

		const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
		const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
		const output = new Output({ format, target: new BufferTarget() });

		const videoCodec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs());
		if (!videoCodec) throw new Error('No encodable video codec is available in this browser.');

		conversion = await Conversion.init({
			input,
			output,
			trim: { start: segment.start, end: segment.end },
			video: {
				codec: videoCodec,
				quality: new Quality({ bitrate: plan.videoKbps * 1000 }),
				width: plan.width,
				height: plan.height,
				fit: 'contain',
				frameRate: plan.frameRate,
				// Bake rotation/flip into pixels so clips display upright everywhere.
				allowTransformationMetadata: false
			},
			audio:
				plan.audioKbps > 0
					? { codec: 'aac', quality: new Quality({ bitrate: plan.audioKbps * 1000 }) }
					: { discard: true }
		});

		if (!conversion.isValid) {
			throw new Error('This clip cannot be converted with the current settings.');
		}

		conversion.onProgress = onProgress;
		await conversion.execute();

		const buffer = output.target.buffer;
		if (!buffer) throw new Error('Encoding finished but produced no data.');
		return new Blob([buffer], { type: 'video/mp4' });
	})();

	return {
		result,
		cancel: async () => {
			if (conversion) await conversion.cancel();
		}
	};
};
