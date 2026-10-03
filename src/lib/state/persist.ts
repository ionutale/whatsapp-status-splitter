import type { QualityPreset } from '../domain/bitrate';

/**
 * Local persistence for settings and per-file clip layouts. Plain TypeScript
 * (no runes): every read is try/caught and shape-validated, and any failure
 * logs the original value and returns null so corrupt storage can never break
 * app loading. `localStorage` is only touched lazily inside the load/save
 * functions, and tests can inject a fake storage via `setStorageForTests`.
 */

export const SETTINGS_STORAGE_KEY = 'wss.settings.v1';
export const SESSIONS_STORAGE_KEY = 'wss.sessions.v1';

/** Newest layouts are kept; the oldest `savedAt` entries are pruned on write. */
export const MAX_STORED_SESSIONS = 10;

export type PersistedSettings = {
	version: 1;
	preset: QualityPreset;
	crop916: boolean;
	maxClipDuration: number;
};

/** One file's stored clip layout: only the numbers that matter, plus a timestamp. */
export type PersistedSegment = { start: number; end: number };

export type PersistedLayout = {
	segments: PersistedSegment[];
	savedAt: number;
};

export type PersistedSessions = {
	version: 2;
	entries: Record<string, PersistedLayout>;
};

export type FileLike = { name: string; size: number; lastModified: number };

/** Identity of a file used to key its stored clip layout. */
export function fileKey(f: FileLike): string {
	return `${f.name}|${f.size}|${f.lastModified}`;
}

const PRESETS: readonly QualityPreset[] = ['whatsapp', 'high', 'small'];

let testStorage: Storage | null = null;

/** Inject a storage implementation for tests; pass null to restore the default. */
export function setStorageForTests(storage: Storage | null): void {
	testStorage = storage;
}

function resolveStorage(): Storage | null {
	if (testStorage) return testStorage;
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

function validateSettings(value: unknown): PersistedSettings | null {
	if (typeof value !== 'object' || value === null) return null;
	const candidate = value as Record<string, unknown>;
	if (candidate.version !== 1) return null;
	if (
		typeof candidate.preset !== 'string' ||
		!PRESETS.includes(candidate.preset as QualityPreset)
	) {
		return null;
	}
	if (typeof candidate.crop916 !== 'boolean') return null;
	if (!isFiniteNumber(candidate.maxClipDuration)) return null;
	return {
		version: 1,
		preset: candidate.preset as QualityPreset,
		crop916: candidate.crop916,
		// Keep the stored value inside the app's supported range.
		maxClipDuration: Math.min(300, Math.max(1, Math.round(candidate.maxClipDuration)))
	};
}

function validateLayout(value: unknown): PersistedLayout | null {
	if (typeof value !== 'object' || value === null) return null;
	const candidate = value as Record<string, unknown>;
	if (!isFiniteNumber(candidate.savedAt)) return null;
	if (!Array.isArray(candidate.segments)) return null;
	const segments: PersistedSegment[] = [];
	for (const item of candidate.segments) {
		if (typeof item !== 'object' || item === null) return null;
		const segment = item as Record<string, unknown>;
		if (!isFiniteNumber(segment.start) || !isFiniteNumber(segment.end)) return null;
		if (segment.start < 0 || segment.end <= segment.start) return null;
		segments.push({ start: segment.start, end: segment.end });
	}
	return { segments, savedAt: candidate.savedAt };
}

/**
 * Parse the stored map, dropping individual entries that no longer validate so
 * one bad layout can never hide the others. Returns null only when the whole
 * value is unreadable (so callers can distinguish "nothing stored" from
 * "something stored but corrupt").
 */
function parseSessions(value: unknown): PersistedSessions | null {
	if (typeof value !== 'object' || value === null) return null;
	const candidate = value as Record<string, unknown>;
	if (candidate.version !== 2) return null;
	if (typeof candidate.entries !== 'object' || candidate.entries === null) return null;
	const entries: Record<string, PersistedLayout> = {};
	for (const [key, raw] of Object.entries(candidate.entries)) {
		if (key.length === 0) continue;
		const layout = validateLayout(raw);
		if (!layout) {
			console.error('[persist] dropping session with an unexpected shape', key, raw);
			continue;
		}
		entries[key] = layout;
	}
	return { version: 2, entries };
}

/** Read and validate the whole map; an unreadable value becomes an empty map. */
function readSessions(storage: Storage): PersistedSessions {
	try {
		const raw = storage.getItem(SESSIONS_STORAGE_KEY);
		if (raw == null) return { version: 2, entries: {} };
		const parsed: unknown = JSON.parse(raw);
		const sessions = parseSessions(parsed);
		if (!sessions) {
			console.error('[persist] stored sessions have an unexpected shape', parsed);
			return { version: 2, entries: {} };
		}
		return sessions;
	} catch (error) {
		console.error('[persist] failed to read sessions', error);
		return { version: 2, entries: {} };
	}
}

export function loadSettings(): PersistedSettings | null {
	try {
		const storage = resolveStorage();
		if (!storage) return null;
		const raw = storage.getItem(SETTINGS_STORAGE_KEY);
		if (raw == null) return null;
		const parsed: unknown = JSON.parse(raw);
		const settings = validateSettings(parsed);
		if (!settings) {
			console.error('[persist] stored settings have an unexpected shape', parsed);
			return null;
		}
		return settings;
	} catch (error) {
		console.error('[persist] failed to load settings', error);
		return null;
	}
}

export function saveSettings(settings: PersistedSettings): void {
	try {
		const storage = resolveStorage();
		if (!storage) return;
		storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
	} catch (error) {
		console.error('[persist] failed to save settings', error);
	}
}

/** The stored layout for `key`, or null when absent/unreadable. */
export function loadSession(key: string): PersistedLayout | null {
	try {
		const storage = resolveStorage();
		if (!storage) return null;
		const raw = storage.getItem(SESSIONS_STORAGE_KEY);
		if (raw == null) return null;
		const parsed: unknown = JSON.parse(raw);
		const sessions = parseSessions(parsed);
		if (!sessions) {
			console.error('[persist] stored sessions have an unexpected shape', parsed);
			return null;
		}
		return sessions.entries[key] ?? null;
	} catch (error) {
		console.error('[persist] failed to load sessions', error);
		return null;
	}
}

/**
 * Store one file's layout, rewriting the whole (tiny) map and pruning the
 * oldest `savedAt` entries beyond the cap. `savedAt` is injectable so tests can
 * pin eviction order deterministically.
 */
export function saveSession(
	key: string,
	segments: PersistedSegment[],
	savedAt: number = Date.now()
): void {
	try {
		const storage = resolveStorage();
		if (!storage) return;
		const sessions = readSessions(storage);
		sessions.entries[key] = { segments, savedAt };
		const keys = Object.keys(sessions.entries);
		if (keys.length > MAX_STORED_SESSIONS) {
			keys
				.sort((a, b) => sessions.entries[a].savedAt - sessions.entries[b].savedAt)
				.slice(0, keys.length - MAX_STORED_SESSIONS)
				.forEach((oldest) => delete sessions.entries[oldest]);
		}
		storage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
	} catch (error) {
		console.error('[persist] failed to save session', error);
	}
}
