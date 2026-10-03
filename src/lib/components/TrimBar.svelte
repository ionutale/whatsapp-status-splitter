<script lang="ts">
	import { formatClock } from '../domain/format';
	import type { Segment } from '../domain/segments';
	import { computeTrimWindow } from '../domain/trimWindow';

	let {
		segment,
		index,
		duration,
		onChange,
		onScrub,
		onSplit,
		onDelete
	}: {
		segment: Segment;
		index: number;
		duration: number;
		onChange: (id: string, next: Segment, moved: 'start' | 'end') => void;
		onScrub: (time: number) => void;
		onSplit: () => void;
		onDelete: () => void;
	} = $props();

	let trackWidth = $state(0);
	let editing = $state<'start' | 'end' | null>(null);
	let editValue = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);

	let drag = $state<{
		edge: 'start' | 'end';
		pointerId: number;
		pointerX: number;
		initial: Segment;
		window: { windowStart: number; windowEnd: number };
		pps: number;
	} | null>(null);

	const clipDuration = $derived(Math.max(0, segment.end - segment.start));
	// The window is a pure function of the clip and the video. It is frozen for
	// the duration of a drag so the clip can be pulled past the visible edge
	// without the bar recentering under the finger; it recenters on release,
	// when the parent feeds the clamped segment straight back in.
	const window = $derived(computeTrimWindow(segment.start, segment.end, duration));
	const activeWindow = $derived(drag ? drag.window : window);
	const windowSpan = $derived(Math.max(activeWindow.windowEnd - activeWindow.windowStart, 1e-6));
	const pxPerSecond = $derived(trackWidth / windowSpan);

	function toPx(time: number): number {
		const raw = (time - activeWindow.windowStart) * pxPerSecond;
		return Math.min(Math.max(raw, 0), trackWidth);
	}

	const startPx = $derived(toPx(segment.start));
	const endPx = $derived(toPx(segment.end));

	$effect(() => {
		if (editing && inputEl) {
			inputEl.focus();
			inputEl.select();
		}
	});

	function startDrag(edge: 'start' | 'end', event: PointerEvent) {
		event.stopPropagation();
		const target = event.currentTarget as HTMLElement;
		try {
			target.setPointerCapture(event.pointerId);
		} catch {
			// Synthetic pointer events in tests have no real pointer to capture.
		}
		// Snapshot the clip and the scale so a drag stays idempotent even if the
		// parent rewrites the segment (and therefore the window) mid-gesture.
		drag = {
			edge,
			pointerId: event.pointerId,
			pointerX: event.clientX,
			initial: { ...segment },
			window,
			pps: pxPerSecond
		};
		onScrub(edge === 'start' ? segment.start : segment.end);
	}

	function moveDrag(event: PointerEvent) {
		if (!drag || event.pointerId !== drag.pointerId || drag.pps <= 0) return;
		const delta = (event.clientX - drag.pointerX) / drag.pps;
		const next: Segment =
			drag.edge === 'start'
				? { ...drag.initial, start: drag.initial.start + delta }
				: { ...drag.initial, end: drag.initial.end + delta };
		// Report raw values; clamping is the store's job.
		onChange(segment.id, next, drag.edge);
		onScrub(drag.edge === 'start' ? next.start : next.end);
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
		onChange(segment.id, next, edge);
	}

	function beginEdit(edge: 'start' | 'end') {
		editing = edge;
		editValue = String(edge === 'start' ? segment.start : segment.end);
	}

	function commitEdit() {
		if (!editing) return;
		const edge = editing;
		editing = null;
		const trimmed = editValue.trim();
		if (trimmed === '') return;
		const value = Number(trimmed);
		if (!Number.isFinite(value)) return;
		const next: Segment =
			edge === 'start' ? { ...segment, start: value } : { ...segment, end: value };
		onChange(segment.id, next, edge);
	}

	function cancelEdit() {
		editing = null;
	}

	function onEditKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			commitEdit();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			cancelEdit();
		}
	}
</script>

