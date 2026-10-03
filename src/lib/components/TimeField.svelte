<script lang="ts">
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
		if (text === formatClock(seconds)) return;
		const value = parseClock(text);
		if (value === null) {
			invalid = true;
			return;
		}
		invalid = false;
		onCommit(value);
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
