import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputPlan, VideoMeta } from '../domain/bitrate';
import type { Segment } from '../domain/segments';
import type { EncodeClipFactory, EncodeHandle } from '../media/exporter';
import type { InspectResult } from '../media/inspect';
import { BatchState, BATCH_READ_FAILURE, BATCH_ZIP_NAME, type BatchDeps } from './batch.svelte';
import { project } from './project.svelte';

const meta = (): VideoMeta => ({
	displayWidth: 1920,
	displayHeight: 1080,
	rotation: 0,
	frameRate: 30,
	videoCodec: 'avc1.42001f',
	audioCodec: 'mp4a.40.2',
	hasAudio: true,
	audioDecodable: true,
	videoDecodable: true
});

const seg = (id: string, start: number, end: number): Segment => ({ id, start, end });

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const okHandle = (blob = new Blob([new Uint8Array([1])])): EncodeHandle => ({
	result: Promise.resolve(blob),
	cancel: async () => {}
});

const file = (name: string) => new File([new Uint8Array([1])], name, { type: 'video/mp4' });

type Encodes = { file: string; id: string; plan: OutputPlan; progress: (p: number) => void }[];

/** Build a BatchState with recording fakes; no real encoding/IO ever runs. */
function harness(options: {
	results?: Segment[][];
	inspectFails?: string[];
	encode?: EncodeClipFactory;
	inspect?: (file: File) => Promise<InspectResult>;
	makeZip?: BatchDeps['makeZip'];
}) {
	const splitResults = [...(options.results ?? [])];
	const inspectFails = new Set(options.inspectFails ?? []);
	const encodes: Encodes = [];
	const downloads: string[] = [];
	const zipCalls: { name: string; blob: Blob }[][] = [];

	const inspect =
		options.inspect ??
		vi.fn(async (f: File) => {
			if (inspectFails.has(f.name)) throw new Error(`unreadable: ${f.name}`);
			return { duration: 4, meta: meta() };
		});
	const split = vi.fn(() => splitResults.shift() ?? []);
	const defaultEncode: EncodeClipFactory = ({ file: f, segment, plan, onProgress }) => {
		encodes.push({ file: f.name, id: segment.id, plan, progress: onProgress });
		return okHandle(new Blob([new Uint8Array([encodes.length])]));
	};
	const deps: BatchDeps = {
		inspect,
		split,
		encodeClip: options.encode ?? defaultEncode,
		makeZip:
			options.makeZip ??
			(async (entries) => {
				zipCalls.push(entries);
				return new Blob([new Uint8Array([9])]);
			}),
		downloadBlob: (_blob, name) => downloads.push(name)
	};

	return { state: new BatchState(deps), deps, encodes, split, inspect, downloads, zipCalls };
}

