<script lang="ts">
	import { flushSync } from 'svelte';
	import { formatClock, parseClock } from '../domain/format';

	let {
		label,
		seconds,
		onCommit,
		testid
	}: {
		label: string;
		seconds: number;
		onCommit: (value: number) => void;
		testid?: string;
	} = $props();

	let text = $state('');
	let invalid = $state(false);

	$effect(() => {
		text = formatClock(seconds);
		invalid = false;
	});

	function commit() {
		const value = parseClock(text);
		invalid = value === null;
		// Svelte 5 applies DOM updates asynchronously; flush so the error style is
		// observable immediately after a commit (and before onCommit).
		flushSync();
		if (value !== null) onCommit(value);
	}
</script>

<label class="flex flex-col gap-1 text-xs">
	{label}
	<input
		class="input w-24 input-xs"
		class:input-error={invalid}
		data-testid={testid}
		bind:value={text}
		onblur={commit}
		onkeydown={(event) => {
			if (event.key === 'Enter') commit();
		}}
	/>
</label>
