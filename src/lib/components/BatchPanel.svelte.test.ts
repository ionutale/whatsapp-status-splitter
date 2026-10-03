import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { VideoMeta } from '../domain/bitrate';
import type { Segment } from '../domain/segments';
import type { EncodeClipFactory } from '../media/exporter';
import { BatchState, type BatchDeps } from '../state/batch.svelte';
import { project } from '../state/project.svelte';
import BatchPanel from './BatchPanel.svelte';

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

const file = (name: string) => new File([new Uint8Array([1])], name, { type: 'video/mp4' });

function makeState(
	downloads: string[],
	encode: EncodeClipFactory = () => ({
		result: Promise.resolve(new Blob([new Uint8Array([1])])),
		cancel: async () => {}
	})
) {
	const deps: BatchDeps = {
		inspect: async () => ({ duration: 4, meta: meta() }),
		split: () => [seg('s1', 0, 2)],
		encodeClip: encode,
		makeZip: async () => new Blob([new Uint8Array([9])]),
		downloadBlob: (_blob, name) => downloads.push(name)
	};
	return new BatchState(deps);
}

const el = <T extends Element>(screen: { container: HTMLElement }, testid: string) =>
	screen.container.querySelector(`[data-testid="${testid}"]`) as T | null;

describe('BatchPanel', () => {
	beforeEach(() => {
		project.maxClipDuration = 30;
		project.preset = 'whatsapp';
		project.crop916 = false;
	});

	afterEach(() => {
		project.flushPendingWrites();
		vi.restoreAllMocks();
	});

	it('renders one row per queued file', async () => {
		const state = makeState([]);
		state.setFiles([file('a.mp4'), file('b.mp4')]);
		const screen = await render(BatchPanel, { batch: state });

		expect(screen.container.querySelectorAll('[data-testid="batch-item"]')).toHaveLength(2);
		const statuses = Array.from(
			screen.container.querySelectorAll('[data-testid="batch-status"]')
		).map((node) => node.textContent?.trim());
		expect(statuses).toEqual(['Queued', 'Queued']);
	});

	it('Start runs the batch with the injected deps and updates statuses', async () => {
		const downloads: string[] = [];
		const state = makeState(downloads);
		state.setFiles([file('a.mp4')]);
		const screen = await render(BatchPanel, { batch: state });

		el<HTMLButtonElement>(screen, 'batch-start')!.click();

		await expect.poll(() => downloads.length).toBe(1);
		expect(downloads[0]).toBe('status_batch.zip');
		await expect.poll(() => el(screen, 'batch-status')?.textContent?.trim()).toBe('Done');
	});

	it('shows clip progress while encoding', async () => {
		let release!: (blob: Blob) => void;
		const state = makeState([], ({ onProgress }) => {
			onProgress(0.25);
			return {
				result: new Promise<Blob>((resolve) => {
					release = resolve;
				}),
				cancel: async () => {}
			};
		});
		state.setFiles([file('a.mp4')]);
		const screen = await render(BatchPanel, { batch: state });

		el<HTMLButtonElement>(screen, 'batch-start')!.click();
		await expect.poll(() => el(screen, 'batch-status')?.textContent?.trim()).toBe('Clip 1 of 1');

		release(new Blob([new Uint8Array([1])]));
		await expect.poll(() => el(screen, 'batch-status')?.textContent?.trim()).toBe('Done');
	});

	it('shows the current settings read-only', async () => {
		const state = makeState([]);
		state.setFiles([file('a.mp4')]);
		const screen = await render(BatchPanel, {
			batch: state,
			maxClipDuration: 7,
			preset: 'high',
			crop916: true
		});

		expect(el(screen, 'batch-settings')?.textContent?.trim()).toBe(
			'7s clips · high preset · 9:16 crop on'
		);
	});

	it('Cancel calls through while running', async () => {
		const state = makeState([], () => ({
			result: new Promise<Blob>(() => {}),
			cancel: async () => {}
		}));
		state.setFiles([file('a.mp4')]);
		const screen = await render(BatchPanel, { batch: state });
		const cancel = vi.spyOn(state, 'cancel');

		el<HTMLButtonElement>(screen, 'batch-start')!.click();
		await expect.poll(() => el<HTMLButtonElement>(screen, 'batch-cancel')!.disabled).toBe(false);

		el<HTMLButtonElement>(screen, 'batch-cancel')!.click();
		expect(cancel).toHaveBeenCalledTimes(1);
	});
});
