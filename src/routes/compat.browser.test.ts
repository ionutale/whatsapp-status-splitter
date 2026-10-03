import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import noAudioUrl from '../../static/test-fixtures/tiny-noaudio.mp4?url';
import { project } from '../lib/state/project.svelte';
import Page from './+page.svelte';

vi.mock('../lib/media/ffmpeg', () => ({
	convertToCompatibleMp4: async () => {
		const blob = await (await fetch(noAudioUrl)).blob();
		return new File([blob], 'converted.mp4', { type: 'video/mp4' });
	}
}));

// `project` is a module-level singleton: reset it so each test starts on the drop zone.
function resetProject() {
	project.begin(new File([], 'reset.mp4'));
}

function pickFile(screen: Awaited<ReturnType<typeof render>>, file: File) {
	const transfer = new DataTransfer();
	transfer.items.add(file);
	const input = screen.container.querySelector('[data-testid="file-input"]') as HTMLInputElement;
	input.files = transfer.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('compatibility mode', () => {
	it('offers conversion when the format is unreadable, then loads the converted file', async () => {
		resetProject();
		const screen = await render(Page);
		pickFile(screen, new File([new Uint8Array([1, 2, 3])], 'old.avi', { type: 'video/avi' }));

		await expect
			.poll(() => screen.container.querySelector('[data-testid="compat-convert"]'))
			.not.toBeNull();
		const convertBtn = screen.container.querySelector(
			'[data-testid="compat-convert"]'
		) as HTMLButtonElement;
		convertBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		await expect
			.poll(() => screen.container.querySelector('[data-testid="file-name"]')?.textContent)
			.toContain('converted.mp4');

		// tiny-noaudio.mp4 is 3s: proves the converted file (not the original) loaded.
		const durationField = screen.container.querySelector(
			'[data-testid="time-field-duration"]'
		) as HTMLInputElement;
		expect(durationField.value).toBe('00:03.0');
	});

	it('does not offer compatibility mode for a readable video', async () => {
		resetProject();
		const screen = await render(Page);
		const blob = await (await fetch(noAudioUrl)).blob();
		pickFile(screen, new File([blob], 'tiny-noaudio.mp4', { type: 'video/mp4' }));

		await expect
			.poll(() => screen.container.querySelector('[data-testid="file-name"]')?.textContent)
			.toContain('tiny-noaudio.mp4');
		expect(screen.container.querySelector('[data-testid="compat-convert"]')).toBeNull();
	});
});
