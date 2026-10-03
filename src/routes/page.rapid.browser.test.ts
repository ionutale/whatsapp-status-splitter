import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

// Controllable inspect mock: each call parks until the test releases it by
// file name, so two loads can be raced deterministically.
const mocks = vi.hoisted(() => {
	const pending = new Map<string, () => void>();
	return {
		pending,
		inspectFile: vi.fn(async (file: File) => {
			await new Promise<void>((resolve) => pending.set(file.name, resolve));
			return {
				duration: 5,
				meta: {
					displayWidth: 320,
					displayHeight: 240,
					rotation: 0,
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
	it('shows the second file when two loads race', async () => {
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

		// Resolve out of order so the stale first load lands last; the load token
		// must discard it and leave the second file in place.
		mocks.pending.get('second.mp4')?.();
		mocks.pending.get('first.mp4')?.();

		await expect
			.poll(() => screen.container.querySelector('[data-testid="file-name"]')?.textContent)
			.toContain('second.mp4');
		expect(screen.container.querySelector('[data-testid="file-name"]')?.textContent).not.toContain(
			'first.mp4'
		);
	});
});
