# Share All Clips — Design

Date: 2026-10-31
Status: Approved approach (A); pending design approval.

## Intent

The user splits one video into several ≤30s clips. Today, getting them into
WhatsApp Status means: save/download the clips, open Photos, multi-select,
Share → WhatsApp Status. The ask: **share all split clips from the app in one
action**, matching that Photos multi-select flow, on both Android and iPhone.

## How it works today

- `ExportPanel` has a per-clip **Share** (`navigator.share` with one file) and
  **Export all (ZIP)**. `share.ts` probes capability with a single dummy file.
- `ExportState.runJobs` encodes jobs sequentially with progress, cancel, retry,
  and keeps each result blob keyed by segment id (`results[id]`).
- `ExportPanel` keeps a component-local cache keyed by plan+bounds so a Share
  never reuses a blob encoded for an older plan (`jobKey`).
- WhatsApp Status is not addressable from the web. The only channel is the OS
  share sheet, which is the same sheet the Photos flow uses.
- `navigator.share` requires transient user activation: a share call after a
  long encode **cannot** open the sheet (activation expired).

## Goal

One place in the export panel: **Share all (N)** — encodes anything missing,
then hands all clips to the OS sheet in one call where supported, so the user
picks WhatsApp → Status once. Where the phone can only share one file at a
time, the same flow becomes a guided per-clip share.

## Non-goals

- Posting directly to Status (impossible from the web).
- Writing clips into the phone's photo library (not possible on iOS).
- Batch-mode sharing (editor only; batch keeps the ZIP).
- Changing exports, presets, encoding, offline, or the deploy setup.

## Anti-goals

- A share call that silently does nothing (must end in the sheet or an error).
- Re-encoding clips that are already prepared for the current settings.
- Sharing stale clips after boundaries/preset/crop changed.
- Blocking the per-clip Share/Download flows.

## Approaches considered

- **A — Share-all with guided fallback (chosen).** Prepare all, one share call
  with N files if `navigator.canShare({ files: N })` allows; otherwise a guided
  "Share i of N" sequence. Closest to the user's current habit; degrades safely
  on either phone.
- **B — Gallery-first.** Save all clips into the media library, then use the
  existing Photos flow. On Android downloads are usually gallery-visible; on
  iOS a web app cannot write to Photos (only per-clip "Save Video"), so it is
  strictly worse there and no fewer taps on Android.
- **C — Guided sequential share only.** Most reliable, but N taps and N
  WhatsApp trips on every device; kept as A's fallback instead.

## Design (A)

### UI

- New primary action in `ExportPanel`, beside **Export all (ZIP)**:
  **Share all (N)**, shown only when file sharing is supported and N ≥ 2
  (a single clip keeps the existing per-clip Share).
- Button states: `idle` → `preparing (i/N)` with the existing cancel button →
  `ready to share` → `sharing…`.
- On the phone layout the panel is already reused full-width, so the button is
  automatically a large touch target.

### Prepare phase

1. Reuse each cached blob whose `jobKey` matches the current plan+bounds.
2. Encode the remaining jobs with `runJobs(file, missing, { finish: 'none' })`,
   reusing the existing progress/error/cancel behavior.
3. If some jobs fail, continue with the successful subset and say so in the
   label ("Share 2 of 3") — failures are retryable per clip as today.
4. Canceling preparation leaves partial results; nothing is shared.

### Share phase

- All prepared → `navigator.canShare({ files: all })`:
  - **true** → one `navigator.share({ files: all, title })` call.
  - **false** → guided mode: "Share 1 of N" (primary), each tap shares that one
    file; advance on success, stay on `AbortError` (user cancelled), allow
    retrying a failed share.
- **Activation rule:** because the preparation await may outlive the tap's
  activation, the share is attempted immediately after preparation; a
  `NotAllowedError` (or any non-abort refusal) drops into the explicit
  **ready to share** button so the user's next tap always works.
- Share errors show the existing error surface; prepared blobs remain available
  for per-clip Download.

### Capability & stale-encode guards

- `share.ts` gains multi-file helpers (`canShareFiles(files)` stays,
  `shareFiles(files, title)`), with the same defensive probing style.
- Capability is probed with the actual prepared `File[]`, not dummy files.
- The `jobKey` cache remains the single authority for "is this blob for the
  current settings"; share-all must never bypass it.

### Scope of files

`src/lib/media/share.ts`, `src/lib/components/ExportPanel.svelte`,
`src/lib/state/export.svelte.ts` (only if a small helper belongs there),
tests, README (phone section), and the export-panel testids.

## Testing

- **Browser tests** (`share.browser.test.ts`, `ExportPanel.svelte.test.ts`):
  stub `navigator.canShare`/`navigator.share`; assert one call with N files when
  supported, guided first clip when not, subset-on-failure, stale-cache
  re-encode, cancel leaves nothing shared, `AbortError` stays put.
- **Mobile e2e** (`e2e/mobile.spec.ts`): `addInitScript` stubs for
  `canShare`/`share`; load a fixture, tap Share all, assert the recorded call
  received both clip files; second test forces single-file capability and walks
  the guided path.
- **Manual device check (required):** on both phones, verify WhatsApp accepts
  the multi-file sheet / guided shares and offers Status. This is the one thing
  the docs cannot settle; if a platform refuses multi-file, it simply takes the
  guided path.

## Left to the builder

Exact labels/wording, the fallback panel layout, and whether the guided mode
lives inline in `ExportPanel` or as a small component (default: inline, keep it
small).
