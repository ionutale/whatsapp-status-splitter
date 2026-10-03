import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import tiny5sUrl from '../../static/test-fixtures/tiny-5s.mp4?url';
import Page from './+page.svelte';

describe('page shell', () => {
	it('loads a video and shows the editor', async () => {
		const screen = await render(Page);
		const blob = await (await fetch(tiny5sUrl)).blob();
		const transfer = new DataTransfer();
		transfer.items.add(new File([blob], 'tiny-5s.mp4', { type: 'video/mp4' }));
		const input = screen.container.querySelector('[data-testid="file-input"]') as HTMLInputElement;
		input.files = transfer.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));

		await expect
			.poll(() => screen.container.querySelector('[data-testid="file-name"]')?.textContent)
			.toContain('tiny-5s.mp4');
		expect(screen.container.querySelector('[data-testid="timeline"]')).not.toBeNull();
	});

	it('accepts a file dropped anywhere on the page', async () => {
		const screen = await render(Page);
		const blob = await (await fetch(tiny5sUrl)).blob();
		const transfer = new DataTransfer();
		transfer.items.add(new File([blob], 'dropped.mp4', { type: 'video/mp4' }));
		const event = new DragEvent('drop', {
			dataTransfer: transfer,
			bubbles: true,
			cancelable: true
		});
		window.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
		await expect
			.poll(() => screen.container.querySelector('[data-testid="file-name"]')?.textContent)
			.toContain('dropped.mp4');
	});

	it('toggles preview on body Space but leaves Space to buttons', async () => {
		const screen = await render(Page);
		const input = screen.container.querySelector(
			'[data-testid="file-input"]'
		) as HTMLInputElement | null;
		if (input) {
			const blob = await (await fetch(tiny5sUrl)).blob();
			const transfer = new DataTransfer();
			transfer.items.add(new File([blob], 'tiny-5s.mp4', { type: 'video/mp4' }));
			input.files = transfer.files;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		}

		await expect
			.poll(() => screen.container.querySelector('[data-testid="btn-export-all"]'))
			.not.toBeNull();

		const button = screen.container.querySelector(
			'[data-testid="btn-export-all"]'
		) as HTMLButtonElement;
		const onButton = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
		button.dispatchEvent(onButton);
		expect(onButton.defaultPrevented).toBe(false);

		const onBody = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
		document.body.dispatchEvent(onBody);
		expect(onBody.defaultPrevented).toBe(true);
	});
});
