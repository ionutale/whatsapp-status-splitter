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
		expect(screen.container.querySelector('[data-testid="timeline-slot"]')).not.toBeNull();
	});
});
