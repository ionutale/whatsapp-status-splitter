import { buildOutputPlan, type QualityPreset } from '../domain/bitrate';
import { clipFileName, sanitizeBaseName } from '../domain/naming';
import { autoSplit, type Segment } from '../domain/segments';
import { downloadBlob } from '../media/download';
import { realEncodeClip, type EncodeClipFactory, type EncodeHandle } from '../media/exporter';
import { inspectFile, type InspectResult } from '../media/inspect';
import { makeZip } from '../media/zip';
import { project } from './project.svelte';

export type BatchFileStatus = 'queued' | 'reading' | 'encoding' | 'done' | 'failed';

export type BatchItem = {
	id: string;
	file: File;
	status: BatchFileStatus;
	/** 1-based clip currently being encoded; 0 when not encoding. */
	clipIndex: number;
	/** Clips discovered for this file after inspection; 0 until then. */
	clipCount: number;
	/** Progress (0..1) of the clip currently being encoded. */
	progress: number;
	error: string | null;
};

export type BatchDeps = {
	inspect: (file: File) => Promise<InspectResult>;
	encodeClip: EncodeClipFactory;
	makeZip: (entries: { name: string; blob: Blob }[]) => Promise<Blob>;
	downloadBlob: (blob: Blob, fileName: string) => void;
	split: (duration: number, maxClipDuration: number) => Segment[];
};

export const BATCH_ZIP_NAME = 'status_batch.zip';
export const BATCH_READ_FAILURE =
	'could not be read — open it individually to use compatibility mode';

const isCancelError = (error: unknown): boolean =>
	error instanceof Error &&
	(error.name === 'ConversionCanceledError' ||
		error.constructor.name === 'ConversionCanceledError');

/**
 * Orchestrates the batch queue: several files, each auto-split and encoded into
 * parts, merged into one ZIP. The editor is never touched; the only project
 * reads are `preset`, `crop916`, and `maxClipDuration`. Dependencies are
 * injectable so the loop can be unit-tested without real encoding.
 */
export class BatchState {
	items = $state<BatchItem[]>([]);
	running = $state(false);
	overallProgress = $state(0);
	runError = $state<string | null>(null);

	#deps: BatchDeps;
	#cancelRequested = false;
	#generation = 0;
	#activeHandle: EncodeHandle | null = null;

	constructor(deps: BatchDeps) {
		this.#deps = deps;
	}

	/** Replace the queue with a fresh set of files, resetting any in-flight run. */
	setFiles(files: File[]): void {
		this.#generation++;
		this.#cancelRequested = false;
		// Stop the previous run's current clip from encoding for a queue that
		// no longer exists; its generation guard drops the result.
		void this.#activeHandle?.cancel();
		this.#activeHandle = null;
		// The previous run's `finally` is generation-guarded, so it will not clear
		// `running` for this new queue — do it here or Start stays disabled forever.
		this.running = false;
		this.items = files.map((file) => ({
			id: crypto.randomUUID(),
			file,
			status: 'queued',
			clipIndex: 0,
			clipCount: 0,
			progress: 0,
			error: null
		}));
		this.overallProgress = 0;
		this.runError = null;
	}

	/** Stop after the clip currently encoding finishes; no ZIP is downloaded. */
	cancel(): void {
		if (!this.running) return;
		this.#cancelRequested = true;
	}

	/**
	 * Drop the queue and stop any in-flight run. Safe to call at any time: the
	 * generation bump makes the stale run bail out at its next checkpoint, and
	 * the in-flight clip is canceled so it stops encoding for nothing.
	 */
	clear(): void {
		this.#generation++;
		this.#cancelRequested = false;
		this.running = false;
		void this.#activeHandle?.cancel();
		this.#activeHandle = null;
		this.items = [];
		this.overallProgress = 0;
		this.runError = null;
	}

