import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readMediaMeta } from './helpers/media';

const FIXTURES = 'static/test-fixtures';

async function loadFixture(page: Page, name: string) {
	await page.goto('/');
	await page.getByTestId('file-input').setInputFiles(`${FIXTURES}/${name}`);
	await expect(page.getByTestId('file-name')).toContainText(name);
}

async function splitIntoTwoSecondClips(page: Page) {
	const input = page.getByTestId('input-max-length');
	await input.fill('2');
	await input.press('Enter');
	await page.getByTestId('btn-reset').click();
}

test('auto-splits a 5s video into 2/2/1 clips', async ({ page }) => {
	await loadFixture(page, 'tiny-5s.mp4');
	await splitIntoTwoSecondClips(page);
	const bars = page.getByTestId('segment-bar');
	await expect(bars).toHaveCount(3);
	await expect(bars.nth(0)).toHaveAttribute('data-duration', '2.000');
	await expect(bars.nth(1)).toHaveAttribute('data-duration', '2.000');
	await expect(bars.nth(2)).toHaveAttribute('data-duration', '1.000');
});

test('dragging a clip start moves only that clip and respects clamps', async ({ page }) => {
	await loadFixture(page, 'tiny-5s.mp4');
	await splitIntoTwoSecondClips(page);
	const handle = page.getByTestId('segment-bar').nth(1).getByTestId('handle-start');
	const box = (await handle.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 10 });
	await page.mouse.up();

	const second = page.getByTestId('segment-bar').nth(1);
	const start = Number(await second.getAttribute('data-start'));
	const duration = Number(await second.getAttribute('data-duration'));
	expect(start).toBeGreaterThan(2);
	expect(duration).toBeLessThan(1.999);
	// The end edge is pinned: a whole-clip translate would move it too.
	await expect(second).toHaveAttribute('data-end', '4.000');
	// First clip did not move.
	await expect(page.getByTestId('segment-bar').nth(0)).toHaveAttribute('data-start', '0.000');

	// Dragging the start back left past the clip's origin clamps at the
	// max-length boundary: start can never leave [end - max, end - min].
	const boxLeft = (await handle.boundingBox())!;
	await page.mouse.move(boxLeft.x + boxLeft.width / 2, boxLeft.y + boxLeft.height / 2);
	await page.mouse.down();
	await page.mouse.move(boxLeft.x + boxLeft.width / 2 - 240, boxLeft.y + boxLeft.height / 2, {
		steps: 10
	});
	await page.mouse.up();

	await expect(second).toHaveAttribute('data-start', '2.000');
	await expect(second).toHaveAttribute('data-duration', '2.000');
});

test('split, delete and reset edit the clip set', async ({ page }) => {
	await loadFixture(page, 'tiny-5s.mp4');
	await splitIntoTwoSecondClips(page);
	await page.getByTestId('segment-bar').nth(0).click();
	await page.getByTestId('btn-split').click();
	await expect(page.getByTestId('segment-bar')).toHaveCount(4);
	await page.getByTestId('btn-delete').click();
	await expect(page.getByTestId('segment-bar')).toHaveCount(3);
	// Mutate the selected clip so a no-op reset would leave the mutation visible.
	const durationField = page.getByTestId('time-field-duration');
	await durationField.fill('1.5');
	await durationField.press('Enter');
	await expect(page.getByTestId('segment-bar').nth(0)).toHaveAttribute('data-duration', '1.500');
	await page.getByTestId('btn-reset').click();
	await expect(page.getByTestId('segment-bar')).toHaveCount(3);
	await expect(page.getByTestId('segment-bar').nth(0)).toHaveAttribute('data-duration', '2.000');
	await expect(page.getByTestId('segment-bar').nth(1)).toHaveAttribute('data-duration', '2.000');
	await expect(page.getByTestId('segment-bar').nth(2)).toHaveAttribute('data-duration', '1.000');
});

test('exports a single clip: valid MP4, exact duration, part01 name', async ({ page }) => {
	await loadFixture(page, 'tiny-5s.mp4');
	await splitIntoTwoSecondClips(page);
	await page.getByTestId('segment-bar').nth(0).click();

	const start = page.getByTestId('time-field-start');
	await start.fill('1');
	await start.press('Enter');
	const end = page.getByTestId('time-field-end');
	await end.fill('2.5');
	await end.press('Enter');

	const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
	await page.getByTestId('btn-export-clip').first().click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('tiny-5s_part01.mp4');

	const path = (await download.path())!;
	const bytes = await readFile(path);
	expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
	const meta = await readMediaMeta(path);
	expect(Math.abs(meta.duration - 1.5)).toBeLessThanOrEqual(0.35);
	expect(meta.hasAudio).toBe(true);
});

