<script lang="ts">
	import { batchState, type BatchItem, type BatchState } from '../state/batch.svelte';

	let { batch = null }: { batch?: BatchState | null } = $props();
	const state = $derived(batch ?? batchState);

	function statusLabel(item: BatchItem): string {
		switch (item.status) {
			case 'queued':
				return 'Queued';
			case 'reading':
				return 'Reading…';
			case 'encoding':
				return `Clip ${item.clipIndex} of ${item.clipCount}`;
			case 'done':
				return 'Done';
			case 'failed':
				return `Failed: ${item.error ?? 'unknown error'}`;
		}
	}
</script>

<div class="flex flex-col gap-3 rounded-box border border-base-300 p-3" data-testid="batch-panel">
	<div class="flex items-center justify-between">
		<h2 class="font-semibold">Batch queue</h2>
		<span class="text-xs text-base-content/60"
			>{state.items.length} file{state.items.length === 1 ? '' : 's'}</span
		>
	</div>

	<ul class="flex flex-col gap-2">
		{#each state.items as item (item.id)}
			<li class="rounded-box bg-base-200 p-2" data-testid="batch-item">
				<div class="flex items-center justify-between gap-2 text-xs">
					<span class="truncate">{item.file.name}</span>
					<span
						class="shrink-0 text-base-content/60"
						data-testid="batch-status"
						data-status={item.status}
					>
						{statusLabel(item)}
					</span>
				</div>
				{#if item.status === 'encoding'}
					<progress class="progress mt-1 h-1 w-full progress-primary" value={item.progress} max="1"
					></progress>
				{/if}
			</li>
		{/each}
	</ul>

	<progress
		class="progress h-2 w-full progress-primary"
		value={state.overallProgress}
		max="1"
		data-testid="batch-overall"
	></progress>

	{#if state.runError}
		<p class="text-xs text-error" role="alert" data-testid="batch-run-error">{state.runError}</p>
	{/if}

	<div class="flex gap-2">
		<button
			class="btn btn-primary btn-sm"
			type="button"
			data-testid="batch-start"
			disabled={state.running || state.items.length === 0}
			onclick={() => state.start()}
		>
			Start
		</button>
		<button
			class="btn btn-ghost btn-sm"
			type="button"
			data-testid="batch-cancel"
			disabled={!state.running}
			onclick={() => state.cancel()}
		>
			Cancel
		</button>
	</div>
</div>
