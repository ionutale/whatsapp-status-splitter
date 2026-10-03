<script lang="ts">
	import { project } from '../state/project.svelte';
	import TimeField from './TimeField.svelte';

	const selected = $derived(project.selected);
	const canSplit = $derived(selected !== null && selected.end - selected.start >= 1);
	const clipNumber = $derived(project.sortedSegments.findIndex((s) => s.id === selected?.id) + 1);
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center justify-between">
		<h2 class="font-semibold">Clip controls</h2>
		<span class="text-xs text-base-content/60" data-testid="clip-count">
			{project.segments.length} clip{project.segments.length === 1 ? '' : 's'}
		</span>
	</div>

	<label class="flex items-center gap-2 text-xs">
		Max clip length
		<input
			class="input w-20 input-xs"
			type="number"
			min="1"
			max="300"
			step="1"
			value={project.maxClipDuration}
			data-testid="input-max-length"
			onchange={(event) =>
				project.setMaxClipDuration(Number((event.currentTarget as HTMLInputElement).value))}
		/>
		s
	</label>

	{#if selected}
		<div class="flex flex-wrap items-end gap-3">
			<TimeField
				label={`Clip ${clipNumber} start`}
				seconds={selected.start}
				testid="time-field-start"
				onCommit={(value) => project.setSelectedField('start', value)}
			/>
			<TimeField
				label="End"
				seconds={selected.end}
				testid="time-field-end"
				onCommit={(value) => project.setSelectedField('end', value)}
			/>
			<TimeField
				label="Duration"
				seconds={selected.end - selected.start}
				testid="time-field-duration"
				onCommit={(value) => project.setSelectedField('duration', value)}
			/>
		</div>
		<div class="flex flex-wrap gap-2">
			<button
				class="btn btn-sm"
				type="button"
				data-testid="btn-split"
				disabled={!canSplit}
				onclick={() => project.splitSelected()}
			>
				Split in half
			</button>
			<button
				class="btn btn-ghost btn-sm"
				type="button"
				data-testid="btn-delete"
				onclick={() => project.deleteSelected()}
			>
				Delete
			</button>
			<button
				class="btn btn-ghost btn-sm"
				type="button"
				data-testid="btn-reset"
				onclick={() => project.resetSplit()}
			>
				Reset to auto-split
			</button>
		</div>
	{:else}
		<p class="text-sm text-base-content/60">Select a clip on the timeline.</p>
	{/if}
</div>
