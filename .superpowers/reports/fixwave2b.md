# Fix wave 2b — batch queue: editor yield, cancel and naming hardening

**Status:** complete, all gates green (check 0/0, lint clean, 205/205 tests).
**Branch:** `main` (local only, never pushed).

## What was fixed

### Must-fix

- **I1 — pre-ZIP cancel guard pinned by a test** (`batch.svelte.ts`): the guard
  `if (this.#cancelRequested || gen !== this.#generation) return;` before
  `makeZip` is load-bearing. New test: 2 files, file 1 finishes, cancel during
  file 2's deferred encode, resolve it → asserts `zipCalls === []`,
  `downloads === []`, and statuses `['done', 'queued']` (completed file stays
  Done). Mutation evidence below.
- **I2 — stale queue no longer leaks into the editor** (`+page.svelte`,
  `batch.svelte.ts`): `handleFile` now calls `batchState.clear()` before
  loading, so a single-file load drops the panel and stops any in-flight batch.
  New `BatchState.clear()` is a safe stop: bumps the generation (stale run
  bails at its next checkpoint), `running = false`, cancels the in-flight clip
  handle, resets items/overallProgress/runError. Tests: (a) unit — `clear()`
  while running stops without download and cancels the handle; (b) browser
  (`page.browser.test.ts`) — 2-file drop → panel with 2 rows; single-file drop
  → editor loads (`file-name` shows the new file) and no `batch-panel` remains.

### Strongly recommended

- **M1 — clip-loop cancel break pinned**: the existing cancel test now asserts
  `encodeCalls` equals `['a1']` after cancel (was unasserted). Mutation
  evidence below.
- **M2 — post-inspect cancel no longer strands a row on "Reading…"**: the
  post-inspect checkpoint now resets the item to `queued` (mirroring the
  encode paths) before breaking. New test: cancel while inspect is pending →
  row returns to `queued`, no ZIP, no download.
- **M3 — cancel during ZIP assembly no longer downloads**: re-check
  `this.#cancelRequested` after `makeZip` resolves, before `downloadBlob`.
  New test: cancel while `makeZip` is pending → no download.
- **M4 — duplicate base names no longer lose a file**: `start()` tracks used
  bases in a record and suffixes collisions `_2`, `_3`… New test: three files
  sanitizing to `My_Clip` produce `My_Clip/`, `My_Clip_2/`, `My_Clip_3/`
  entries, all rows Done, one download.
- **M5 — stale run's in-flight clip no longer keeps encoding**: `BatchState`
  keeps the current `EncodeHandle` in `#activeHandle`; `setFiles` and `clear`
  call `handle.cancel()` when the generation is invalidated. New tests:
  re-selecting mid-clip cancels the stale handle (late result still produces
  no download); `clear()` test asserts the same.
- **M6 — settings visible while the queue is up**: `+page.svelte` passes
  `{ maxClipDuration, preset, crop916 }` from the project into `BatchPanel`,
  which renders one compact read-only line (`batch-settings` testid), e.g.
  "30s clips · whatsapp preset · 9:16 crop off". New BatchPanel test asserts
  the line ("7s clips · high preset · 9:16 crop on").
- **M7 — README nits**: opening line now mentions batch ("Splits one video —
  or a batch of videos — …"); the ZIP sentence clarifies you get one ZIP when
  at least one file completes and **nothing is downloaded if every file
  fails**; the memory note now states peak is roughly **2× the total encoded
  size** during ZIP assembly (parts plus archive); the Cancel bullet now says
  finished files stay **Done** and the rest return to **Queued** (the queue is
  not reset to virgin idle).

## Skipped (orchestrator-accepted)

- M8 odds-and-ends, the e2e `timeout: 120_000` pattern, and the design spec —
  untouched, as instructed. `e2e/splitter.spec.ts` needed no changes: the e2e
  flow (2 files → panel → Start → one ZIP) is unchanged, and the new
  `batch-settings` line does not disturb any e2e selector.

## Exact RED-GREEN mutation evidence

Scratch-copy mutations on `src/lib/state/batch.svelte.ts` (backup at
`/tmp/batch.svelte.ts.bak`, restored after each run; `git diff` confirms only
the intended changes remain).

**Item 1 (I1) — neutralize the pre-makeZip cancel guard** (line 242:
`if (this.#cancelRequested || gen !== this.#generation) return;` →
`if (gen !== this.#generation) return;`):

```
$ pnpm vitest --run --project unit src/lib/state/batch.test.ts
 × never ZIPs or downloads a canceled run, even after the last clip resolves 55ms
 Tests  1 failed | 13 passed (14)
```

The new test fails (partial ZIP of the completed file 1 is assembled and
downloaded after cancel); all 13 others stay green — the guard was untested
before. File restored.

**Item 3 (M1) — remove the clip-loop cancel break** (line 183 deleted):

```
$ pnpm vitest --run --project unit src/lib/state/batch.test.ts
 × cancel stops after the current clip: remaining files never start, nothing downloads 3ms
 Tests  1 failed | 13 passed (14)
```

The extended assertion `encodeCalls === ['a1']` fails (a2 encodes after
cancel). File restored.

## Gate output

```
$ pnpm check
svelte-check found 0 errors and 0 warnings

$ pnpm lint
All matched files use Prettier code style!   # eslint: no output (clean)

$ pnpm test:unit -- --run
  Test Files  30 passed (30)
       Tests  205 passed (205)      # was 197; +8 new tests
```

Focused runs: `batch.test.ts` 14 passed (was 8); `BatchPanel.svelte.test.ts`
5 passed (was 4); `page.browser.test.ts` 5 passed (was 4).

`pnpm test:e2e` and `pnpm build` were **not** run, per instructions. The e2e
flow is unchanged (no e2e selector or assertion was touched); if a run is
wanted later, `pnpm exec playwright test e2e/splitter.spec.ts` is the command.

## Files touched

- `src/lib/state/batch.svelte.ts` — `clear()`, `#activeHandle` tracking +
  cancel on `setFiles`/`clear`, post-inspect cancel reset, pre-download
  cancel re-check, duplicate-base suffixing.
- `src/lib/state/batch.test.ts` — harness gains `inspect`/`makeZip` overrides;
  cancel test extended (M1); 6 new tests (I1, I2a, M2, M3, M4, M5).
- `src/lib/components/BatchPanel.svelte` — settings props + read-only
  `batch-settings` line.
- `src/lib/components/BatchPanel.svelte.test.ts` — settings-line test (M6).
- `src/routes/+page.svelte` — `batchState.clear()` in `handleFile` (I2);
  settings props passed to `BatchPanel` (M6).
- `src/routes/page.browser.test.ts` — batch-cleared-on-single-file browser
  test (I2b); `batchState.clear()` in `beforeEach` (shared singleton
  hygiene).
- `README.md` — M7 nits.

`src/lib/media/**`, `project.svelte.ts`, `export.svelte.ts`, and the design
spec were not modified.

## Concerns

- `clear()` bumps the generation, so a batch run in flight when a single file
  is loaded stops at its next checkpoint and its in-flight clip is canceled —
  this is the intended I2 behavior, but it does mean a running batch is
  abandoned (not resumed) when the user switches to the editor. That matches
  the reviewer's requirement.
- The `svelte/prefer-svelte-reactivity` lint rule rejects `new Set()` even for
  function-locals; the used-bases tracker uses a plain `Record<string, true>`
  instead (no reactivity needed for a local).
- Duplicate-base suffixing is per-run: two files named `My Clip.mp4` and
  `My_Clip.mp4` get `_2` suffixes; a third collision gets `_3`, etc.
