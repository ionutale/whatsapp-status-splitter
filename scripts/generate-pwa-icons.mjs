#!/usr/bin/env node
// Regenerates the PWA PNG icons from static/icon.svg using the repo's
// already-installed Playwright Chromium. Run: node scripts/generate-pwa-icons.mjs
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svgUrl = pathToFileURL(path.join(root, 'static', 'icon.svg')).href;

const targets = [
	{ file: 'static/icons/icon-192.png', size: 192 },
	{ file: 'static/icons/icon-512.png', size: 512 },
	{ file: 'static/apple-touch-icon.png', size: 180 }
];

const browser = await chromium.launch();
try {
	const page = await browser.newPage({ deviceScaleFactor: 1 });
	for (const { file, size } of targets) {
		await page.setViewportSize({ width: size, height: size });
		await page.goto(svgUrl);
		// A standalone SVG document renders at its intrinsic size; stretch the
		// root to the viewport so the screenshot is exactly `size` square.
		await page.evaluate((px) => {
			const svg = document.documentElement;
			svg.setAttribute('width', String(px));
			svg.setAttribute('height', String(px));
			svg.style.display = 'block';
			svg.style.margin = '0';
		}, size);
		const out = path.join(root, file);
		await mkdir(path.dirname(out), { recursive: true });
		await page.screenshot({ path: out });
		console.log(`wrote ${path.relative(root, out)} (${size}x${size})`);
	}
} finally {
	await browser.close();
}
