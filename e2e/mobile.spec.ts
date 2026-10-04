import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const FIXTURES = 'static/test-fixtures';

async function loadFixture(page: Page, name: string) {
	await page.goto('/');
	await page.getByTestId('file-input').setInputFiles(`${FIXTURES}/${name}`);
	await expect(page.getByTestId('file-name')).toContainText(name);
}

// Real pointer drag: `page.mouse` fires the pointer events the TrimBar handles
// listen for (the touchscreen API only taps). Drags to an absolute viewport x so
// a far-left/right move is guaranteed to overshoot the clamp, not depend on pps.
async function dragHandleTo(page: Page, testId: string, targetX: number) {
	const box = await page.getByTestId(testId).boundingBox();
	expect(box).not.toBeNull();
	const cy = box!.y + box!.height / 2;
	await page.mouse.move(box!.x + box!.width / 2, cy);
	await page.mouse.down();
	await page.mouse.move(targetX, cy, { steps: 12 });
	await page.mouse.up();
}

test('phone editor replaces the desktop timeline at the Pixel viewport', async ({ page }) => {
	await loadFixture(page, 'tiny-5s.mp4');
	await expect(page.getByTestId('phone-editor')).toBeVisible();
	await expect(page.getByTestId('trim-bar')).toBeVisible();
	await expect(page.getByTestId('segment-bar')).toHaveCount(0);
});

test('landscape phone still gets the phone column', async ({ page }) => {
	// The Pixel 7 viewport is 412×839; rotated it is 839×412 — wide enough
	// that a width-only breakpoint would wrongly show the desktop editor.
	await page.setViewportSize({ width: 839, height: 412 });
	await loadFixture(page, 'tiny-5s.mp4');
	await expect(page.getByTestId('phone-editor')).toBeVisible();
	await expect(page.getByTestId('segment-bar')).toHaveCount(0);
});

test('drags the trim end to the floor, then re-extends it after the window recenters', async ({
	page
}) => {
	await loadFixture(page, 'tiny-5s.mp4');
	const bar = page.getByTestId('trim-bar');
	await expect(bar).toHaveAttribute('data-start', '0.000');
	await expect(bar).toHaveAttribute('data-end', '5.000');

	// Far-left drag past the clip origin: the store's min-length clamp pins the
	// end at the 0.5s floor while the start stays put.
	await dragHandleTo(page, 'trim-handle-end', 1);
	await expect(bar).toHaveAttribute('data-end', '0.500');
	await expect(bar).toHaveAttribute('data-start', '0.000');
	const end = Number(await bar.getAttribute('data-end'));
	const start = Number(await bar.getAttribute('data-start'));
	expect(end).toBeGreaterThanOrEqual(start + 0.5 - 1e-3);

	// The window recenters on release, so the end handle is reachable again and
	// the trimmed clip can be dragged back open.
	const before = Number(await bar.getAttribute('data-end'));
	const viewport = page.viewportSize()!;
	await dragHandleTo(page, 'trim-handle-end', viewport.width - 1);
	await expect.poll(async () => Number(await bar.getAttribute('data-end'))).toBeGreaterThan(before);
});

test('types an exact end time into the trim label', async ({ page }) => {
	await loadFixture(page, 'tiny-5s.mp4');
	await page.getByTestId('trim-label-end').click();
	const input = page.getByTestId('trim-input');
	await input.fill('3');
	await input.press('Enter');
	await expect(page.getByTestId('trim-bar')).toHaveAttribute('data-end', '3.000');
});

test('split-in-half quick action yields two clip chips', async ({ page }) => {
	await loadFixture(page, 'tiny-5s.mp4');
	await expect(page.getByTestId('clip-chip')).toHaveCount(1);
	await page.getByTestId('trim-action-split').click();
	await expect(page.getByTestId('clip-chip')).toHaveCount(2);
});

test('exports one clip with a part01 name and non-empty bytes', async ({ page }) => {
	await loadFixture(page, 'tiny-5s.mp4');
	const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
	await page.getByTestId('btn-export-clip').first().click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('tiny-5s_part01.mp4');

	const bytes = await readFile((await download.path())!);
	expect(bytes.length).toBeGreaterThan(0);
	expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
});

test('tapping the preview toggles playback', async ({ page }) => {
	await loadFixture(page, 'tiny-5s.mp4');
	const video = page.getByTestId('video');
	const play = page.getByTestId('btn-play');
	const paused = () => video.evaluate((el: HTMLVideoElement) => el.paused);

	// A real tap is a trusted gesture, so playback genuinely starts.
	await video.click();
	await expect(play).toHaveText('Pause');
	await expect.poll(paused).toBe(false);

	// Tap again: back to paused.
	await video.click();
	await expect(play).toHaveText('Play');
	await expect.poll(paused).toBe(true);
});
