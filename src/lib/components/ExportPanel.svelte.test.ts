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

describe('ExportPanel', () => {
	beforeEach(() => {
		project.begin(new File([], 'vid.mp4'));
		project.ready(80, meta());
		project.preset = 'whatsapp';
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
});
