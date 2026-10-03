// WhatsApp Status Splitter service worker.
//
// Gives the production static build offline support: the app shell and the
// whole route graph are precached on install, so even a cold cache (first-ever
// load while offline) renders. Immutable build assets are cached on first use.
// The dev server never registers this worker (see src/routes/+layout.svelte).
//
// Bump VERSION on releases to purge stale caches. The contract test in
// src/lib/sw.test.ts asserts the version pattern, not the literal value.
const VERSION = 'wss-v1';
const SHELL_CACHE = `wss-shell-${VERSION}`;
const ASSETS_CACHE = `wss-assets-${VERSION}`;

// Small, stable files worth precaching even though they are not referenced by
// the shell HTML.
const PRECACHE_EXTRAS = [
	'/manifest.webmanifest',
	'/apple-touch-icon.png',
	'/icons/icon-192.png',
	'/icons/icon-512.png'
];

// Same-origin URLs handled cache-first: immutable hashed build output, the PWA
// icons, and the manifest. Anything else passes straight through to the network.
function isCacheableAsset(pathname) {
	return (
		pathname.startsWith('/_app/') ||
		pathname.startsWith('/icons/') ||
		pathname === '/apple-touch-icon.png' ||
		pathname === '/icon.svg' ||
		pathname === '/manifest.webmanifest'
	);
}

// Pull same-origin <script src>/<link href> asset URLs out of the shell HTML.
// Only the immutable build output and the manifest are kept.
function extractShellAssets(html) {
	const urls = new Set();
	const attrRe = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
	let match;
	while ((match = attrRe.exec(html)) !== null) {
		let url;
		try {
			url = new URL(match[1], self.location.origin);
		} catch {
			continue;
		}
		if (url.origin !== self.location.origin) continue;
		if (url.pathname.startsWith('/_app/') || url.pathname === '/manifest.webmanifest') {
			urls.add(url.pathname);
		}
	}
	return [...urls];
}

// The shell HTML references the entry chunks but not the lazy route nodes —
// e.g. the root error boundary at /_app/immutable/nodes/1.*.js. Crawl the
// route graph breadth-first so a cold cache can still render offline.
const IMPORT_RE = /import\(\s*[`'"]([^`'"]+)[`'"]\s*\)/g;
const MAX_CRAWLED_FILES = 200;

async function crawlRouteGraph(seedUrls) {
	const found = new Set();
	const visited = new Set();
	const queue = [...seedUrls];
	while (queue.length > 0 && visited.size < MAX_CRAWLED_FILES) {
		const pathname = queue.shift();
		if (visited.has(pathname)) continue;
		visited.add(pathname);
		let source;
		try {
			const response = await fetch(pathname);
			if (!response.ok) continue;
			source = await response.text();
		} catch {
			continue;
		}
		IMPORT_RE.lastIndex = 0;
		let match;
		while ((match = IMPORT_RE.exec(source)) !== null) {
			let url;
			try {
				url = new URL(match[1], new URL(pathname, self.location.origin));
			} catch {
				continue;
			}
			if (url.origin !== self.location.origin) continue;
			if (!url.pathname.startsWith('/_app/immutable/')) continue;
			// The ~31MB ffmpeg core stays runtime-cached; never precache it.
			if (url.pathname.includes('ffmpeg-core')) continue;
			if (!found.has(url.pathname)) {
				found.add(url.pathname);
				queue.push(url.pathname);
			}
		}
	}
	return [...found];
}

async function precache() {
	const shell = await caches.open(SHELL_CACHE);
	const assets = await caches.open(ASSETS_CACHE);
	const entries = new Set(PRECACHE_EXTRAS);
	let seedUrls = [];
	try {
		const response = await fetch('/');
		if (response.ok) await shell.put('/', response.clone());
		seedUrls = extractShellAssets(await response.text());
	} catch (err) {
		console.warn('[sw] shell precache failed', err);
	}
	for (const url of seedUrls) entries.add(url);
	// Best-effort per entry: one missing file must not fail the whole install.
	const graph = await crawlRouteGraph(seedUrls);
	for (const url of graph) entries.add(url);
	await Promise.allSettled([...entries].map((url) => assets.add(url)));
}

self.addEventListener('install', (event) => {
	self.skipWaiting();
	event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keep = new Set([SHELL_CACHE, ASSETS_CACHE]);
			const names = await caches.keys();
			await Promise.all(
				names
					.filter((name) => name.startsWith('wss-') && !keep.has(name))
					.map((name) => caches.delete(name))
			);
			await self.clients.claim();
		})()
	);
});

// Navigations are network-first so a deploy is picked up on the next online
// load; when the network is unavailable, fall back to the cached shell at "/".
// Navigations are never written to the cache: install already precaches "/",
// and caching a deep link would overwrite the shell entry.
async function networkFirstNavigation(request) {
	try {
		return await fetch(request);
	} catch (err) {
		const cache = await caches.open(SHELL_CACHE);
		const cached = await cache.match('/');
		if (cached) return cached;
		throw err;
	}
}

// Hashed asset names are immutable in a build, so cache-first is safe. On a
// miss, fetch and cache a clone. This is what makes the lazy ffmpeg core
// (/_app/immutable/assets/ffmpeg-core.*) available offline after one online use.
async function cacheFirstAsset(request) {
	const cache = await caches.open(ASSETS_CACHE);
	// ignoreVary: build assets are immutable and same-origin, and `Vary: Origin`
	// (set by preview/production servers) would otherwise make a CORS module
	// request miss the entry stored without an Origin header.
	const cached = await cache.match(request, { ignoreVary: true });
	if (cached) return cached;
	const response = await fetch(request);
	if (response.ok) {
		// Fire-and-forget: a failed cache write must never delay or break the
		// response.
		cache.put(request, response.clone()).catch((err) => {
			console.warn('[sw] asset cache put failed', err);
		});
	}
	return response;
}

// Last-resort wrapper: a bug in this worker must never break a page request.
function respondWithFallback(handler) {
	return (event) => {
		event.respondWith(
			handler(event.request).catch((err) => {
				console.error('[sw] handler failed, falling back to network', err);
				return fetch(event.request);
			})
		);
	};
}

self.addEventListener(
	'fetch',
	respondWithFallback(async (request) => {
		if (request.method !== 'GET') return fetch(request);

		const url = new URL(request.url);
		// Cross-origin and range requests are never intercepted. blob: URLs pass
		// the origin check (their origin is the creating document's origin) but
		// fail the asset check below, so they pass through to the network.
		if (url.origin !== self.location.origin) return fetch(request);
		if (request.headers.has('range')) return fetch(request);

		if (request.mode === 'navigate') return networkFirstNavigation(request);
		if (isCacheableAsset(url.pathname)) return cacheFirstAsset(request);
		return fetch(request);
	})
);
