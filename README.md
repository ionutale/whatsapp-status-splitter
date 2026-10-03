# WhatsApp Status Splitter

Splits one video — or a batch of videos — into independent, trimmable clips of
≤30s and exports WhatsApp-Status-ready MP4s — entirely in the browser. Video is decoded and
re-encoded on-device with [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
and [Mediabunny](https://mediabunny.dev/); nothing is uploaded and there is no
server, database, or account.

## Prerequisites

- **Node 20+** and **[pnpm](https://pnpm.io/)**
- **Google Chrome on macOS** — the supported target, because it provides
  WebCodecs. Safari and Firefox show an in-app notice when a file's codec can't
  be decoded and point you at Chrome.
- **ffmpeg** — only needed if you want to regenerate the test fixtures
  (`brew install ffmpeg`).

## Setup / run

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite (usually <http://localhost:5173>). For a
production build:

```sh
pnpm build     # static output in build/, with build/index.html as the SPA fallback
pnpm preview   # serve the built output locally
```

## Install as an app

The app is installable as a PWA — no store, no account. Installation is a
convenience (home-screen icon, standalone window); it does **not** widen the
supported processing target, which stays **Chrome on macOS** (see
[Browser support](#browser-support)):

- **Desktop Chrome** — click the install icon in the address bar. This is the
  supported processing path.
- **Android Chrome** — open the browser menu, then tap **Install app**. Chrome
  for Android also ships WebCodecs, but phone processing is untested and not
  supported.
- **iPhone / iPad** — open the site in Safari, tap **Share**, then **Add to Home
  Screen**. Every iOS browser is WebKit, so the in-app browser-support notice
  still applies; iOS is not a supported processing path.

There is **no service worker and no offline mode**: the page must load from the
network each time and nothing is cached between visits.

## Usage

1. **Load a video** — drag one onto the drop zone, click to choose a file, or
   drag a video straight out of the macOS Photos app into the page (it arrives
   as a normal file drop). Loading another replaces the current project.
   Selecting or dropping **two or more** files at once enters
   [batch mode](#batch-mode) instead.
2. **Split** — the video is auto-split into equal clips of at most the max clip
   length. Change **Max clip length** and press **Reset to auto-split** to
   re-split.
3. **Trim** — drag a clip's handles, type exact values into the numeric start /
   end / duration fields, or focus a handle with **Tab** and nudge it with
   **←/→** (0.1s) or **Shift+←/→** (1s).
4. **Edit clips** — **Split in half** the selected clip at its midpoint,
   **Delete** it, or **Reset to auto-split** to discard manual edits.
5. **Export** — **Download** an individual clip, **Share** it via the macOS
   share sheet (directly to WhatsApp / AirDrop), or **Export all (ZIP)** to get
   every clip in one archive. Clips are encoded sequentially with live progress,
   cancel, and retry.

Exports can optionally be center-cropped to 9:16 for full-screen statuses
(toggle in the export panel).

### Batch mode

Selecting or dropping **two or more videos at once** (the picker accepts
multiple files) opens a **batch queue** instead of the editor. Press **Start**
to process them — nothing runs until you do. Each file is read, auto-split with
the current **max clip length**, and encoded with the current **preset** and
**9:16 crop** setting, sequentially, one file at a time. When at least one file
completes you get **one ZIP** (`status_batch.zip`) containing each completed
file's parts under its own folder (`<name>/<name>_partNN.mp4`); if every file
fails, nothing is downloaded.

- **Sequential, not parallel:** one clip is encoded at a time, so a batch takes
  as long as the sum of its files — slower than processing them one by one.
- **Held in memory:** all encoded parts stay in memory until the ZIP is
  assembled — peak memory is roughly 2× the total encoded size during assembly
  (parts plus archive). Fine for phone-sized videos; not intended for a large
  batch of long clips.
- **Unreadable files fail alone:** a file that can't be read is marked **failed**
  with the reason and the rest of the queue continues. Batch mode has no
  compatibility mode — open that file individually to convert it.
- **Cancel** stops after the clip currently encoding and discards the partial
  ZIP (no partial download). Files that already finished stay **Done**; the
  rest return to **Queued**.

Batch mode never touches the editor: the single-file editor state is left
exactly as it was.

Settings and the clip layouts of your most recent files are remembered locally
(localStorage); nothing leaves the machine.

## Limits & presets

Global constraints:

| Constraint         | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Max clip length    | Default **30s**, configurable **1–300s**                               |
| Min clip length    | **0.5s**                                                               |
| WhatsApp file size | Target **≤16MB** (encodes to ~15MB with headroom)                      |
| Supported input    | One video at a time (or a batch queue); any codec WebCodecs can decode |

Quality presets:

| Preset               | Resolution | Frame rate | Video bitrate           | Audio    | Size target |
| -------------------- | ---------- | ---------- | ----------------------- | -------- | ----------- |
| **WhatsApp (≤16MB)** | 720p cap   | 30fps cap  | adaptive, 800–6000 kbps | 128 kbps | ≤16MB       |
| **High quality**     | 1080p cap  | 60fps cap  | 8000 kbps               | 192 kbps | —           |
| **Small file**       | 480p cap   | 30fps cap  | adaptive, 400–3000 kbps | 96 kbps  | ≤16MB       |

The 30s default comes from the classic WhatsApp Status limit. Newer WhatsApp
versions may accept 60–90s clips, so the max clip length is configurable up to
300s — the preset still targets ≤16MB per clip.

## Browser support

- **Chrome on macOS** is the supported target.
- **Safari / Firefox** are not a supported path. When a file's codec can't be
  decoded, the app offers the same on-device [compatibility
  mode](#compatibility-mode) (a local transcode to H.264/AAC MP4). This is a
  codec-level, programmatic check, so Chrome on macOS can hit it too.

## Compatibility mode

When the app can't load a video normally — the browser rejects the container
(e.g. an old AVI or MOV) **or** it parses the container but cannot decode the
codec (e.g. HEVC on Windows Chrome) — it offers **compatibility mode**: a local,
on-device transcode to a standard H.264/AAC MP4 via
[ffmpeg.wasm](https://ffmpegwasm.netlify.app/), which is then loaded through the
normal split/export pipeline.

- **When it triggers:** only when the initial file read fails or its codec can't
  be decoded. Videos that load normally never touch it.
- **Single-threaded by design:** the single-thread `@ffmpeg/core` is used (no
  COOP/COEP headers, no multi-thread build). It is **slow on long videos** — a
  minute of phone footage can take several minutes to convert.
- **Served by the app itself:** the ffmpeg core wasm (~31MB) is bundled and
  served by this app, so the first use downloads it once. **Nothing is uploaded
  elsewhere** — the transcode happens entirely on your machine.
- **Cancel:** you can cancel mid-conversion (including while the core is still
  downloading); nothing is loaded until the converted file is ready.

## Testing

```sh
pnpm test:unit -- --run   # Vitest: Node unit project + Chromium browser project
pnpm test:e2e             # Playwright end-to-end (Chromium, dev server)
pnpm test:e2e:build       # Playwright against a production build + preview server
pnpm check                # svelte-check + TypeScript
pnpm lint                 # Prettier + ESLint
```

`pnpm test` runs the unit suite plus dev-mode e2e in one go. `pnpm test:e2e`
first runs `playwright install chromium`, so run it once on a fresh clone;
`pnpm test:e2e:build` assumes Chromium is already installed and skips that step.

Fixtures live in `static/test-fixtures/` (tiny synthetic MP4s) and can be
regenerated with ffmpeg:

```sh
bash static/test-fixtures/generate.sh
```

The rotated fixture is produced with `-display_rotation -90`: ffmpeg and
Mediabunny use opposite rotation conventions, and the script comment explains
why the sign is flipped. Because the fixtures live under `static/`, they
(including `generate.sh`) are copied into `build/` by `pnpm build` — expected,
about 650 KB.

## Manual smoke checklist

Automated tests use synthetic fixtures; real phone video is the only way to
validate true WhatsApp-Status acceptance. Run `pnpm dev`, then walk through:

- [ ] **Load** a real **iPhone HEVC portrait** video (ideally rotated and/or 4K)
      without errors.
- [ ] **Load** an **Android H.264** video without errors.
- [ ] **Load** a **macOS screen recording** without errors.
- [ ] **Auto-split** looks right (equal chunks, no slivers).
- [ ] **Trim** by dragging handles and by typing numeric values; both agree.
- [ ] **Export** a clip with the default **WhatsApp** preset.
- [ ] Exported file is **≤16MB**.
- [ ] Exported file **plays in QuickTime**.
- [ ] Exported file **uploads to WhatsApp Status**.
- [ ] A **rotated** source exports **upright**.
- [ ] **Load** a video Chrome cannot decode (e.g. an old AVI) → **compatibility
      mode** converts it → it **splits and exports**.
- [ ] **Batch mode:** select **two real videos at once** → **Start** → one
      `status_batch.zip` with a folder per file; a corrupt file fails alone and
      the rest of the queue still completes.

## Project layout

```
src/
├─ routes/                 # SvelteKit page + layout
└─ lib/
   ├─ domain/              # Pure logic: segments, timeline math, bitrate/presets, naming, formatting
   ├─ media/               # Browser I/O: inspect, thumbnails, export/encode, zip, download, share
   ├─ state/               # Svelte 5 runes stores: project + export + batch
   └─ components/          # UI: drop zone, timeline, segment bar/panel, preview, export/batch panels
```

## Non-goals

- No server, database, auth, or uploads.
- No arbitrary cropping/aspect-ratio changes (the only crop is the optional 9:16 center-crop), filters, music, watermarks, subtitles, or speed changes.
- No scene/silence-based auto-splitting — equal chunks plus manual handles only.
- No drag-to-reorder; clip order always follows timeline order.
- No offline mode — installable as a PWA, but there is no service worker.
- No multi-file _editing_ — batch mode only queues whole files and splits each
  independently; the editor still edits one video at a time.
