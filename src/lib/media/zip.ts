import { downloadZip } from 'client-zip';

export async function makeZip(entries: { name: string; blob: Blob }[]): Promise<Blob> {
	const response = downloadZip(
		entries.map((entry) => ({
			name: entry.name,
			input: entry.blob,
			lastModified: new Date()
		}))
	);
	return await response.blob();
}
