// Regenerates the README screenshots (docs/screenshot.png, plus light/dark and
// phone variants). Requires a running dev server with a video fixture available.
//
//   HTTPS_DEV=1 ./node_modules/.bin/vite dev --port 5180 --strictPort --host &
//   node scripts/screenshot.mjs
//
// Override with SCREENSHOT_URL / SCREENSHOT_FIXTURE if the server or fixture moves.
import { copyFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const url = process.env.SCREENSHOT_URL ?? 'https://localhost:5180/';
const fixture = process.env.SCREENSHOT_FIXTURE ?? 'static/test-fixtures/tiny-5s.mp4';

// `waits` are the editor controls to wait for before shooting. Wide viewports
// wait on the desktop precision panel (`time-field-end`); the phone column
// (≤767px) has no such panel, so it waits on `phone-editor` + `trim-bar`.
async function capture({ viewport, scheme, waits, path, isMobile = false, hasTouch = false }) {
	const browser = await chromium.launch();
	const context = await browser.newContext({
		viewport,
		deviceScaleFactor: 2,
		colorScheme: scheme,
		isMobile,
		hasTouch,
		ignoreHTTPSErrors: true
	});
	const page = await context.newPage();
	await page.goto(url);
	await page.getByTestId('file-input').setInputFiles(fixture);
	await page.getByTestId('file-name').waitFor();
	for (const testId of waits) await page.getByTestId(testId).waitFor();
	// let thumbnails and layout settle
	await page.waitForTimeout(1500);
	await page.screenshot({ path, fullPage: true });
	await browser.close();
}

for (const scheme of ['light', 'dark']) {
	await capture({
		viewport: { width: 1440, height: 960 },
		scheme,
		waits: ['time-field-end'],
		path: `docs/screenshot-${scheme}.png`
	});
}

await capture({
	viewport: { width: 390, height: 844 },
	scheme: 'dark',
	waits: ['phone-editor', 'trim-bar'],
	path: 'docs/screenshot-phone.png',
	isMobile: true,
	hasTouch: true
});

copyFileSync('docs/screenshot-dark.png', 'docs/screenshot.png');
console.log(
	'wrote docs/screenshot-phone.png, docs/screenshot-light.png, docs/screenshot-dark.png and docs/screenshot.png'
);
