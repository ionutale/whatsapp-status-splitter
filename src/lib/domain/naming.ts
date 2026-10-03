export function sanitizeBaseName(fileName: string): string {
	const withoutExt = fileName.replace(/\.[^.]*$/, '');
	const cleaned = withoutExt
		.replace(/[^A-Za-z0-9_-]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '');
	return cleaned || 'video';
}

export function clipFileName(base: string, index: number): string {
	return `${base}_part${String(index + 1).padStart(2, '0')}.mp4`;
}

export function zipFileName(base: string): string {
	return `${base}_parts.zip`;
}
