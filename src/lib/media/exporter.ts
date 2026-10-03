import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	Conversion,
	ConversionCanceledError,
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
	aacReady ??= canEncodeAudio('aac')
		.then((supported) => {
			if (!supported) registerAacEncoder();
		})
		.catch((error) => {
			// Don't memoize a rejection: a later export should be able to retry.
			aacReady = null;
			throw error;
		});
	return aacReady;
}

export const realEncodeClip: EncodeClipFactory = ({ file, segment, plan, onProgress }) => {
	let conversion: Conversion | null = null;
	let cancelled = false;

	const result = (async () => {
		await ensureAacSupport();

		const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
		try {
			const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
			const output = new Output({ format, target: new BufferTarget() });

			const videoCodec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs());
			if (!videoCodec) throw new Error('No encodable video codec is available in this browser.');

			conversion = await Conversion.init({
				input,
				output,
				tracks: 'primary',
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

			// A cancel() that arrived while init was in flight could not touch the
			// conversion, so honour it here before doing any real work.
			if (cancelled) throw new ConversionCanceledError();

			if (!conversion.isValid) {
				const discarded = conversion.discardedTracks;
				const summary = discarded.map(({ track, reason }) => `${track.type}:${reason}`).join(', ');
				console.error('[exporter] invalid conversion', discarded);
				throw new Error(
					`This clip cannot be converted with the current settings${summary ? ` (${summary})` : ''}.`,
					{ cause: discarded }
				);
			}

			conversion.onProgress = onProgress;
			await conversion.execute();

			const buffer = output.target.buffer;
			if (!buffer) throw new Error('Encoding finished but produced no data.');
			return new Blob([buffer], { type: 'video/mp4' });
		} finally {
			input.dispose();
		}
	})();

	return {
		result,
		cancel: async () => {
			cancelled = true;
			if (conversion) await conversion.cancel();
		}
	};
};
