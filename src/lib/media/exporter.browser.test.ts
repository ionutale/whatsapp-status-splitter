import { describe, expect, it } from 'vitest';
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import tiny5sUrl from '../../../static/test-fixtures/tiny-5s.mp4?url';
import noAudioUrl from '../../../static/test-fixtures/tiny-noaudio.mp4?url';
import rotatedUrl from '../../../static/test-fixtures/tiny-portrait-rotated.mp4?url';
import { buildOutputPlan } from '../domain/bitrate';
import { inspectFile } from './inspect';
import { realEncodeClip } from './exporter';

async function loadFixture(url: string, name: string): Promise<File> {
	const blob = await (await fetch(url)).blob();
	return new File([blob], name, { type: 'video/mp4' });
}

function isFtyp(blob: Blob) {
	return blob
		.slice(4, 8)
		.text()
		.then((text) => text === 'ftyp');
}

describe('realEncodeClip', () => {
	it('exports a valid MP4 whose duration matches the requested range (mid-GOP start)', async () => {
		const file = await loadFixture(tiny5sUrl, 'tiny-5s.mp4');
		const { meta } = await inspectFile(file);
		const plan = buildOutputPlan(1.5, meta, 'whatsapp');
		const progress: number[] = [];
		const handle = realEncodeClip({
			file,
			segment: { id: 'a', start: 1, end: 2.5 },
			plan,
			onProgress: (p) => progress.push(p)
		});
		const blob = await handle.result;
		expect(await isFtyp(blob)).toBe(true);

		const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
		try {
			const duration = await input.computeDuration();
			expect(Math.abs(duration - 1.5)).toBeLessThanOrEqual(0.35);
			expect(progress.length).toBeGreaterThan(0);
			expect(progress.at(-1)).toBeLessThanOrEqual(1);
		} finally {
			input.dispose();
		}
	});

	it('starts with real picture, not black frames', async () => {
		const file = await loadFixture(tiny5sUrl, 'tiny-5s.mp4');
		const { meta } = await inspectFile(file);
		const plan = buildOutputPlan(0.5, meta, 'whatsapp');
		const handle = realEncodeClip({
			file,
			segment: { id: 'a', start: 2, end: 2.5 },
			plan,
			onProgress: () => {}
		});
		const blob = await handle.result;
		const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
		try {
			const videoTrack = await input.getPrimaryVideoTrack();
			const sink = new VideoSampleSink(videoTrack!);
			const sample = await sink.getSample(0.05);
			expect(sample).not.toBeNull();
			try {
				const canvas = new OffscreenCanvas(32, 24);
				const ctx = canvas.getContext('2d')!;
				sample!.draw(ctx, 0, 0, 32, 24);
				const pixels = ctx.getImageData(0, 0, 32, 24).data;
				let lit = 0;
				for (let i = 0; i < pixels.length; i += 4) {
					if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) lit++;
				}
				expect(lit).toBeGreaterThan(10);
			} finally {
				sample!.close();
			}
		} finally {
			input.dispose();
		}
	});

	it('bakes rotation so the exported clip displays portrait', async () => {
		const file = await loadFixture(rotatedUrl, 'rotated.mp4');
		const { meta } = await inspectFile(file);
		const plan = buildOutputPlan(1, meta, 'whatsapp');
		const handle = realEncodeClip({
			file,
			segment: { id: 'a', start: 0, end: 1 },
			plan,
			onProgress: () => {}
		});
		const blob = await handle.result;
		const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
		try {
			const videoTrack = await input.getPrimaryVideoTrack();
			const width = await videoTrack!.getDisplayWidth();
			const height = await videoTrack!.getDisplayHeight();
			expect(height).toBeGreaterThan(width);
			// Rotation must be baked into the pixels, not left as display metadata.
			expect(await videoTrack!.getRotation()).toBe(0);
		} finally {
			input.dispose();
		}
	});

	it('center-crops the encoded output to 720x1280 when the plan requests 9:16', async () => {
		const file = await loadFixture(tiny5sUrl, 'tiny-5s.mp4');
		const { meta } = await inspectFile(file);
		const plan = buildOutputPlan(1, meta, 'whatsapp', { crop916: true });
		expect(plan.fit).toBe('cover');
		const handle = realEncodeClip({
			file,
			segment: { id: 'a', start: 0, end: 1 },
			plan,
			onProgress: () => {}
		});
		const blob = await handle.result;
		const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
		try {
			const videoTrack = await input.getPrimaryVideoTrack();
			const width = await videoTrack!.getDisplayWidth();
			const height = await videoTrack!.getDisplayHeight();
			expect(width).toBe(720);
			expect(height).toBe(1280);
		} finally {
			input.dispose();
		}
	});

	it('encodes when the plan carries a fractional video bitrate', async () => {
		const file = await loadFixture(tiny5sUrl, 'tiny-5s.mp4');
		const plan = {
			width: 1280,
			height: 720,
			fit: 'contain' as const,
			frameRate: 30,
			videoKbps: 1801.37984,
			audioKbps: 128,
			estimatedBytes: 0
		};
		const handle = realEncodeClip({
			file,
			segment: { id: 'a', start: 0, end: 1 },
			plan,
			onProgress: () => {}
		});
		const blob = await handle.result;
		expect(await isFtyp(blob)).toBe(true);

		const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
		try {
			const duration = await input.computeDuration();
			expect(Math.abs(duration - 1)).toBeLessThanOrEqual(0.35);
		} finally {
			input.dispose();
		}
	});

	it('discards audio when the plan targets no audio', async () => {
		const file = await loadFixture(noAudioUrl, 'tiny-noaudio.mp4');
		const { meta } = await inspectFile(file);
		const plan = buildOutputPlan(1, meta, 'whatsapp');
		expect(plan.audioKbps).toBe(0);
		const handle = realEncodeClip({
			file,
			segment: { id: 'a', start: 0, end: 1 },
			plan,
			onProgress: () => {}
		});
		const blob = await handle.result;
		const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
		try {
			expect(await input.getPrimaryAudioTrack()).toBeNull();
		} finally {
			input.dispose();
		}
	});
});
