import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareFiles, shareBlob } from './share';

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
});
