# WhatsApp Status Splitter — Design Specification

- **Date:** 2026-10-03
- **Status:** Approved in brainstorming; awaiting written-spec review
- **Project:** `whatsapp-status-splitter` (`/Users/ionutale/developer-playground/whatsapp-status-splitter`)

## 1. Context and problem

WhatsApp Status rejects videos longer than its per-post limit (30s historically;
60–90s in some current versions) and forces an in-app trim. A long video must be
cut into several consecutive clips and posted as consecutive statuses.

Doing this by hand is lossy and tedious: trim → post → remember where you stopped →
re-open the video → trim again. There is no tool that shows the **whole video on one
timeline** split into **independent, per-clip trimmable ranges** and exports all
clips as WhatsApp-ready MP4s.

## 2. Goals

1. Load one video from disk (file picker, drag-and-drop, or dragging out of the
   macOS Photos app).
2. Auto-split it into consecutive chunks of a configurable maximum length
   (default 30s). Example: 80s → 0–30, 30–60, 60–80.
3. Show the full video on a single shared timeline where each chunk is a selection
   bar with its own left/right drag handles.
4. Ranges are **independent**: dragging one clip never moves another. Overlaps and
   uncovered stretches are allowed and clearly marked.
5. Let the user fine-tune every clip: drag handles, numeric fields, keyboard nudges,
   split/delete/reset, timeline zoom.
