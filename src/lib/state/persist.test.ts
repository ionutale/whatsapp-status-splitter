import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	fileKey,
	loadSession,
	loadSettings,
	saveSession,
	saveSettings,
	setStorageForTests,
	SESSION_STORAGE_KEY,
	SETTINGS_STORAGE_KEY,
	type PersistedSession,
	type PersistedSettings
} from './persist';

const makeStorage = (): Storage => {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (key: string) => map.get(key) ?? null,
		key: (index: number) => [...map.keys()][index] ?? null,
		removeItem: (key: string) => {
			map.delete(key);
		},
		setItem: (key: string, value: string) => {
			map.set(key, String(value));
		}
	} as Storage;
};

const settings: PersistedSettings = {
	version: 1,
	preset: 'high',
	crop916: true,
	maxClipDuration: 15
};

const session: PersistedSession = {
	version: 1,
	fileKey: 'video.mp4|1024|1700000000000',
	segments: [
		{ id: 'a', start: 0, end: 15 },
		{ id: 'b', start: 15, end: 30 }
	]
};

describe('fileKey', () => {
	it('combines name, size and lastModified', () => {
		expect(fileKey({ name: 'video.mp4', size: 1024, lastModified: 1700000000000 })).toBe(
			'video.mp4|1024|1700000000000'
		);
	});

	it('distinguishes files that differ in any component', () => {
		const base = { name: 'video.mp4', size: 1024, lastModified: 1700000000000 };
		expect(fileKey(base)).not.toBe(fileKey({ ...base, name: 'other.mp4' }));
		expect(fileKey(base)).not.toBe(fileKey({ ...base, size: 2048 }));
		expect(fileKey(base)).not.toBe(fileKey({ ...base, lastModified: 1700000000001 }));
	});
});

describe('settings persistence', () => {
	let storage: Storage;

	beforeEach(() => {
		storage = makeStorage();
		setStorageForTests(storage);
	});

	afterEach(() => {
		setStorageForTests(null);
		vi.restoreAllMocks();
	});

	it('round-trips settings through storage', () => {
		saveSettings(settings);
		expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe(JSON.stringify(settings));
		expect(loadSettings()).toEqual(settings);
	});

	it('returns null when nothing is stored', () => {
		expect(loadSettings()).toBeNull();
	});

	it('returns null and logs on corrupt JSON', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.setItem(SETTINGS_STORAGE_KEY, '{not json');
		expect(loadSettings()).toBeNull();
		expect(error).toHaveBeenCalled();
	});

	it('returns null and logs on a wrong shape', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ preset: 'high' }));
		expect(loadSettings()).toBeNull();
		expect(error).toHaveBeenCalled();
	});

	it('returns null and logs on a different settings version', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...settings, version: 2 }));
		expect(loadSettings()).toBeNull();
		expect(error).toHaveBeenCalled();
	});

	it('returns null and logs on invalid field types', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...settings, maxClipDuration: 'soon' }));
		expect(loadSettings()).toBeNull();
		expect(error).toHaveBeenCalled();
	});

	it('clamps an out-of-range max clip duration into the supported range', () => {
		saveSettings({ ...settings, maxClipDuration: 99999 });
		expect(loadSettings()?.maxClipDuration).toBe(300);
	});

	it('never throws when the storage backend fails', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const broken = {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			}
		} as unknown as Storage;
		setStorageForTests(broken);
		expect(loadSettings()).toBeNull();
		expect(() => saveSettings(settings)).not.toThrow();
		expect(error).toHaveBeenCalled();
	});
});

describe('session persistence', () => {
	let storage: Storage;

	beforeEach(() => {
		storage = makeStorage();
		setStorageForTests(storage);
	});

	afterEach(() => {
		setStorageForTests(null);
		vi.restoreAllMocks();
	});

	it('round-trips a session through storage', () => {
		saveSession(session);
		expect(storage.getItem(SESSION_STORAGE_KEY)).toBe(JSON.stringify(session));
		expect(loadSession()).toEqual(session);
	});

	it('returns null when nothing is stored', () => {
		expect(loadSession()).toBeNull();
	});

	it('returns null and logs on corrupt JSON', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.setItem(SESSION_STORAGE_KEY, ']]]');
		expect(loadSession()).toBeNull();
		expect(error).toHaveBeenCalled();
	});

	it('returns null and logs on a wrong shape', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.setItem(
			SESSION_STORAGE_KEY,
			JSON.stringify({ version: 1, fileKey: 'k', segments: [{ start: 0, end: 5 }] })
		);
		expect(loadSession()).toBeNull();
		expect(error).toHaveBeenCalled();
	});

	it('returns null and logs on a different session version', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ ...session, version: 42 }));
		expect(loadSession()).toBeNull();
		expect(error).toHaveBeenCalled();
	});

	it('returns null and logs when a segment is structurally invalid', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.setItem(
			SESSION_STORAGE_KEY,
			JSON.stringify({
				version: 1,
				fileKey: 'k',
				segments: [{ id: 'a', start: 10, end: 5 }]
			})
		);
		expect(loadSession()).toBeNull();
		expect(error).toHaveBeenCalled();
	});
});
