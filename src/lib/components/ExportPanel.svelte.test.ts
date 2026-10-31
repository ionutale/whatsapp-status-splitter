import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { VideoMeta } from '../domain/bitrate';
import { ExportState } from '../state/export.svelte';
import { project } from '../state/project.svelte';
import ExportPanel from './ExportPanel.svelte';

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

const fakeBlob = new Blob([new Uint8Array([1])]);

function makeExporter(downloads: string[]) {
	return new ExportState({
		encodeClip: () => ({
			result: Promise.resolve(fakeBlob),
			cancel: async () => {}
		}),
		downloadBlob: (_blob, name) => downloads.push(name),
		makeZip: async () => fakeBlob
	});
}

function makeCountingExporter() {
	const blobs: Blob[] = [];
	const state = new ExportState({
		encodeClip: () => {
			const blob = new Blob([new Uint8Array(blobs.length + 1)]);
			blobs.push(blob);
			return { result: Promise.resolve(blob), cancel: async () => {} };
		},
		downloadBlob: () => {},
		makeZip: async () => fakeBlob
	});
	return { state, blobs };
}

function makeFailAfterFirstExporter() {
	const invocations: number[] = [];
	const state = new ExportState({
		encodeClip: () => {
			invocations.push(invocations.length + 1);
			if (invocations.length > 1) {
				return { result: Promise.reject(new Error('encode boom')), cancel: async () => {} };
			}
			return {
				result: Promise.resolve(new Blob([new Uint8Array([9])])),
				cancel: async () => {}
			};
		},
		downloadBlob: () => {},
		makeZip: async () => fakeBlob
	});
	return { state, invocations };
}

