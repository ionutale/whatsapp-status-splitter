import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../routes/layout.css';
import type { Segment } from '../domain/segments';
import TrimBar from './TrimBar.svelte';

type TrimBarProps = {
	segment: Segment;
	index: number;
	duration: number;
	onChange: (id: string, next: Segment, moved: 'start' | 'end') => void;
	onScrub: (time: number) => void;
	onSplit: () => void;
	onDelete: () => void;
};

async function mount(overrides: Partial<TrimBarProps> = {}) {
	const props: TrimBarProps = {
		segment: { id: 's1', start: 0, end: 30 },
		index: 0,
		duration: 80,
		onChange: () => {},
		onScrub: () => {},
		onSplit: () => {},
		onDelete: () => {},
		...overrides
	};
	const screen = await render(TrimBar, props);
	const bar = screen.container.querySelector('[data-testid="trim-bar"]') as HTMLElement;
	// clientWidth is bound via ResizeObserver; wait for the first measurement.
	await vi.waitFor(() => {
		expect(Number(bar.dataset.pps)).toBeGreaterThan(0);
	});
	return { screen, bar };
}

describe('TrimBar', () => {
	it('renders the start/end/duration labels and bar data attributes', async () => {
		const { screen, bar } = await mount();
		const start = screen.container.querySelector('[data-testid="trim-label-start"]') as HTMLElement;
		const end = screen.container.querySelector('[data-testid="trim-label-end"]') as HTMLElement;
		const duration = screen.container.querySelector(
			'[data-testid="trim-label-duration"]'
		) as HTMLElement;
		expect(start.textContent?.trim()).toBe('00:00.0');
		expect(end.textContent?.trim()).toBe('00:30.0');
		expect(duration.textContent?.trim()).toBe('00:30.0');
		expect(bar.dataset.start).toBe('0.000');
		expect(bar.dataset.end).toBe('30.000');
		expect(bar.dataset.duration).toBe('30.000');
		expect(Number(bar.dataset.pps)).toBeGreaterThan(0);
	});

	it('reports the raw end value and scrubs while dragging the end handle', async () => {
		const onChange = vi.fn();
		const onScrub = vi.fn();
		const { screen, bar } = await mount({ onChange, onScrub });
		const pps = Number(bar.dataset.pps);
		const handle = screen.container.querySelector('[data-testid="trim-handle-end"]') as HTMLElement;
		handle.dispatchEvent(
			new PointerEvent('pointerdown', { clientX: 300, bubbles: true, pointerId: 1 })
		);
		handle.dispatchEvent(
			new PointerEvent('pointermove', { clientX: 390, bubbles: true, pointerId: 1 })
		);
		handle.dispatchEvent(
			new PointerEvent('pointerup', { clientX: 390, bubbles: true, pointerId: 1 })
		);
		expect(onScrub).toHaveBeenCalled();
		const [id, next, moved] = onChange.mock.calls.at(-1)!;
		expect(id).toBe('s1');
		expect(moved).toBe('end');
		expect(next.end).toBeCloseTo(30 + 90 / pps, 3);
		expect(onScrub.mock.calls.at(-1)![0]).toBeCloseTo(30 + 90 / pps, 3);
	});

	it('keeps reporting a start beyond the window when dragged far left', async () => {
		const onChange = vi.fn();
		const { screen, bar } = await mount({ onChange });
		const pps = Number(bar.dataset.pps);
		const handle = screen.container.querySelector(
			'[data-testid="trim-handle-start"]'
		) as HTMLElement;
		handle.dispatchEvent(
			new PointerEvent('pointerdown', { clientX: 100, bubbles: true, pointerId: 1 })
		);
		handle.dispatchEvent(
			new PointerEvent('pointermove', { clientX: -300, bubbles: true, pointerId: 1 })
		);
		const [, next, moved] = onChange.mock.calls.at(-1)!;
		expect(moved).toBe('start');
		expect(next.start).toBeCloseTo(0 - 400 / pps, 3);
		// The window starts at 0 for this clip; a window clamp would floor it here.
		expect(next.start).toBeLessThan(0);
	});

	it('freezes the window while dragging and recenters it after release', async () => {
		const { screen, bar } = await mount();
		const frozenPps = Number(bar.dataset.pps);
		const handle = screen.container.querySelector('[data-testid="trim-handle-end"]') as HTMLElement;
		handle.dispatchEvent(
			new PointerEvent('pointerdown', { clientX: 300, bubbles: true, pointerId: 1 })
		);
		handle.dispatchEvent(
			new PointerEvent('pointermove', { clientX: 390, bubbles: true, pointerId: 1 })
		);
		// The parent clamps and stores the dragged value mid-gesture.
		await screen.rerender({ segment: { id: 's1', start: 0, end: 40 } });
		expect(Number(bar.dataset.pps)).toBeCloseTo(frozenPps, 4);
		handle.dispatchEvent(
			new PointerEvent('pointerup', { clientX: 390, bubbles: true, pointerId: 1 })
		);
		// Released: the window grows to fit the longer clip, so the scale drops.
		await vi.waitFor(() => {
			expect(Number(bar.dataset.pps)).toBeLessThan(frozenPps);
		});
	});

	it('nudges the focused end handle by a second with Shift+ArrowRight', async () => {
		const onChange = vi.fn();
		const { screen } = await mount({ onChange });
		const handle = screen.container.querySelector('[data-testid="trim-handle-end"]') as HTMLElement;
		handle.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
		handle.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })
		);
		const [id, next, moved] = onChange.mock.calls.at(-1)!;
		expect(id).toBe('s1');
		expect(moved).toBe('end');
		expect(next.end).toBe(31);
	});

	it('commits an exact end value typed into the label input', async () => {
		const onChange = vi.fn();
		const { screen } = await mount({
			segment: { id: 's1', start: 0, end: 300 },
			duration: 300,
			onChange
		});
		(screen.container.querySelector('[data-testid="trim-label-end"]') as HTMLElement).click();
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-testid="trim-input"]')).not.toBeNull();
		});
		const input = screen.container.querySelector('[data-testid="trim-input"]') as HTMLInputElement;
		input.value = '150';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		const [id, next, moved] = onChange.mock.calls.at(-1)!;
		expect(id).toBe('s1');
		expect(moved).toBe('end');
		expect(next.end).toBe(150);
	});

	it('renders a draggable window for a 0.5s clip', async () => {
		const { screen, bar } = await mount({
			segment: { id: 's1', start: 0, end: 0.5 },
			duration: 300
		});
		expect(Number(bar.dataset.pps)).toBeGreaterThan(0);
		expect(bar.dataset.duration).toBe('0.500');
		expect(screen.container.querySelector('[data-testid="trim-handle-start"]')).not.toBeNull();
		expect(screen.container.querySelector('[data-testid="trim-handle-end"]')).not.toBeNull();
	});

	it('keeps the handle hit bands from overlapping for a short clip at phone width', async () => {
		// Phone geometry: a 390px viewport leaves the track ~366px wide, so
		// the handles of a 0.5s clip sit ~28px apart — closer than the fixed
		// 44px hit bands, which overlap and let the end handle (later in the
		// DOM) steal presses aimed at the start handle.
		await page.viewport(390, 844);
		try {
			const { screen } = await mount({
				segment: { id: 's1', start: 9, end: 9.5 },
				duration: 60
			});
			const startRect = (
				screen.container.querySelector('[data-testid="trim-handle-start"]') as HTMLElement
			).getBoundingClientRect();
			const endRect = (
				screen.container.querySelector('[data-testid="trim-handle-end"]') as HTMLElement
			).getBoundingClientRect();
			expect(startRect.right).toBeLessThanOrEqual(endRect.left);
		} finally {
			await page.viewport(1280, 720);
		}
	});

	it('moves the start edge when a contested press lands in the start handle band', async () => {
		// Extreme geometry: a 0.25s clip at phone width leaves the handles
		// ~15px apart, so the 16px floor bands still overlap and the end
		// handle (later in the DOM) wins the hit test for contested pixels.
		// Simulate that hit-test outcome: pointerdown targets the end handle
		// at a clientX inside the start handle's band (its centre). The drag
		// must move the start edge, not the end edge.
		await page.viewport(390, 844);
		try {
			const onChange = vi.fn();
			const { screen, bar } = await mount({
				segment: { id: 's1', start: 9, end: 9.25 },
				duration: 60,
				onChange
			});
			const pps = Number(bar.dataset.pps);
			const startRect = (
				screen.container.querySelector('[data-testid="trim-handle-start"]') as HTMLElement
			).getBoundingClientRect();
			const endHandle = screen.container.querySelector(
				'[data-testid="trim-handle-end"]'
			) as HTMLElement;
			const pressX = startRect.left + startRect.width / 2;
			const pressY = startRect.top + startRect.height / 2;
			endHandle.dispatchEvent(
				new PointerEvent('pointerdown', {
					clientX: pressX,
					clientY: pressY,
					bubbles: true,
					pointerId: 1
				})
			);
			endHandle.dispatchEvent(
				new PointerEvent('pointermove', {
					clientX: pressX + 30,
					clientY: pressY,
					bubbles: true,
					pointerId: 1
				})
			);
			const [id, next, moved] = onChange.mock.calls.at(-1)!;
			expect(id).toBe('s1');
			expect(moved).toBe('start');
			expect(next.start).toBeCloseTo(9 + 30 / pps, 3);
			expect(next.end).toBe(9.25);
		} finally {
			await page.viewport(1280, 720);
		}
	});

	it('fires split and delete from the quick actions', async () => {
		const onSplit = vi.fn();
		const onDelete = vi.fn();
		const { screen } = await mount({ onSplit, onDelete });
		(screen.container.querySelector('[data-testid="trim-action-split"]') as HTMLElement).click();
		(screen.container.querySelector('[data-testid="trim-action-delete"]') as HTMLElement).click();
		expect(onSplit).toHaveBeenCalledTimes(1);
		expect(onDelete).toHaveBeenCalledTimes(1);
	});
});
