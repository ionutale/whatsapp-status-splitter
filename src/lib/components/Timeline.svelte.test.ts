import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Timeline from './Timeline.svelte';

const segments = [
	{ id: 'a', start: 0, end: 30 },
	{ id: 'b', start: 30, end: 60 },
	{ id: 'c', start: 60, end: 80 }
];

describe('Timeline', () => {
	it('renders one bar per segment', async () => {
		const screen = await render(Timeline, {
			duration: 80,
			segments,
			selectedId: 'a',
			currentTime: 0,
			thumbs: [],
			coverage: { gaps: [], overlaps: [] },
			onSeek: () => {},
			onSelect: () => {},
			onSegmentChange: () => {}
		});
		expect(screen.container.querySelectorAll('[data-testid="segment-bar"]')).toHaveLength(3);
	});

	it('seeks to the clicked time', async () => {
		const onSeek = vi.fn();
		const screen = await render(Timeline, {
			duration: 80,
			segments,
			selectedId: null,
			currentTime: 0,
			thumbs: [],
			coverage: { gaps: [], overlaps: [] },
			onSeek,
			onSelect: () => {},
			onSegmentChange: () => {}
		});
		const timeline = screen.container.querySelector('[data-testid="timeline"]') as HTMLElement;
		const rect = timeline.getBoundingClientRect();
		timeline.dispatchEvent(
			new MouseEvent('click', { clientX: rect.left + rect.width / 2, bubbles: true })
		);
		expect(onSeek).toHaveBeenCalled();
		expect(onSeek.mock.calls[0][0]).toBeCloseTo(40, 0);
	});
});
