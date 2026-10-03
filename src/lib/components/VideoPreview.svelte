<script lang="ts">
	type Range = { start: number; end: number } | null;

	let {
		src,
		range = null,
		loop = $bindable(true),
		seekRequest = null,
		onTime,
		onSeekHandled
	}: {
		src: string;
		range?: Range;
		loop?: boolean;
		seekRequest?: { t: number } | null;
		onTime?: (time: number) => void;
		onSeekHandled?: () => void;
	} = $props();

	let video = $state<HTMLVideoElement | null>(null);
	let paused = $state(true);

	export function play() {
		const element = video;
		if (!element) return;
		if (
			range &&
			(element.currentTime < range.start - 0.05 || element.currentTime >= range.end - 0.05)
		) {
			element.currentTime = range.start;
		}
		void element.play().catch((error) => console.error('[preview] play failed', error));
	}

	export function pause() {
		video?.pause();
	}

	export function toggle() {
		if (paused) play();
		else pause();
	}

	$effect(() => {
		if (video && seekRequest) {
			video.currentTime = seekRequest.t;
			onSeekHandled?.();
		}
	});

	function handleTimeUpdate() {
		if (!video) return;
		const time = video.currentTime;
		onTime?.(time);
		if (range && time >= range.end - 0.02) {
			if (loop) video.currentTime = range.start;
			else video.pause();
		}
	}
</script>

<div class="flex flex-col gap-2">
	<video
		bind:this={video}
		{src}
		class="max-h-[45vh] w-full rounded-box bg-black"
		playsinline
		onplay={() => (paused = false)}
		onpause={() => (paused = true)}
		ontimeupdate={handleTimeUpdate}
		data-testid="video"
	></video>
	<div class="flex items-center gap-2">
		<button class="btn btn-sm" type="button" data-testid="btn-play" onclick={toggle}>
			{paused ? 'Play' : 'Pause'}
		</button>
		<button
			class="btn btn-sm"
			class:btn-active={loop}
			type="button"
			data-testid="btn-loop"
			onclick={() => (loop = !loop)}
		>
			Loop clip
		</button>
	</div>
</div>
