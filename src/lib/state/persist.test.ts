import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	fileKey,
	loadSession,
	loadSettings,
	saveSession,
	saveSettings,
	setStorageForTests,
	MAX_STORED_SESSIONS,
	SESSIONS_STORAGE_KEY,
	SETTINGS_STORAGE_KEY,
	type PersistedSegment,
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

const layoutSegments: PersistedSegment[] = [
	{ start: 0, end: 15 },
	{ start: 15, end: 30 }
];

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

	it('round-trips one file layout through storage', () => {
		const key = 'video.mp4|1024|1700000000000';
		saveSession(key, layoutSegments, 1000);
		expect(loadSession(key)).toEqual({ segments: layoutSegments, savedAt: 1000 });
	});

	it('returns null when nothing is stored', () => {
		expect(loadSession('any')).toBeNull();
	});

	it('returns null for a key that has no stored layout', () => {
		saveSession('a', layoutSegments, 1000);
		expect(loadSession('b')).toBeNull();
	});

	it('keeps layouts for different files side by side', () => {
		saveSession('a', [{ start: 0, end: 5 }], 1000);
		saveSession('b', [{ start: 0, end: 9 }], 2000);
		expect(loadSession('a')?.segments).toEqual([{ start: 0, end: 5 }]);
		expect(loadSession('b')?.segments).toEqual([{ start: 0, end: 9 }]);
	});

	it('replaces an existing layout without growing the map', () => {
		saveSession('a', [{ start: 0, end: 5 }], 1000);
		saveSession('a', [{ start: 0, end: 7 }], 2000);
		expect(loadSession('a')).toEqual({ segments: [{ start: 0, end: 7 }], savedAt: 2000 });
		const stored = JSON.parse(storage.getItem(SESSIONS_STORAGE_KEY) ?? '{}');
		expect(Object.keys(stored.entries)).toEqual(['a']);
	});

	it('returns null and logs on corrupt JSON', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.setItem(SESSIONS_STORAGE_KEY, ']]]');
		expect(loadSession('a')).toBeNull();
		expect(error).toHaveBeenCalled();
	});

	it('returns null and logs on a wrong top-level shape', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify({ version: 1, fileKey: 'k' }));
		expect(loadSession('k')).toBeNull();
		expect(error).toHaveBeenCalled();
	});

	it('returns null and logs on a different map version', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.setItem(
			SESSIONS_STORAGE_KEY,
			JSON.stringify({ version: 42, entries: { a: { segments: [], savedAt: 1 } } })
		);
		expect(loadSession('a')).toBeNull();
		expect(error).toHaveBeenCalled();
	});

	it('drops a structurally invalid entry but keeps the valid ones', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.setItem(
			SESSIONS_STORAGE_KEY,
			JSON.stringify({
				version: 2,
				entries: {
					bad: { segments: [{ start: 10, end: 5 }], savedAt: 1 },
					good: { segments: [{ start: 0, end: 5 }], savedAt: 2 }
				}
			})
		);
		expect(loadSession('bad')).toBeNull();
		expect(loadSession('good')).toEqual({ segments: [{ start: 0, end: 5 }], savedAt: 2 });
		expect(error).toHaveBeenCalled();
	});

	it('prunes the oldest entries beyond the cap on write', () => {
		for (let i = 0; i < MAX_STORED_SESSIONS; i++) {
			saveSession(`file-${i}`, [{ start: 0, end: i + 1 }], 1000 + i);
		}
		// One more write pushes the map over the cap: the lowest savedAt goes.
		saveSession('newest', [{ start: 0, end: 99 }], 5000);

		expect(loadSession('file-0')).toBeNull();
		expect(loadSession('file-1')).not.toBeNull();
		expect(loadSession('newest')).not.toBeNull();
		const stored = JSON.parse(storage.getItem(SESSIONS_STORAGE_KEY) ?? '{}');
		expect(Object.keys(stored.entries).length).toBe(MAX_STORED_SESSIONS);
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
		expect(loadSession('a')).toBeNull();
		expect(() => saveSession('a', layoutSegments, 1)).not.toThrow();
		expect(error).toHaveBeenCalled();
	});
});
