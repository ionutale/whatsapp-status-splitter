// Regenerates the README screenshots (docs/screenshot.png, plus light/dark
// variants). Requires a running dev server with a video fixture available.
//
//   HTTPS_DEV=1 ./node_modules/.bin/vite dev --port 5180 --strictPort --host &
//   node scripts/screenshot.mjs
//
// Override with SCREENSHOT_URL / SCREENSHOT_FIXTURE if the server or fixture moves.
import { copyFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const url = process.env.SCREENSHOT_URL ?? 'https://localhost:5180/';
const fixture = process.env.SCREENSHOT_FIXTURE ?? 'static/test-fixtures/tiny-5s.mp4';

for (const scheme of ['light', 'dark']) {
	const browser = await chromium.launch();
	const context = await browser.newContext({
		viewport: { width: 1440, height: 960 },
		deviceScaleFactor: 2,
		colorScheme: scheme,
		ignoreHTTPSErrors: true
	});
	const page = await context.newPage();
	await page.goto(url);
	await page.getByTestId('file-input').setInputFiles(fixture);
	await page.getByTestId('file-name').waitFor();
	await page.getByTestId('time-field-end').waitFor();
	// let filmstrip thumbnails and layout settle
	await page.waitForTimeout(1500);
	await page.screenshot({ path: `docs/screenshot-${scheme}.png`, fullPage: true });
	await browser.close();
}

copyFileSync('docs/screenshot-dark.png', 'docs/screenshot.png');
console.log('wrote docs/screenshot-dark.png, docs/screenshot-light.png and docs/screenshot.png');
