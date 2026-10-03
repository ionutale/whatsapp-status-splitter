import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { VideoMeta } from '../domain/bitrate';
import { project } from '../state/project.svelte';
import SegmentPanel from './SegmentPanel.svelte';

const meta = (): VideoMeta => ({
	displayWidth: 1920,
	displayHeight: 1080,
	rotation: 0,
	frameRate: 30,
	videoCodec: 'avc1.42001f',
	audioCodec: 'mp4a.40.2',
	hasAudio: true,
	audioDecodable: true,
	videoDecodable: true
});

describe('SegmentPanel', () => {
	beforeEach(() => {
		project.begin(new File([], 'v.mp4'));
		project.ready(80, meta());
	});

	it('shows the clip count and edits the selected duration', async () => {
		const screen = await render(SegmentPanel);
		expect(screen.container.querySelector('[data-testid="clip-count"]')?.textContent).toContain(
			'3 clips'
		);
		const duration = screen.container.querySelector(
			'[data-testid="time-field-duration"]'
		) as HTMLInputElement;
		duration.value = '10';
		duration.dispatchEvent(new Event('input', { bubbles: true }));
		duration.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(project.selected!.end - project.selected!.start).toBeCloseTo(10, 1);
	});

	it('splits, deletes and resets', async () => {
		const screen = await render(SegmentPanel);
		(screen.container.querySelector('[data-testid="btn-split"]') as HTMLButtonElement).click();
		expect(project.segments.length).toBe(4);
		(screen.container.querySelector('[data-testid="btn-delete"]') as HTMLButtonElement).click();
		expect(project.segments.length).toBe(3);
		(screen.container.querySelector('[data-testid="btn-reset"]') as HTMLButtonElement).click();
		expect(project.segments.length).toBe(3);
		expect(project.dirty).toBe(false);
	});
});
