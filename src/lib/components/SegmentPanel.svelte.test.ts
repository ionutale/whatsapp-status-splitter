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

	it('does not re-commit a rounded display on blur without edits', async () => {
		// A raw drag candidate before clamping can carry sub-millisecond precision;
		// seed it directly so the display (12.4) differs from the stored value.
		project.segments = project.segments.map((segment) =>
			segment.id === project.selectedId ? { ...segment, end: 12.4371 } : segment
		);
		const screen = await render(SegmentPanel);
		const end = screen.container.querySelector(
			'[data-testid="time-field-end"]'
		) as HTMLInputElement;
		expect(end.value).toBe('00:12.4');
		end.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(project.selected!.end).toBe(12.4371);
	});

	it('ignores a cleared or non-numeric max length', async () => {
		const screen = await render(SegmentPanel);
		const max = screen.container.querySelector(
			'[data-testid="input-max-length"]'
		) as HTMLInputElement;
		max.value = '';
		max.dispatchEvent(new Event('change', { bubbles: true }));
		expect(project.maxClipDuration).toBe(30);
		max.value = '15';
		max.dispatchEvent(new Event('change', { bubbles: true }));
		expect(project.maxClipDuration).toBe(15);
	});
});
