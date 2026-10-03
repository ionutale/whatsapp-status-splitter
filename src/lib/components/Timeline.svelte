<script lang="ts">
	import { formatClock } from '../domain/format';
	import type { Interval, Segment } from '../domain/segments';
	import { assignLanes, generateTicks } from '../domain/timeline';
	import Filmstrip from './Filmstrip.svelte';
	import SegmentBar from './SegmentBar.svelte';

	let {
		duration,
		segments,
		selectedId,
		currentTime,
		zoom = $bindable(1),
		thumbs,
		coverage,
		onSeek,
		onSelect,
		onSegmentChange
	}: {
		duration: number;
		segments: Segment[];
		selectedId: string | null;
		currentTime: number;
		zoom?: number;
		thumbs: { time: number; url: string }[];
		coverage: { gaps: Interval[]; overlaps: Interval[] };
		onSeek: (time: number) => void;
		onSelect: (id: string) => void;
		onSegmentChange: (id: string, next: Segment, moved: 'start' | 'end') => void;
	} = $props();

	let scroller = $state<HTMLDivElement | null>(null);
	let viewportWidth = $state(800);
	let lastPxPerSecond = 0;

	const pxPerSecond = $derived((viewportWidth * zoom) / Math.max(duration, 0.001));
	const contentWidth = $derived(viewportWidth * zoom);
	const ticks = $derived(generateTicks(duration, pxPerSecond));
	const lanes = $derived(assignLanes(segments));
	const laneCount = $derived(Math.max(1, ...lanes.map((lane) => lane + 1)));

	$effect(() => {
		const pps = pxPerSecond;
		if (scroller && lastPxPerSecond !== 0 && pps !== lastPxPerSecond) {
			scroller.scrollLeft = currentTime * pps - viewportWidth / 2;
		}
		lastPxPerSecond = pps;
	});

	// Keep the playhead in view as it moves. Only writes scrollLeft when the
	// playhead drifts past a small margin, so ordinary playback doesn't scroll
	// every tick — but a deliberate scroll away from the playhead is re-centered
	// on the next tick (~4x/sec). No-op when the whole timeline already fits.
	const PLAYHEAD_MARGIN = 24;
	$effect(() => {
		const pps = pxPerSecond;
		const time = currentTime;
		if (!scroller || contentWidth <= viewportWidth) return;
		const x = time * pps;
		const left = scroller.scrollLeft;
		if (x < left + PLAYHEAD_MARGIN || x > left + viewportWidth - PLAYHEAD_MARGIN) {
			scroller.scrollLeft = x - viewportWidth / 2;
		}
	});

	function seek(event: MouseEvent) {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const time = (event.clientX - rect.left) / pxPerSecond;
		onSeek(Math.min(Math.max(time, 0), duration));
	}
</script>

<div class="flex flex-col gap-2">
	<div
		class="overflow-x-auto rounded-box bg-base-200 p-2"
		bind:this={scroller}
		bind:clientWidth={viewportWidth}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="relative"
			style="width:{contentWidth}px; height:{80 + laneCount * 44}px"
			onclick={seek}
			data-testid="timeline"
		>
			<Filmstrip {thumbs} {pxPerSecond} />
			<div class="absolute top-0 left-0 h-6 w-full" data-testid="ruler">
				{#each ticks as tick (tick.time)}
					<span
						class="absolute top-0 text-[10px] text-base-content/60"
						style="left:{tick.time * pxPerSecond}px"
					>
						{tick.major ? formatClock(tick.time) : ''}
					</span>
				{/each}
			</div>
			{#each coverage.gaps as gap (gap.start)}
				<div
					class="absolute bg-warning/40"
					style="left:{gap.start * pxPerSecond}px; width:{Math.max(
						2,
						(gap.end - gap.start) * pxPerSecond
					)}px; top:80px; height:{laneCount * 44}px"
					title="Uncovered"
				></div>
			{/each}
			{#each coverage.overlaps as overlap, index (index)}
				<div
					class="absolute bg-error/30"
					style="left:{overlap.start * pxPerSecond}px; width:{Math.max(
						2,
						(overlap.end - overlap.start) * pxPerSecond
					)}px; top:80px; height:{laneCount * 44}px"
					title="Overlapping clips"
					data-testid="overlap-band"
				></div>
			{/each}
			<div class="absolute top-20 left-0 w-full">
				{#each segments as segment, index (segment.id)}
					<SegmentBar
						{segment}
						lane={lanes[index]}
						{pxPerSecond}
						selected={segment.id === selectedId}
						{index}
						onSelect={(id) => onSelect(id)}
						onChange={(id, next, moved) => onSegmentChange(id, next, moved)}
					/>
				{/each}
			</div>
			<div
				class="absolute top-0 h-full w-0.5 bg-error"
				style="left:{currentTime * pxPerSecond}px"
				data-testid="playhead"
			></div>
		</div>
	</div>
	<label class="flex items-center gap-2 text-xs">
		Zoom
		<input
			class="range max-w-xs range-xs"
			type="range"
			min="1"
			max="20"
			step="0.1"
			bind:value={zoom}
			data-testid="zoom-slider"
		/>
	</label>
</div>
