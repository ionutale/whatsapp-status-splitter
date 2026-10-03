import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

// Distinct metadata per file, plus a controllable inspect that parks each call
// until the test releases it by name. That lets the two loads race
// deterministically and makes each load's continuation observable downstream.
const mocks = vi.hoisted(() => {
	const pending = new Map<string, () => void>();
	const files: Record<string, { duration: number; width: number; height: number }> = {
		'first.mp4': { duration: 5, width: 320, height: 240 },
		'second.mp4': { duration: 9, width: 1920, height: 1080 }
	};
	return {
		pending,
		files,
		inspectFile: vi.fn(async (file: File) => {
			await new Promise<void>((resolve) => pending.set(file.name, resolve));
			const spec = files[file.name];
			if (!spec) throw new Error(`unexpected file in rapid test: ${file.name}`);
			return {
				duration: spec.duration,
				meta: {
					displayWidth: spec.width,
					displayHeight: spec.height,
					rotation: 0 as const,
					frameRate: 30,
					videoCodec: 'avc1.42E01E',
					audioCodec: null,
					hasAudio: false,
					audioDecodable: false,
					videoDecodable: true
				}
			};
		}),
		assertDecodable: vi.fn(() => null)
	};
});

vi.mock('../lib/media/inspect', () => ({
	inspectFile: mocks.inspectFile,
	assertDecodable: mocks.assertDecodable
}));

// The fake files are not real videos; skip the (irrelevant, noisy) thumbnail
// extraction that the page triggers once a file is ready.
vi.mock('../lib/media/thumbnails', () => ({
	extractThumbnails: vi.fn(async () => {})
}));

describe('page rapid loads', () => {
	it('keeps the second file when the stale first load resolves last', async () => {
		const screen = await render(Page);
		const input = screen.container.querySelector('[data-testid="file-input"]') as HTMLInputElement;

		const load = (name: string, byte: number) => {
			const transfer = new DataTransfer();
			transfer.items.add(new File([new Uint8Array([byte])], name, { type: 'video/mp4' }));
			input.files = transfer.files;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		};

		load('first.mp4', 1);
		await expect.poll(() => mocks.pending.has('first.mp4')).toBe(true);

		load('second.mp4', 2);
		await expect.poll(() => mocks.pending.has('second.mp4')).toBe(true);

		// Release the second load first, then the stale first load, so the stale
		// continuation lands last. Only the load token can stop it from
		// overwriting the second file's state.
		mocks.pending.get('second.mp4')?.();
		mocks.pending.get('first.mp4')?.();

		// Let both continuations and Svelte's DOM flush settle before asserting,
		// so a stale write can't hide behind a transient poll pass.
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));

		// The selected clip's end (00:09.0) comes from `project.ready()` running
		// for the 9s second file. The stale first load would set it to 00:05.0.
		const end = screen.container.querySelector(
			'[data-testid="time-field-end"]'
		) as HTMLInputElement;
		expect(end.value).toBe('00:09.0');
		expect(screen.container.querySelector('[data-testid="file-name"]')?.textContent).toContain(
			'second.mp4'
		);
	});
});
