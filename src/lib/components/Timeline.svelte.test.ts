import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../routes/layout.css';
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

	it('renders overlapping coverage that shares a start without duplicate-key errors', async () => {
		const overlapping = [
			{ id: 'a', start: 0, end: 30 },
			{ id: 'b', start: 10, end: 20 },
			{ id: 'c', start: 10, end: 25 }
		];
		const screen = await render(Timeline, {
			duration: 80,
			segments: overlapping,
			selectedId: null,
			currentTime: 0,
			thumbs: [],
			coverage: {
				gaps: [],
				overlaps: [
					{ start: 10, end: 20 },
					{ start: 10, end: 25 }
				]
			},
			onSeek: () => {},
			onSelect: () => {},
			onSegmentChange: () => {}
		});
		expect(screen.container.querySelectorAll('[data-testid="overlap-band"]')).toHaveLength(2);
	});

	it('places the lane area below the ruler and filmstrip', async () => {
		const screen = await render(Timeline, {
			duration: 80,
			segments,
			selectedId: null,
			currentTime: 0,
			thumbs: [],
			coverage: { gaps: [], overlaps: [] },
			onSeek: () => {},
			onSelect: () => {},
			onSegmentChange: () => {}
		});
		const timeline = screen.container.querySelector('[data-testid="timeline"]') as HTMLElement;
		const filmstrip = screen.container.querySelector('[data-testid="filmstrip"]') as HTMLElement;
		const bar = screen.container.querySelector('[data-testid="segment-bar"]') as HTMLElement;
		const offset = bar.getBoundingClientRect().top - timeline.getBoundingClientRect().top;
		// The lane area must start below the filmstrip so no bar covers it.
		expect(bar.getBoundingClientRect().top).toBeGreaterThanOrEqual(
			filmstrip.getBoundingClientRect().bottom
		);
		expect(offset).toBeGreaterThanOrEqual(78);
	});

	it('selects a clip without seeking when its body is clicked', async () => {
		const onSeek = vi.fn();
		const onSelect = vi.fn();
		const screen = await render(Timeline, {
			duration: 80,
			segments,
			selectedId: null,
			currentTime: 0,
			thumbs: [],
			coverage: { gaps: [], overlaps: [] },
			onSeek,
			onSelect,
			onSegmentChange: () => {}
		});
		const bar = screen.container.querySelector('[data-testid="segment-bar"]') as HTMLElement;
		bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		bar.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(onSelect).toHaveBeenCalledWith('a');
		expect(onSeek).not.toHaveBeenCalled();
	});

	it('seeks when an empty region of the track is clicked', async () => {
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
			new MouseEvent('click', {
				clientX: rect.left + rect.width / 2,
				clientY: rect.bottom - 2,
				bubbles: true
			})
		);
		expect(onSeek).toHaveBeenCalled();
	});
});
