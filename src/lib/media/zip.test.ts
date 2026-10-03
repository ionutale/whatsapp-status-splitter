import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { makeZip } from './zip';

describe('makeZip', () => {
	it('creates a zip containing the given entries', async () => {
		const zip = await makeZip([
			{ name: 'a_part01.mp4', blob: new Blob([new Uint8Array([1, 2, 3])]) },
			{ name: 'a_part02.mp4', blob: new Blob([new Uint8Array([4, 5])]) }
		]);
		const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
		expect(Object.keys(entries).sort()).toEqual(['a_part01.mp4', 'a_part02.mp4']);
		expect(Array.from(entries['a_part01.mp4'])).toEqual([1, 2, 3]);
	});
});