describe('ExportPanel', () => {
	beforeEach(() => {
		project.begin(new File([], 'vid.mp4'));
		project.ready(80, meta());
		project.preset = 'whatsapp';
		project.crop916 = false;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('lists one row per clip with estimated sizes', async () => {
		const screen = await render(ExportPanel, { exporter: makeExporter([]) });
		expect(screen.container.querySelectorAll('[data-testid="export-row"]')).toHaveLength(3);
	});

	it('downloads the clicked clip with its part name', async () => {
		const downloads: string[] = [];
		const screen = await render(ExportPanel, { exporter: makeExporter(downloads) });
		(
			screen.container.querySelector('[data-testid="btn-export-clip"]') as HTMLButtonElement
		).click();
		await expect.poll(() => downloads.length).toBe(1);
		expect(downloads[0]).toBe('vid_part01.mp4');
	});

	it('changes the quality preset', async () => {
		const screen = await render(ExportPanel, { exporter: makeExporter([]) });
		const select = screen.container.querySelector(
			'[data-testid="preset-select"]'
		) as HTMLSelectElement;
		select.value = 'small';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		expect(project.preset).toBe('small');
	});

	it('toggles the 9:16 center-crop option', async () => {
		const screen = await render(ExportPanel, { exporter: makeExporter([]) });
		const toggle = screen.container.querySelector(
			'[data-testid="toggle-crop916"]'
		) as HTMLInputElement;
		expect(toggle.checked).toBe(false);
		expect(project.crop916).toBe(false);

		toggle.click();
		await expect.poll(() => project.crop916).toBe(true);
		expect(toggle.checked).toBe(true);

		toggle.click();
		await expect.poll(() => project.crop916).toBe(false);
		expect(toggle.checked).toBe(false);
	});

	it('re-encodes for share when the preset changed since the last export', async () => {
		const { state, blobs } = makeCountingExporter();
		const share = vi.fn<(data: { files: File[] }) => Promise<void>>(async () => {});
		vi.stubGlobal('navigator', { canShare: () => true, share });
		const screen = await render(ExportPanel, { exporter: state });

		(
			screen.container.querySelector('[data-testid="btn-export-clip"]') as HTMLButtonElement
		).click();
		await expect.poll(() => blobs.length).toBe(1);

		const select = screen.container.querySelector(
			'[data-testid="preset-select"]'
		) as HTMLSelectElement;
		select.value = 'small';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));

		(screen.container.querySelector('[data-testid="btn-share-clip"]') as HTMLButtonElement).click();
		await expect.poll(() => blobs.length).toBe(2);
		await expect.poll(() => share.mock.calls.length).toBe(1);

		const file = share.mock.calls[0][0].files[0];
		expect(file.size).toBe(blobs[1].size);
		expect(file.size).not.toBe(blobs[0].size);
	});

	it('never shares or caches a stale blob after a failed re-encode', async () => {
		const { state, invocations } = makeFailAfterFirstExporter();
		const share = vi.fn<(data: { files: File[] }) => Promise<void>>(async () => {});
		vi.stubGlobal('navigator', { canShare: () => true, share });
		const screen = await render(ExportPanel, { exporter: state });
		const id = project.sortedSegments[0].id;

		// First encode succeeds, populating state.results[id].
		(
			screen.container.querySelector('[data-testid="btn-export-clip"]') as HTMLButtonElement
		).click();
		await expect.poll(() => invocations.length).toBe(1);

		// Change the preset so Share must re-encode; that re-encode fails.
		const select = screen.container.querySelector(
			'[data-testid="preset-select"]'
		) as HTMLSelectElement;
		select.value = 'small';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));

		(screen.container.querySelector('[data-testid="btn-share-clip"]') as HTMLButtonElement).click();
		await expect.poll(() => state.statuses[id]).toBe('failed');
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(share).not.toHaveBeenCalled();

		// No stale cache entry: a second Share re-encodes instead of reusing.
		(screen.container.querySelector('[data-testid="btn-share-clip"]') as HTMLButtonElement).click();
		await expect.poll(() => invocations.length).toBe(3);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(share).not.toHaveBeenCalled();
	});

	it('shares every prepared clip in one call', async () => {
		const share = vi.fn<(data: { files: File[] }) => Promise<void>>(async () => {});
		vi.stubGlobal('navigator', { canShare: () => true, share });
		const screen = await render(ExportPanel, { exporter: makeExporter([]) });
		(screen.container.querySelector('[data-testid="btn-share-all"]') as HTMLButtonElement).click();
		await expect.poll(() => share.mock.calls.length).toBe(1);
		expect(share.mock.calls[0][0].files.map((f) => f.name)).toEqual([
			'vid_part01.mp4',
			'vid_part02.mp4',
			'vid_part03.mp4'
		]);
	});

	it('never re-encodes when the browser refuses after a long prepare', async () => {
		const { state, blobs } = makeCountingExporter();
		const share = vi
			.fn()
			.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
			.mockResolvedValueOnce(undefined);
		vi.stubGlobal('navigator', { canShare: () => true, share });
		const screen = await render(ExportPanel, { exporter: state });
		const btn = () =>
			screen.container.querySelector('[data-testid="btn-share-all"]') as HTMLButtonElement;
		btn().click();
		await expect.poll(() => share.mock.calls.length).toBe(1);
		await expect.poll(() => btn().dataset.state).toBe('ready');
		btn().click();
		await expect.poll(() => share.mock.calls.length).toBe(2);
		expect(blobs.length).toBe(3); // one encode per clip, total
	});

	it('shares only the successful subset when a clip fails', async () => {
		const { state } = makeFailAfterFirstExporter(); // first succeeds, rest fail
		const share = vi
			.fn()
			.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
			.mockResolvedValue(undefined);
		vi.stubGlobal('navigator', { canShare: () => true, share });
		const screen = await render(ExportPanel, { exporter: state });
		(screen.container.querySelector('[data-testid="btn-share-all"]') as HTMLButtonElement).click();
		await expect.poll(() => share.mock.calls.length).toBe(1);
		expect(share.mock.calls[0][0].files).toHaveLength(1);
		await expect
			.poll(() => screen.container.querySelector('[data-testid="btn-share-all"]')?.textContent)
			.toBe('Share 1 of 3'); // stays visible in the ready state after the refusal
	});

	it('shares nothing when preparation is canceled', async () => {
		let reject!: (error: Error) => void;
		const state = new ExportState({
			encodeClip: () => ({
				result: new Promise((_resolve, r) => {
					reject = r;
				}),
				cancel: async () =>
					reject(Object.assign(new Error('canceled'), { name: 'ConversionCanceledError' }))
			}),
			downloadBlob: () => {},
			makeZip: async () => fakeBlob
		});
		const share = vi.fn(async () => {});
		vi.stubGlobal('navigator', { canShare: () => true, share });
		const screen = await render(ExportPanel, { exporter: state });
		(screen.container.querySelector('[data-testid="btn-share-all"]') as HTMLButtonElement).click();
		await expect.poll(() => state.busy).toBe(true);
		(
			screen.container.querySelector('[data-testid="btn-cancel-export"]') as HTMLButtonElement
		).click();
		await expect.poll(() => state.busy).toBe(false);
		expect(share).not.toHaveBeenCalled();
	});

	it('drops stale blobs when settings change during preparation', async () => {
		const resolvers: ((blob: Blob) => void)[] = [];
		const state = new ExportState({
			encodeClip: () => ({
				result: new Promise<Blob>((resolve) => resolvers.push(resolve)),
				cancel: async () => {}
			}),
			downloadBlob: () => {},
			makeZip: async () => fakeBlob
		});
		const share = vi.fn(async () => {});
		vi.stubGlobal('navigator', { canShare: () => true, share });
		const screen = await render(ExportPanel, { exporter: state });
		(screen.container.querySelector('[data-testid="btn-share-all"]') as HTMLButtonElement).click();
		await expect.poll(() => resolvers.length).toBe(1);
		project.preset = 'small'; // settings change mid-prepare

		// Drain the sequential encoder one clip at a time until the run finishes.
		while (state.busy) {
			resolvers.shift()?.(fakeBlob);
			await new Promise((resolve) => setTimeout(resolve, 0));
		}

		expect(share).not.toHaveBeenCalled();
		expect(screen.container.querySelector('[data-testid="share-all-error"]')).not.toBeNull();
	});

	it('hides Share all for a single clip', async () => {
		project.ready(5, meta()); // 1 clip
		const screen = await render(ExportPanel, { exporter: makeExporter([]) });
		expect(screen.container.querySelector('[data-testid="btn-share-all"]')).toBeNull();
	});

	it('resets share-all state when the file changes', async () => {
		const share = vi
			.fn()
			.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
			.mockResolvedValue(undefined);
		vi.stubGlobal('navigator', { canShare: () => true, share });
		const screen = await render(ExportPanel, { exporter: makeExporter([]) });
		const btn = () =>
			screen.container.querySelector('[data-testid="btn-share-all"]') as HTMLButtonElement;
		btn().click();
		await expect.poll(() => btn().dataset.state).toBe('ready');
		project.begin(new File([], 'other.mp4'));
		project.ready(80, meta());
		await new Promise((resolve) => setTimeout(resolve, 0));
		await expect.poll(() => btn().dataset.state).toBe('idle');
		btn().click();
		await expect.poll(() => share.mock.calls.length).toBe(2);
		const lastNames = share.mock.calls[share.mock.calls.length - 1][0].files.map(
			(f: File) => f.name
		);
		expect(lastNames).not.toContain('vid_part01.mp4');
	});

	it('walks clip by clip when multi-file sharing is unsupported', async () => {
		const share = vi.fn<(data: { files: File[] }) => Promise<void>>(async () => {});
		vi.stubGlobal('navigator', {
			canShare: (data: { files: File[] }) => data.files.length === 1,
			share
		});
		const screen = await render(ExportPanel, { exporter: makeExporter([]) });
		(screen.container.querySelector('[data-testid="btn-share-all"]') as HTMLButtonElement).click();
		await expect
			.poll(
				() => screen.container.querySelector('[data-testid="share-guided-status"]')?.textContent
			)
			.toContain('1 of 3');
		(screen.container.querySelector('[data-testid="btn-share-next"]') as HTMLButtonElement).click();
		await expect.poll(() => share.mock.calls.length).toBe(1);
		expect(share.mock.calls[0][0].files.map((f: File) => f.name)).toEqual(['vid_part01.mp4']);
		await expect
			.poll(
				() => screen.container.querySelector('[data-testid="share-guided-status"]')?.textContent
			)
			.toContain('2 of 3');
	});

	it('stays on the same clip when the user cancels the sheet', async () => {
		const share = vi
			.fn()
			.mockRejectedValueOnce(Object.assign(new Error('cancel'), { name: 'AbortError' }))
			.mockResolvedValue(undefined);
		vi.stubGlobal('navigator', {
			canShare: (data: { files: File[] }) => data.files.length === 1,
			share
		});
		const screen = await render(ExportPanel, { exporter: makeExporter([]) });
		(screen.container.querySelector('[data-testid="btn-share-all"]') as HTMLButtonElement).click();
		await expect
			.poll(() => screen.container.querySelector('[data-testid="btn-share-next"]'))
			.not.toBeNull();
		(screen.container.querySelector('[data-testid="btn-share-next"]') as HTMLButtonElement).click();
		await expect.poll(() => share.mock.calls.length).toBe(1);
		await expect
			.poll(
				() => screen.container.querySelector('[data-testid="share-guided-status"]')?.textContent
			)
			.toContain('1 of 3');
		(screen.container.querySelector('[data-testid="btn-share-next"]') as HTMLButtonElement).click();
		await expect.poll(() => share.mock.calls.length).toBe(2);
		await expect
			.poll(
				() => screen.container.querySelector('[data-testid="share-guided-status"]')?.textContent
			)
			.toContain('2 of 3');
	});

	it('exits guided mode without sharing', async () => {
		const share = vi.fn(async () => {});
		vi.stubGlobal('navigator', {
			canShare: (data: { files: File[] }) => data.files.length === 1,
			share
		});
		const screen = await render(ExportPanel, { exporter: makeExporter([]) });
		(screen.container.querySelector('[data-testid="btn-share-all"]') as HTMLButtonElement).click();
		await expect
			.poll(() => screen.container.querySelector('[data-testid="btn-share-guided-exit"]'))
			.not.toBeNull();
		(
			screen.container.querySelector('[data-testid="btn-share-guided-exit"]') as HTMLButtonElement
		).click();
		await expect
			.poll(() => screen.container.querySelector('[data-testid="share-guided-status"]'))
			.toBeNull();
		expect(share).not.toHaveBeenCalled();
	});
});
