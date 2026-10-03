<script lang="ts">
	import { formatClock } from '../domain/format';
	import type { Segment } from '../domain/segments';

	let {
		segment,
		lane,
		pxPerSecond,
		selected = false,
		index,
		onSelect,
		onChange
	}: {
		segment: Segment;
		lane: number;
		pxPerSecond: number;
		selected?: boolean;
		index: number;
		onSelect?: (id: string) => void;
		onChange?: (id: string, next: Segment, moved: 'start' | 'end') => void;
	} = $props();

	let drag = $state<{
		edge: 'start' | 'end';
		pointerId: number;
		pointerX: number;
		initial: Segment;
	} | null>(null);

	function startDrag(edge: 'start' | 'end', event: PointerEvent) {
		event.stopPropagation();
		onSelect?.(segment.id);
		const target = event.currentTarget as HTMLElement;
		try {
			target.setPointerCapture(event.pointerId);
		} catch {
			// Synthetic pointer events in tests have no real pointer to capture.
		}
		drag = { edge, pointerId: event.pointerId, pointerX: event.clientX, initial: { ...segment } };
	}

	function moveDrag(event: PointerEvent) {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const delta = (event.clientX - drag.pointerX) / pxPerSecond;
		const next: Segment =
			drag.edge === 'start'
				? { ...drag.initial, start: drag.initial.start + delta }
				: { ...drag.initial, end: drag.initial.end + delta };
		onChange?.(segment.id, next, drag.edge);
	}

	function endDrag() {
		drag = null;
	}

	function handleKey(event: KeyboardEvent, edge: 'start' | 'end') {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const step = (event.shiftKey ? 1 : 0.1) * (event.key === 'ArrowLeft' ? -1 : 1);
		const next: Segment =
			edge === 'start'
				? { ...segment, start: segment.start + step }
				: { ...segment, end: segment.end + step };
		onChange?.(segment.id, next, edge);
	}

	const duration = $derived(segment.end - segment.start);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="segment-bar absolute flex h-9 items-center rounded-selector border border-base-content/20"
	class:selected
	style="left:{segment.start * pxPerSecond}px; width:{duration * pxPerSecond}px; top:{lane * 44}px"
	data-testid="segment-bar"
	data-start={segment.start.toFixed(3)}
	data-end={segment.end.toFixed(3)}
	data-duration={duration.toFixed(3)}
	onpointerdown={() => onSelect?.(segment.id)}
>
	<span
		class="handle absolute top-0 left-0 h-full w-3 cursor-ew-resize rounded-l bg-primary"
		role="slider"
		tabindex="0"
		aria-label={`Clip ${index + 1} start`}
		aria-valuemin={0}
		aria-valuenow={segment.start}
		aria-valuemax={segment.end}
		data-testid="handle-start"
		onpointerdown={(event) => startDrag('start', event)}
		onpointermove={moveDrag}
		onpointerup={endDrag}
		onpointercancel={endDrag}
		onlostpointercapture={endDrag}
		onkeydown={(event) => handleKey(event, 'start')}
	></span>
	<span class="pointer-events-none mx-auto truncate px-4 text-xs">
		Clip {index + 1} · {formatClock(duration)}
	</span>
	<span
		class="handle absolute top-0 right-0 h-full w-3 cursor-ew-resize rounded-r bg-primary"
		role="slider"
		tabindex="0"
		aria-label={`Clip ${index + 1} end`}
		aria-valuemin={segment.start}
		aria-valuenow={segment.end}
		aria-valuemax={100000}
		data-testid="handle-end"
		onpointerdown={(event) => startDrag('end', event)}
		onpointermove={moveDrag}
		onpointerup={endDrag}
		onpointercancel={endDrag}
		onlostpointercapture={endDrag}
		onkeydown={(event) => handleKey(event, 'end')}
	></span>
</div>

<style>
	.segment-bar {
		background: color-mix(in oklab, var(--color-primary) 18%, transparent);
	}
	.segment-bar.selected {
		background: color-mix(in oklab, var(--color-primary) 38%, transparent);
		outline: 2px solid var(--color-primary);
	}
</style>
