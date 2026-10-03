import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { describe, expect, it, vi } from 'vitest';
import { convertToCompatibleMp4 } from './ffmpeg';

type ProgressCb = (event: { progress: number; time: number }) => void;

function makeFakeFfmpeg(execImpl?: (args: string[]) => Promise<number>) {
	const fake = {
		on: vi.fn((event: string, cb: ProgressCb) => {
			if (event === 'progress') fake.progressCbs.push(cb);
		}),
		writeFile: vi.fn(async () => true),
		exec: vi.fn(execImpl ?? (async () => 0)),
		readFile: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
		deleteFile: vi.fn(async () => true),
		terminate: vi.fn(),
		progressCbs: [] as ProgressCb[]
	};
	return fake;
}

function loaderFor(fake: ReturnType<typeof makeFakeFfmpeg>) {
	return async () => fake as unknown as FFmpeg;
}

const EXPECTED_ARGS = [
	'-i',
	'in-old-video.avi',
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
	'out-old-video.mp4'
];

describe('convertToCompatibleMp4', () => {
	it('transcodes once: writes input, execs, reads output, cleans up, terminates', async () => {
		const fake = makeFakeFfmpeg();
		const file = new File([new Uint8Array([9, 8, 7])], 'old-video.avi', {
			type: 'video/avi'
		});

		const result = await convertToCompatibleMp4(file, {}, loaderFor(fake));

		expect(fake.writeFile).toHaveBeenCalledWith('in-old-video.avi', expect.any(Uint8Array));
		expect(fake.exec).toHaveBeenCalledWith(EXPECTED_ARGS);
		expect(fake.readFile).toHaveBeenCalledWith('out-old-video.mp4');
		expect(result.name).toBe('old-video.mp4');
		expect(result.type).toBe('video/mp4');
		expect(Array.from(new Uint8Array(await result.arrayBuffer()))).toEqual([1, 2, 3, 4]);
		expect(fake.deleteFile).toHaveBeenCalledWith('in-old-video.avi');
		expect(fake.deleteFile).toHaveBeenCalledWith('out-old-video.mp4');
		expect(fake.terminate).toHaveBeenCalled();
	});

	it('derives input/output names from the original file name', async () => {
		const fake = makeFakeFfmpeg();
		const file = new File([new Uint8Array([1])], 'clip', { type: 'video/mp4' });

		const result = await convertToCompatibleMp4(file, {}, loaderFor(fake));

		expect(fake.writeFile).toHaveBeenCalledWith('in-clip', expect.any(Uint8Array));
		expect(fake.exec).toHaveBeenCalledWith(expect.arrayContaining(['in-clip', 'out-clip.mp4']));
		expect(result.name).toBe('clip.mp4');
	});

	it('keeps input and output FS names distinct when the source is input.mp4', async () => {
		const fake = makeFakeFfmpeg();
		const file = new File([new Uint8Array([1])], 'input.mp4', { type: 'video/mp4' });

		const result = await convertToCompatibleMp4(file, {}, loaderFor(fake));

		expect(fake.writeFile).toHaveBeenCalledWith('in-input.mp4', expect.any(Uint8Array));
		expect(fake.exec).toHaveBeenCalledWith(
			expect.arrayContaining(['in-input.mp4', 'out-input.mp4'])
		);
		expect(fake.readFile).toHaveBeenCalledWith('out-input.mp4');
		expect(result.name).toBe('input.mp4');
	});

	it('forwards clamped progress events', async () => {
		const onProgress = vi.fn();
		const fake = makeFakeFfmpeg();
		const file = new File([new Uint8Array([1])], 'old-video.avi', {
			type: 'video/avi'
		});

		await convertToCompatibleMp4(file, { onProgress }, loaderFor(fake));

		expect(fake.progressCbs.length).toBe(1);
		const emit = fake.progressCbs[0];
		emit({ progress: 0.25, time: 1 });
		emit({ progress: -0.5, time: 0 });
		emit({ progress: 2, time: 99 });
		expect(onProgress.mock.calls.map((call) => call[0])).toEqual([0.25, 0, 1]);
	});

	it('rejects with AbortError and terminates when the signal aborts mid-exec', async () => {
		const fake = makeFakeFfmpeg(() => new Promise<number>(() => {}));
		const controller = new AbortController();
		const file = new File([new Uint8Array([1])], 'old-video.avi', {
			type: 'video/avi'
		});

		const promise = convertToCompatibleMp4(file, { signal: controller.signal }, loaderFor(fake));
		await vi.waitFor(() => expect(fake.exec).toHaveBeenCalled());
		controller.abort();

		await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
		expect(fake.terminate).toHaveBeenCalled();
	});

	it('aborts while the core loader is still pending, then terminates the late instance', async () => {
		const fake = makeFakeFfmpeg();
		let resolveLoader: (instance: FFmpeg) => void = () => {};
		const pending = new Promise<FFmpeg>((resolve) => {
			resolveLoader = resolve;
		});
		const loader = vi.fn(() => pending);
		const controller = new AbortController();
		const file = new File([new Uint8Array([1])], 'old-video.avi', { type: 'video/avi' });

		const promise = convertToCompatibleMp4(file, { signal: controller.signal }, loader);
		await vi.waitFor(() => expect(loader).toHaveBeenCalled());
		controller.abort();

		// Rejects without waiting for the ~31MB core download to finish.
		await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
		expect(fake.terminate).not.toHaveBeenCalled();
		expect(fake.writeFile).not.toHaveBeenCalled();

		// The loader resolves after the abort: its instance must be terminated
		// and never reused.
		resolveLoader(fake as unknown as FFmpeg);
		await vi.waitFor(() => expect(fake.terminate).toHaveBeenCalled());
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it('rejects immediately when the signal is already aborted', async () => {
		const fake = makeFakeFfmpeg();
		const controller = new AbortController();
		controller.abort();
		const file = new File([new Uint8Array([1])], 'old-video.avi', {
			type: 'video/avi'
		});

		await expect(
			convertToCompatibleMp4(file, { signal: controller.signal }, loaderFor(fake))
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(fake.exec).not.toHaveBeenCalled();
		expect(fake.terminate).not.toHaveBeenCalled();
	});

	it('rejects and still cleans up when ffmpeg exits non-zero', async () => {
		const fake = makeFakeFfmpeg(async () => 1);
		const file = new File([new Uint8Array([1])], 'old-video.avi', {
			type: 'video/avi'
		});

		await expect(convertToCompatibleMp4(file, {}, loaderFor(fake))).rejects.toThrow(/exit code 1/);
		expect(fake.deleteFile).toHaveBeenCalledWith('in-old-video.avi');
		expect(fake.deleteFile).toHaveBeenCalledWith('out-old-video.mp4');
		expect(fake.terminate).toHaveBeenCalled();
	});
});
