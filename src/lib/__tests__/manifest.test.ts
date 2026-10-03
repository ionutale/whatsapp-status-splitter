import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const manifestUrl = new URL('../../../static/manifest.webmanifest', import.meta.url);

type WebManifest = {
	name: string;
	short_name: string;
	start_url: string;
	display: string;
	icons: { src: string }[];
};

async function readManifest(): Promise<WebManifest> {
	return JSON.parse(await readFile(manifestUrl, 'utf8')) as WebManifest;
}

describe('web app manifest', () => {
	it('declares the expected identity and display mode', async () => {
		const manifest = await readManifest();
		expect(manifest.name).toBe('WhatsApp Status Splitter');
		expect(manifest.short_name).toBe('Status Splitter');
		expect(manifest.start_url).toBe('/');
		expect(manifest.display).toBe('standalone');
	});

	it('references icon files that exist on disk', async () => {
		const manifest = await readManifest();
		expect(manifest.icons.length).toBeGreaterThan(0);
		for (const icon of manifest.icons) {
			const iconUrl = new URL(`../../../static${icon.src}`, import.meta.url);
			await expect(access(iconUrl)).resolves.toBeUndefined();
		}
	});
});
