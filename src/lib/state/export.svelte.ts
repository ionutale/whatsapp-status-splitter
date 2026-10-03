import type { Segment } from '../domain/segments';
import type { OutputPlan } from '../domain/bitrate';
import { downloadBlob } from '../media/download';
import { realEncodeClip, type EncodeClipFactory, type EncodeHandle } from '../media/exporter';
import { makeZip } from '../media/zip';

export type ClipStatus = 'idle' | 'encoding' | 'done' | 'failed' | 'canceled';

export type ExportJob = {
	id: string;
	fileName: string;
	segment: Segment;
	plan: OutputPlan;
};

export type FinishMode =
	{ finish: 'download-first' } | { finish: 'zip'; zipName: string } | { finish: 'none' };

export type ExportDeps = {
	encodeClip: EncodeClipFactory;
	downloadBlob: (blob: Blob, fileName: string) => void;
	makeZip: (entries: { name: string; blob: Blob }[]) => Promise<Blob>;
};

const isCancelError = (error: unknown): boolean =>
	error instanceof Error &&
	(error.name === 'ConversionCanceledError' ||
		error.constructor.name === 'ConversionCanceledError');

export class ExportState {
	statuses = $state<Record<string, ClipStatus>>({});
	progress = $state<Record<string, number>>({});
	errors = $state<Record<string, string>>({});
	results = $state<Record<string, Blob>>({});
	busy = $state(false);
	runError = $state<string | null>(null);

	#deps: ExportDeps;
	#current: EncodeHandle | null = null;
	#cancelRequested = false;
	#generation = 0;

	constructor(deps: ExportDeps) {
		this.#deps = deps;
	}

	async runJobs(file: File, jobs: ExportJob[], mode: FinishMode): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		const gen = this.#generation;
		this.#cancelRequested = false;
		this.runError = null;
		const succeeded: { name: string; blob: Blob }[] = [];

		try {
			for (const job of jobs) {
				if (this.#cancelRequested || gen !== this.#generation) break;
				this.statuses[job.id] = 'encoding';
				this.progress[job.id] = 0;
				this.errors[job.id] = '';

				const handle = this.#deps.encodeClip({
					file,
					segment: job.segment,
					plan: job.plan,
					onProgress: (value) => {
						if (gen !== this.#generation) return;
						this.progress[job.id] = value;
					}
				});
				this.#current = handle;

				try {
					const blob = await handle.result;
					if (gen !== this.#generation) break;
					this.statuses[job.id] = 'done';
					this.progress[job.id] = 1;
					this.results[job.id] = blob;
					succeeded.push({ name: job.fileName, blob });
				} catch (error) {
					if (gen !== this.#generation) break;
					if (this.#cancelRequested || isCancelError(error)) {
						this.statuses[job.id] = 'canceled';
						this.#cancelRequested = true;
					} else {
						this.statuses[job.id] = 'failed';
						this.errors[job.id] = error instanceof Error ? error.message : String(error);
						console.error('[export] clip failed', job.fileName, error);
					}
				} finally {
					this.#current = null;
				}
			}

			// A canceled run never finishes: completed blobs stay in `results` for
			// per-clip download, but nothing is downloaded or zipped automatically.
			if (!this.#cancelRequested && gen === this.#generation) {
				if (mode.finish === 'download-first' && succeeded[0]) {
					this.#deps.downloadBlob(succeeded[0].blob, succeeded[0].name);
				} else if (mode.finish === 'zip' && succeeded.length > 0) {
					const zip = await this.#deps.makeZip(succeeded);
					// A reset may have landed while the zip was assembling: re-check the
					// generation before firing the (now stale) download.
					if (gen === this.#generation) {
						this.#deps.downloadBlob(zip, mode.zipName);
					}
				}
			}
		} catch (error) {
			console.error('[export] run failed', error);
			if (gen === this.#generation) {
				this.runError = error instanceof Error ? error.message : String(error);
			}
		} finally {
			this.busy = false;
		}
	}

	async cancel(): Promise<void> {
		this.#cancelRequested = true;
		await this.#current?.cancel();
	}

	/**
	 * Stop any in-flight run and clear all per-clip state. Bumping the generation
	 * makes a still-running loop discard its late writes, so a stale export can
	 * never repopulate statuses or fire a stray download/zip after a new file loads.
	 */
	reset(): void {
		void this.cancel();
		this.#generation++;
		this.statuses = {};
		this.progress = {};
		this.errors = {};
		this.results = {};
		this.runError = null;
	}
}

export const exportState = new ExportState({
	encodeClip: realEncodeClip,
	downloadBlob,
	makeZip
});
