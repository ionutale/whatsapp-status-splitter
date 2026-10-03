<script lang="ts">
	let { thumbs, pxPerSecond }: { thumbs: { time: number; url: string }[]; pxPerSecond: number } =
		$props();
</script>

<div class="absolute top-7 left-0 h-12 opacity-60" data-testid="filmstrip">
	{#each thumbs as thumb (thumb.url)}
		<img
			src={thumb.url}
			alt=""
			class="absolute top-0 h-12 w-16 rounded-sm object-cover"
			style="left:{thumb.time * pxPerSecond}px"
		/>
	{/each}
</div>
