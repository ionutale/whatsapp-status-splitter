import type { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

export interface ConvertOptions {
	onProgress?: (ratio: number) => void;
	signal?: AbortSignal;
}

export type FFmpegLoader = () => Promise<FFmpeg>;

function splitName(name: string): { base: string; ext: string } {
	const dot = name.lastIndexOf('.');
	if (dot <= 0) return { base: name, ext: '' };
	return { base: name.slice(0, dot), ext: name.slice(dot) };
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function abortError(): DOMException {
	return new DOMException('The conversion was cancelled.', 'AbortError');
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

async function loadFfmpeg(): Promise<FFmpeg> {
	const { FFmpeg } = await import('@ffmpeg/ffmpeg');
	const ffmpeg = new FFmpeg();
	await ffmpeg.load({ coreURL, wasmURL });
	return ffmpeg;
}

function buildArgs(inputName: string, outputName: string): string[] {
	return [
		'-i',
		inputName,
		'-c:v',
		'libx264',
		'-preset',
		'veryfast',
		'-crf',
		'23',
		'-vf',
		"scale='min(1920,iw)':-2",
		'-c:a',
		'aac',
		'-b:a',
		'128k',
		'-movflags',
		'+faststart',
		outputName
	];
}

/**
 * Transcode `file` to a browser-friendly H.264/AAC MP4 with ffmpeg.wasm, entirely
 * on-device. The heavy ffmpeg core (~31MB wasm) is only fetched when this is
 * called: the page dynamically imports this module, and the core assets are
 * referenced by URL (never fetched until the worker loads them).
 *
 * `loadImpl` is an injectable seam so tests can drive the orchestration with a
 * fake FFmpeg instance instead of the real core.
 */
export async function convertToCompatibleMp4(
	file: File,
	opts: ConvertOptions = {},
	loadImpl: FFmpegLoader = loadFfmpeg
): Promise<File> {
	if (opts.signal?.aborted) throw abortError();

	// Build the abort channel BEFORE the (slow, ~31MB) core download so a cancel
	// during that phase rejects promptly instead of waiting for the load.
	let onAbort: (() => void) | null = null;
	let aborted = false;
	const abortPromise = new Promise<never>((_, reject) => {
		onAbort = () => {
			aborted = true;
			reject(abortError());
		};
		opts.signal?.addEventListener('abort', onAbort, { once: true });
	});

	// Distinct internal FS names so a source file literally called `input.mp4`
	// cannot collide with the output name.
	const { base, ext } = splitName(file.name);
	const inputName = `in-${base}${ext}`;
	const outputName = `out-${base}.mp4`;

	let ffmpeg: FFmpeg | null = null;
	let cleaned = false;
	const cleanup = async () => {
		if (cleaned || !ffmpeg) return;
		cleaned = true;
		for (const name of [inputName, outputName]) {
			try {
				await ffmpeg.deleteFile(name);
			} catch {
				// Best effort: the instance is terminated below regardless.
			}
		}
	};

	try {
		const loadPromise = loadImpl();
		// If the loader resolves after an abort won the race, terminate the late
		// instance so it is never reused (Promise.race does not cancel the loser).
		loadPromise.then(
			(instance) => {
				if (aborted) instance.terminate();
			},
			() => {
				// Loader errors are surfaced through the race below.
			}
		);
		ffmpeg = await Promise.race([loadPromise, abortPromise]);
		if (aborted) throw abortError();

		ffmpeg.on('progress', ({ progress }) => {
			opts.onProgress?.(clamp01(progress));
		});

		const bytes = new Uint8Array(await file.arrayBuffer());
		await Promise.race([ffmpeg.writeFile(inputName, bytes), abortPromise]);

		const exitCode = await Promise.race([
			ffmpeg.exec(buildArgs(inputName, outputName)),
			abortPromise
		]);
		if (exitCode !== 0) {
			throw new Error(`Conversion failed (ffmpeg exit code ${exitCode}).`);
		}

		const data = await ffmpeg.readFile(outputName);
		const outBytes = new Uint8Array(
			typeof data === 'string' ? new TextEncoder().encode(data) : data
		);
		const result = new File([outBytes], `${base}.mp4`, { type: 'video/mp4' });

		await cleanup();
		return result;
	} catch (error) {
		// On abort the worker is gone anyway; otherwise still clean the FS entries.
		if (!isAbortError(error)) await cleanup();
		throw error;
	} finally {
		if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
		// A terminated instance is never reused: the next call loads a fresh one.
		ffmpeg?.terminate();
	}
}
