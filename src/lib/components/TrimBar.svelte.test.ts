import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
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
