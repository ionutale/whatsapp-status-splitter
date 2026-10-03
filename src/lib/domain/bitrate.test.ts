import { describe, expect, it } from 'vitest';
import { buildOutputPlan, computeOutputSize, estimateBitrate, type VideoMeta } from './bitrate';

const meta = (overrides: Partial<VideoMeta> = {}): VideoMeta => ({
	displayWidth: 1920,
	displayHeight: 1080,
	rotation: 0,
	frameRate: 30,
	videoCodec: 'avc1.42001f',
	audioCodec: 'mp4a.40.2',
	hasAudio: true,
	audioDecodable: true,
	videoDecodable: true,
	...overrides
});

describe('estimateBitrate', () => {
	it('targets just under 16MB for a 30s whatsapp clip', () => {
		const { videoKbps, audioKbps, estimatedBytes } = estimateBitrate(30, 'whatsapp', true);
		expect(videoKbps).toBeGreaterThan(3000);
		expect(videoKbps).toBeLessThan(4000);
		expect(audioKbps).toBe(128);
		expect(estimatedBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
	});
	it('uses the fixed bitrate for the high preset', () => {
		expect(estimateBitrate(30, 'high', true).videoKbps).toBe(8000);
		expect(estimateBitrate(30, 'high', true).audioKbps).toBe(192);
	});
	it('drops audio budget when there is no audio', () => {
		const { audioKbps } = estimateBitrate(30, 'whatsapp', false);
		expect(audioKbps).toBe(0);
	});
	it('respects the floor and does not hide the size consequence', () => {
		const { videoKbps } = estimateBitrate(500, 'whatsapp', true);
		expect(videoKbps).toBe(800);
	});
	it('always produces integer video kbps inside the fractional window', () => {
		for (const durationSec of [19, 60, 100, 124]) {
			const { videoKbps } = estimateBitrate(durationSec, 'whatsapp', true);
			expect(Number.isInteger(videoKbps)).toBe(true);
			expect(videoKbps).toBeGreaterThanOrEqual(800);
			expect(videoKbps).toBeLessThanOrEqual(6000);
		}
	});
	it('rounds the target rate to the nearest integer (60s whatsapp with audio)', () => {
		const { videoKbps, estimatedBytes } = estimateBitrate(60, 'whatsapp', true);
		expect(videoKbps).toBe(1801);
		expect(estimatedBytes).toBe(Math.round((((1801 + 128) * 1000) / 8) * 60));
	});
});

describe('computeOutputSize', () => {
	it('downscales landscape 1080p to 720p', () => {
		expect(computeOutputSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
	});
	it('downscales portrait 1080x1920 to portrait 720p', () => {
		expect(computeOutputSize(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
	});
	it('downscales 4K to 720p', () => {
		expect(computeOutputSize(3840, 2160, 720)).toEqual({ width: 1280, height: 720 });
	});
	it('keeps smaller videos at their size', () => {
		expect(computeOutputSize(640, 480, 720)).toEqual({ width: 640, height: 480 });
	});
	it('rounds odd dimensions to even', () => {
		expect(computeOutputSize(321, 241, 720)).toEqual({ width: 322, height: 242 });
	});
});

describe('buildOutputPlan', () => {
	it('caps fps at the preset limit', () => {
		expect(buildOutputPlan(10, meta({ frameRate: 120 }), 'whatsapp').frameRate).toBe(30);
		expect(buildOutputPlan(10, meta({ frameRate: 24 }), 'high').frameRate).toBe(24);
	});
	it('falls back to the preset fps when unknown', () => {
		expect(buildOutputPlan(10, meta({ frameRate: null }), 'whatsapp').frameRate).toBe(30);
	});
	it('drops audio when the track is undecodable', () => {
		const plan = buildOutputPlan(30, meta({ audioDecodable: false }), 'whatsapp');
		expect(plan.audioKbps).toBe(0);
	});
	it('defaults to contain and the original dimensions', () => {
		const plan = buildOutputPlan(10, meta(), 'whatsapp');
		expect(plan).toMatchObject({ width: 1280, height: 720, fit: 'contain' });
	});
	it('crops whatsapp to 720x1280 cover', () => {
		const plan = buildOutputPlan(10, meta(), 'whatsapp', { crop916: true });
		expect(plan).toMatchObject({ width: 720, height: 1280, fit: 'cover' });
	});
	it('crops high to 1080x1920 cover', () => {
		const plan = buildOutputPlan(10, meta(), 'high', { crop916: true });
		expect(plan).toMatchObject({ width: 1080, height: 1920, fit: 'cover' });
	});
	it('crops small to 480x854 cover', () => {
		const plan = buildOutputPlan(10, meta(), 'small', { crop916: true });
		expect(plan).toMatchObject({ width: 480, height: 854, fit: 'cover' });
	});
});
