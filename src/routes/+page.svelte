<script lang="ts">
	import DropZone from '../lib/components/DropZone.svelte';
	import ExportPanel from '../lib/components/ExportPanel.svelte';
	import SegmentPanel from '../lib/components/SegmentPanel.svelte';
	import Timeline from '../lib/components/Timeline.svelte';
	import VideoPreview from '../lib/components/VideoPreview.svelte';
	import { formatClock } from '../lib/domain/format';
	import { assertDecodable, inspectFile, type InspectResult } from '../lib/media/inspect';
	import { extractThumbnails } from '../lib/media/thumbnails';
	import { exportState } from '../lib/state/export.svelte';
	import { project } from '../lib/state/project.svelte';
	import { onDestroy } from 'svelte';

	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let objectUrl = $state<string | null>(null);
	let loadToken = 0;
	let currentTime = $state(0);
	let seekRequest = $state<{ t: number } | null>(null);
	let preview = $state<VideoPreview | null>(null);
	let compatFile = $state<File | null>(null);
	let converting = $state(false);
	let compatProgress = $state(0);
	let compatError = $state<string | null>(null);
	let compatController: AbortController | null = null;

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

		// A newly loaded file invalidates any in-flight compatibility conversion:
		// abort it and clear its state so a late result can never replace the new
		// video.
		compatController?.abort();
		compatController = null;
		compatFile = null;
		converting = false;
		compatProgress = 0;
		compatError = null;

		const token = ++loadToken;
		loadError = null;
		project.begin(file);
		// A new file invalidates any in-flight export: reset() cancels the current
		// conversion and drops its state so the old run can't finish and fire a
		// stray download/ZIP. Calling cancel() first would cancel twice.
		exportState.reset();
		currentTime = 0;
		seekRequest = null;
		loading = true;

		// Only the inspect/decode check may produce a compatibility offer. URL
		// creation and project.ready() run outside this try so a programming error
		// there surfaces as a plain load error, never as "compatibility mode".
		let inspected: InspectResult | null = null;
		try {
			inspected = await inspectFile(file);
		} catch (error) {
			if (token !== loadToken) return;
			console.error('[load] failed to read video', error);
			loadError = error instanceof Error ? error.message : String(error);
			// Duck-type the InspectionError name so this keeps working when the
			// inspect module is mocked in tests without re-exporting the class.
			if (error instanceof Error && error.name === 'InspectionError') {
				compatFile = file;
			}
		} finally {
			if (token === loadToken) loading = false;
		}
		if (!inspected || token !== loadToken) return;

		const blocked = assertDecodable(inspected.meta);
		if (blocked) {
			// The container parsed but the codec can't be decoded (the real
			// Windows-Chrome/HEVC case): offer the same on-device conversion
			// instead of telling the user to convert the file by hand.
			loadError = blocked;
			compatFile = file;
			return;
		}

		try {
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			objectUrl = URL.createObjectURL(file);
			project.ready(inspected.duration, inspected.meta);
		} catch (error) {
			if (token !== loadToken) return;
			console.error('[load] failed to prepare video', error);
			loadError = error instanceof Error ? error.message : String(error);
		}
	}

	async function startCompat() {
		if (!compatFile || converting) return;
		const file = compatFile;
		const controller = new AbortController();
		compatController = controller;
		converting = true;
		compatProgress = 0;
		compatError = null;
		// Capture the current load generation: if a new file loads while this
		// conversion runs, the result is stale and must be dropped.
		const token = loadToken;
		try {
			const { convertToCompatibleMp4 } = await import('../lib/media/ffmpeg');
			const converted = await convertToCompatibleMp4(file, {
				onProgress: (ratio) => {
					compatProgress = ratio;
				},
				signal: controller.signal
			});
			if (token !== loadToken) return;
			compatFile = null;
			converting = false;
			compatController = null;
			await handleFile(converted);
		} catch (error) {
			if (token !== loadToken) return;
			converting = false;
			compatController = null;
			if (error instanceof DOMException && error.name === 'AbortError') {
				compatProgress = 0;
				compatError = null;
			} else {
				compatError = error instanceof Error ? error.message : String(error);
			}
		}
	}

	function cancelCompat() {
		compatController?.abort();
	}

	// Flush debounced persistence synchronously when the page is being hidden or
	// unloaded, so closing a tab within the debounce window can't drop the last
	// edit. (`ssr = false`, so `window`/`document` always exist here.)
	function flushPendingWrites() {
		project.flushPendingWrites();
	}

	function handleVisibilityChange() {
		if (document.visibilityState === 'hidden') flushPendingWrites();
	}

	window.addEventListener('pagehide', flushPendingWrites);
	document.addEventListener('visibilitychange', handleVisibilityChange);

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

	// Revoke the live file URL when the page is destroyed. Deliberately not an
	// $effect cleanup: that would run on every objectUrl change and revoke the
	// URL still in use.
	onDestroy(() => {
		window.removeEventListener('pagehide', flushPendingWrites);
		document.removeEventListener('visibilitychange', handleVisibilityChange);
		if (objectUrl) URL.revokeObjectURL(objectUrl);
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
		{#if compatFile}
			<div class="alert alert-warning" role="alert" data-testid="compat-notice">
				<p>This video's format can't be read by this browser, so it can't be split yet.</p>
				{#if compatError}
					<p class="text-error" role="alert" data-testid="compat-error">{compatError}</p>
				{/if}
				{#if converting}
					<p data-testid="compat-progress">
						Converting to a compatible format… {Math.round(compatProgress * 100)}%
					</p>
					<button
						type="button"
						class="btn btn-sm"
						data-testid="compat-cancel"
						onclick={cancelCompat}
					>
						Cancel
					</button>
				{:else}
					<button
						type="button"
						class="btn btn-sm"
						data-testid="compat-convert"
						onclick={startCompat}
					>
						Try compatibility mode (slower)
					</button>
				{/if}
			</div>
		{/if}
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
