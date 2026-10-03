export type QualityPreset = 'whatsapp' | 'high' | 'small';

export type VideoMeta = {
	displayWidth: number;
	displayHeight: number;
	rotation: 0 | 90 | 180 | 270;
	frameRate: number | null;
	videoCodec: string | null;
	audioCodec: string | null;
	hasAudio: boolean;
	audioDecodable: boolean;
	videoDecodable: boolean;
};

export type OutputPlan = {
	width: number;
	height: number;
	fit: 'contain' | 'cover';
	frameRate: number;
	videoKbps: number;
	audioKbps: number;
	estimatedBytes: number;
};

export const PRESET_LIMITS: Record<
	QualityPreset,
	{
		resolutionCap: number;
		fpsCap: number;
		minKbps: number;
		maxKbps: number;
		audioKbps: number;
		targetBytes: number | null;
	}
> = {
	whatsapp: {
		resolutionCap: 720,
		fpsCap: 30,
		minKbps: 800,
		maxKbps: 6000,
		audioKbps: 128,
		targetBytes: 15 * 1024 * 1024
	},
	high: {
		resolutionCap: 1080,
		fpsCap: 60,
		minKbps: 8000,
		maxKbps: 8000,
		audioKbps: 192,
		targetBytes: null
	},
	small: {
		resolutionCap: 480,
		fpsCap: 30,
		minKbps: 400,
		maxKbps: 3000,
		audioKbps: 96,
		targetBytes: 15 * 1024 * 1024
	}
};

const clampNumber = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

export function estimateBitrate(
	durationSec: number,
	preset: QualityPreset,
	hasAudio: boolean
): { videoKbps: number; audioKbps: number; estimatedBytes: number } {
	const limits = PRESET_LIMITS[preset];
	const audioKbps = hasAudio ? limits.audioKbps : 0;
	let videoKbps = limits.minKbps;

	if (limits.targetBytes !== null && durationSec > 0) {
		const targetKbit = (limits.targetBytes * 8) / 1000;
		const wanted = (targetKbit * 0.92) / durationSec - audioKbps;
		videoKbps = Math.round(clampNumber(wanted, limits.minKbps, limits.maxKbps));
	}

	const estimatedBytes = Math.round((((videoKbps + audioKbps) * 1000) / 8) * durationSec);
	return { videoKbps, audioKbps, estimatedBytes };
}

export function computeOutputSize(
	width: number,
	height: number,
	resolutionCap: number
): { width: number; height: number } {
	const shortSide = Math.min(width, height);
	const scale = shortSide > resolutionCap ? resolutionCap / shortSide : 1;
	return { width: even(width * scale), height: even(height * scale) };
}

export function buildOutputPlan(
	durationSec: number,
	meta: VideoMeta,
	preset: QualityPreset,
	options: { crop916?: boolean } = {}
): OutputPlan {
	const limits = PRESET_LIMITS[preset];
	const crop916 = options.crop916 ?? false;
	// 9:16 targets the preset's resolution cap on the shorter (width) side. The
	// bitrate/size math below is unchanged: it keys off the cap, not the dims.
	const { width, height } = crop916
		? { width: even(limits.resolutionCap), height: even((limits.resolutionCap * 16) / 9) }
		: computeOutputSize(meta.displayWidth, meta.displayHeight, limits.resolutionCap);
	const { videoKbps, audioKbps, estimatedBytes } = estimateBitrate(
		durationSec,
		preset,
		meta.hasAudio && meta.audioDecodable
	);
	const sourceFps = meta.frameRate ?? limits.fpsCap;
	return {
		width,
		height,
		fit: crop916 ? 'cover' : 'contain',
		frameRate: Math.max(1, Math.min(limits.fpsCap, Math.round(sourceFps))),
		videoKbps,
		audioKbps,
		estimatedBytes
	};
}
