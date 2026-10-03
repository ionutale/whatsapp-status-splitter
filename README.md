# WhatsApp Status Splitter

Splits a video — or a batch of videos — into independent, trimmable clips of at
most 30 seconds (configurable) and exports MP4s ready for WhatsApp Status.
Everything runs in your browser: video is decoded and re-encoded on-device with
[WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) and
[Mediabunny](https://mediabunny.dev/). Nothing is uploaded, and there is no
server, database, or account.

**Try it live:** <https://whatsapp-status-splitter.vercel.app>

![WhatsApp Status Splitter: an 80-second video split into 30s/30s/20s clips on
one timeline, with per-clip export](docs/screenshot.png)

## Highlights

- **One timeline, independent clips** — an 80s video auto-splits into
  30s/30s/20s; every clip has its own handles, numeric fields, and keyboard
  nudging. Gaps and overlaps are allowed and clearly marked.
- **WhatsApp-ready by default** — the WhatsApp preset targets **≤16MB** per clip
  (adaptive 800–6000 kbps, 720p/30fps cap, 128 kbps AAC) and bakes phone
  rotation into the pixels. Silent sources export as valid video-only MP4s.
- **Optional 9:16 center-crop** for full-screen statuses.
- **Batch queue** — select several videos at once and get one
  `status_batch.zip`, with a folder per video.
- **Compatibility mode** — videos Chrome can't read (old AVI/MOV, an
  undecodable codec, …) are locally transcoded with ffmpeg.wasm, then handled
  normally.
- **Remembers your work** — settings persist, and each file's clip layout comes
  back when you load it again (localStorage; nothing leaves the machine).
- **Installable PWA with offline support** — add it to your home screen; after
  one online visit the app shell and assets are cached and it opens without a
  network connection.

## Quick start

```sh
pnpm install
pnpm dev
```

