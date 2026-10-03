import { describe, expect, it } from 'vitest';
import type { EncodeClipFactory, EncodeHandle } from '../media/exporter';
import { ExportState, type ExportJob } from './export.svelte';

const job = (id: string): ExportJob => ({
	id,
	fileName: `vid_${id}.mp4`,
	segment: { id, start: 0, end: 1 },
	plan: {
		width: 320,
		height: 240,
		frameRate: 30,
		videoKbps: 1000,
		audioKbps: 128,
		estimatedBytes: 100
	}
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function fakeEncoder() {
	const calls: { id: string; handle: EncodeHandle }[] = [];
	const factories: (() => EncodeHandle)[] = [];
	const factory: EncodeClipFactory = (args) => {
		const scripted = factories.shift();
		const handle = scripted ? scripted() : successHandle();
		calls.push({ id: args.segment.id, handle });
		return handle;
	};
	const successHandle = (): EncodeHandle => {
		const d = deferred<Blob>();
		d.resolve(new Blob([new Uint8Array([1])]));
		return { result: d.promise, cancel: async () => {} };
	};
	return { factory, calls, push: (fn: () => EncodeHandle) => factories.push(fn) };
}

const makeDeps = (
	encoder = fakeEncoder(),
	makeZipOverride?: (entries: { name: string; blob: Blob }[]) => Promise<Blob>
) => {
	const downloads: string[] = [];
	const zips: { name: string; count: number }[] = [];
	const state = new ExportState({
		encodeClip: encoder.factory,
		downloadBlob: (_blob, name) => downloads.push(name),
		makeZip:
			makeZipOverride ??
			(async (entries) => {
				zips.push({ name: 'zip', count: entries.length });
				return new Blob([new Uint8Array([1])]);
			})
	});
	return { state, encoder, downloads, zips };
};

describe('ExportState', () => {
	it('downloads a single successful clip', async () => {
		const { state, downloads } = makeDeps();
		await state.runJobs(new File([], 'v.mp4'), [job('a')], { finish: 'download-first' });
		expect(state.statuses['a']).toBe('done');
		expect(state.results['a']).toBeInstanceOf(Blob);
		expect(downloads).toEqual(['vid_a.mp4']);
		expect(state.busy).toBe(false);
	});

	it('continues after a failure and downloads the first success', async () => {
		const { state, encoder, downloads } = makeDeps();
		encoder.push(() => ({ result: Promise.reject(new Error('boom')), cancel: async () => {} }));
		await state.runJobs(new File([], 'v.mp4'), [job('a'), job('b')], { finish: 'download-first' });
		expect(state.statuses['a']).toBe('failed');
		expect(state.errors['a']).toContain('boom');
		expect(state.statuses['b']).toBe('done');
		expect(downloads).toEqual(['vid_b.mp4']);
	});

	it('zips all successful clips', async () => {
		const { state, zips, downloads } = makeDeps();
		await state.runJobs(new File([], 'v.mp4'), [job('a'), job('b')], {
			finish: 'zip',
			zipName: 'all.zip'
		});
		expect(zips).toEqual([{ name: 'zip', count: 2 }]);
		expect(downloads).toEqual(['all.zip']);
	});

	it('cancels the current conversion and stops the queue without downloading', async () => {
		const { state, encoder, downloads } = makeDeps();
		let cancelCalled = false;
		const d = deferred<Blob>();
		encoder.push(() => ({
			result: d.promise,
			cancel: async () => {
				cancelCalled = true;
				d.reject(new Error('ConversionCanceledError'));
			}
		}));
		const run = state.runJobs(new File([], 'v.mp4'), [job('a'), job('b')], {
			finish: 'zip',
			zipName: 'all.zip'
		});
		await Promise.resolve();
		await state.cancel();
		await run;
		expect(cancelCalled).toBe(true);
		expect(state.statuses['a']).toBe('canceled');
		expect(state.statuses['b']).toBeUndefined();
		expect(downloads).toEqual([]);
		expect(state.busy).toBe(false);
	});

	it('supports retrying a failed clip', async () => {
		const { state, encoder } = makeDeps();
		encoder.push(() => ({ result: Promise.reject(new Error('boom')), cancel: async () => {} }));
		await state.runJobs(new File([], 'v.mp4'), [job('a')], { finish: 'none' });
		expect(state.statuses['a']).toBe('failed');
		await state.runJobs(new File([], 'v.mp4'), [job('a')], { finish: 'none' });
		expect(state.statuses['a']).toBe('done');
	});

	it('skips the zip when a cancel arrives after a partial success', async () => {
		const { state, encoder, downloads } = makeDeps();
		const d = deferred<Blob>();
		encoder.push(() => ({
			result: Promise.resolve(new Blob([new Uint8Array([1])])),
			cancel: async () => {}
		}));
		encoder.push(() => ({
			result: d.promise,
			cancel: async () => {
				d.reject(new Error('ConversionCanceledError'));
			}
		}));
		const run = state.runJobs(new File([], 'v.mp4'), [job('a'), job('b')], {
			finish: 'zip',
			zipName: 'all.zip'
		});
		await Promise.resolve();
		await state.cancel();
		await run;
		expect(downloads).toEqual([]);
		expect(state.results['a']).toBeInstanceOf(Blob);
		expect(state.statuses['a']).toBe('done');
		expect(state.statuses['b']).toBe('canceled');
		expect(state.busy).toBe(false);
		expect(state.runError).toBeNull();
	});

	it('surfaces a finish failure and unlocks', async () => {
		const { state } = makeDeps(fakeEncoder(), async () => {
			throw new Error('zip boom');
		});
		await state.runJobs(new File([], 'v.mp4'), [job('a')], {
			finish: 'zip',
			zipName: 'all.zip'
		});
		expect(state.busy).toBe(false);
		expect(state.runError).toContain('zip boom');
	});

	it('ignores a second run while one is already in flight', async () => {
		const { state, encoder } = makeDeps();
		const d = deferred<Blob>();
		encoder.push(() => ({ result: d.promise, cancel: async () => {} }));
		const first = state.runJobs(new File([], 'v.mp4'), [job('a')], { finish: 'none' });
		await Promise.resolve();
		await state.runJobs(new File([], 'v.mp4'), [job('b')], { finish: 'none' });
		expect(encoder.calls.map((call) => call.id)).toEqual(['a']);
		expect(state.statuses['b']).toBeUndefined();
		d.resolve(new Blob([new Uint8Array([1])]));
		await first;
		expect(state.statuses['a']).toBe('done');
		expect(state.busy).toBe(false);
	});

	it('reset clears all state and discards a stale run’s late writes', async () => {
		const { state, encoder, downloads } = makeDeps();
		const d = deferred<Blob>();
		encoder.push(() => ({ result: d.promise, cancel: async () => {} }));
		const run = state.runJobs(new File([], 'v.mp4'), [job('a')], { finish: 'download-first' });
		await Promise.resolve();
		expect(state.statuses['a']).toBe('encoding');

		state.reset();
		expect(state.statuses).toEqual({});
		expect(state.progress).toEqual({});
		expect(state.errors).toEqual({});
		expect(state.results).toEqual({});
		expect(state.runError).toBeNull();

		// A blob that resolves after reset must not repopulate the cleared maps.
		d.resolve(new Blob([new Uint8Array([1])]));
		await run;
		expect(state.statuses).toEqual({});
		expect(state.progress).toEqual({});
		expect(state.errors).toEqual({});
		expect(state.results).toEqual({});
		expect(downloads).toEqual([]);
		expect(state.busy).toBe(false);
	});

	it('reset clears a prior run error', async () => {
		const { state } = makeDeps(fakeEncoder(), async () => {
			throw new Error('zip boom');
		});
		await state.runJobs(new File([], 'v.mp4'), [job('a')], {
			finish: 'zip',
			zipName: 'all.zip'
		});
		expect(state.runError).toContain('zip boom');
		state.reset();
		expect(state.runError).toBeNull();
		expect(state.statuses).toEqual({});
	});
});
