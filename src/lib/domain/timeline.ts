import type { Segment } from './segments';

const TICK_LADDER = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const EPS = 1e-3;

export function chooseTickStep(pxPerSecond: number, minPxBetweenTicks = 60): number {
	for (const step of TICK_LADDER) {
		if (step * pxPerSecond >= minPxBetweenTicks) return step;
	}
	return TICK_LADDER[TICK_LADDER.length - 1];
}

export function generateTicks(
	durationSec: number,
	pxPerSecond: number
): { time: number; major: boolean }[] {
	const step = chooseTickStep(pxPerSecond);
	const ticks: { time: number; major: boolean }[] = [];
	const count = Math.ceil(durationSec / step);
	for (let i = 0; i <= count; i++) {
		const time = Math.min(Math.round(i * step * 1000) / 1000, durationSec);
		ticks.push({ time, major: i % 5 === 0 });
		if (time >= durationSec - EPS) break;
	}
	return ticks;
}

export function assignLanes(segments: Segment[]): number[] {
	const lanes: { start: number; end: number }[][] = [];
	return segments.map((segment) => {
		for (let lane = 0; lane < lanes.length; lane++) {
			const collides = lanes[lane].some(
				(other) => segment.start < other.end - EPS && segment.end > other.start + EPS
			);
			if (!collides) {
				lanes[lane].push({ start: segment.start, end: segment.end });
				return lane;
			}
		}
		lanes.push([{ start: segment.start, end: segment.end }]);
		return lanes.length - 1;
	});
}
