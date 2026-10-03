import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import noAudioUrl from '../../static/test-fixtures/tiny-noaudio.mp4?url';
import { project } from '../lib/state/project.svelte';
import Page from './+page.svelte';

const mocks = vi.hoisted(() => ({
	convert: vi.fn(),
	lastSignal: null as AbortSignal | null
}));

vi.mock('../lib/media/ffmpeg', () => ({
	convertToCompatibleMp4: mocks.convert
}));

// `undecodable.mov` parses (inspect succeeds) but its codec cannot be decoded,
// mirroring the real Windows-Chrome/HEVC case. Everything else goes through the
// real inspect module (so the AVI container failure and the readable fixture
// both behave as in production).
vi.mock('../lib/media/inspect', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../lib/media/inspect')>();
	return {
		...actual,
		inspectFile: (file: File) => {
			if (file.name === 'undecodable.mov') {
				return Promise.resolve({
					duration: 3,
					meta: {
						displayWidth: 320,
						displayHeight: 240,
						rotation: 0 as const,
						frameRate: 30,
						videoCodec: 'hvc1.1.6.L93.B0',
						audioCodec: null,
						hasAudio: false,
						audioDecodable: false,
						videoDecodable: false
					}
				});
			}
			return actual.inspectFile(file);
		}
	};
});

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

const convertButton = (screen: Awaited<ReturnType<typeof render>>) =>
	screen.container.querySelector('[data-testid="compat-convert"]') as HTMLButtonElement | null;

