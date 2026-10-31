<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import { buildOutputPlan } from '../domain/bitrate';
	import { clipFileName, sanitizeBaseName, zipFileName } from '../domain/naming';
	import { canShareAll, canShareFiles, shareFiles } from '../media/share';
	import { exportState, type ExportState } from '../state/export.svelte';
	import { project } from '../state/project.svelte';

	let { exporter = null }: { exporter?: ExportState | null } = $props();
	const exporterState = $derived(exporter ?? exportState);

	const base = $derived(sanitizeBaseName(project.file?.name ?? 'video'));
	const jobs = $derived(
		project.meta
			? project.sortedSegments.map((segment, index) => ({
					id: segment.id,
					fileName: clipFileName(base, index),
					segment,
					plan: buildOutputPlan(segment.end - segment.start, project.meta!, project.preset, {
						crop916: project.crop916
					})
				}))
			: []
	);
	const shareable = canShareFiles();

	const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

	// `exporterState.results` is keyed only by segment id, which survives boundary and
	// preset edits. Cache the exact plan+bounds a blob was encoded for so Share
	// never reuses an encode that no longer matches the current row.
	type CacheEntry = { key: string; blob: Blob };
	const cache = new SvelteMap<string, CacheEntry>();
	const jobKey = (job: (typeof jobs)[number]) =>
		`${job.plan.width}x${job.plan.height}/${job.plan.fit}/${job.plan.videoKbps}/${job.segment.start}-${job.segment.end}`;

	type Prepared = { job: (typeof jobs)[number]; blob: Blob };

	let shareAllState = $state<'idle' | 'preparing' | 'ready' | 'sharing' | 'guided'>('idle');
	let shareAllError = $state<string | null>(null);
	let preparedFiles = $state<Prepared[] | null>(null);
	let guidedFiles = $state<Prepared[] | null>(null);
	let guidedIndex = $state(0);

	const shareAllLabel = $derived.by(() => {
		if (shareAllState === 'preparing') return 'Preparing…';
		if (shareAllState === 'sharing') return 'Sharing…';
		if (shareAllState === 'ready') {
			const pc = preparedFiles?.length ?? 0;
			const tc = jobs.length;
			if (pc > 0 && pc < tc) return `Share ${pc} of ${tc}`;
			return `Share all (${pc || tc})`;
		}
		return `Share all (${jobs.length})`;
	});

	// Reset share-all state whenever the underlying file changes, so a stale
	// `ready` state can never share the previous file's clips.
	$effect(() => {
		void project.file;
		shareAllState = 'idle';
		shareAllError = null;
		preparedFiles = null;
		guidedFiles = null;
		guidedIndex = 0;
		cache.clear();
	});

	async function prepareAll(): Promise<Prepared[]> {
		if (!project.file) return [];
		const startJobs = jobs;
		const missing: (typeof jobs)[number][] = [];
		const preparedByKey = new SvelteMap<
			string,
			{ job: (typeof jobs)[number]; blob: Blob; key: string }
		>();

		for (const job of startJobs) {
			const key = jobKey(job);
			const c = cache.get(job.id);
			if (c && c.key === key) {
				preparedByKey.set(job.id, { job, blob: c.blob, key });
			} else {
				missing.push(job);
			}
		}

		let canceled = false;
		if (missing.length > 0) {
			await exporterState.runJobs(project.file, missing, { finish: 'none' });
			for (const job of missing) {
				if (exporterState.statuses[job.id] === 'canceled') {
					canceled = true;
				}
			}
			if (!canceled) {
				for (const job of missing) {
					if (exporterState.statuses[job.id] === 'done') {
						const blob = exporterState.results[job.id];
						if (blob) {
							const key = jobKey(job);
							cache.set(job.id, { key, blob });
							preparedByKey.set(job.id, { job, blob, key });
						}
					}
				}
			}
		}

		if (canceled) return [];

		const nowJobs = jobs;
		const result: Prepared[] = [];
		for (const job of nowJobs) {
			const key = jobKey(job);
			const entry = preparedByKey.get(job.id);
			if (entry && entry.key === key) {
				result.push({ job, blob: entry.blob });
			}
		}
		return result;
	}

	async function attemptShare(files: File[]) {
		shareAllState = 'sharing';
		try {
			await shareFiles(files, 'Status clips');
			shareAllState = 'idle';
			shareAllError = null;
			preparedFiles = null;
		} catch (error) {
			const name = (error as Error)?.name;
			if (name === 'AbortError') {
				shareAllState = 'idle';
				shareAllError = null;
				preparedFiles = null;
			} else if (name === 'NotAllowedError') {
				shareAllState = 'ready';
				shareAllError = 'Tap Share all again to open the share sheet.';
			} else {
				shareAllState = 'idle';
				shareAllError = error instanceof Error ? error.message : String(error);
				preparedFiles = null;
			}
		}
	}

	async function shareAll() {
		if (!project.file) return;
		shareAllError = null;

		if (shareAllState === 'ready' && preparedFiles) {
			let stale = false;
			if (preparedFiles.length === 0) stale = true;
			for (const p of preparedFiles) {
				const cj = jobs.find((j) => j.id === p.job.id);
				if (!cj || jobKey(cj) !== jobKey(p.job)) {
					stale = true;
					break;
				}
			}
			if (preparedFiles.some((p) => !jobs.find((j) => j.id === p.job.id))) stale = true;

			if (stale) {
				shareAllState = 'preparing';
				preparedFiles = null;
				const result = await prepareAll();
				await finishPrepare(result);
				return;
			}

			const files = preparedFiles.map(
				(p) => new File([p.blob], p.job.fileName, { type: 'video/mp4' })
			);
			await attemptShare(files);
			return;
		}

		shareAllState = 'preparing';
		preparedFiles = null;
		const result = await prepareAll();
		await finishPrepare(result);
	}

	async function finishPrepare(result: Prepared[]) {
		if (result.length === 0) {
			const canceled = jobs.some((j) => exporterState.statuses[j.id] === 'canceled');
			if (canceled) {
				shareAllState = 'idle';
				shareAllError = null;
			} else {
				shareAllState = 'idle';
				shareAllError = 'Settings changed while preparing — try again.';
			}
			preparedFiles = null;
			return;
		}

		preparedFiles = result;
		const files = result.map((p) => new File([p.blob], p.job.fileName, { type: 'video/mp4' }));
		if (canShareAll(files)) {
			await attemptShare(files);
		} else {
			guidedFiles = result;
			guidedIndex = 0;
			shareAllState = 'guided';
			shareAllError = null;
		}
	}

	async function shareNext() {
		if (!guidedFiles || guidedIndex >= guidedFiles.length) return;
		const prepared = guidedFiles[guidedIndex];
		const file = new File([prepared.blob], prepared.job.fileName, { type: 'video/mp4' });
		try {
			await shareFiles([file], 'Status clips');
			guidedIndex += 1;
			if (guidedIndex >= guidedFiles.length) {
				shareAllState = 'idle';
				shareAllError = null;
				guidedFiles = null;
				guidedIndex = 0;
				preparedFiles = null;
			}
		} catch (error) {
			const name = (error as Error)?.name;
			if (name === 'AbortError') {
				// stay on the same clip
			} else {
				shareAllError = error instanceof Error ? error.message : String(error);
			}
		}
	}

	function exitGuided() {
		shareAllState = 'idle';
		shareAllError = null;
		guidedFiles = null;
		guidedIndex = 0;
		preparedFiles = null;
	}

	async function exportClip(job: (typeof jobs)[number]) {
		if (!project.file) return;
		await exporterState.runJobs(project.file, [job], { finish: 'download-first' });
		if (exporterState.statuses[job.id] !== 'done') return;
		const blob = exporterState.results[job.id];
		if (blob) cache.set(job.id, { key: jobKey(job), blob });
	}

	async function exportAll() {
		if (!project.file) return;
		await exporterState.runJobs(project.file, jobs, { finish: 'zip', zipName: zipFileName(base) });
	}

	async function shareClip(job: (typeof jobs)[number]) {
		if (!project.file) return;
		const key = jobKey(job);
		const cached = cache.get(job.id);
		let blob = cached?.key === key ? cached.blob : undefined;
		if (!blob) {
			await exporterState.runJobs(project.file, [job], { finish: 'none' });
			blob = exporterState.statuses[job.id] === 'done' ? exporterState.results[job.id] : undefined;
			if (blob) cache.set(job.id, { key, blob });
		}
		if (!blob) return;
		try {
			await shareFiles([new File([blob], job.fileName, { type: 'video/mp4' })], job.fileName);
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

	<label class="label cursor-pointer justify-start gap-2 py-0">
		<input
			type="checkbox"
			class="checkbox checkbox-sm"
			data-testid="toggle-crop916"
			bind:checked={project.crop916}
		/>
		<span class="label-text">
			Fit 9:16 (crop)
			<span class="block text-xs text-base-content/60">center-crops for full-screen statuses</span>
		</span>
	</label>

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
						disabled={exporterState.busy}
						onclick={() => exportClip(job)}
					>
						Download
					</button>
					{#if shareable}
						<button
							class="btn btn-ghost btn-xs"
							type="button"
							data-testid="btn-share-clip"
							disabled={exporterState.busy}
							onclick={() => shareClip(job)}
						>
							Share
						</button>
					{/if}
					{#if exporterState.statuses[job.id] === 'failed'}
						<button
							class="btn btn-warning btn-xs"
							type="button"
							data-testid="btn-retry-clip"
							disabled={exporterState.busy}
							onclick={() => exportClip(job)}
						>
							Retry
						</button>
					{/if}
					{#if exporterState.statuses[job.id] === 'encoding'}
						<progress
							class="progress w-24 progress-primary"
							value={exporterState.progress[job.id] ?? 0}
							max="1"
						></progress>
					{:else if exporterState.statuses[job.id] === 'done'}
						<span class="text-xs text-success">Done</span>
					{:else if exporterState.statuses[job.id] === 'canceled'}
						<span class="text-xs text-base-content/60">Canceled</span>
					{/if}
					{#if exporterState.errors[job.id]}
						<span class="text-xs text-error" data-testid="export-error"
							>{exporterState.errors[job.id]}</span
						>
					{/if}
				</div>
			</li>
		{/each}
	</ul>

	{#if exporterState.runError}
		<p class="text-xs text-error" role="alert" data-testid="export-run-error">
			{exporterState.runError}
		</p>
	{/if}

	{#if shareAllError}
		<p class="text-xs text-error" role="alert" data-testid="share-all-error">{shareAllError}</p>
	{/if}

	<div class="flex gap-2">
		{#if shareable && jobs.length >= 2}
			{#if shareAllState === 'guided' && guidedFiles}
				<span class="text-xs" data-testid="share-guided-status"
					>Share {guidedIndex + 1} of {guidedFiles.length}</span
				>
				<button
					class="btn btn-primary btn-sm"
					type="button"
					data-testid="btn-share-next"
					disabled={exporterState.busy}
					onclick={shareNext}
				>
					Share {guidedIndex + 1} of {guidedFiles.length}
				</button>
				<button
					class="btn btn-ghost btn-sm"
					type="button"
					data-testid="btn-share-guided-exit"
					onclick={exitGuided}
				>
					Exit
				</button>
			{:else}
				<button
					class="btn btn-primary btn-sm"
					type="button"
					data-testid="btn-share-all"
					data-state={shareAllState}
					disabled={exporterState.busy}
					onclick={shareAll}
				>
					{shareAllLabel}
				</button>
			{/if}
		{/if}
		<button
			class="btn btn-outline btn-sm"
			type="button"
			data-testid="btn-export-all"
			disabled={exporterState.busy || jobs.length === 0}
			onclick={exportAll}
		>
			Export all (ZIP)
		</button>
		{#if exporterState.busy}
			<button
				class="btn btn-ghost btn-sm"
				type="button"
				data-testid="btn-cancel-export"
				onclick={() => exporterState.cancel()}
			>
				Cancel
			</button>
		{/if}
	</div>
</div>
