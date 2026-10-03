import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const swUrl = new URL('../../static/sw.js', import.meta.url);

async function readWorker(): Promise<string> {
	return readFile(swUrl, 'utf8');
}

// Contract test only: static/sw.js runs in a service worker global, so it is
// read as text rather than executed here. These assertions pin the shape the
// offline flow depends on.
describe('service worker contract', () => {
	it('pins a cache version and derives both cache names from it', async () => {
		const sw = await readWorker();
		expect(sw).toContain("const VERSION = 'wss-v1';");
		expect(sw).toContain('wss-shell-${VERSION}');
		expect(sw).toContain('wss-assets-${VERSION}');
	});

	it('registers install, activate and fetch listeners', async () => {
		const sw = await readWorker();
		expect(sw).toMatch(/addEventListener\(\s*'install'/);
		expect(sw).toMatch(/addEventListener\(\s*'activate'/);
		expect(sw).toMatch(/addEventListener\(\s*'fetch'/);
	});

	it('takes over immediately on install and activate', async () => {
		const sw = await readWorker();
		expect(sw).toContain('self.skipWaiting()');
		expect(sw).toContain('self.clients.claim()');
	});

	it('falls back to the cached shell for offline navigations', async () => {
		const sw = await readWorker();
		expect(sw).toContain("request.mode === 'navigate'");
		expect(sw).toContain('networkFirstNavigation');
		expect(sw).toMatch(/cache\.match\('\/'/);
	});

	it('cache-firsts same-origin build assets', async () => {
		const sw = await readWorker();
		expect(sw).toContain("pathname.startsWith('/_app/')");
		expect(sw).toContain('cacheFirstAsset');
	});

	it('precaches best-effort so one missing file cannot fail install', async () => {
		const sw = await readWorker();
		expect(sw).toContain('Promise.allSettled');
		expect(sw).toContain("'/manifest.webmanifest'");
		expect(sw).toContain("'/icons/icon-192.png'");
		expect(sw).toContain("'/icons/icon-512.png'");
	});
});
