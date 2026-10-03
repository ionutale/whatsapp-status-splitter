import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import tiny5sUrl from '../../../static/test-fixtures/tiny-5s.mp4?url';
import VideoPreview from './VideoPreview.svelte';

describe('VideoPreview', () => {
	it('seeks to the clip start when playing from outside the range', async () => {
		const source = URL.createObjectURL(await (await fetch(tiny5sUrl)).blob());
		const screen = await render(VideoPreview, {
			src: source,
			range: { start: 2, end: 3 },
			loop: false
		});
		const video = screen.container.querySelector('video') as HTMLVideoElement;
		if (video.readyState === 0) {
			await new Promise<void>((resolve) =>
				video.addEventListener('loadedmetadata', () => resolve(), { once: true })
			);
		}
		(screen.container.querySelector('[data-testid="btn-play"]') as HTMLButtonElement).click();
		await expect.poll(() => video.currentTime).toBeGreaterThanOrEqual(1.95);
	});

	it('applies parent-driven seeks and acknowledges them', async () => {
		const source = URL.createObjectURL(await (await fetch(tiny5sUrl)).blob());
		const onSeekHandled = vi.fn();
		const screen = await render(VideoPreview, {
			src: source,
			seekRequest: { t: 3 },
			onSeekHandled
		});
		const video = screen.container.querySelector('video') as HTMLVideoElement;
		if (video.readyState === 0) {
			await new Promise<void>((resolve) =>
				video.addEventListener('loadedmetadata', () => resolve(), { once: true })
			);
		}
		await expect.poll(() => onSeekHandled).toHaveBeenCalled();
		await expect.poll(() => video.currentTime).toBeGreaterThanOrEqual(2.95);
	});
});