6. Preview any clip in place (player plays only that clip's range).
7. Export clips as WhatsApp-ready MP4 (H.264 video + AAC audio), with quality
   presets; default preset targets ≤16MB per clip and 720p/30fps.
8. Export one clip at a time (download), all clips as a ZIP, or share a clip
   directly to WhatsApp via the OS share sheet.
9. All processing happens locally in the browser. No uploads, no server, no account.

## 3. Non-goals (YAGNI)

- No server, database, auth, or uploads.
- No persistence across page refresh (re-open and re-load if needed).
- No cropping/aspect-ratio changes, filters, music, watermarks, subtitles, speed.
- No scene/silence-based automatic splitting — equal chunks plus manual handles only.
- No drag-to-reorder; clip order always follows timeline order.
- No mobile/PWA target. Desktop Chrome on macOS is the supported browser.
- No ffmpeg.wasm fallback in v1 — add only if a real-world video fails to decode.
- No multi-file queue — one video at a time.

## 4. Usage context

- Personal tool, run locally from the playground: `pnpm dev`, open in Chrome.
- Sources seen in practice: iPhone HEVC `.mov` (including rotated portrait, 4K),
  Android H.264 `.mp4`, macOS screen recordings, downloaded clips.
- "Load from photo library" means: the user may drag a video straight out of the
  macOS Photos app into the page (it arrives as a normal file drop), or pick an
  exported file. Browsers cannot read the Photos library directly; drag-out covers it.
- Output files go to Downloads (single clips), one ZIP (all clips), or the macOS
  share sheet (directly to WhatsApp / AirDrop).

## 5. Functional requirements

### FR-1 Load

- Drop zone fills the page when empty: accepts file drop, click-to-choose
  (`<input type="file" accept="video/*">`), and drag-out from Photos.
- One video at a time; loading a new file replaces the previous project. A `dirty`
  flag is set by any manual edit (drag, numeric, split, delete, max-length change);
  loading while dirty asks for confirmation. Fresh loads and Reset-to-auto-split
  clear the flag.

### FR-2 Inspect and preflight

- Read duration, primary video track (display width/height, rotation, codec),
  and whether an audio track exists, using Mediabunny `Input` + `computeDuration()`
  and track getters.
- Preflight `track.canDecode()`; if the codec can't be decoded in this browser,
  show a blocking, plain-language error and do not create the project.
- Warn (non-blocking) for very long videos (> 20 min): "thumbnails and export may
  be slow".

### FR-3 Auto-split

- On load, split `[0, duration]` into consecutive chunks of `maxClipDuration`
  (default 30s, editable in the UI, min 1s, max 300s).
- `autoSplit(80, 30) = [{0,30},{30,60},{60,80}]`; `autoSplit(60,30) = [{0,30},{30,60}]`.
- Videos shorter than `maxClipDuration` → a single clip `[0, duration]`.
- Edge: if `duration <= minClipDuration (0.5s)`, the single clip is allowed to be
  shorter than the minimum (the minimum never blocks the whole video).

### FR-4 Timeline

- One shared time axis for the whole video: ruler with adaptive ticks, filmstrip
  thumbnails, playhead, and the clip lane.
- Each clip is a colored selection bar labeled `Clip N` with left/right handles.
- Selected clip is highlighted; bars show start, end, and duration.
- Uncovered stretches (gaps) are hatched/marked; overlapping stretches are marked,
  and overlapping bars are offset vertically slightly so both remain grabbable.

### FR-5 Handle dragging (independence + clamps)

- Dragging a handle changes only that clip's `start` or `end`.
- Clamps while dragging:
  - start ∈ [0, end − minClipDuration]; end ∈ [start + minClipDuration, duration];
  - `end − start ≤ maxClipDuration`;
  - `minClipDuration = 0.5s` (or `min(0.5, duration)` for very short videos).
- Handles cannot cross. Grabbing a handle pauses playback.

### FR-6 Per-clip controls

- Numeric fields per selected clip: start, end, duration (`MM:SS.d` format).
  Editing goes through the same clamp rules.
- Keyboard: handles are focusable (`role="slider"` with aria values); ←/→ nudges
  the focused handle by 0.1s; Shift+←/→ by 1s; Space play/pauses.
- Buttons: **Split selected in half** (two clips at the midpoint; disabled when the
  clip is shorter than `2 × minClipDuration`), **Delete selected**, **Reset to
  auto-split** (re-runs FR-3 with current max length).
- Max clip length input (default 30s). Lowering it immediately re-clamps any clip
  longer than the new max. Reset restores a clean auto-split.
- Timeline zoom slider (1× = the whole video fits the lane; up to 20×, horizontal
  scroll). Zoom anchors at the playhead.
- Clicking a clip selects it; clicking inside a clip also seeks the player to its
  start.

### FR-7 Preview

- Player shows the loaded file (plain `<video>` with object URL — no decode
  pipeline for preview).
- Playing a selected clip: seek to its start on play; stop at its end, or loop
  within the range when the loop toggle is on (default: on).
- Playhead follows playback; dragging the playhead scrubs.

### FR-8 Export — single clip

- Per-clip Download button → MP4 (H.264 + AAC), named
  `<base>_part01.mp4`, `<base>_part02.mp4`, … (`<base>` = sanitized file name
  without extension; zero-padded by timeline order).
- Export disabled while another export runs; shows per-clip progress.

### FR-9 Export — all clips

- **Export all**: encodes clips sequentially in timeline order (bounded memory,
  honest progress), then downloads a single ZIP named `<base>_parts.zip`
  containing all clips.
- Failure of one clip marks it failed with a **Retry** action and continues with
  the rest. Errors are surfaced in the UI and logged to console.
- **Cancel** stops the current conversion (`conversion.cancel()`); already-exported
  clips stay available. Cancellation is not an error state.

### FR-10 Share

- Per-clip **Share** button using the Web Share API with files
  (`navigator.canShare({ files })` feature-detect). Hidden when unsupported.
- Share sheet opens the system UI (WhatsApp, AirDrop, etc.).

### FR-11 Quality presets

| Preset | Resolution cap | FPS cap | Video bitrate | Audio | Size target |
|---|---|---|---|---|---|
| `whatsapp` (default) | min(w,h) ≤ 720 | 30 | auto to target, clamp 800k–6M | AAC 128k | ≤ 16MB (target 15MB) |
| `high` | min(w,h) ≤ 1080 | 60 | 8 Mbps | AAC 192k | none |
| `small` | min(w,h) ≤ 480 | 30 | auto to target, clamp 400k–3M | AAC 96k | ≤ 16MB (target 15MB) |

- Auto bitrate: `videoKbps = clamp((15MB × 8000 × 0.92 / durationSec) − audioKbps,
  presetMin, presetMax)`; `0.92` accounts for container overhead. If the clamp floor
  is hit, the file may exceed 16MB — acceptable and not hidden.
- Videos without an audio track export video-only (`audio: { discard: true }`,
  audioKbps = 0 in the formula).
- Export panel shows the estimated size per clip before exporting.
- Rotation: exported clips must render in the same orientation as the preview —
  rotation is baked into exported pixels given phone metadata; covered by a
  dedicated test.

### FR-12 Thumbnails

- Filmstrip extracted via Mediabunny `VideoSampleSink` at up to 30 evenly spaced
  timestamps, drawn small (~160px wide). Generated progressively after load;
  failure is non-fatal (neutral pattern instead).

## 6. Data model and pure functions

```ts
type Segment = { id: string; start: number; end: number }; // seconds, start < end
type Interval = { start: number; end: number };
type QualityPreset = 'whatsapp' | 'high' | 'small';

type VideoMeta = {
  displayWidth: number; displayHeight: number;
  rotation: 0 | 90 | 180 | 270;
  hasAudio: boolean;
  videoCodec: string | null;
};
```

All time values are seconds (floats). Functions in `src/lib/domain/` are pure and
unit-tested. The specs below are exact.

- `autoSplit(duration, maxClipDuration): Segment[]` — consecutive chunks from 0;
  last chunk may be shorter; never emits zero-length clips.
- `clampSegment(segment, opts: { duration, maxClipDuration, minClipDuration }): Segment` —
  applies all FR-5 rules; used by drag, numeric edits, keyboard nudges, and max
  length changes.
- `nudge(segment, edge: 'start' | 'end', deltaSeconds, opts): Segment` —
  `clampSegment` with the moved edge.
- `setField(segment, field: 'start' | 'end' | 'duration', value, opts): Segment` —
  duration edits move `end` (clamped).
- `computeCoverage(segments, duration): { gaps: Interval[]; overlaps: Interval[] }` —
  merges intervals; input may be unordered; adjacency (a.end == b.start) is not a
  gap.
- `estimateBitrate(durationSec, preset, hasAudio): { videoKbps, audioKbps, estimatedBytes }` —
  the FR-11 formula; `estimatedBytes = duration × (videoKbps + audioKbps) × 1000 / 8`.
- `clipFileName(base, index): string` → `${base}_part${String(index + 1).padStart(2, '0')}.mp4`.
- `sanitizeBaseName(fileName): string` — strips extension, replaces unsafe chars
  with `_`, collapses repeats; never empty.
- `formatClock(seconds): string` → `MM:SS.d` (deciseconds); `parseClock(str): number | null`
  round-trips with `formatClock` (accepts `SS.d`, `MM:SS.d`, `HH:MM:SS.d`).

## 7. Architecture

- **Stack:** SvelteKit (Svelte 5 runes, TypeScript strict) + Tailwind CSS + DaisyUI +
  Vite; `adapter-static`, SPA mode (`ssr = false`, `fallback: 'index.html'`).
  pnpm. Prettier, ESLint, Vitest (unit + component), Playwright (e2e).
- **No backend.** Everything runs in the browser; Mediabunny does inspection,
  thumbnails, and export via WebCodecs (hardware-accelerated where available).

### File layout

```
src/lib/
  domain/    segments.ts, bitrate.ts, format.ts, naming.ts         (+ *.test.ts)
  media/     inspect.ts, thumbnails.ts, exporter.ts, share.ts, zip.ts
  state/     project.svelte.ts, export.svelte.ts
  components/ DropZone.svelte, VideoPreview.svelte, Timeline.svelte, TimelineRuler.svelte,
              Filmstrip.svelte, SegmentBar.svelte, SegmentPanel.svelte,
              ExportPanel.svelte, TimeField.svelte, ProgressBar.svelte
src/routes/  +layout.ts (ssr=false), +layout.svelte, +page.svelte
e2e/         *.spec.ts, fixtures/ (committed tiny videos), helpers/
```

- Every file stays small and single-purpose (target < 500 lines).
- `state/project.svelte.ts`: class with `$state` for file, `VideoMeta`, duration,
  segments, selection, `dirty`, max clip length, preset, zoom, loop flag; methods perform
  domain operations and keep invariants (all mutations pass through
  `clampSegment`).
- `state/export.svelte.ts`: export queue, per-clip status
  (`idle | encoding | done | failed | canceled`), progress, results map, cancel.
- `media/exporter.ts` has no Svelte imports — plain async functions, independently
  testable.

### Error surface

- All failures propagate to the UI as visible messages (banner/list) **and** are
  logged to console with the original error. No silent fallbacks, no fake success.

## 8. Media pipeline (Mediabunny specifics)

Verified against Mediabunny docs (2026-10):

- **Inspect:** `new Input({ source: new BlobSource(file), formats: ALL_FORMATS })`;
  `await input.computeDuration()`; `getPrimaryVideoTrack()` →
  `getDisplayWidth/Height()`, `getRotation()`, `getCodec()`, `await track.canDecode()`;
  `getPrimaryAudioTrack()` for `hasAudio`.
- **Thumbnails:** `new VideoSampleSink(videoTrack)` + `getSample(t)`; draw to canvas.
- **Export (per clip):**
  - `Output` with `new Mp4OutputFormat({ fastStart: 'in-memory' })` +
    `BufferTarget`; output Blob `video/mp4`.
  - Video codec via `getFirstEncodableVideoCodec(output.format.getSupportedVideoCodecs())`
    (expect `avc`), passed as `video.codec`; `Conversion.init` with
    `trim: { start, end }`,
    `video: { codec, quality: new Quality({ bitrate: videoKbps * 1000 }),
    width, height, fit: 'contain', frameRate }` (cap resolution/fps per preset),
    `audio: { codec: 'aac', quality: new Quality({ bitrate: audioKbps * 1000 }) }`.
  - AAC fallback: `if (!(await canEncodeAudio('aac'))) registerAacEncoder()` from
    `@mediabunny/aac-encoder` (registered once at app start; recommended by upstream).
  - Progress via `conversion.onProgress` (0–1); cancellation via
    `await conversion.cancel()`; cancellation surfaces as `ConversionCanceledError`.
  - Setting `trim.start` forces a transcode — desired here (WhatsApp-compatible
    output, precise cuts, rotation baked).
  - One `Input` per clip export (fresh source), sequential queue.
- **ZIP:** `client-zip` (`downloadZip` with `{ name, input: Blob }` entries).
- **Share:** `navigator.share({ files: [new File([blob], name, { type: 'video/mp4' })] })`.

## 9. Testing strategy

### Unit (Vitest) — all domain logic

- `autoSplit`: 80/30 → 3 clips (30/30/20); exact multiple 60/30 → 2; 20/30 → 1;
  tiny (0.3s) → 1 short clip.
- `clampSegment`: drag start past `end − min`; drag end past `duration`;
  exceeding `maxClipDuration`; max-length reduction re-clamps; min-length exception.
- `nudge`: 0.1s / 1s steps at boundaries.
- `computeCoverage`: adjacent not a gap; gap; overlap; nested; unordered input.
- `estimateBitrate`: 30s whatsapp → ≈ 3.8 Mbps video, est. size ≤ 16MB; high preset
  fixed bitrate; video-only (audioKbps = 0).
- `clipFileName`/`sanitizeBaseName`; `formatClock`/`parseClock` round-trip.

### Component (Vitest browser mode)

- `SegmentBar`: simulated pointer drag emits clamped segment updates; keyboard
  nudge on focused handles.

### E2E (Playwright, Chromium) with committed fixtures

Fixtures generated once with ffmpeg and committed (few KB each):
`tiny-5s.mp4` (5s, 320×240, H.264+AAC), `tiny-portrait-rotated.mp4` (1s, rotation
metadata 90°).

1. Load `tiny-5s.mp4`, set max clip length to 2s → three clips 2/2/1 render.
2. Drag the right handle of clip 1 → numeric end updates and clamps at 2s.
3. Split in half → N+1 clips; Delete → N; Reset → auto-split restored.
4. Export one clip → `download` event; bytes start with `ftyp` box; non-trivial size.
5. Export all → ZIP downloads; contains N entries named `_partNN.mp4` (verified with
   `fflate` in the test).
6. Rotated fixture → exported clip displays in portrait (in-page Mediabunny read
   of display dimensions; asserts rotation handling).
7. Unsupported-codec path is unit-level (mocked preflight) — no giant fixture needed.

### Manual smoke checklist (README)

- Real iPhone HEVC portrait 4K `.mov`, Android `.mp4`, macOS screen recording:
  load → split → export → play in QuickTime → upload one clip to WhatsApp Status
  (≤16MB accepted).

## 10. Performance and limits

- Clips are ≤ ~5 min by construction (max length default 30s; cap 300s), bounding
  memory per conversion.
- Sequential exports; one `Input` and `BufferTarget` alive at a time.
- Object URLs and thumbnail bitmaps revoked on file change/unmount.
- Progress UI updates per clip; export-all shows completed/total.

## 11. Browser support

- **Chrome (Chromium) on macOS:** supported target. WebCodecs decode of H.264,
  HEVC (hardware), VP8/VP9, AV1; H.264 encode via hardware.
- **Safari 17+:** best-effort. Feature detection: if WebCodecs `VideoEncoder` is
  missing, show a clear "use Chrome" notice instead of failing mid-export.
- Firefox: not a target; same feature-detect path.

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Rare codec variant cannot be decoded | Preflight on load blocks early with a clear message; ffmpeg.wasm fallback is a documented future option |
| Rotated phone videos export wrong orientation | Bake rotation in export; dedicated e2e fixture and assertion |
| 4K/60fps source is slow to encode | Default `whatsapp` preset downscales to 720p/30fps; sequential export; progress UI |
| Computed bitrate still exceeds 16MB at clamp floor | Estimated size shown before export; `small` preset available; not hidden |
| WebCodecs quirks during long encodes | Cancel support; per-clip retry; errors surfaced |
| Photo library not directly accessible in browser | Drag-out from Photos works as file drop; README documents it |

## 13. Success criteria (definition of done)

1. Load iPhone HEVC (incl. rotated portrait) and Android H.264 videos in Chrome on
   macOS without errors; unsupported codecs produce a clear message instead.
2. 80s video auto-splits to 30/30/20; handles drag independently; gaps/overlaps are
   visible; clamps hold under abusive dragging.
3. Numeric fields, keyboard nudges, split/delete/reset, and zoom all work.
4. A 30s clip exports as a valid MP4 with correct orientation and audio, ≤16MB in
   the default preset, playable in QuickTime and accepted by WhatsApp Status.
5. Export all produces a correctly named, ordered ZIP.
6. `pnpm check`, `pnpm lint`, `pnpm test` (unit + e2e) pass.
7. README covers setup, usage, and the manual smoke checklist.

## 14. Future ideas (explicitly out of scope)

- ffmpeg.wasm fallback for undecodable inputs.
- PWA/mobile version with direct native sharing.
- Crop to 9:16 / vertical reframing.
- Persistence (recent projects, segment layouts) via IndexedDB.
- Scene-aware split suggestions.
- Batch queue for multiple files.
