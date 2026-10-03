<script lang="ts">
	import { browser } from '$app/env';
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';

	let { children } = $props();

	// Production only: the dev server has no service worker. `browser` keeps
	// registration out of any SSR pass.
	onMount(() => {
		if (import.meta.env.PROD && browser && 'serviceWorker' in navigator) {
			navigator.serviceWorker
				.register('/sw.js')
				.catch((err) => console.error('[sw] registration failed', err));
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
