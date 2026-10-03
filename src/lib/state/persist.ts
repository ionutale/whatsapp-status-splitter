import type { QualityPreset } from '../domain/bitrate';
import type { Segment } from '../domain/segments';

/**
 * Local persistence for settings and per-file clip layouts. Plain TypeScript
 * (no runes): every read is try/caught and shape-validated, and any failure
 * logs the original value and returns null so corrupt storage can never break
 * app loading. `localStorage` is only touched lazily inside the load/save
 * functions, and tests can inject a fake storage via `setStorageForTests`.
 */

export const SETTINGS_STORAGE_KEY = 'wss.settings.v1';
export const SESSION_STORAGE_KEY = 'wss.session.v1';

export type PersistedSettings = {
	version: 1;
	preset: QualityPreset;
	crop916: boolean;
	maxClipDuration: number;
};

export type PersistedSession = {
	version: 1;
	fileKey: string;
	segments: Segment[];
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

function validateSession(value: unknown): PersistedSession | null {
	if (typeof value !== 'object' || value === null) return null;
	const candidate = value as Record<string, unknown>;
	if (candidate.version !== 1) return null;
	if (typeof candidate.fileKey !== 'string' || candidate.fileKey.length === 0) return null;
	if (!Array.isArray(candidate.segments)) return null;
	const segments: Segment[] = [];
	for (const item of candidate.segments) {
		if (typeof item !== 'object' || item === null) return null;
		const segment = item as Record<string, unknown>;
		if (typeof segment.id !== 'string' || segment.id.length === 0) return null;
		if (!isFiniteNumber(segment.start) || !isFiniteNumber(segment.end)) return null;
		if (segment.start < 0 || segment.end <= segment.start) return null;
		segments.push({ id: segment.id, start: segment.start, end: segment.end });
	}
	return { version: 1, fileKey: candidate.fileKey, segments };
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

export function loadSession(): PersistedSession | null {
	try {
		const storage = resolveStorage();
		if (!storage) return null;
		const raw = storage.getItem(SESSION_STORAGE_KEY);
		if (raw == null) return null;
		const parsed: unknown = JSON.parse(raw);
		const session = validateSession(parsed);
		if (!session) {
			console.error('[persist] stored session has an unexpected shape', parsed);
			return null;
		}
		return session;
	} catch (error) {
		console.error('[persist] failed to load session', error);
		return null;
	}
}

export function saveSession(session: PersistedSession): void {
	try {
		const storage = resolveStorage();
		if (!storage) return;
		storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
	} catch (error) {
		console.error('[persist] failed to save session', error);
	}
}
