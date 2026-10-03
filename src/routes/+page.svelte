<script lang="ts">
	import DropZone from '../lib/components/DropZone.svelte';
	import ExportPanel from '../lib/components/ExportPanel.svelte';
	import SegmentPanel from '../lib/components/SegmentPanel.svelte';
	import Timeline from '../lib/components/Timeline.svelte';
	import VideoPreview from '../lib/components/VideoPreview.svelte';
	import { formatClock } from '../lib/domain/format';
	import { assertDecodable, inspectFile } from '../lib/media/inspect';
	import { extractThumbnails } from '../lib/media/thumbnails';
	import { project } from '../lib/state/project.svelte';

	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let objectUrl = $state<string | null>(null);
	let loadToken = 0;
	let currentTime = $state(0);
	let seekRequest = $state<{ t: number } | null>(null);
	let preview = $state<VideoPreview | null>(null);

	function handleKeydown(event: KeyboardEvent) {
		if (event.repeat) return;
		const target = event.target;
		if (
			target instanceof Element &&
			target.closest(
				'button, a, summary, [role="button"], [contenteditable], input, select, textarea'
			)
		) {
			return;
		}
		if (event.key === ' ') {
			event.preventDefault();
			preview?.toggle();
		}
	}

	async function handleFile(file: File) {
		if (project.dirty && !confirm('Discard the current editing state and load a new video?'))
			return;
		const token = ++loadToken;
		loadError = null;
		project.begin(file);
		currentTime = 0;
		seekRequest = null;
		loading = true;
		try {
			const { duration, meta } = await inspectFile(file);
			if (token !== loadToken) return;
			const blocked = assertDecodable(meta);
			if (blocked) {
				loadError = blocked;
				return;
			}
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			objectUrl = URL.createObjectURL(file);
			project.ready(duration, meta);
		} catch (error) {
			if (token !== loadToken) return;
			console.error('[load] failed to load video', error);
			loadError = error instanceof Error ? error.message : String(error);
		} finally {
			if (token === loadToken) loading = false;
		}
	}

	function selectClip(id: string) {
		project.select(id);
		const segment = project.segments.find((item) => item.id === id);
		if (!segment) return;
		currentTime = segment.start;
		seekRequest = { t: segment.start };
	}

	$effect(() => {
		const file = project.file;
		const meta = project.meta;
		if (!file || !meta) return;
		let cancelled = false;
		extractThumbnails(file, 30, 160, (thumb) => {
			if (cancelled || project.file !== file) {
				URL.revokeObjectURL(thumb.url);
			} else {
				project.addThumb(thumb);
			}
		}).catch((error) => {
			if (!cancelled) console.error('[thumbs] extraction failed', error);
		});
		return () => {
			cancelled = true;
		};
	});
</script>

<svelte:window
	onkeydown={handleKeydown}
	ondragover={(event) => event.preventDefault()}
	ondrop={(event) => {
		event.preventDefault();
		const file = event.dataTransfer?.files?.[0];
		if (file) handleFile(file);
	}}
/>

<div class="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4">
	<header class="flex items-center justify-between">
		<h1 class="text-xl font-bold">WhatsApp Status Splitter</h1>
		{#if project.meta}
			<div class="flex items-center gap-3">
				<span class="text-sm text-base-content/70" data-testid="file-name"
					>{project.file?.name}</span
				>
				<span class="font-mono text-sm text-base-content/70 tabular-nums" data-testid="preview-time"
					>{formatClock(currentTime)}</span
				>
			</div>
		{/if}
	</header>

	{#if project.error}
		<div class="alert alert-error" role="alert" data-testid="error-banner">{project.error}</div>
	{/if}
	{#if project.notice}
		<div class="alert alert-warning" role="alert" data-testid="notice-banner">{project.notice}</div>
	{/if}

	{#if !project.meta}
		{#if loading}<span class="loading loading-spinner"></span>{/if}
		<DropZone onFile={handleFile} error={loadError} />
	{:else}
		<section class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
			<div class="flex flex-col gap-4">
				<VideoPreview
					bind:this={preview}
					src={objectUrl!}
					range={project.selected
						? { start: project.selected.start, end: project.selected.end }
						: null}
					bind:loop={project.loopPreview}
					{seekRequest}
					onSeekHandled={() => (seekRequest = null)}
					onTime={(time) => (currentTime = time)}
				/>
				<Timeline
					duration={project.duration}
					segments={project.sortedSegments}
					selectedId={project.selectedId}
					{currentTime}
					bind:zoom={project.zoom}
					thumbs={project.thumbs}
					coverage={project.coverage}
					onSeek={(time) => {
						currentTime = time;
						seekRequest = { t: time };
					}}
					onSelect={selectClip}
					onSegmentChange={(id, next, moved) => project.updateSegment(id, next, moved)}
				/>
			</div>
			<div class="flex flex-col gap-4">
				<SegmentPanel />
				<ExportPanel />
			</div>
		</section>
	{/if}
</div>
