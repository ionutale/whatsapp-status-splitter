<script lang="ts">
	import DropZone from '../lib/components/DropZone.svelte';
	import { assertDecodable, inspectFile } from '../lib/media/inspect';
	import { project } from '../lib/state/project.svelte';

	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let objectUrl = $state<string | null>(null);

	async function handleFile(file: File) {
		if (project.dirty && !confirm('Discard the current editing state and load a new video?'))
			return;
		loadError = null;
		project.begin(file);
		loading = true;
		try {
			const { duration, meta } = await inspectFile(file);
			const blocked = assertDecodable(meta);
			if (blocked) {
				loadError = blocked;
				return;
			}
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			objectUrl = URL.createObjectURL(file);
			project.ready(duration, meta);
		} catch (error) {
			console.error('[load] failed to load video', error);
			loadError = error instanceof Error ? error.message : String(error);
		} finally {
			loading = false;
		}
	}
</script>

<div class="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4">
	<header class="flex items-center justify-between">
		<h1 class="text-xl font-bold">WhatsApp Status Splitter</h1>
		{#if project.meta}
			<span class="text-sm text-base-content/70" data-testid="file-name">{project.file?.name}</span>
		{/if}
	</header>

	{#if project.error}
		<div class="alert alert-error" data-testid="error-banner">{project.error}</div>
	{/if}
	{#if project.notice}
		<div class="alert alert-warning" data-testid="notice-banner">{project.notice}</div>
	{/if}

	{#if !project.meta}
		{#if loading}<span class="loading loading-spinner"></span>{/if}
		<DropZone onFile={handleFile} error={loadError} />
	{:else}
		<section class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
			<div class="flex flex-col gap-4">
				<div class="rounded-box bg-base-200 p-4" data-testid="preview-slot">Preview</div>
				<div class="rounded-box bg-base-200 p-4" data-testid="timeline-slot">Timeline</div>
			</div>
			<div class="flex flex-col gap-4">
				<div class="rounded-box bg-base-200 p-4" data-testid="panel-slot">Clip controls</div>
				<div class="rounded-box bg-base-200 p-4" data-testid="export-slot">Export</div>
			</div>
		</section>
	{/if}
</div>
