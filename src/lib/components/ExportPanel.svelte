<script lang="ts">
	import { buildOutputPlan } from '../domain/bitrate';
	import { clipFileName, sanitizeBaseName, zipFileName } from '../domain/naming';
	import { downloadBlob } from '../media/download';
	import { realEncodeClip } from '../media/exporter';
	import { canShareFiles, shareBlob } from '../media/share';
	import { makeZip } from '../media/zip';
	import { ExportState } from '../state/export.svelte';
	import { project } from '../state/project.svelte';

	let { exporter = null }: { exporter?: ExportState | null } = $props();
	const state = $derived(
		exporter ?? new ExportState({ encodeClip: realEncodeClip, downloadBlob, makeZip })
	);

	const base = $derived(sanitizeBaseName(project.file?.name ?? 'video'));
	const jobs = $derived(
		project.meta
			? project.sortedSegments.map((segment, index) => ({
					id: segment.id,
					fileName: clipFileName(base, index),
					segment,
					plan: buildOutputPlan(segment.end - segment.start, project.meta!, project.preset)
				}))
			: []
	);
	const shareable = canShareFiles();

	const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

	async function exportClip(job: (typeof jobs)[number]) {
		if (!project.file) return;
		await state.runJobs(project.file, [job], { finish: 'download-first' });
	}

	async function exportAll() {
		if (!project.file) return;
		await state.runJobs(project.file, jobs, { finish: 'zip', zipName: zipFileName(base) });
	}

	async function shareClip(job: (typeof jobs)[number]) {
		if (!project.file) return;
		let blob = state.results[job.id];
		if (!blob) {
			await state.runJobs(project.file, [job], { finish: 'none' });
			blob = state.results[job.id];
		}
		if (!blob) return;
		try {
			await shareBlob(blob, job.fileName);
		} catch (error) {
			if ((error as Error)?.name !== 'AbortError') {
				console.error('[share] failed', error);
				project.setError('Sharing failed. The clip was still exported and can be downloaded.');
			}
		}
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center justify-between">
		<h2 class="font-semibold">Export</h2>
		<select class="select select-xs" bind:value={project.preset} data-testid="preset-select">
			<option value="whatsapp">WhatsApp (≤16MB)</option>
			<option value="high">High quality</option>
			<option value="small">Small file</option>
		</select>
	</div>

	<ul class="flex flex-col gap-2">
		{#each jobs as job (job.id)}
			<li class="rounded-box bg-base-200 p-2" data-testid="export-row">
				<div class="flex items-center justify-between gap-2 text-xs">
					<span class="truncate">{job.fileName}</span>
					<span class="shrink-0 text-base-content/60">{formatSize(job.plan.estimatedBytes)}</span>
				</div>
				<div class="mt-1 flex flex-wrap items-center gap-2">
					<button
						class="btn btn-xs"
						type="button"
						data-testid="btn-export-clip"
						disabled={state.busy}
						onclick={() => exportClip(job)}
					>
						Download
					</button>
					{#if shareable}
						<button
							class="btn btn-ghost btn-xs"
							type="button"
							data-testid="btn-share-clip"
							disabled={state.busy}
							onclick={() => shareClip(job)}
						>
							Share
						</button>
					{/if}
					{#if state.statuses[job.id] === 'failed'}
						<button
							class="btn btn-warning btn-xs"
							type="button"
							data-testid="btn-retry-clip"
							disabled={state.busy}
							onclick={() => exportClip(job)}
						>
							Retry
						</button>
					{/if}
					{#if state.statuses[job.id] === 'encoding'}
						<progress
							class="progress w-24 progress-primary"
							value={state.progress[job.id] ?? 0}
							max="1"
						></progress>
					{:else if state.statuses[job.id] === 'done'}
						<span class="text-xs text-success">Done</span>
					{:else if state.statuses[job.id] === 'canceled'}
						<span class="text-xs text-base-content/60">Canceled</span>
					{/if}
					{#if state.errors[job.id]}
						<span class="text-xs text-error" data-testid="export-error">{state.errors[job.id]}</span
						>
					{/if}
				</div>
			</li>
		{/each}
	</ul>

	{#if state.runError}
		<p class="text-xs text-error" role="alert" data-testid="export-run-error">{state.runError}</p>
	{/if}

	<div class="flex gap-2">
		<button
			class="btn btn-primary btn-sm"
			type="button"
			data-testid="btn-export-all"
			disabled={state.busy || jobs.length === 0}
			onclick={exportAll}
		>
			Export all (ZIP)
		</button>
		{#if state.busy}
			<button
				class="btn btn-ghost btn-sm"
				type="button"
				data-testid="btn-cancel-export"
				onclick={() => state.cancel()}
			>
				Cancel
			</button>
		{/if}
	</div>
</div>