describe('compatibility mode', () => {
	beforeEach(() => {
		resetProject();
		mocks.lastSignal = null;
		mocks.convert.mockReset();
		mocks.convert.mockImplementation(async () => {
			const blob = await (await fetch(noAudioUrl)).blob();
			return new File([blob], 'converted.mp4', { type: 'video/mp4' });
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('offers conversion when the format is unreadable, then loads the converted file', async () => {
		const screen = await render(Page);
		pickFile(screen, new File([new Uint8Array([1, 2, 3])], 'old.avi', { type: 'video/avi' }));

		await expect.poll(() => convertButton(screen)).not.toBeNull();
		convertButton(screen)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		await expect
			.poll(() => screen.container.querySelector('[data-testid="file-name"]')?.textContent)
			.toContain('converted.mp4');

		// tiny-noaudio.mp4 is 3s: proves the converted file (not the original) loaded.
		const durationField = screen.container.querySelector(
			'[data-testid="time-field-duration"]'
		) as HTMLInputElement;
		expect(durationField.value).toBe('00:03.0');
	});

	it('offers conversion when the container parses but the codec cannot be decoded', async () => {
		const screen = await render(Page);
		pickFile(
			screen,
			new File([new Uint8Array([1, 2, 3])], 'undecodable.mov', { type: 'video/quicktime' })
		);

		await expect.poll(() => convertButton(screen)).not.toBeNull();
		// The decode-failure message is surfaced alongside the offer.
		expect(screen.container.querySelector('[data-testid="dropzone-error"]')?.textContent).toMatch(
			/codec/i
		);

		convertButton(screen)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		await expect
			.poll(() => screen.container.querySelector('[data-testid="file-name"]')?.textContent)
			.toContain('converted.mp4');
		const durationField = screen.container.querySelector(
			'[data-testid="time-field-duration"]'
		) as HTMLInputElement;
		expect(durationField.value).toBe('00:03.0');
	});

	it('does not offer compatibility mode for a readable video', async () => {
		const screen = await render(Page);
		const blob = await (await fetch(noAudioUrl)).blob();
		pickFile(screen, new File([blob], 'tiny-noaudio.mp4', { type: 'video/mp4' }));

		await expect
			.poll(() => screen.container.querySelector('[data-testid="file-name"]')?.textContent)
			.toContain('tiny-noaudio.mp4');
		expect(convertButton(screen)).toBeNull();
	});

	it('does not offer compatibility mode when a non-format step fails', async () => {
		const screen = await render(Page);
		// `project.ready` is a post-inspect step: its failure is a programming
		// error, not an unreadable file, so it must never trigger the offer.
		const ready = vi.spyOn(project, 'ready').mockImplementationOnce(() => {
			throw new Error('boom from ready');
		});
		const blob = await (await fetch(noAudioUrl)).blob();
		pickFile(screen, new File([blob], 'tiny-noaudio.mp4', { type: 'video/mp4' }));

		await expect
			.poll(() => screen.container.querySelector('[data-testid="dropzone-error"]')?.textContent)
			.toContain('boom from ready');
		expect(convertButton(screen)).toBeNull();
		ready.mockRestore();
	});

	it('ignores a stale conversion that resolves after a new file is loaded', async () => {
		const screen = await render(Page);

		let resolveConvert: (file: File) => void = () => {};
		mocks.convert.mockImplementationOnce(
			() =>
				new Promise<File>((resolve) => {
					resolveConvert = resolve;
				})
		);

		pickFile(screen, new File([new Uint8Array([1, 2, 3])], 'old.avi', { type: 'video/avi' }));
		await expect.poll(() => convertButton(screen)).not.toBeNull();
		convertButton(screen)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await expect.poll(() => mocks.convert).toHaveBeenCalled();

		// Load a readable file while the conversion is still in flight.
		const blob = await (await fetch(noAudioUrl)).blob();
		pickFile(screen, new File([blob], 'tiny-noaudio.mp4', { type: 'video/mp4' }));
		await expect
			.poll(() => screen.container.querySelector('[data-testid="file-name"]')?.textContent)
			.toContain('tiny-noaudio.mp4');

		// The stale conversion finishes late: it must be dropped, not re-loaded.
		const convertedBlob = await (await fetch(noAudioUrl)).blob();
		resolveConvert(new File([convertedBlob], 'converted.mp4', { type: 'video/mp4' }));
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(screen.container.querySelector('[data-testid="file-name"]')?.textContent).toContain(
			'tiny-noaudio.mp4'
		);
		expect(screen.container.querySelector('[data-testid="file-name"]')?.textContent).not.toContain(
			'converted.mp4'
		);
		expect(mocks.convert).toHaveBeenCalledTimes(1);
	});

	it('aborts an in-flight conversion when a new file is loaded', async () => {
		const screen = await render(Page);

		// A conversion that rejects only when its AbortSignal fires, mirroring the
		// real ffmpeg wrapper.
		mocks.convert.mockImplementationOnce((_file: File, options: { signal: AbortSignal }) => {
			mocks.lastSignal = options.signal;
			return new Promise<File>((_resolve, reject) => {
				options.signal.addEventListener('abort', () =>
					reject(new DOMException('Aborted', 'AbortError'))
				);
			});
		});

		pickFile(screen, new File([new Uint8Array([1, 2, 3])], 'old.avi', { type: 'video/avi' }));
		await expect.poll(() => convertButton(screen)).not.toBeNull();
		convertButton(screen)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await expect.poll(() => mocks.convert).toHaveBeenCalled();
		expect(mocks.lastSignal?.aborted).toBe(false);

		// Load a readable file while the conversion is still in flight: handleFile
		// must abort the controller so the old conversion can never land.
		const blob = await (await fetch(noAudioUrl)).blob();
		pickFile(screen, new File([blob], 'tiny-noaudio.mp4', { type: 'video/mp4' }));
		await expect
			.poll(() => screen.container.querySelector('[data-testid="file-name"]')?.textContent)
			.toContain('tiny-noaudio.mp4');

		expect(mocks.lastSignal?.aborted).toBe(true);
		expect(screen.container.querySelector('[data-testid="file-name"]')?.textContent).toContain(
			'tiny-noaudio.mp4'
		);
		expect(mocks.convert).toHaveBeenCalledTimes(1);
	});
});