<div
	class="trim-bar flex flex-col gap-2 rounded-box border border-base-content/20 bg-base-200 p-3"
	data-testid="trim-bar"
	data-start={segment.start.toFixed(3)}
	data-end={segment.end.toFixed(3)}
	data-duration={clipDuration.toFixed(3)}
	data-pps={pxPerSecond.toFixed(4)}
>
	<div class="flex items-center justify-center gap-1 font-mono text-xs">
		{#if editing === 'start'}
			<input
				class="input h-11 w-24 text-center input-xs"
				data-testid="trim-input"
				aria-label={`Clip ${index + 1} start`}
				bind:value={editValue}
				bind:this={inputEl}
				onblur={commitEdit}
				onkeydown={onEditKeydown}
			/>
		{:else}
			<button
				type="button"
				class="rounded-btn min-h-11 px-2"
				data-testid="trim-label-start"
				onclick={() => beginEdit('start')}
			>
				{formatClock(segment.start)}
			</button>
		{/if}
		<span class="text-base-content/40">·</span>
		{#if editing === 'end'}
			<input
				class="input h-11 w-24 text-center input-xs"
				data-testid="trim-input"
				aria-label={`Clip ${index + 1} end`}
				bind:value={editValue}
				bind:this={inputEl}
				onblur={commitEdit}
				onkeydown={onEditKeydown}
			/>
		{:else}
			<button
				type="button"
				class="rounded-btn min-h-11 px-2"
				data-testid="trim-label-end"
				onclick={() => beginEdit('end')}
			>
				{formatClock(segment.end)}
			</button>
		{/if}
		<span class="text-base-content/40">·</span>
		<span class="px-2" data-testid="trim-label-duration">{formatClock(clipDuration)}</span>
	</div>

	<div class="relative h-12 w-full" bind:clientWidth={trackWidth}>
		<div
			class="pointer-events-none absolute top-0 h-full rounded-selector bg-primary/25"
			style="left:{startPx}px; width:{Math.max(endPx - startPx, 0)}px"
		></div>
		<span
			class="handle absolute top-0 h-full w-11 -translate-x-1/2 cursor-ew-resize"
			style="left:{startPx}px"
			role="slider"
			tabindex="0"
			aria-label={`Clip ${index + 1} start`}
			aria-valuemin={0}
			aria-valuenow={segment.start}
			aria-valuemax={segment.end}
			data-testid="trim-handle-start"
			onpointerdown={(event) => startDrag('start', event)}
			onpointermove={moveDrag}
			onpointerup={endDrag}
			onpointercancel={endDrag}
			onlostpointercapture={endDrag}
			onkeydown={(event) => handleKey(event, 'start')}
		>
			<span
				class="pointer-events-none absolute top-1/2 left-1/2 h-8 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
			></span>
		</span>
		<span
			class="handle absolute top-0 h-full w-11 -translate-x-1/2 cursor-ew-resize"
			style="left:{endPx}px"
			role="slider"
			tabindex="0"
			aria-label={`Clip ${index + 1} end`}
			aria-valuemin={segment.start}
			aria-valuenow={segment.end}
			aria-valuemax={duration}
			data-testid="trim-handle-end"
			onpointerdown={(event) => startDrag('end', event)}
			onpointermove={moveDrag}
			onpointerup={endDrag}
			onpointercancel={endDrag}
			onlostpointercapture={endDrag}
			onkeydown={(event) => handleKey(event, 'end')}
		>
			<span
				class="pointer-events-none absolute top-1/2 left-1/2 h-8 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
			></span>
		</span>
	</div>

	<div class="flex gap-2">
		<button
			type="button"
			class="btn min-h-11 flex-1 btn-sm"
			data-testid="trim-action-split"
			onclick={onSplit}
		>
			Split in half
		</button>
		<button
			type="button"
			class="btn min-h-11 flex-1 btn-sm"
			data-testid="trim-action-delete"
			onclick={onDelete}
		>
			Delete
		</button>
	</div>
</div>

<style>
	.trim-bar {
		touch-action: none;
	}
	.handle {
		touch-action: none;
	}
</style>
