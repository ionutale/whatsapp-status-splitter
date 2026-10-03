import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { project } from '../lib/state/project.svelte';
import Page from './+page.svelte';

// A deterministic 60s source so auto-split (default 30s max) yields exactly two
// clips. The fake bytes never reach a real decoder — `inspectFile` is mocked and
// thumbnail extraction is skipped, mirroring the rapid-load page test.
const mocks = vi.hoisted(() => ({
	inspectFile: vi.fn(async (file: File) => {
		if (file.name !== 'phone.mp4') throw new Error(`unexpected file in phone test: ${file.name}`);
		return {
			duration: 60,
			meta: {
				displayWidth: 1920,
				displayHeight: 1080,
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
}));

vi.mock('../lib/media/inspect', () => ({
	inspectFile: mocks.inspectFile,
	assertDecodable: mocks.assertDecodable
}));

vi.mock('../lib/media/thumbnails', () => ({
	extractThumbnails: vi.fn(async () => {})
}));

type Screen = Awaited<ReturnType<typeof render>>;

function pickPhoneFile(screen: Screen) {
	const input = screen.container.querySelector('[data-testid="file-input"]') as HTMLInputElement;
	const transfer = new DataTransfer();
	transfer.items.add(new File([new Uint8Array([1, 2, 3])], 'phone.mp4', { type: 'video/mp4' }));
	input.files = transfer.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function renderPhone(): Promise<Screen> {
	await page.viewport(390, 844);
	const screen = await render(Page);
	pickPhoneFile(screen);
	await expect
		.poll(() => screen.container.querySelector('[data-testid="phone-editor"]'))
		.not.toBeNull();
	return screen;
}

describe('phone editor column', () => {
	beforeEach(() => {
		// `project` is a module singleton: reset it (and any persisted settings)
		// so each test starts from a clean auto-split.
		localStorage.clear();
		project.begin(new File([], 'reset.mp4'));
		project.setMaxClipDuration(30);
	});

	afterEach(async () => {
		await page.viewport(1280, 720);
	});

	it('shows the phone editor and hides the desktop timeline at a narrow viewport', async () => {
		const screen = await renderPhone();
		expect(screen.container.querySelector('[data-testid="phone-editor"]')).not.toBeNull();
		expect(screen.container.querySelector('[data-testid="trim-bar"]')).not.toBeNull();
		expect(screen.container.querySelector('[data-testid="timeline"]')).toBeNull();
		expect(screen.container.querySelector('[data-testid="filmstrip"]')).toBeNull();

		// Carried ClipStrip a11y follow-ups: chips expose their pressed state and
		// the max-length stepper value is a polite live region.
		const chips = screen.container.querySelectorAll('[data-testid="clip-chip"]');
		expect(chips[0].getAttribute('aria-pressed')).toBe('true');
		expect(chips[1].getAttribute('aria-pressed')).toBe('false');
		expect(
			screen.container.querySelector('[data-testid="max-clip-value"]')?.getAttribute('aria-live')
		).toBe('polite');
	});

	it('updates the trim bar when another clip chip is selected', async () => {
		const screen = await renderPhone();
		const chips = screen.container.querySelectorAll('[data-testid="clip-chip"]');
		expect(chips).toHaveLength(2);
		const bar = screen.container.querySelector('[data-testid="trim-bar"]') as HTMLElement;
		expect(Number(bar.dataset.start)).toBe(0);

		(chips[1] as HTMLElement).click();

		await vi.waitFor(() => {
			expect(Number(bar.dataset.start)).toBe(30);
		});
		expect(chips[1].getAttribute('aria-pressed')).toBe('true');
	});

	it('crosses the breakpoint to the desktop editor without losing segments', async () => {
		const screen = await renderPhone();
		const before = project.segments.map((segment) => ({ start: segment.start, end: segment.end }));

		await page.viewport(1280, 720);

		await expect
			.poll(() => screen.container.querySelector('[data-testid="phone-editor"]'))
			.toBeNull();
		expect(screen.container.querySelector('[data-testid="segment-bar"]')).not.toBeNull();
		const after = project.segments.map((segment) => ({ start: segment.start, end: segment.end }));
		expect(after).toEqual(before);
	});

	it('clamps a far-left end drag to the minimum clip length', async () => {
		const screen = await renderPhone();
		const bar = screen.container.querySelector('[data-testid="trim-bar"]') as HTMLElement;
		await vi.waitFor(() => {
			expect(Number(bar.dataset.pps)).toBeGreaterThan(0);
		});

		const handle = screen.container.querySelector('[data-testid="trim-handle-end"]') as HTMLElement;
		handle.dispatchEvent(
			new PointerEvent('pointerdown', { clientX: 300, bubbles: true, pointerId: 1 })
		);
		handle.dispatchEvent(
			new PointerEvent('pointermove', { clientX: -1000, bubbles: true, pointerId: 1 })
		);
		handle.dispatchEvent(
			new PointerEvent('pointerup', { clientX: -1000, bubbles: true, pointerId: 1 })
		);

		await vi.waitFor(() => {
			const start = Number(bar.dataset.start);
			const end = Number(bar.dataset.end);
			expect(end).toBeGreaterThanOrEqual(start + 0.5 - 1e-3);
		});
		expect(Number(bar.dataset.end)).toBeGreaterThan(Number(bar.dataset.start));
	});

	it('taps the phone preview to toggle playback', async () => {
		const screen = await renderPhone();
		const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
		const video = screen.container.querySelector('[data-testid="video"]') as HTMLVideoElement;

		video.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(play).toHaveBeenCalled();
		play.mockRestore();
	});
});