Open the URL Vite prints (usually <http://localhost:5173>). For a production
build:

```sh
pnpm build     # static output in build/ (index.html is the SPA fallback)
pnpm preview   # serve the built output locally
```

**Requirements:** Node 20+, [pnpm](https://pnpm.io/), and a
[WebCodecs](https://caniuse.com/webcodecs)-capable browser — Google Chrome is
the supported target.

## Usage

1. **Load a video** — drag one onto the drop zone, click to choose a file, or
   drag straight out of the macOS Photos app. Selecting or dropping **two or
   more** files enters [batch mode](#batch-mode) instead.
2. **Split** — clips are auto-split to at most the **max clip length** (30s
   default, 1–300s). Change it and press **Reset to auto-split** to re-split.
3. **Trim** — drag clip handles, type exact values, or focus a handle with
   **Tab** and nudge it with **←/→** (0.1s) or **Shift+←/→** (1s).
4. **Edit** — **Split in half** the selected clip, **Delete** it, or **Reset to
   auto-split** to discard manual edits.
5. **Export** — **Download** one clip, **Share** it via the macOS share sheet
   (directly to WhatsApp / AirDrop), or **Export all (ZIP)**. Clips encode
   sequentially with live progress, cancel, and retry.

Exports can optionally be center-cropped to 9:16 for full-screen statuses
(toggle in the export panel).

## Limits & presets

| Constraint         | Value                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Max clip length    | Default **30s**, configurable **1–300s**                                                 |
| Min clip length    | **0.5s**                                                                                 |
| WhatsApp file size | Target **≤16MB** (encodes to ~15MB with headroom)                                        |
| Supported input    | Any codec WebCodecs can decode, or convert via [compatibility mode](#compatibility-mode) |

| Preset               | Resolution | Frame rate | Video bitrate           | Audio    | Size target |
| -------------------- | ---------- | ---------- | ----------------------- | -------- | ----------- |
| **WhatsApp (≤16MB)** | 720p cap   | 30fps cap  | adaptive, 800–6000 kbps | 128 kbps | ≤16MB       |
| **High quality**     | 1080p cap  | 60fps cap  | 8000 kbps               | 192 kbps | —           |
| **Small file**       | 480p cap   | 30fps cap  | adaptive, 400–3000 kbps | 96 kbps  | ≤16MB       |

The 30s default comes from the classic WhatsApp Status limit. Newer WhatsApp
versions may accept 60–90s clips, so the max clip length is configurable up to
300s — the preset still targets ≤16MB per clip.

## Batch mode

Selecting or dropping **two or more videos at once** opens a **batch queue**
instead of the editor. Press **Start** — nothing runs until you do. Each file is
read, auto-split with the current settings, and encoded sequentially, one file
at a time. Completed files land in **one ZIP** (`status_batch.zip`) under
`<name>/<name>_partNN.mp4`; if every file fails, nothing is downloaded.

- **Sequential, not parallel:** a batch takes as long as the sum of its files.
- **Held in memory:** peak memory is roughly 2× the total encoded size while the
  ZIP assembles — fine for phone-sized videos, not for a big batch of long
  clips.
- **Unreadable files fail alone** (with the reason); batch mode has no
  compatibility mode — open that file individually instead.
- **Cancel** stops after the clip currently encoding and discards the partial
  ZIP; finished files stay **Done**.

## Compatibility mode

When a video can't be loaded normally — the container is unreadable **or** its
codec can't be decoded (e.g. HEVC on some Chrome installs) — the app offers
**compatibility mode**: a local transcode to standard H.264/AAC MP4 via
[ffmpeg.wasm](https://ffmpegwasm.netlify.app/), then the normal split/export
pipeline.

- **Single-threaded by design** (no COOP/COEP headers needed) and therefore
  **slow on long videos** — a minute of footage can take minutes.
- **Served by the app itself:** the ffmpeg core wasm (~31MB) is bundled and
  downloaded once on first use. Nothing is uploaded.
- **Cancel** works mid-conversion, including while the core downloads.

## Install as an app

The app is installable as a PWA — no store, no account.

- **Desktop Chrome** — click the install icon in the address bar.
- **Android Chrome** — browser menu → **Install app**.
- **iPhone / iPad** — Safari → **Share** → **Add to Home Screen**.

Installing does not widen the supported processing target (Chrome on macOS);
every iOS browser is WebKit, so on iPhones expect the in-app browser-support
notice. WebCodecs requires a secure context, so LAN testing from a phone needs
HTTPS — this repo ships an opt-in self-signed HTTPS dev server:

```sh
HTTPS_DEV=1 ./node_modules/.bin/vite dev --port 5180 --strictPort --host
# then open https://<your-lan-ip>:5180/ on the phone and accept the cert warning
```

### Offline

A service worker ships in the production build only (never in dev). After one
online visit it caches the app shell and build assets, so the app opens and runs
without a network connection. Updates are picked up on the next online load
after a deploy. Compatibility mode's ffmpeg core (~31MB) downloads on first
online use and is then cached too.

## Browser support

- **Chrome on macOS** is the supported target.
- **Safari / Firefox** are not a supported path. When a file's codec can't be
  decoded, the app offers [compatibility mode](#compatibility-mode); the check
  is codec-level and programmatic, so Chrome can hit it too.

## Privacy

There is no backend: files never leave your machine, nothing is uploaded, and
the app works fully offline once loaded. The only persisted state is your
settings and clip layouts in `localStorage`.

## Development

```sh
pnpm test:unit -- --run   # Vitest: Node unit project + Chromium browser project
pnpm test:e2e             # Playwright end-to-end (Chromium, dev server)
pnpm test:e2e:build       # Playwright against a production build + preview server
pnpm check                # svelte-check + TypeScript
pnpm lint                 # Prettier + ESLint
```

`pnpm test` runs the unit suite plus dev-mode e2e in one go. Fixtures live in
`static/test-fixtures/` (tiny synthetic MP4s) and can be regenerated with
`bash static/test-fixtures/generate.sh` (needs ffmpeg). The README screenshot is
regenerable too, with a dev server running:

```sh
node scripts/screenshot.mjs   # refreshes docs/screenshot.png (dark hero) + light/dark variants
```

Automated tests use synthetic fixtures. Real-phone validation is still a manual
smoke pass: load an iPhone HEVC clip, trim, export, and confirm **≤16MB** and
successful **WhatsApp Status upload**; a rotated source must export upright.

### Project layout

```
src/
├─ routes/                 # SvelteKit page + layout
└─ lib/
   ├─ domain/              # Pure logic: segments, timeline math, bitrate/presets, naming, formatting
   ├─ media/               # Browser I/O: inspect, thumbnails, export/encode, zip, download, share
   ├─ state/               # Svelte 5 runes stores: project + export + batch
   └─ components/          # UI: drop zone, timeline, segment bar/panel, preview, export/batch panels
```

## Roadmap

- Mobile-first layout and touch interactions for the editor.

## License

[MIT](LICENSE)