	#setOverall(fileIndex: number, doneClips: number, clipCount: number, fileCount: number): void {
		const fraction = clipCount > 0 ? doneClips / clipCount : 1;
		this.overallProgress = Math.min(1, (fileIndex + fraction) / fileCount);
	}

	async start(): Promise<void> {
		if (this.running || this.items.length === 0) return;
		this.running = true;
		this.#cancelRequested = false;
		this.runError = null;
		const gen = this.#generation;
		const items = this.items;
		const fileCount = items.length;
		const entries: { name: string; blob: Blob }[] = [];
		// Object.create(null): a plain {} inherits from Object.prototype, so a
		// first-occurrence base like "constructor" or "toString" would read as
		// already-used and get wrongly suffixed.
		const usedBases = Object.create(null) as Record<string, true>;

		for (const item of items) {
			item.status = 'queued';
			item.clipIndex = 0;
			item.clipCount = 0;
			item.progress = 0;
			item.error = null;
		}
		this.overallProgress = 0;

		try {
			for (let i = 0; i < fileCount; i++) {
				if (this.#cancelRequested || gen !== this.#generation) break;
				const item = items[i];
				item.status = 'reading';

				let inspected: InspectResult;
				try {
					inspected = await this.#deps.inspect(item.file);
				} catch (error) {
					if (gen !== this.#generation) break;
					console.error('[batch] failed to read', item.file.name, error);
					// Compatibility mode is a single-file affordance only: batch keeps
					// going and tells the user to open this file on its own.
					item.status = 'failed';
					item.error = BATCH_READ_FAILURE;
					this.#setOverall(i, 1, 1, fileCount);
					continue;
				}
				if (gen !== this.#generation) break;
				if (this.#cancelRequested) {
					item.status = 'queued';
					item.clipIndex = 0;
					item.progress = 0;
					break;
				}

				const segments = this.#deps.split(inspected.duration, project.maxClipDuration);
				const preset: QualityPreset = project.preset;
				const crop916 = project.crop916;
				// Two files can sanitize to the same base ("My Clip.mp4" and
				// "My_Clip.mp4"); suffix the duplicates so neither file is silently
				// dropped from the archive.
				let base = sanitizeBaseName(item.file.name);
				if (usedBases[base]) {
					let n = 2;
					while (usedBases[`${base}_${n}`]) n++;
					base = `${base}_${n}`;
				}
				usedBases[base] = true;
				item.clipCount = segments.length;
				item.status = 'encoding';

				// Parts stay local until the whole file encodes, so a mid-file
				// failure never leaves a half-file in the archive.
				const parts: { name: string; blob: Blob }[] = [];
				let failed = false;

				for (let j = 0; j < segments.length; j++) {
					if (this.#cancelRequested || gen !== this.#generation) break;
					const segment = segments[j];
					item.clipIndex = j + 1;
					item.progress = 0;
					const plan = buildOutputPlan(segment.end - segment.start, inspected.meta, preset, {
						crop916
					});
					const handle = this.#deps.encodeClip({
						file: item.file,
						segment,
						plan,
						onProgress: (value) => {
							if (gen !== this.#generation) return;
							item.progress = value;
							this.#setOverall(i, j + value, segments.length, fileCount);
						}
					});
					this.#activeHandle = handle;

					try {
						const blob = await handle.result;
						if (gen !== this.#generation) break;
						parts.push({ name: `${base}/${clipFileName(base, j)}`, blob });
						item.progress = 1;
						this.#setOverall(i, j + 1, segments.length, fileCount);
					} catch (error) {
						if (gen !== this.#generation) break;
						if (this.#cancelRequested || isCancelError(error)) {
							item.status = 'queued';
							item.clipIndex = 0;
							item.progress = 0;
							break;
						}
						console.error('[batch] clip failed', item.file.name, error);
						item.status = 'failed';
						item.error = error instanceof Error ? error.message : String(error);
						failed = true;
						break;
					} finally {
						if (this.#activeHandle === handle) this.#activeHandle = null;
					}
				}

				if (gen !== this.#generation) break;
				if (this.#cancelRequested) {
					item.status = 'queued';
					item.clipIndex = 0;
					item.progress = 0;
					break;
				}
				if (!failed) {
					item.status = 'done';
					entries.push(...parts);
				}
				this.#setOverall(i, 1, 1, fileCount);
			}

			// A canceled run never finishes: the partial ZIP is discarded and no
			// download is offered. Completed per-file statuses stay as they are.
			if (this.#cancelRequested || gen !== this.#generation) return;

			if (entries.length > 0) {
				const zip = await this.#deps.makeZip(entries);
				// Cancel can land while the archive is assembled; never offer a
				// ZIP the user already canceled.
				if (this.#cancelRequested || gen !== this.#generation) return;
				this.#deps.downloadBlob(zip, BATCH_ZIP_NAME);
			}
			this.overallProgress = 1;
		} catch (error) {
			console.error('[batch] run failed', error);
			if (gen === this.#generation) {
				this.runError = error instanceof Error ? error.message : String(error);
			}
		} finally {
			if (gen === this.#generation) {
				this.running = false;
				this.#cancelRequested = false;
			}
		}
	}
}

export const batchState = new BatchState({
	inspect: inspectFile,
	encodeClip: realEncodeClip,
	makeZip,
	downloadBlob,
	split: autoSplit
});
