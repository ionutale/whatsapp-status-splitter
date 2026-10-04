import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Segment } from '../domain/segments';
import ClipStrip from './ClipStrip.svelte';

type ClipStripProps = {
	segments: Segment[];
	selectedId: string | null;
	maxClipDuration: number;
	onSelect: (id: string) => void;
	onMaxClipDurationChange: (seconds: number) => void;
	onReset: () => void;
};

const segments: Segment[] = [
	{ id: 'a', start: 0, end: 30 },
	{ id: 'b', start: 30, end: 60 },
	{ id: 'c', start: 60, end: 80 }
];

function makeProps(overrides: Partial<ClipStripProps> = {}): ClipStripProps {
	return {
		segments,
		selectedId: 'b',
		maxClipDuration: 30,
		onSelect: vi.fn(),
		onMaxClipDurationChange: vi.fn(),
		onReset: vi.fn(),
		...overrides
	};
}

describe('ClipStrip', () => {
	it('renders one chip per segment with index and duration', async () => {
		const props = makeProps();
		const screen = await render(ClipStrip, props);
		const chips = screen.container.querySelectorAll('[data-testid="clip-chip"]');
		expect(chips).toHaveLength(3);
		expect(chips[0].textContent).toContain('1 · 00:30.0');
		expect(chips[1].textContent).toContain('2 · 00:30.0');
		expect(chips[2].textContent).toContain('3 · 00:20.0');
		expect(chips[0].getAttribute('data-index')).toBe('0');
		expect(chips[1].getAttribute('data-index')).toBe('1');
		expect(chips[2].getAttribute('data-index')).toBe('2');
	});

	it('calls onSelect with the tapped chip id', async () => {
		const props = makeProps();
		const screen = await render(ClipStrip, props);
		const chips = screen.container.querySelectorAll('[data-testid="clip-chip"]');
		(chips[2] as HTMLElement).click();
		expect(props.onSelect).toHaveBeenCalledWith('c');
	});

	it('marks the selected chip', async () => {
		const props = makeProps({ selectedId: 'b' });
		const screen = await render(ClipStrip, props);
		const chips = screen.container.querySelectorAll('[data-testid="clip-chip"]');
		expect(chips[1].getAttribute('data-selected')).toBe('true');
		expect(chips[0].getAttribute('data-selected')).toBe('false');
		expect(chips[2].getAttribute('data-selected')).toBe('false');
	});

	it('steps the max clip length by five', async () => {
		const props = makeProps({ maxClipDuration: 30 });
		const screen = await render(ClipStrip, props);
		const minus = screen.container.querySelector(
			'[data-testid="max-clip-minus"]'
		) as HTMLButtonElement;
		const plus = screen.container.querySelector(
			'[data-testid="max-clip-plus"]'
		) as HTMLButtonElement;
		minus.click();
		expect(props.onMaxClipDurationChange).toHaveBeenLastCalledWith(25);
		plus.click();
		expect(props.onMaxClipDurationChange).toHaveBeenLastCalledWith(35);
	});

	it('disables minus at the minimum and still steps up', async () => {
		const props = makeProps({ maxClipDuration: 1 });
		const screen = await render(ClipStrip, props);
		const minus = screen.container.querySelector(
			'[data-testid="max-clip-minus"]'
		) as HTMLButtonElement;
		const plus = screen.container.querySelector(
			'[data-testid="max-clip-plus"]'
		) as HTMLButtonElement;
		expect(minus.disabled).toBe(true);
		expect(plus.disabled).toBe(false);
		minus.click();
		expect(props.onMaxClipDurationChange).not.toHaveBeenCalled();
		plus.click();
		expect(props.onMaxClipDurationChange).toHaveBeenCalledWith(6);
	});

	it('disables plus at the maximum and still steps down', async () => {
		const props = makeProps({ maxClipDuration: 300 });
		const screen = await render(ClipStrip, props);
		const minus = screen.container.querySelector(
			'[data-testid="max-clip-minus"]'
		) as HTMLButtonElement;
		const plus = screen.container.querySelector(
			'[data-testid="max-clip-plus"]'
		) as HTMLButtonElement;
		expect(plus.disabled).toBe(true);
		expect(minus.disabled).toBe(false);
		plus.click();
		expect(props.onMaxClipDurationChange).not.toHaveBeenCalled();
		minus.click();
		expect(props.onMaxClipDurationChange).toHaveBeenCalledWith(295);
	});

	it('shows the current max clip length', async () => {
		const props = makeProps({ maxClipDuration: 30 });
		const screen = await render(ClipStrip, props);
		expect(screen.container.querySelector('[data-testid="max-clip-value"]')?.textContent).toContain(
			'30'
		);
	});

	it('calls onReset', async () => {
		const props = makeProps();
		const screen = await render(ClipStrip, props);
		(
			screen.container.querySelector('[data-testid="reset-auto-split"]') as HTMLButtonElement
		).click();
		expect(props.onReset).toHaveBeenCalled();
	});

	it('renders no chips without crashing when there are no segments', async () => {
		const props = makeProps({ segments: [] });
		const screen = await render(ClipStrip, props);
		expect(screen.container.querySelectorAll('[data-testid="clip-chip"]')).toHaveLength(0);
		expect(screen.container.querySelector('[data-testid="clip-strip"]')).not.toBeNull();
		expect(screen.container.querySelector('[data-testid="max-clip-value"]')?.textContent).toContain(
			'30'
		);
	});
});
