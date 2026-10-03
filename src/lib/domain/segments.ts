export type Segment = { id: string; start: number; end: number };
export type Interval = { start: number; end: number };

export const MIN_CLIP_DURATION = 0.5;
const EPS = 1e-3;

const roundMs = (value: number) => Math.round(value * 1000) / 1000;
const clampNumber = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

export type ClampOpts = {
	duration: number;
	maxClipDuration: number;
	minClipDuration?: number;
};

export const newSegmentId = (): string => crypto.randomUUID();

export function sortSegments(segments: Segment[]): Segment[] {
	return [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
}

export function autoSplit(duration: number, maxClipDuration: number): Segment[] {
	if (duration <= 0) return [];
	const max = Math.max(1, maxClipDuration);
	const out: Segment[] = [];
	let cursor = 0;
	while (cursor < duration - EPS) {
		const end = Math.min(cursor + max, duration);
		out.push({ id: newSegmentId(), start: roundMs(cursor), end: roundMs(end) });
		cursor = end;
	}
	return out;
}

export function clampSegment(
	segment: Segment,
	opts: ClampOpts,
	moved: 'start' | 'end' = 'end'
): Segment {
	const duration = Math.max(0, opts.duration);
	const min = Math.min(opts.minClipDuration ?? MIN_CLIP_DURATION, duration);
	const max = Math.min(Math.max(opts.maxClipDuration, min), duration);

	let start = clampNumber(segment.start, 0, duration);
	let end = clampNumber(segment.end, 0, duration);

	if (moved === 'start') {
		start = clampNumber(start, end - max, end - min);
	} else {
		end = clampNumber(end, start + min, start + max);
	}

	// Final safety pass for inconsistent inputs (e.g. both edges out of order).
	if (end - start < min - EPS) {
		if (moved === 'start') start = end - min;
		else end = start + min;
	}
	start = clampNumber(start, 0, duration);
	end = clampNumber(end, start, duration);

	return { ...segment, start: roundMs(start), end: roundMs(end) };
}

export function nudge(
	segment: Segment,
	edge: 'start' | 'end',
	delta: number,
	opts: ClampOpts
): Segment {
	const moved = { ...segment, [edge]: segment[edge] + delta };
	return clampSegment(moved, opts, edge);
}

export function setField(
	segment: Segment,
	field: 'start' | 'end' | 'duration',
	value: number,
	opts: ClampOpts
): Segment {
	if (field === 'start') return clampSegment({ ...segment, start: value }, opts, 'start');
	if (field === 'end') return clampSegment({ ...segment, end: value }, opts, 'end');
	return clampSegment({ ...segment, end: segment.start + value }, opts, 'end');
}

export function splitInHalf(segment: Segment, opts: ClampOpts): [Segment, Segment] | null {
	const min = opts.minClipDuration ?? MIN_CLIP_DURATION;
	if (segment.end - segment.start < 2 * min - EPS) return null;
	const mid = roundMs((segment.start + segment.end) / 2);
	return [
		{ id: newSegmentId(), start: segment.start, end: mid },
		{ id: newSegmentId(), start: mid, end: segment.end }
	];
}

export function computeCoverage(
	segments: Segment[],
	duration: number
): { gaps: Interval[]; overlaps: Interval[] } {
	const sorted = sortSegments(segments).map((s) => ({
		start: clampNumber(s.start, 0, duration),
		end: clampNumber(s.end, 0, duration)
	}));
	const gaps: Interval[] = [];
	const overlaps: Interval[] = [];
	let cursor = 0;
	for (const current of sorted) {
		if (current.start > cursor + EPS) gaps.push({ start: cursor, end: current.start });
		if (current.start < cursor - EPS) {
			overlaps.push({ start: current.start, end: Math.min(cursor, current.end) });
		}
		cursor = Math.max(cursor, current.end);
	}
	if (cursor < duration - EPS) gaps.push({ start: cursor, end: duration });
	return { gaps, overlaps };
}
