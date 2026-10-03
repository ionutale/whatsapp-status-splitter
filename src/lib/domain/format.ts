const pad = (n: number) => String(n).padStart(2, '0');

export function formatClock(seconds: number): string {
	const decis = Math.round(Math.abs(seconds) * 10);
	const d = decis % 10;
	const totalSeconds = Math.floor(decis / 10);
	const sec = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const min = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);
	const base = `${pad(min)}:${pad(sec)}.${d}`;
	return hours > 0 ? `${hours}:${base}` : base;
}

export function parseClock(input: string): number | null {
	const trimmed = input.trim();
	if (!/^\d+(:\d+){0,2}(\.\d+)?$/.test(trimmed)) return null;
	const parts = trimmed.split(':').map(Number);
	if (parts.some(Number.isNaN)) return null;
	const seconds = parts.reduce((acc, part) => acc * 60 + part, 0);
	return seconds;
}