describe('BatchState', () => {
	beforeEach(() => {
		project.maxClipDuration = 30;
		project.preset = 'whatsapp';
		project.crop916 = false;
	});

	afterEach(() => {
		project.flushPendingWrites();
		vi.restoreAllMocks();
	});

	it('processes files and their clips in sequential order', async () => {
		const h = harness({
			results: [[seg('a1', 0, 2), seg('a2', 2, 4)], [seg('b1', 0, 4)]]
		});
		h.state.setFiles([file('a.mp4'), file('b.mp4')]);
		await h.state.start();

		expect(h.encodes.map((e) => `${e.file}:${e.id}`)).toEqual(['a.mp4:a1', 'a.mp4:a2', 'b.mp4:b1']);
		expect(h.state.items.map((i) => i.status)).toEqual(['done', 'done']);
		expect(h.state.overallProgress).toBe(1);
	});

	it('names ZIP entries <base>/<base>_partNN.mp4 and downloads one status_batch.zip', async () => {
		const h = harness({
			results: [[seg('a1', 0, 2), seg('a2', 2, 4)], [seg('b1', 0, 4)]]
		});
		h.state.setFiles([file('My Clip.mp4'), file('b.mp4')]);
		await h.state.start();

		expect(h.zipCalls).toHaveLength(1);
		expect(h.zipCalls[0].map((entry) => entry.name)).toEqual([
			'My_Clip/My_Clip_part01.mp4',
			'My_Clip/My_Clip_part02.mp4',
			'b/b_part01.mp4'
		]);
		expect(h.downloads).toEqual([BATCH_ZIP_NAME]);
	});

	it('isolates a failing inspect: the file fails and later files still run', async () => {
		const h = harness({
			results: [[seg('good1', 0, 4)]],
			inspectFails: ['bad.avi']
		});
		h.state.setFiles([file('bad.avi'), file('good.mp4')]);
		await h.state.start();

		expect(h.state.items[0].status).toBe('failed');
		expect(h.state.items[0].error).toBe(BATCH_READ_FAILURE);
		expect(h.state.items[0].error).toContain('compatibility mode');
		expect(h.state.items[1].status).toBe('done');
		expect(h.encodes.map((e) => e.file)).toEqual(['good.mp4']);
		expect(h.zipCalls[0].map((entry) => entry.name)).toEqual(['good/good_part01.mp4']);
	});

	it('isolates an encode failure within a file and continues to the next file', async () => {
		const failing = deferred<Blob>();
		let calls = 0;
		const h = harness({
			results: [[seg('a1', 0, 2), seg('a2', 2, 4)], [seg('b1', 0, 4)]],
			encode: ({ segment }) => {
				calls++;
				if (segment.id === 'a2') return { result: failing.promise, cancel: async () => {} };
				return okHandle(new Blob([new Uint8Array([1])]));
			}
		});
		h.state.setFiles([file('a.mp4'), file('b.mp4')]);
		const run = h.state.start();
		await expect.poll(() => calls).toBe(2);
		failing.reject(new Error('encode boom'));
		await run;

		expect(h.state.items[0].status).toBe('failed');
		expect(h.state.items[0].error).toContain('encode boom');
		expect(h.state.items[1].status).toBe('done');
		// Only the completed file's parts make it into the archive.
		expect(h.zipCalls[0].map((entry) => entry.name)).toEqual(['b/b_part01.mp4']);
	});

	it('cancel stops after the current clip: remaining files never start, nothing downloads', async () => {
		const first = deferred<Blob>();
		const encodeCalls: string[] = [];
		const h = harness({
			results: [[seg('a1', 0, 2), seg('a2', 2, 4)], [seg('b1', 0, 4)]],
			encode: ({ segment }) => {
				encodeCalls.push(segment.id);
				return segment.id === 'a1' ? { result: first.promise, cancel: async () => {} } : okHandle();
			}
		});
		h.state.setFiles([file('a.mp4'), file('b.mp4')]);
		const run = h.state.start();
		await expect.poll(() => h.state.items[0].status).toBe('encoding');

		h.state.cancel();
		first.resolve(new Blob([new Uint8Array([1])]));
		await run;

		expect(h.inspect).toHaveBeenCalledTimes(1);
		expect(h.zipCalls).toEqual([]);
		expect(h.downloads).toEqual([]);
		expect(h.state.running).toBe(false);
		// Canceled file returns to the queue; untouched file stays queued.
		expect(h.state.items.map((i) => i.status)).toEqual(['queued', 'queued']);
		// The clip that was encoding finishes, but no further clip is started.
		expect(encodeCalls).toEqual(['a1']);
	});

	it('never ZIPs or downloads a canceled run, even after the last clip resolves', async () => {
		const second = deferred<Blob>();
		const h = harness({
			results: [[seg('a1', 0, 2)], [seg('b1', 0, 2)]],
			encode: ({ segment }) =>
				segment.id === 'b1' ? { result: second.promise, cancel: async () => {} } : okHandle()
		});
		h.state.setFiles([file('a.mp4'), file('b.mp4')]);
		const run = h.state.start();
		await expect.poll(() => h.state.items[0].status).toBe('done');
		await expect.poll(() => h.state.items[1].status).toBe('encoding');

		h.state.cancel();
		second.resolve(new Blob([new Uint8Array([1])]));
		await run;

		// File 1 finished before the cancel: its parts must not ship.
		expect(h.zipCalls).toEqual([]);
		expect(h.downloads).toEqual([]);
		expect(h.state.items.map((i) => i.status)).toEqual(['done', 'queued']);
	});

	it('does not download when canceled while the ZIP is being assembled', async () => {
		const zipPending = deferred<Blob>();
		const zipCalls: { name: string; blob: Blob }[][] = [];
		const h = harness({
			results: [[seg('a1', 0, 2)]],
			makeZip: async (entries) => {
				zipCalls.push(entries);
				return zipPending.promise;
			}
		});
		h.state.setFiles([file('a.mp4')]);
		const run = h.state.start();
		await expect.poll(() => zipCalls.length).toBe(1);

		h.state.cancel();
		zipPending.resolve(new Blob([new Uint8Array([9])]));
		await run;

		expect(h.downloads).toEqual([]);
	});

	it('cancel while reading returns the row to queued instead of leaving it on Reading', async () => {
		const inspectPending = deferred<InspectResult>();
		const h = harness({
			results: [[seg('a1', 0, 2)]],
			inspect: async () => inspectPending.promise
		});
		h.state.setFiles([file('a.mp4')]);
		const run = h.state.start();
		await expect.poll(() => h.state.items[0].status).toBe('reading');

		h.state.cancel();
		inspectPending.resolve({ duration: 4, meta: meta() });
		await run;

		expect(h.state.items[0].status).toBe('queued');
		expect(h.zipCalls).toEqual([]);
		expect(h.downloads).toEqual([]);
	});

	it('suffixes duplicate base names so no file is silently dropped', async () => {
		const h = harness({
			results: [[seg('a1', 0, 2)], [seg('b1', 0, 2)], [seg('c1', 0, 2)]]
		});
		// All three sanitize to the same base "My_Clip".
		h.state.setFiles([file('My Clip.mp4'), file('My_Clip.mp4'), file('My  Clip.mp4')]);
		await h.state.start();

		expect(h.zipCalls).toHaveLength(1);
		expect(h.zipCalls[0].map((entry) => entry.name)).toEqual([
			'My_Clip/My_Clip_part01.mp4',
			'My_Clip_2/My_Clip_2_part01.mp4',
			'My_Clip_3/My_Clip_3_part01.mp4'
		]);
		expect(h.state.items.map((i) => i.status)).toEqual(['done', 'done', 'done']);
		expect(h.downloads).toEqual([BATCH_ZIP_NAME]);
	});

	it('does not suffix Object.prototype names like constructor or toString', async () => {
		const h = harness({
			results: [[seg('a1', 0, 2)], [seg('b1', 0, 2)]]
		});
		// A plain {} inherits these from Object.prototype, so a first occurrence
		// must not be treated as a duplicate.
		h.state.setFiles([file('constructor.mp4'), file('toString.mp4')]);
		await h.state.start();

		expect(h.zipCalls).toHaveLength(1);
		expect(h.zipCalls[0].map((entry) => entry.name)).toEqual([
			'constructor/constructor_part01.mp4',
			'toString/toString_part01.mp4'
		]);
		expect(h.state.items.map((i) => i.status)).toEqual(['done', 'done']);
		expect(h.downloads).toEqual([BATCH_ZIP_NAME]);
	});

	it('cancels the in-flight clip when a new selection replaces the queue', async () => {
		const pending = deferred<Blob>();
		let cancelCalls = 0;
		const h = harness({
			results: [[seg('a1', 0, 2)]],
			encode: () => ({
				result: pending.promise,
				cancel: async () => {
					cancelCalls++;
				}
			})
		});
		h.state.setFiles([file('a.mp4')]);
		const run = h.state.start();
		await expect.poll(() => h.state.items[0].status).toBe('encoding');

		h.state.setFiles([file('b.mp4')]);
		expect(cancelCalls).toBe(1);

		// The stale run's late result must not produce a download.
		pending.resolve(new Blob([new Uint8Array([1])]));
		await run;
		expect(h.zipCalls).toEqual([]);
		expect(h.downloads).toEqual([]);
	});

	it('clear() while running stops the run without a download', async () => {
		const pending = deferred<Blob>();
		let cancelCalls = 0;
		const h = harness({
			results: [[seg('a1', 0, 2)]],
			encode: () => ({
				result: pending.promise,
				cancel: async () => {
					cancelCalls++;
				}
			})
		});
		h.state.setFiles([file('a.mp4')]);
		const run = h.state.start();
		await expect.poll(() => h.state.running).toBe(true);

		h.state.clear();
		expect(h.state.running).toBe(false);
		expect(h.state.items).toEqual([]);
		expect(cancelCalls).toBe(1);

		pending.resolve(new Blob([new Uint8Array([1])]));
		await run;
		expect(h.zipCalls).toEqual([]);
		expect(h.downloads).toEqual([]);
	});

	it('surfaces per-file state through progress callbacks', async () => {
		const pending = deferred<Blob>();
		const h = harness({
			results: [[seg('a1', 0, 2)]],
			encode: ({ onProgress }) => {
				onProgress(0.5);
				return { result: pending.promise, cancel: async () => {} };
			}
		});
		h.state.setFiles([file('a.mp4')]);
		const run = h.state.start();

		await expect.poll(() => h.state.items[0].status).toBe('encoding');
		expect(h.state.items[0].progress).toBe(0.5);
		expect(h.state.items[0].clipIndex).toBe(1);
		expect(h.state.items[0].clipCount).toBe(1);

		pending.resolve(new Blob([new Uint8Array([1])]));
		await run;
		expect(h.state.items[0].progress).toBe(1);
		expect(h.state.items[0].status).toBe('done');
	});

	it('reads preset, crop916 and maxClipDuration from the project', async () => {
		project.maxClipDuration = 7;
		project.preset = 'high';
		project.crop916 = true;
		const h = harness({ results: [[seg('a1', 0, 7)]] });
		h.state.setFiles([file('a.mp4')]);
		await h.state.start();

		expect(h.split).toHaveBeenCalledWith(4, 7);
		expect(h.encodes[0].plan.fit).toBe('cover');
		expect(h.encodes[0].plan.videoKbps).toBe(8000);
	});

	it('does not start a second run while one is in flight', async () => {
		const pending = deferred<Blob>();
		const h = harness({
			results: [[seg('a1', 0, 2)]],
			encode: () => ({ result: pending.promise, cancel: async () => {} })
		});
		h.state.setFiles([file('a.mp4')]);
		const run = h.state.start();
		await expect.poll(() => h.state.running).toBe(true);
		await h.state.start();
		expect(h.inspect).toHaveBeenCalledTimes(1);
		pending.resolve(new Blob([new Uint8Array([1])]));
		await run;
	});
});
