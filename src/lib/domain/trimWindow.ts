/**
 * Window of video shown around the selected clip in the touch trimmer.
 *
 * The bar shows the clip plus a pad on each side so a previously trimmed clip
 * can always be dragged back open. The pad is `max(3s, half the clip)` per
 * side, and the window is clamped to the video bounds.
 */
export function computeTrimWindow(
	start: number,
	end: number,
	videoDuration: number
): { windowStart: number; windowEnd: number } {
	const clip = Math.max(0, end - start);
	const pad = Math.max(3, clip * 0.5);

	// Pad the clip on each side, then clamp the window to the video bounds.
	let windowStart = start - pad;
	let windowEnd = end + pad;
	windowStart = Math.max(0, windowStart);
	windowEnd = Math.min(videoDuration, windowEnd);

	// Degenerate inputs (or heavy clamping) must still leave a draggable span:
	// at least the clip duration, or 0.5s when the clip itself is tiny.
	const floor = Math.max(clip, 0.5);
	if (windowEnd - windowStart < floor) {
		windowStart = Math.max(0, windowEnd - floor);
		windowEnd = Math.min(videoDuration, windowStart + floor);
	}

	return { windowStart, windowEnd };
}
