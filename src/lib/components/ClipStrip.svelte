<script lang="ts">
	import { formatClock } from '../domain/format';
	import type { Segment } from '../domain/segments';

	const MIN_MAX_CLIP_DURATION = 1;
	const MAX_MAX_CLIP_DURATION = 300;
	const STEP = 5;

	let {
		segments,
		selectedId,
		maxClipDuration,
		onSelect,
		onMaxClipDurationChange,
		onReset
	}: {
		segments: Segment[];
		selectedId: string | null;
		maxClipDuration: number;
		onSelect: (id: string) => void;
		onMaxClipDurationChange: (seconds: number) => void;
		onReset: () => void;
	} = $props();

	const minusDisabled = $derived(maxClipDuration <= MIN_MAX_CLIP_DURATION);
	const plusDisabled = $derived(maxClipDuration >= MAX_MAX_CLIP_DURATION);

	function step(delta: number) {
		const current = Math.min(
			Math.max(maxClipDuration, MIN_MAX_CLIP_DURATION),
			MAX_MAX_CLIP_DURATION
		);
		const next = Math.min(Math.max(current + delta, MIN_MAX_CLIP_DURATION), MAX_MAX_CLIP_DURATION);
		onMaxClipDurationChange(next);
	}
</script>

<div class="flex flex-col gap-3" data-testid="clip-strip">
	<div class="flex gap-2 overflow-x-auto">
		{#each segments as segment, index (segment.id)}
			<button
				type="button"
				class="btn min-h-11 shrink-0 btn-sm {segment.id === selectedId
					? 'btn-primary'
					: 'btn-ghost'}"
				data-testid="clip-chip"
				data-index={index}
				data-selected={segment.id === selectedId}
				aria-pressed={segment.id === selectedId}
				onclick={() => onSelect(segment.id)}
			>
				{index + 1} · {formatClock(segment.end - segment.start)}
			</button>
		{/each}
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<span class="text-xs">Max clip length</span>
		<div class="flex items-center gap-1">
			<button
				type="button"
				class="btn min-h-11 min-w-11 btn-sm"
				data-testid="max-clip-minus"
				aria-label="Decrease max clip length"
				disabled={minusDisabled}
				onclick={() => step(-STEP)}
			>
				−
			</button>
			<span class="w-10 text-center text-sm" aria-live="polite" data-testid="max-clip-value"
				>{maxClipDuration}s</span
			>
			<button
				type="button"
				class="btn min-h-11 min-w-11 btn-sm"
				data-testid="max-clip-plus"
				aria-label="Increase max clip length"
				disabled={plusDisabled}
				onclick={() => step(STEP)}
			>
				+
			</button>
		</div>
		<button
			type="button"
			class="btn min-h-11 btn-ghost btn-sm"
			data-testid="reset-auto-split"
			onclick={onReset}
		>
			Reset to auto-split
		</button>
	</div>
</div>