test('export all produces a ZIP with one entry per clip', async ({ page }) => {
	await loadFixture(page, 'tiny-5s.mp4');
	await splitIntoTwoSecondClips(page);

	const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
	await page.getByTestId('btn-export-all').click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('tiny-5s_parts.zip');

	const bytes = await readFile((await download.path())!);
	const entries = unzipSync(new Uint8Array(bytes));
	expect(Object.keys(entries).sort()).toEqual([
		'tiny-5s_part01.mp4',
		'tiny-5s_part02.mp4',
		'tiny-5s_part03.mp4'
	]);
});

test('batch mode splits several videos into one ZIP', async ({ page }) => {
	await page.goto('/');
	await page
		.getByTestId('file-input')
		.setInputFiles([`${FIXTURES}/tiny-5s.mp4`, `${FIXTURES}/tiny-noaudio.mp4`]);
	await expect(page.getByTestId('batch-item')).toHaveCount(2);

	const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
	await page.getByTestId('batch-start').click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('status_batch.zip');

	const bytes = await readFile((await download.path())!);
	const entries = unzipSync(new Uint8Array(bytes));
	// Default max clip length (30s): each short fixture is a single part, under
	// its own <base>/ folder in the shared archive.
	expect(Object.keys(entries).sort()).toEqual([
		'tiny-5s/tiny-5s_part01.mp4',
		'tiny-noaudio/tiny-noaudio_part01.mp4'
	]);
});

test('rotated portrait source exports portrait', async ({ page }) => {
	await loadFixture(page, 'tiny-portrait-rotated.mp4');
	await splitIntoTwoSecondClips(page);

	const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
	await page.getByTestId('btn-export-clip').first().click();
	const download = await downloadPromise;
	const meta = await readMediaMeta((await download.path())!);
	expect(meta.displayHeight).toBeGreaterThan(meta.displayWidth);
	// Rotation is baked into the pixels, not carried as metadata.
	expect(meta.rotation).toBe(0);
});

test('video without audio exports a silent MP4', async ({ page }) => {
	await loadFixture(page, 'tiny-noaudio.mp4');
	await splitIntoTwoSecondClips(page);

	const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
	await page.getByTestId('btn-export-clip').first().click();
	const download = await downloadPromise;
	const meta = await readMediaMeta((await download.path())!);
	expect(meta.hasAudio).toBe(false);
	expect(Math.abs(meta.duration - 2)).toBeLessThanOrEqual(0.35);
});

test('offline: the app shell loads from cache', async ({ page, context }) => {
	test.skip(process.env.E2E_BUILD !== '1', 'the service worker ships in the production build only');

	// First online visit registers the worker and lets it precache the shell
	// and the route graph.
	await page.goto('/');
	await page.evaluate(() => navigator.serviceWorker.ready);
	await expect(page.getByTestId('file-input')).toBeVisible();

	// Deterministic precache wait: poll the assets cache until the route graph
	// is in it. This assertion is what catches a missing route node — the root
	// error boundary (nodes/1) is not referenced by the HTML and used to be
	// absent from a cold cache.
	const cacheName = await page.evaluate(async () => {
		const names = await caches.keys();
		return names.find((name) => name.startsWith('wss-assets-')) ?? '';
	});
	expect(cacheName).not.toBe('');

	let paths: string[] = [];
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		paths = await page.evaluate(async (name: string) => {
			const cache = await caches.open(name);
			const keys = await cache.keys();
			return keys.map((request) => new URL(request.url).pathname);
		}, cacheName);
		const hasEntry = paths.some((p) => p.startsWith('/_app/immutable/entry/'));
		const hasNodes = [0, 1, 2].every((n) =>
			paths.some((p) => p.startsWith(`/_app/immutable/nodes/${n}.`))
		);
		if (hasEntry && hasNodes) break;
		await page.waitForTimeout(250);
	}

	expect(
		paths.some((p) => p.startsWith('/_app/immutable/entry/')),
		`no entry chunk in ${cacheName} (got: ${paths.join(', ')})`
	).toBe(true);
	for (const n of [0, 1, 2]) {
		expect(
			paths.some((p) => p.startsWith(`/_app/immutable/nodes/${n}.`)),
			`no nodes/${n} in ${cacheName} (got: ${paths.join(', ')})`
		).toBe(true);
	}

	// Purge the browser HTTP cache so the offline reload cannot be served from
	// it (hashed assets are immutable for a year), then go offline and reload:
	// everything must come from the service worker caches.
	const cdp = await context.newCDPSession(page);
	await cdp.send('Network.enable');
	await cdp.send('Network.clearBrowserCache');
	await context.setOffline(true);
	try {
		await page.reload();
		await expect(page.getByTestId('file-input')).toBeVisible();
	} finally {
		await context.setOffline(false);
	}
});
