export function canShareFiles(): boolean {
	if (typeof navigator === 'undefined') return false;
	if (typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function')
		return false;
	try {
		return navigator.canShare({
			files: [new File([new Uint8Array([1])], 'probe.mp4', { type: 'video/mp4' })]
		});
	} catch (error) {
		console.error('[share] capability probe failed', error);
		return false;
	}
}

export async function shareBlob(blob: Blob, fileName: string): Promise<void> {
	const file = new File([blob], fileName, { type: 'video/mp4' });
	await navigator.share({ files: [file], title: fileName });
}
