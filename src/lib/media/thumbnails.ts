import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';

export async function extractThumbnails(
	file: File,
	count: number,
	width: number,
	onThumb?: (thumb: { time: number; url: string }) => void
): Promise<{ time: number; url: string }[]> {
	const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
	const track = await input.getPrimaryVideoTrack();
	if (!track) return [];
	const duration = await input.computeDuration();
	const sink = new VideoSampleSink(track);
	const out: { time: number; url: string }[] = [];

	for (let i = 0; i < count; i++) {
		const time = Math.min(((i + 0.5) / count) * duration, Math.max(duration - 0.05, 0));
		const sample = await sink.getSample(time);
		if (!sample) continue;
		const scale = Math.min(1, width / sample.displayWidth);
		const canvas = new OffscreenCanvas(
			Math.max(2, Math.round(sample.displayWidth * scale)),
			Math.max(2, Math.round(sample.displayHeight * scale))
		);
		const context = canvas.getContext('2d');
		if (!context) continue;
		sample.draw(context, 0, 0, canvas.width, canvas.height);
		const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
		const thumb = { time, url: URL.createObjectURL(blob) };
		out.push(thumb);
		onThumb?.(thumb);
	}

	return out;
}
