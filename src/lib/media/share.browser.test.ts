import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareAll, canShareFiles, shareBlob, shareFiles } from './share';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('share helpers', () => {
	it('reports unsupported when navigator.share is missing', () => {
		vi.stubGlobal('navigator', {});
		expect(canShareFiles()).toBe(false);
	});

	it('detects file sharing support', () => {
		vi.stubGlobal('navigator', { canShare: () => true, share: async () => {} });
		expect(canShareFiles()).toBe(true);
	});

	it('shares a blob as a named file', async () => {
		const share = vi.fn<(data: { files: File[] }) => Promise<void>>(async () => {});
		vi.stubGlobal('navigator', { canShare: () => true, share });
		await shareBlob(new Blob([new Uint8Array([1])]), 'clip.mp4');
		expect(share).toHaveBeenCalledOnce();
		const files = share.mock.calls[0][0].files;
		expect(files[0].name).toBe('clip.mp4');
		expect(files[0].type).toBe('video/mp4');
	});

	it('probes multi-file sharing with the actual files', () => {
		const canShare = vi.fn((data: { files: File[] }) => data.files.length === 2);
		vi.stubGlobal('navigator', { canShare, share: async () => {} });
		const files = [
			new File([new Uint8Array([1])], 'a.mp4'),
			new File([new Uint8Array([2])], 'b.mp4')
		];
		expect(canShareAll(files)).toBe(true);
		expect(canShare.mock.calls[0][0].files).toHaveLength(2);
		vi.stubGlobal('navigator', { canShare: () => false, share: async () => {} });
		expect(canShareAll(files)).toBe(false);
		vi.stubGlobal('navigator', {});
		expect(canShareAll(files)).toBe(false);
	});

	it('shares all files and the title in one call', async () => {
		const share = vi.fn<(data: { files: File[]; title: string }) => Promise<void>>(async () => {});
		vi.stubGlobal('navigator', { canShare: () => true, share });
		const files = [
			new File([new Uint8Array([1])], 'a.mp4'),
			new File([new Uint8Array([2])], 'b.mp4')
		];
		await shareFiles(files, 'Status clips');
		expect(share).toHaveBeenCalledOnce();
		expect(share.mock.calls[0][0].files.map((f) => f.name)).toEqual(['a.mp4', 'b.mp4']);
		expect(share.mock.calls[0][0].title).toBe('Status clips');
	});

	it('reports unsupported when the multi-file probe throws', () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubGlobal('navigator', {
			canShare: () => {
				throw new Error('probe boom');
			},
			share: async () => {}
		});
		expect(canShareAll([new File([new Uint8Array([1])], 'a.mp4')])).toBe(false);
		consoleError.mockRestore();
	});
});
