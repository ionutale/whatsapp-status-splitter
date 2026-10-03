<script lang="ts">
	let {
		onFile,
		onFiles = null,
		multiple = false,
		error = null
	}: {
		onFile: (file: File) => void;
		onFiles?: ((files: File[]) => void) | null;
		multiple?: boolean;
		error?: string | null;
	} = $props();
	let dragging = $state(false);

	function pick(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		if (files.length > 1 && onFiles) onFiles(files);
		else if (files.length > 0) onFile(files[0]);
		input.value = '';
	}

	function drop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
	}
</script>

<label
	class="dropzone flex min-h-[60vh] cursor-pointer flex-col items-center justify-center gap-4 rounded-box border-2 border-dashed border-base-300 bg-base-100 p-8 text-center has-[:focus-visible]:border-primary"
	class:border-primary={dragging}
	ondragover={(event) => {
		event.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={drop}
	data-testid="dropzone"
>
	<input
		data-testid="file-input"
		class="sr-only"
		type="file"
		accept="video/*"
		{multiple}
		onchange={pick}
	/>
	<h2 class="text-2xl font-semibold">Drop a video here</h2>
	<p class="text-base-content/70">
		Or click to choose a file. You can also drag a video straight out of the Photos app.
	</p>
	{#if error}
		<p class="text-error" role="alert" data-testid="dropzone-error">{error}</p>
	{/if}
</label>
