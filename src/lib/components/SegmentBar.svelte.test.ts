import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SegmentBar from './SegmentBar.svelte';

const segment = { id: 's1', start: 10, end: 20 };

describe('SegmentBar', () => {
	it('renders position attributes', async () => {
		const screen = await render(SegmentBar, { segment, lane: 0, pxPerSecond: 10, index: 0 });
		const bar = screen.container.querySelector('[data-testid="segment-bar"]') as HTMLElement;
		expect(bar.dataset.start).toBe('10.000');
		expect(bar.dataset.end).toBe('20.000');
		expect(bar.dataset.duration).toBe('10.000');
		expect(bar.style.left).toBe('100px');
		expect(bar.style.width).toBe('100px');
	});

	it('emits raw candidate updates while dragging the end handle', async () => {
		const onChange = vi.fn();
		const screen = await render(SegmentBar, {
			segment,
			lane: 0,
			pxPerSecond: 10,
			index: 0,
			onChange
		});
		const handle = screen.container.querySelector('[data-testid="handle-end"]') as HTMLElement;
		handle.dispatchEvent(
			new PointerEvent('pointerdown', { clientX: 200, bubbles: true, pointerId: 1 })
		);
		handle.dispatchEvent(
			new PointerEvent('pointermove', { clientX: 220, bubbles: true, pointerId: 1 })
		);
		handle.dispatchEvent(
			new PointerEvent('pointerup', { clientX: 220, bubbles: true, pointerId: 1 })
		);
		expect(onChange).toHaveBeenCalled();
		const [id, next, moved] = onChange.mock.calls.at(-1)!;
		expect(id).toBe('s1');
		expect(moved).toBe('end');
		expect(next.end).toBeCloseTo(22, 3);
	});

	it('ignores pointer moves from a different pointer id', async () => {
		const onChange = vi.fn();
		const screen = await render(SegmentBar, {
			segment,
			lane: 0,
			pxPerSecond: 10,
			index: 0,
			onChange
		});
		const handle = screen.container.querySelector('[data-testid="handle-end"]') as HTMLElement;
		handle.dispatchEvent(
			new PointerEvent('pointerdown', { clientX: 200, bubbles: true, pointerId: 1 })
		);
		handle.dispatchEvent(
			new PointerEvent('pointermove', { clientX: 220, bubbles: true, pointerId: 2 })
		);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('stops emitting after pointercancel', async () => {
		const onChange = vi.fn();
		const screen = await render(SegmentBar, {
			segment,
			lane: 0,
			pxPerSecond: 10,
			index: 0,
			onChange
		});
		const handle = screen.container.querySelector('[data-testid="handle-end"]') as HTMLElement;
		handle.dispatchEvent(
			new PointerEvent('pointerdown', { clientX: 200, bubbles: true, pointerId: 1 })
		);
		handle.dispatchEvent(
			new PointerEvent('pointercancel', { clientX: 200, bubbles: true, pointerId: 1 })
		);
		handle.dispatchEvent(
			new PointerEvent('pointermove', { clientX: 220, bubbles: true, pointerId: 1 })
		);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('exposes the handles as sliders without flattening the bar', async () => {
		const screen = await render(SegmentBar, { segment, lane: 0, pxPerSecond: 10, index: 0 });
		const bar = screen.container.querySelector('[data-testid="segment-bar"]') as HTMLElement;
		const start = screen.container.querySelector('[data-testid="handle-start"]') as HTMLElement;
		const end = screen.container.querySelector('[data-testid="handle-end"]') as HTMLElement;
		expect(bar.getAttribute('role')).toBeNull();
		expect(start.getAttribute('role')).toBe('slider');
		expect(end.getAttribute('role')).toBe('slider');
	});

	it('nudges the focused handle with the keyboard', async () => {
		const onChange = vi.fn();
		const screen = await render(SegmentBar, {
			segment,
			lane: 0,
			pxPerSecond: 10,
			index: 0,
			onChange
		});
		const handle = screen.container.querySelector('[data-testid="handle-end"]') as HTMLElement;
		handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(onChange.mock.calls.at(-1)![1].end).toBeCloseTo(20.1, 3);
		handle.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true })
		);
		expect(onChange.mock.calls.at(-1)![1].end).toBeCloseTo(19, 3);
	});

	it('highlights when selected', async () => {
		const screen = await render(SegmentBar, {
			segment,
			lane: 0,
			pxPerSecond: 10,
			index: 0,
			selected: true
		});
		const bar = screen.container.querySelector('[data-testid="segment-bar"]') as HTMLElement;
		expect(bar.className).toContain('selected');
	});
});
