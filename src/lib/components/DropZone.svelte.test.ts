import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DropZone from './DropZone.svelte';

describe('DropZone', () => {
	it('calls onFile when a file is chosen', async () => {
		const onFile = vi.fn();
		const screen = await render(DropZone, { onFile });
		const input = screen.container.querySelector('[data-testid="file-input"]') as HTMLInputElement;
		const file = new File([new Uint8Array([1])], 'a.mp4', { type: 'video/mp4' });
		const transfer = new DataTransfer();
		transfer.items.add(file);
		input.files = transfer.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));
		expect(onFile).toHaveBeenCalledWith(file);
	});

	it('shows the error message', async () => {
		const screen = await render(DropZone, { onFile: () => {}, error: 'nope' });
		expect(screen.container.querySelector('[data-testid="dropzone-error"]')?.textContent).toContain(
			'nope'
		);
	});
});
