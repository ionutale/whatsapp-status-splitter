# WhatsApp Status Splitter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local browser app that loads one video, splits it into a shared timeline of independently trimmable ≤30s clips, and exports WhatsApp-ready MP4s (individually, as a ZIP, or via the OS share sheet).

**Architecture:** Pure client-side SvelteKit SPA (Svelte 5 runes, adapter-static, `ssr=false`). All media work happens in-browser through Mediabunny/WebCodecs: inspection, filmstrip thumbnails, and per-clip transcoding with `Conversion` `trim` ranges. Pure domain functions (segments, bitrate, formatting, timeline math) carry the logic and are unit-tested; UI components are thin; the export queue is tested with an injected fake encoder.

**Tech Stack:** SvelteKit + Svelte 5 + TypeScript (strict), Tailwind CSS + DaisyUI, Vite, Vitest (node + browser projects), Playwright (Chromium), pnpm, Mediabunny, `@mediabunny/aac-encoder`, `client-zip`, plus `fflate` (dev-only dependency, used to inspect ZIP contents in e2e).

**Spec:** `docs/superpowers/specs/2026-10-03-whatsapp-status-splitter-design.md`

## Global Constraints

- pnpm only; never npm. All commands run from the project root `whatsapp-status-splitter/`.
- Svelte 5 runes syntax (`$state`, `$derived`, `$effect`, `$props`); TypeScript strict; `pnpm check` must stay clean.
- No backend, no network calls, no uploads. Everything runs locally in the browser.
- Target browser: Chrome on macOS. If WebCodecs is unavailable, show a notice instead of failing mid-export.
- Default max clip length 30s (UI input range 1–300s). Minimum clip length 0.5s (never blocks a whole short video).
- Quality presets (exact values):
  - `whatsapp` (default): resolution cap 720, fps cap 30, bitrate target 15 MiB auto (clamp 800–6000 kbps), audio AAC 128 kbps.
  - `high`: resolution cap 1080, fps cap 60, fixed 8000 kbps, audio AAC 192 kbps.
  - `small`: resolution cap 480, fps cap 30, bitrate target 15 MiB auto (clamp 400–3000 kbps), audio AAC 96 kbps.
  - "Resolution cap" caps the **shorter** side; both output dimensions must be even (H.264).
- Output naming: `<base>_partNN.mp4` (zero-padded, timeline order); ZIP name `<base>_parts.zip`; `<base>` is the sanitized file name without extension.
- Ranges are **independent**: dragging a handle never moves another clip; gaps and overlaps are allowed and visibly marked.
- Errors: always `console.error` the original error AND surface a visible message. Never silent success.
- Files stay small and single-purpose (< 500 lines each).
- Git: local commits only (`git init` in Task 1). Never push, never create remotes.

## Review Focus

Five input classes / failure modes the spec implies. Each line's test is pinned to the owning task.

1. **Rotated portrait phone video** (pixels landscape + 90° metadata) — exported clip must render upright everywhere. → Task 6 fixture metadata test, Task 8 browser encode test asserts portrait output, Task 17 e2e #6.
2. **No audio track, or an undecodable audio codec** — must still export a valid video-only MP4; undecodable audio must surface a visible notice, not a failure. → Task 4 (`audioKbps = 0`), Task 7 (`audioDecodable` flag), Task 10 (notice), Task 17 e2e #7.
3. **Odd / non-even source dimensions** — H.264 requires even dimensions; output must be silently rounded to even. → Task 4 `computeOutputSize` unit tests.
4. **Trim range starting mid-GOP** — exported clip must begin at the requested time with real picture (no black lead-in) and duration within tolerance of the requested length. → Task 8 browser test (decodes first frame, checks non-black + duration ± 0.3s), Task 17 e2e #4 (range 1.0–2.5s, duration ≈ 1.5s).
5. **Cancel / retry mid-queue** — cancel must leave no partial downloads and a consistent UI; retry must work after a failure. → Task 9 queue tests with a fake encoder, Task 16 UI states.

---

### Task 1: Scaffold, toolchain, and project setup

**Files:**
- Create: project scaffold (via `sv create`), `src/app.css` (DaisyUI), `src/routes/+layout.ts`, `src/lib/__tests__/unit-smoke.test.ts`, `src/lib/__tests__/browser-smoke.browser.test.ts`
- Modify: `svelte.config.js` (adapter-static), `vite.config.ts` (vitest projects), `package.json` (scripts sanity)

**Interfaces:**
- Consumes: nothing.
- Produces: a working SvelteKit project where `pnpm check`, `pnpm lint`, `pnpm test:unit -- --run`, and `pnpm test:e2e` all run; unit tests run in Node, `*.browser.test.ts` runs in Chromium with WebCodecs available.

- [ ] **Step 1: Scaffold the project**

The directory already contains `docs/`, so `--force` is required.

```bash
cd /Users/ionutale/developer-playground/whatsapp-status-splitter
pnpm dlx sv create --template minimal --types ts --add prettier eslint vitest="usages:unit,component" playwright tailwindcss="plugins:typography,forms" sveltekit-adapter="adapter:static" --install pnpm . --force
```

- [ ] **Step 2: Add dependencies**

```bash
pnpm add mediabunny @mediabunny/aac-encoder client-zip
pnpm add -D fflate
pnpm exec playwright install chromium
```

- [ ] **Step 3: Configure static SPA output**

`svelte.config.js` must use adapter-static with a fallback:

```js
import adapter from '@sveltejs/adapter-static';

const config = {
  kit: {
    adapter: adapter({ fallback: 'index.html' })
  }
};

export default config;
```

Create `src/routes/+layout.ts`:

```ts
export const ssr = false;
```

- [ ] **Step 4: Wire DaisyUI**

Find the CSS file the tailwindcss addon generated (imported from `src/routes/+layout.svelte`, typically `src/app.css`) and set its contents to:

```css
@import 'tailwindcss';
@plugin 'daisyui';
```

If no CSS file exists, create `src/app.css` and import it at the top of `+layout.svelte`.

- [ ] **Step 5: Configure Vitest projects**

Open `vite.config.ts`. Keep the generated `test` setup but ensure it defines exactly two projects:

- node project `unit`: `include: ['src/**/*.test.ts']`, `exclude: ['src/**/*.browser.test.ts', 'src/**/*.svelte.test.ts']`, environment `node`.
- browser project `client`: `include: ['src/**/*.browser.test.ts', 'src/**/*.svelte.test.ts']`, browser enabled with the Playwright provider and Chromium instance (from `@vitest/browser-playwright`), as generated by the vitest addon.

If the generated file already separates browser/component tests under different names, keep its structure but make the include/exclude rules match the two bullets above.

- [ ] **Step 6: Add smoke tests and verify the toolchain**

Create `src/lib/__tests__/unit-smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('unit toolchain', () => {
  it('runs in node without DOM', () => {
    expect(typeof document).toBe('undefined');
  });
});
```

Create `src/lib/__tests__/browser-smoke.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('browser toolchain', () => {
  it('has WebCodecs available', () => {
    expect(typeof VideoEncoder).toBe('function');
    expect(typeof VideoDecoder).toBe('function');
    expect(typeof AudioEncoder).toBe('function');
  });
});
```

Run:

```bash
pnpm check
pnpm lint
pnpm test:unit -- --run
```

Expected: all pass, and the browser smoke test executes in Chromium (not Node).

- [ ] **Step 7: Initialize git and commit**

```bash
git init -b main
git add -A
git commit -m "chore: scaffold SvelteKit SPA with vitest browser projects"
```

---

### Task 2: Domain — clock formatting and file naming

**Files:**
- Create: `src/lib/domain/format.ts`, `src/lib/domain/naming.ts`, `src/lib/domain/format.test.ts`, `src/lib/domain/naming.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `formatClock(seconds: number): string` — `MM:SS.d`, or `H:MM:SS.d` when ≥ 1 hour.
  - `parseClock(input: string): number | null` — accepts `SS.d`, `MM:SS.d`, `H:MM:SS.d` (decimals optional, more decimals allowed); rejects negatives and malformed strings.
  - `sanitizeBaseName(fileName: string): string` — strips the extension, replaces anything outside `[A-Za-z0-9_-]` with `_`, collapses repeats, never returns empty (falls back to `video`).
  - `clipFileName(base: string, index: number): string` → `${base}_part01.mp4` (zero-padded to 2).
  - `zipFileName(base: string): string` → `${base}_parts.zip`.

- [ ] **Step 1: Write the failing tests**

`src/lib/domain/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatClock, parseClock } from './format';

describe('formatClock', () => {
  it('formats sub-minute values', () => {
    expect(formatClock(0)).toBe('00:00.0');
    expect(formatClock(12.34)).toBe('00:12.3');
  });
  it('formats minutes', () => {
    expect(formatClock(72.05)).toBe('01:12.1');
  });
  it('formats hours', () => {
    expect(formatClock(3723.5)).toBe('1:02:03.5');
  });
});

describe('parseClock', () => {
  it('round-trips formatClock output', () => {
    for (const t of [0, 12.3, 72.1, 3723.5]) {
      expect(parseClock(formatClock(t))).toBeCloseTo(t, 1);
    }
  });
  it('accepts plain seconds', () => {
    expect(parseClock('83')).toBe(83);
    expect(parseClock('12.5')).toBe(12.5);
  });
  it('rejects malformed input', () => {
    expect(parseClock('abc')).toBeNull();
    expect(parseClock('1:2:3:4')).toBeNull();
    expect(parseClock('-5')).toBeNull();
    expect(parseClock('')).toBeNull();
  });
});
```

`src/lib/domain/naming.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clipFileName, sanitizeBaseName, zipFileName } from './naming';

describe('sanitizeBaseName', () => {
  it('strips extension and unsafe characters', () => {
    expect(sanitizeBaseName('IMG 1234.MOV')).toBe('IMG_1234');
    expect(sanitizeBaseName('a//b??.mp4')).toBe('a_b');
  });
  it('never returns empty', () => {
    expect(sanitizeBaseName('.mp4')).toBe('video');
  });
});

describe('clipFileName', () => {
  it('zero-pads the part index', () => {
    expect(clipFileName('vid', 0)).toBe('vid_part01.mp4');
    expect(clipFileName('vid', 11)).toBe('vid_part12.mp4');
  });
});

describe('zipFileName', () => {
  it('appends _parts', () => {
    expect(zipFileName('vid')).toBe('vid_parts.zip');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- --run src/lib/domain/format.test.ts src/lib/domain/naming.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement**

`src/lib/domain/format.ts`:

```ts
const pad = (n: number) => String(n).padStart(2, '0');

export function formatClock(seconds: number): string {
  const decis = Math.round(Math.abs(seconds) * 10);
  const d = decis % 10;
  const totalSeconds = Math.floor(decis / 10);
  const sec = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const min = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const base = `${pad(min)}:${pad(sec)}.${d}`;
  return hours > 0 ? `${hours}:${base}` : base;
}

export function parseClock(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(:\d+){0,2}(\.\d+)?$/.test(trimmed)) return null;
  const parts = trimmed.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  const seconds = parts.reduce((acc, part) => acc * 60 + part, 0);
  return seconds;
}
```

`src/lib/domain/naming.ts`:

```ts
export function sanitizeBaseName(fileName: string): string {
  const withoutExt = fileName.replace(/\.[^.]*$/, '');
  const cleaned = withoutExt
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return cleaned || 'video';
}

export function clipFileName(base: string, index: number): string {
  return `${base}_part${String(index + 1).padStart(2, '0')}.mp4`;
}

export function zipFileName(base: string): string {
  return `${base}_parts.zip`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- --run src/lib/domain/format.test.ts src/lib/domain/naming.test.ts`
Expected: PASS (all cases above).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/format.ts src/lib/domain/format.test.ts src/lib/domain/naming.ts src/lib/domain/naming.test.ts
git commit -m "feat: clock formatting and output file naming"
```

---

### Task 3: Domain — segments (auto-split, clamping, coverage)

**Files:**
- Create: `src/lib/domain/segments.ts`, `src/lib/domain/segments.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Segment = { id: string; start: number; end: number }`, `type Interval = { start: number; end: number }`
  - `MIN_CLIP_DURATION = 0.5`
  - `type ClampOpts = { duration: number; maxClipDuration: number; minClipDuration?: number }`
  - `newSegmentId(): string`
  - `sortSegments(segments: Segment[]): Segment[]` (new array, by start then end)
  - `autoSplit(duration: number, maxClipDuration: number): Segment[]`
  - `clampSegment(segment: Segment, opts: ClampOpts, moved?: 'start' | 'end'): Segment` (default `'end'`)
  - `nudge(segment: Segment, edge: 'start' | 'end', delta: number, opts: ClampOpts): Segment`
  - `setField(segment: Segment, field: 'start' | 'end' | 'duration', value: number, opts: ClampOpts): Segment`
  - `splitInHalf(segment: Segment, opts: ClampOpts): [Segment, Segment] | null` (null when length < 2 × min)
  - `computeCoverage(segments: Segment[], duration: number): { gaps: Interval[]; overlaps: Interval[] }`

- [ ] **Step 1: Write the failing tests**

`src/lib/domain/segments.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  MIN_CLIP_DURATION,
  autoSplit,
  clampSegment,
  computeCoverage,
  nudge,
  setField,
  splitInHalf,
  type Segment,
} from './segments';

const seg = (start: number, end: number): Segment => ({ id: 'x', start, end });
const times = (list: Segment[]) => list.map((s) => [s.start, s.end]);
const opts = { duration: 80, maxClipDuration: 30 };

describe('autoSplit', () => {
  it('splits 80s into 30/30/20', () => {
    expect(times(autoSplit(80, 30))).toEqual([[0, 30], [30, 60], [60, 80]]);
  });
  it('handles exact multiples without zero-length clips', () => {
    expect(times(autoSplit(60, 30))).toEqual([[0, 30], [30, 60]]);
  });
  it('keeps short videos as one clip', () => {
    expect(times(autoSplit(20, 30))).toEqual([[0, 20]]);
  });
  it('allows a single clip shorter than the minimum', () => {
    expect(times(autoSplit(0.3, 30))).toEqual([[0, 0.3]]);
  });
  it('returns nothing for non-positive duration', () => {
    expect(autoSplit(0, 30)).toEqual([]);
  });
});

describe('clampSegment', () => {
  it('clamps the end to the video duration', () => {
    expect(times([clampSegment(seg(60, 95), opts, 'end')])).toEqual([[60, 80]]);
  });
  it('caps the length at maxClipDuration when dragging the end', () => {
    expect(times([clampSegment(seg(0, 40), opts, 'end')])).toEqual([[0, 30]]);
  });
  it('caps the length at maxClipDuration when dragging the start left', () => {
    expect(times([clampSegment(seg(20, 60), opts, 'start')])).toEqual([[30, 60]]);
  });
  it('enforces the minimum when dragging the start right', () => {
    expect(times([clampSegment(seg(29.9, 30), opts, 'start')])).toEqual([[29.5, 30]]);
  });
  it('enforces the minimum when dragging the end left', () => {
    expect(times([clampSegment(seg(0, 0.4), opts, 'end')])).toEqual([[0, 0.5]]);
  });
  it('never lets start go below zero', () => {
    expect(times([clampSegment(seg(-5, 10), opts, 'start')])).toEqual([[0, 10]]);
  });
  it('lets the min win when the video is shorter than the min', () => {
    const out = clampSegment(seg(0, 1), { duration: 0.3, maxClipDuration: 30 }, 'end');
    expect(out.end).toBeCloseTo(0.3, 3);
  });
});

describe('nudge', () => {
  it('moves the requested edge by the delta', () => {
    expect(nudge(seg(10, 20), 'start', 0.1, opts).start).toBeCloseTo(10.1, 3);
    expect(nudge(seg(10, 20), 'end', 1, opts).end).toBeCloseTo(21, 3);
  });
  it('clamps at the boundary', () => {
    expect(nudge(seg(0, 20), 'start', -1, opts).start).toBe(0);
  });
});

describe('setField', () => {
  it('sets end directly', () => {
    expect(setField(seg(10, 20), 'end', 25, opts).end).toBe(25);
  });
  it('sets duration by moving the end', () => {
    const out = setField(seg(10, 20), 'duration', 5, opts);
    expect(out.start).toBeCloseTo(10, 3);
    expect(out.end).toBeCloseTo(15, 3);
  });
});

describe('splitInHalf', () => {
  it('splits at the midpoint', () => {
    const out = splitInHalf(seg(10, 20), opts);
    expect(out).not.toBeNull();
    expect(times(out!)).toEqual([[10, 15], [15, 20]]);
  });
  it('refuses when shorter than 2x the minimum', () => {
    expect(splitInHalf(seg(10, 10.9), opts)).toBeNull();
  });
});

describe('computeCoverage', () => {
  it('reports no gaps or overlaps for contiguous clips', () => {
    const out = computeCoverage([seg(30, 60), seg(0, 30), seg(60, 80)], 80);
    expect(out.gaps).toEqual([]);
    expect(out.overlaps).toEqual([]);
  });
  it('finds a gap', () => {
    const out = computeCoverage([seg(0, 30), seg(35, 80)], 80);
    expect(out.gaps).toEqual([{ start: 30, end: 35 }]);
  });
  it('finds overlapping and nested regions', () => {
    const out = computeCoverage([seg(0, 10), seg(2, 4), seg(6, 12)], 12);
    expect(out.overlaps).toEqual([
      { start: 2, end: 4 },
      { start: 6, end: 10 },
    ]);
  });
  it('finds a trailing gap', () => {
    const out = computeCoverage([seg(0, 60)], 80);
    expect(out.gaps).toEqual([{ start: 60, end: 80 }]);
  });
});

describe('constants', () => {
  it('minimum is 0.5s', () => {
    expect(MIN_CLIP_DURATION).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- --run src/lib/domain/segments.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

`src/lib/domain/segments.ts`:

```ts
export type Segment = { id: string; start: number; end: number };
export type Interval = { start: number; end: number };

export const MIN_CLIP_DURATION = 0.5;
const EPS = 1e-3;

const roundMs = (value: number) => Math.round(value * 1000) / 1000;
const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export type ClampOpts = {
  duration: number;
  maxClipDuration: number;
  minClipDuration?: number;
};

export const newSegmentId = (): string => crypto.randomUUID();

export function sortSegments(segments: Segment[]): Segment[] {
  return [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
}

export function autoSplit(duration: number, maxClipDuration: number): Segment[] {
  if (duration <= 0) return [];
  const max = Math.max(1, maxClipDuration);
  const out: Segment[] = [];
  let cursor = 0;
  while (cursor < duration - EPS) {
    const end = Math.min(cursor + max, duration);
    out.push({ id: newSegmentId(), start: roundMs(cursor), end: roundMs(end) });
    cursor = end;
  }
  return out;
}

export function clampSegment(
  segment: Segment,
  opts: ClampOpts,
  moved: 'start' | 'end' = 'end'
): Segment {
  const duration = Math.max(0, opts.duration);
  const min = Math.min(opts.minClipDuration ?? MIN_CLIP_DURATION, duration);
  const max = Math.min(Math.max(opts.maxClipDuration, min), duration);

  let start = clampNumber(segment.start, 0, duration);
  let end = clampNumber(segment.end, 0, duration);

  if (moved === 'start') {
    start = clampNumber(start, end - max, end - min);
  } else {
    end = clampNumber(end, start + min, start + max);
  }

  // Final safety pass for inconsistent inputs (e.g. both edges out of order).
  if (end - start < min - EPS) {
    if (moved === 'start') start = end - min;
    else end = start + min;
  }
  start = clampNumber(start, 0, duration);
  end = clampNumber(end, start, duration);

  return { ...segment, start: roundMs(start), end: roundMs(end) };
}

export function nudge(
  segment: Segment,
  edge: 'start' | 'end',
  delta: number,
  opts: ClampOpts
): Segment {
  const moved = { ...segment, [edge]: segment[edge] + delta };
  return clampSegment(moved, opts, edge);
}

export function setField(
  segment: Segment,
  field: 'start' | 'end' | 'duration',
  value: number,
  opts: ClampOpts
): Segment {
  if (field === 'start') return clampSegment({ ...segment, start: value }, opts, 'start');
  if (field === 'end') return clampSegment({ ...segment, end: value }, opts, 'end');
  return clampSegment({ ...segment, end: segment.start + value }, opts, 'end');
}

export function splitInHalf(segment: Segment, opts: ClampOpts): [Segment, Segment] | null {
  const min = opts.minClipDuration ?? MIN_CLIP_DURATION;
  if (segment.end - segment.start < 2 * min - EPS) return null;
  const mid = roundMs((segment.start + segment.end) / 2);
  return [
    { id: newSegmentId(), start: segment.start, end: mid },
    { id: newSegmentId(), start: mid, end: segment.end },
  ];
}

export function computeCoverage(
  segments: Segment[],
  duration: number
): { gaps: Interval[]; overlaps: Interval[] } {
  const sorted = sortSegments(segments).map((s) => ({
    start: clampNumber(s.start, 0, duration),
    end: clampNumber(s.end, 0, duration),
  }));
  const gaps: Interval[] = [];
  const overlaps: Interval[] = [];
  let cursor = 0;
  for (const current of sorted) {
    if (current.start > cursor + EPS) gaps.push({ start: cursor, end: current.start });
    if (current.start < cursor - EPS) {
      overlaps.push({ start: current.start, end: Math.min(cursor, current.end) });
    }
    cursor = Math.max(cursor, current.end);
  }
  if (cursor < duration - EPS) gaps.push({ start: cursor, end: duration });
  return { gaps, overlaps };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- --run src/lib/domain/segments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/segments.ts src/lib/domain/segments.test.ts
git commit -m "feat: pure segment model (auto-split, clamps, coverage)"
```

---

### Task 4: Domain — bitrate, resolution, and output plans

**Files:**
- Create: `src/lib/domain/bitrate.ts`, `src/lib/domain/bitrate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type QualityPreset = 'whatsapp' | 'high' | 'small'`
  - `type VideoMeta = { displayWidth: number; displayHeight: number; rotation: 0 | 90 | 180 | 270; frameRate: number | null; videoCodec: string | null; audioCodec: string | null; hasAudio: boolean; audioDecodable: boolean; videoDecodable: boolean }`
  - `type OutputPlan = { width: number; height: number; frameRate: number; videoKbps: number; audioKbps: number; estimatedBytes: number }`
  - `PRESET_LIMITS: Record<QualityPreset, { resolutionCap: number; fpsCap: number; minKbps: number; maxKbps: number; audioKbps: number; targetBytes: number | null }>`
  - `estimateBitrate(durationSec: number, preset: QualityPreset, hasAudio: boolean): { videoKbps: number; audioKbps: number; estimatedBytes: number }`
  - `computeOutputSize(width: number, height: number, resolutionCap: number): { width: number; height: number }`
  - `buildOutputPlan(durationSec: number, meta: VideoMeta, preset: QualityPreset): OutputPlan`

- [ ] **Step 1: Write the failing tests**

`src/lib/domain/bitrate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildOutputPlan,
  computeOutputSize,
  estimateBitrate,
  type VideoMeta,
} from './bitrate';

const meta = (overrides: Partial<VideoMeta> = {}): VideoMeta => ({
  displayWidth: 1920,
  displayHeight: 1080,
  rotation: 0,
  frameRate: 30,
  videoCodec: 'avc1.42001f',
  audioCodec: 'mp4a.40.2',
  hasAudio: true,
  audioDecodable: true,
  videoDecodable: true,
  ...overrides,
});

describe('estimateBitrate', () => {
  it('targets just under 16MB for a 30s whatsapp clip', () => {
    const { videoKbps, audioKbps, estimatedBytes } = estimateBitrate(30, 'whatsapp', true);
    expect(videoKbps).toBeGreaterThan(3000);
    expect(videoKbps).toBeLessThan(4000);
    expect(audioKbps).toBe(128);
    expect(estimatedBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  });
  it('uses the fixed bitrate for the high preset', () => {
    expect(estimateBitrate(30, 'high', true).videoKbps).toBe(8000);
    expect(estimateBitrate(30, 'high', true).audioKbps).toBe(192);
  });
  it('drops audio budget when there is no audio', () => {
    const { audioKbps } = estimateBitrate(30, 'whatsapp', false);
    expect(audioKbps).toBe(0);
  });
  it('respects the floor and does not hide the size consequence', () => {
    const { videoKbps } = estimateBitrate(500, 'whatsapp', true);
    expect(videoKbps).toBe(800);
  });
});

describe('computeOutputSize', () => {
  it('downscales landscape 1080p to 720p', () => {
    expect(computeOutputSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
  });
  it('downscales portrait 1080x1920 to portrait 720p', () => {
    expect(computeOutputSize(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
  });
  it('downscales 4K to 720p', () => {
    expect(computeOutputSize(3840, 2160, 720)).toEqual({ width: 1280, height: 720 });
  });
  it('keeps smaller videos at their size', () => {
    expect(computeOutputSize(640, 480, 720)).toEqual({ width: 640, height: 480 });
  });
  it('rounds odd dimensions to even', () => {
    expect(computeOutputSize(321, 241, 720)).toEqual({ width: 322, height: 242 });
  });
});

describe('buildOutputPlan', () => {
  it('caps fps at the preset limit', () => {
    expect(buildOutputPlan(10, meta({ frameRate: 120 }), 'whatsapp').frameRate).toBe(30);
    expect(buildOutputPlan(10, meta({ frameRate: 24 }), 'high').frameRate).toBe(24);
  });
  it('falls back to the preset fps when unknown', () => {
    expect(buildOutputPlan(10, meta({ frameRate: null }), 'whatsapp').frameRate).toBe(30);
  });
  it('drops audio when the track is undecodable', () => {
    const plan = buildOutputPlan(30, meta({ audioDecodable: false }), 'whatsapp');
    expect(plan.audioKbps).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- --run src/lib/domain/bitrate.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

`src/lib/domain/bitrate.ts`:

```ts
export type QualityPreset = 'whatsapp' | 'high' | 'small';

export type VideoMeta = {
  displayWidth: number;
  displayHeight: number;
  rotation: 0 | 90 | 180 | 270;
  frameRate: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  audioDecodable: boolean;
  videoDecodable: boolean;
};

export type OutputPlan = {
  width: number;
  height: number;
  frameRate: number;
  videoKbps: number;
  audioKbps: number;
  estimatedBytes: number;
};

export const PRESET_LIMITS: Record<
  QualityPreset,
  {
    resolutionCap: number;
    fpsCap: number;
    minKbps: number;
    maxKbps: number;
    audioKbps: number;
    targetBytes: number | null;
  }
> = {
  whatsapp: {
    resolutionCap: 720,
    fpsCap: 30,
    minKbps: 800,
    maxKbps: 6000,
    audioKbps: 128,
    targetBytes: 15 * 1024 * 1024,
  },
  high: {
    resolutionCap: 1080,
    fpsCap: 60,
    minKbps: 8000,
    maxKbps: 8000,
    audioKbps: 192,
    targetBytes: null,
  },
  small: {
    resolutionCap: 480,
    fpsCap: 30,
    minKbps: 400,
    maxKbps: 3000,
    audioKbps: 96,
    targetBytes: 15 * 1024 * 1024,
  },
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export function estimateBitrate(
  durationSec: number,
  preset: QualityPreset,
  hasAudio: boolean
): { videoKbps: number; audioKbps: number; estimatedBytes: number } {
  const limits = PRESET_LIMITS[preset];
  const audioKbps = hasAudio ? limits.audioKbps : 0;
  let videoKbps = limits.minKbps;

  if (limits.targetBytes !== null && durationSec > 0) {
    const targetKbit = (limits.targetBytes * 8) / 1000;
    const wanted = (targetKbit * 0.92) / durationSec - audioKbps;
    videoKbps = clampNumber(wanted, limits.minKbps, limits.maxKbps);
  }

  const estimatedBytes = Math.round((((videoKbps + audioKbps) * 1000) / 8) * durationSec);
  return { videoKbps, audioKbps, estimatedBytes };
}

export function computeOutputSize(
  width: number,
  height: number,
  resolutionCap: number
): { width: number; height: number } {
  const shortSide = Math.min(width, height);
  const scale = shortSide > resolutionCap ? resolutionCap / shortSide : 1;
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return { width: even(width * scale), height: even(height * scale) };
}

export function buildOutputPlan(
  durationSec: number,
  meta: VideoMeta,
  preset: QualityPreset
): OutputPlan {
  const limits = PRESET_LIMITS[preset];
  const { width, height } = computeOutputSize(meta.displayWidth, meta.displayHeight, limits.resolutionCap);
  const { videoKbps, audioKbps, estimatedBytes } = estimateBitrate(
    durationSec,
    preset,
    meta.hasAudio && meta.audioDecodable
  );
  const sourceFps = meta.frameRate ?? limits.fpsCap;
  return {
    width,
    height,
    frameRate: Math.max(1, Math.min(limits.fpsCap, Math.round(sourceFps))),
    videoKbps,
    audioKbps,
    estimatedBytes,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- --run src/lib/domain/bitrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/bitrate.ts src/lib/domain/bitrate.test.ts
git commit -m "feat: bitrate targeting, resolution capping, output plans"
```

---

### Task 5: Domain — timeline math (ticks and lanes)

**Files:**
- Create: `src/lib/domain/timeline.ts`, `src/lib/domain/timeline.test.ts`

**Interfaces:**
- Consumes: `Segment` from `./segments`.
- Produces:
  - `chooseTickStep(pxPerSecond: number, minPxBetweenTicks?: number): number` (default 60)
  - `generateTicks(durationSec: number, pxPerSecond: number): { time: number; major: boolean }[]` (major tick every 5th step)
  - `assignLanes(segments: Segment[]): number[]` — lane index per input segment; two segments collide only when they overlap (adjacent is fine); greedy first-fit.

- [ ] **Step 1: Write the failing tests**

`src/lib/domain/timeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assignLanes, chooseTickStep, generateTicks } from './timeline';
import type { Segment } from './segments';

const seg = (start: number, end: number): Segment => ({ id: `${start}`, start, end });

describe('chooseTickStep', () => {
  it('picks the smallest step that keeps 60px between ticks', () => {
    expect(chooseTickStep(2)).toBe(30);
    expect(chooseTickStep(10)).toBe(10);
    expect(chooseTickStep(60)).toBe(1);
    expect(chooseTickStep(200)).toBe(0.5);
  });
  it('falls back to the largest step', () => {
    expect(chooseTickStep(0.01)).toBe(300);
  });
});

describe('generateTicks', () => {
  it('generates ticks from 0 to duration', () => {
    const ticks = generateTicks(80, 10);
    expect(ticks.map((t) => t.time)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80]);
  });
  it('marks every fifth tick as major', () => {
    const ticks = generateTicks(80, 10);
    expect(ticks.map((t) => t.major)).toEqual([true, false, false, false, false, true, false, false, false]);
  });
});

describe('assignLanes', () => {
  it('keeps contiguous clips in lane 0', () => {
    expect(assignLanes([seg(0, 30), seg(30, 60), seg(60, 80)])).toEqual([0, 0, 0]);
  });
  it('offsets overlapping clips', () => {
    expect(assignLanes([seg(0, 30), seg(20, 50)])).toEqual([0, 1]);
  });
  it('reuses lanes once free', () => {
    expect(assignLanes([seg(0, 10), seg(5, 15), seg(20, 30)])).toEqual([0, 1, 0]);
  });
  it('handles nested clips', () => {
    expect(assignLanes([seg(0, 30), seg(5, 10)])).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- --run src/lib/domain/timeline.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

`src/lib/domain/timeline.ts`:

```ts
import type { Segment } from './segments';

const TICK_LADDER = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const EPS = 1e-3;

export function chooseTickStep(pxPerSecond: number, minPxBetweenTicks = 60): number {
  for (const step of TICK_LADDER) {
    if (step * pxPerSecond >= minPxBetweenTicks) return step;
  }
  return TICK_LADDER[TICK_LADDER.length - 1];
}

export function generateTicks(
  durationSec: number,
  pxPerSecond: number
): { time: number; major: boolean }[] {
  const step = chooseTickStep(pxPerSecond);
  const ticks: { time: number; major: boolean }[] = [];
  const count = Math.ceil(durationSec / step);
  for (let i = 0; i <= count; i++) {
    const time = Math.min(Math.round(i * step * 1000) / 1000, durationSec);
    ticks.push({ time, major: i % 5 === 0 });
    if (time >= durationSec - EPS) break;
  }
  return ticks;
}

export function assignLanes(segments: Segment[]): number[] {
  const lanes: { start: number; end: number }[][] = [];
  return segments.map((segment) => {
    for (let lane = 0; lane < lanes.length; lane++) {
      const collides = lanes[lane].some(
        (other) => segment.start < other.end - EPS && segment.end > other.start + EPS
      );
      if (!collides) {
        lanes[lane].push({ start: segment.start, end: segment.end });
        return lane;
      }
    }
    lanes.push([{ start: segment.start, end: segment.end }]);
    return lanes.length - 1;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- --run src/lib/domain/timeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/timeline.ts src/lib/domain/timeline.test.ts
git commit -m "feat: timeline tick and lane assignment math"
```

### Task 6: Test fixture videos

**Files:**
- Create: `static/test-fixtures/generate.sh`, `static/test-fixtures/tiny-5s.mp4`, `static/test-fixtures/tiny-noaudio.mp4`, `static/test-fixtures/tiny-portrait-rotated.mp4`, `src/lib/media/fixtures.test.ts`

**Interfaces:**
- Consumes: Mediabunny `Input`/`BufferSource` (works in Node for demuxing — no WebCodecs needed).
- Produces: three committed fixture videos in `static/test-fixtures/` used by browser tests (via `?url` imports) and Playwright (via file path):
  - `tiny-5s.mp4` — 5s, 320×240, 30fps, H.264 + AAC, rotation 0.
  - `tiny-noaudio.mp4` — 3s, 320×240, 30fps, H.264, no audio.
  - `tiny-portrait-rotated.mp4` — copy of `tiny-5s.mp4` with 90° display rotation.

- [ ] **Step 1: Write the fixture generation script**

Create `static/test-fixtures/generate.sh`:

```bash
#!/usr/bin/env bash
# Regenerates the tiny fixture videos used by tests. Requires ffmpeg (brew install ffmpeg).
set -euo pipefail
cd "$(dirname "$0")"

# 5s test pattern with audio: 320x240@30, H.264 + AAC
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=size=320x240:rate=30:duration=5" \
  -f lavfi -i "sine=frequency=440:duration=5" \
  -c:v libx264 -pix_fmt yuv420p -g 30 -c:a aac -b:a 96k -movflags +faststart \
  tiny-5s.mp4

# 3s test pattern without audio
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=size=320x240:rate=30:duration=3" \
  -c:v libx264 -pix_fmt yuv420p -g 30 -an -movflags +faststart \
  tiny-noaudio.mp4

# Same 5s clip with a 90-degree display rotation (simulates portrait phone video).
# Fallback if -display_rotation is unavailable:
#   ffmpeg -y -i tiny-5s.mp4 -c copy -metadata:s:v:0 rotate=90 tiny-portrait-rotated.mp4
ffmpeg -y -hide_banner -loglevel error \
  -display_rotation 90 -i tiny-5s.mp4 -c copy tiny-portrait-rotated.mp4
```

- [ ] **Step 2: Generate the fixtures**

```bash
chmod +x static/test-fixtures/generate.sh
bash static/test-fixtures/generate.sh
ls -la static/test-fixtures/
```

Expected: three small `.mp4` files (each well under 1MB).

- [ ] **Step 3: Write the failing metadata test**

`src/lib/media/fixtures.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';

const readFixture = async (name: string) => {
  const bytes = await readFile(new URL(`../../../static/test-fixtures/${name}`, import.meta.url));
  return new Input({ formats: ALL_FORMATS, source: new BufferSource(new Uint8Array(bytes)) });
};

describe('fixture metadata', () => {
  it('tiny-5s.mp4 is 5s, 320x240, no rotation, with audio', async () => {
    const input = await readFixture('tiny-5s.mp4');
    expect(await input.computeDuration()).toBeCloseTo(5, 0);
    const video = await input.getPrimaryVideoTrack();
    expect(await video!.getDisplayWidth()).toBe(320);
    expect(await video!.getDisplayHeight()).toBe(240);
    expect(await video!.getRotation()).toBe(0);
    expect(await input.getPrimaryAudioTrack()).not.toBeNull();
  });

  it('tiny-portrait-rotated.mp4 carries 90-degree rotation', async () => {
    const input = await readFixture('tiny-portrait-rotated.mp4');
    const video = await input.getPrimaryVideoTrack();
    expect(await video!.getRotation()).toBe(90);
  });

  it('tiny-noaudio.mp4 has no audio track', async () => {
    const input = await readFixture('tiny-noaudio.mp4');
    expect(await input.getPrimaryAudioTrack()).toBeNull();
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test:unit -- --run src/lib/media/fixtures.test.ts`
Expected: PASS. If the rotation test fails, regenerate with the `-metadata:s:v:0 rotate=90` fallback noted in the script and re-run.

- [ ] **Step 5: Commit**

```bash
git add static/test-fixtures src/lib/media/fixtures.test.ts
git commit -m "test: tiny fixture videos + metadata assertions"
```

---

### Task 7: Media — file inspection and decodability preflight

**Files:**
- Create: `src/lib/media/inspect.ts`, `src/lib/media/inspect.browser.test.ts`
- Modify: `src/vite-env.d.ts` (add `/// <reference types="vite/client" />` if `*.mp4?url` imports fail type-checking)

**Interfaces:**
- Consumes: `VideoMeta` from `$lib/domain/bitrate` (Task 4).
- Produces:
  - `class InspectionError extends Error`
  - `inspectFile(file: File): Promise<{ duration: number; meta: VideoMeta }>` — throws `InspectionError` with a friendly message when the file can't be parsed as video; never returns partial data.
  - `assertDecodable(meta: Pick<VideoMeta, 'videoDecodable' | 'videoCodec'>): string | null` — null when ok, otherwise the user-facing message.

- [ ] **Step 1: Write the failing tests**

`src/lib/media/inspect.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import tiny5sUrl from '../../../static/test-fixtures/tiny-5s.mp4?url';
import noAudioUrl from '../../../static/test-fixtures/tiny-noaudio.mp4?url';
import rotatedUrl from '../../../static/test-fixtures/tiny-portrait-rotated.mp4?url';
import { assertDecodable, inspectFile } from './inspect';

async function loadFixture(url: string, name: string): Promise<File> {
  const blob = await (await fetch(url)).blob();
  return new File([blob], name, { type: 'video/mp4' });
}

describe('inspectFile', () => {
  it('reads duration, dimensions, fps and tracks from tiny-5s.mp4', async () => {
    const { duration, meta } = await inspectFile(await loadFixture(tiny5sUrl, 'tiny-5s.mp4'));
    expect(duration).toBeCloseTo(5, 0);
    expect(meta.displayWidth).toBe(320);
    expect(meta.displayHeight).toBe(240);
    expect(meta.rotation).toBe(0);
    expect(meta.hasAudio).toBe(true);
    expect(meta.audioDecodable).toBe(true);
    expect(meta.videoDecodable).toBe(true);
    expect(meta.frameRate).toBeGreaterThan(25);
    expect(meta.videoCodec).toMatch(/^avc/);
  });

  it('reports 90-degree rotation as portrait display dimensions', async () => {
    const { meta } = await inspectFile(await loadFixture(rotatedUrl, 'rotated.mp4'));
    expect(meta.rotation).toBe(90);
    expect(meta.displayHeight).toBeGreaterThan(meta.displayWidth);
  });

  it('reports no audio track', async () => {
    const { meta } = await inspectFile(await loadFixture(noAudioUrl, 'noaudio.mp4'));
    expect(meta.hasAudio).toBe(false);
    expect(meta.audioDecodable).toBe(false);
  });

  it('throws a friendly InspectionError for non-video data', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'nope.mp4', { type: 'video/mp4' });
    await expect(inspectFile(file)).rejects.toThrow(/could not be read/i);
  });
});

describe('assertDecodable', () => {
  it('returns the user-facing message for an undecodable codec', () => {
    const message = assertDecodable({ videoDecodable: false, videoCodec: 'vp9' });
    expect(message).toMatch(/can't be decoded/i);
  });

  it('returns null when decodable', () => {
    expect(assertDecodable({ videoDecodable: true, videoCodec: 'avc1' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- --run src/lib/media/inspect.browser.test.ts`
Expected: FAIL — `./inspect` doesn't exist. (If `?url` imports fail to type-check, add `/// <reference types="vite/client" />` to `src/vite-env.d.ts`.)

- [ ] **Step 3: Implement**

`src/lib/media/inspect.ts`:

```ts
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { VideoMeta } from '$lib/domain/bitrate';

export class InspectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'InspectionError';
  }
}

export type InspectResult = { duration: number; meta: VideoMeta };

export async function inspectFile(file: File): Promise<InspectResult> {
  try {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const duration = await input.computeDuration();
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new InspectionError('No video track was found in this file.');
    const audioTrack = await input.getPrimaryAudioTrack();

    const frameRate = await videoTrack
      .computeFrameRateMetrics()
      .then((metrics) => metrics.bestGuessFrameRate)
      .catch(() => null);

    const meta: VideoMeta = {
      displayWidth: await videoTrack.getDisplayWidth(),
      displayHeight: await videoTrack.getDisplayHeight(),
      rotation: await videoTrack.getRotation(),
      frameRate,
      videoCodec: await videoTrack.getCodecParameterString().catch(() => null),
      audioCodec: audioTrack ? await audioTrack.getCodecParameterString().catch(() => null) : null,
      hasAudio: audioTrack !== null,
      audioDecodable: audioTrack ? await audioTrack.canDecode().catch(() => false) : false,
      videoDecodable: await videoTrack.canDecode().catch(() => false),
    };

    return { duration, meta };
  } catch (error) {
    if (error instanceof InspectionError) throw error;
    console.error('[inspect] failed to read media file', error);
    throw new InspectionError('This file could not be read as a video.', { cause: error });
  }
}

export function assertDecodable(meta: Pick<VideoMeta, 'videoDecodable' | 'videoCodec'>): string | null {
  if (meta.videoDecodable) return null;
  const codec = meta.videoCodec ? ` (${meta.videoCodec})` : '';
  return `This video's codec${codec} can't be decoded in this browser. Try Chrome, or convert the file to H.264 MP4 first.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- --run src/lib/media/inspect.browser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media/inspect.ts src/lib/media/inspect.browser.test.ts
git add src/vite-env.d.ts 2>/dev/null || true
git commit -m "feat: media inspection with codec preflight"
```

---

### Task 8: Media — clip encoder

**Files:**
- Create: `src/lib/media/exporter.ts`, `src/lib/media/exporter.browser.test.ts`

**Interfaces:**
- Consumes: `Segment` (Task 3), `OutputPlan` (Task 4), `inspectFile`/`buildOutputPlan` for tests.
- Produces:
  - `type EncodeArgs = { file: File; segment: Segment; plan: OutputPlan; onProgress: (progress: number) => void }`
  - `type EncodeHandle = { result: Promise<Blob>; cancel: () => Promise<void> }`
  - `type EncodeClipFactory = (args: EncodeArgs) => EncodeHandle`
  - `const realEncodeClip: EncodeClipFactory` — transcodes exactly `[segment.start, segment.end]` into an MP4 (H.264 + AAC unless `plan.audioKbps === 0`, then video-only), rotation baked into pixels, output starting at timestamp 0.

- [ ] **Step 1: Write the failing tests**

`src/lib/media/exporter.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import tiny5sUrl from '../../../static/test-fixtures/tiny-5s.mp4?url';
import rotatedUrl from '../../../static/test-fixtures/tiny-portrait-rotated.mp4?url';
import { buildOutputPlan } from '$lib/domain/bitrate';
import { inspectFile } from './inspect';
import { realEncodeClip } from './exporter';

async function loadFixture(url: string, name: string): Promise<File> {
  const blob = await (await fetch(url)).blob();
  return new File([blob], name, { type: 'video/mp4' });
}

function isFtyp(blob: Blob) {
  return blob.slice(4, 8).text().then((text) => text === 'ftyp');
}

describe('realEncodeClip', () => {
  it('exports a valid MP4 whose duration matches the requested range (mid-GOP start)', async () => {
    const file = await loadFixture(tiny5sUrl, 'tiny-5s.mp4');
    const { meta } = await inspectFile(file);
    const plan = buildOutputPlan(1.5, meta, 'whatsapp');
    const progress: number[] = [];
    const handle = realEncodeClip({
      file,
      segment: { id: 'a', start: 1, end: 2.5 },
      plan,
      onProgress: (p) => progress.push(p),
    });
    const blob = await handle.result;
    expect(await isFtyp(blob)).toBe(true);

    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const duration = await input.computeDuration();
    expect(Math.abs(duration - 1.5)).toBeLessThanOrEqual(0.35);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toBeLessThanOrEqual(1);
  });

  it('starts with real picture, not black frames', async () => {
    const file = await loadFixture(tiny5sUrl, 'tiny-5s.mp4');
    const { meta } = await inspectFile(file);
    const plan = buildOutputPlan(0.5, meta, 'whatsapp');
    const handle = realEncodeClip({
      file,
      segment: { id: 'a', start: 2, end: 2.5 },
      plan,
      onProgress: () => {},
    });
    const blob = await handle.result;
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const videoTrack = await input.getPrimaryVideoTrack();
    const sink = new VideoSampleSink(videoTrack!);
    const sample = await sink.getSample(0.05);
    expect(sample).not.toBeNull();
    const canvas = new OffscreenCanvas(32, 24);
    const ctx = canvas.getContext('2d')!;
    sample!.draw(ctx, 0, 0, 32, 24);
    const pixels = ctx.getImageData(0, 0, 32, 24).data;
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) lit++;
    }
    expect(lit).toBeGreaterThan(10);
  });

  it('bakes rotation so the exported clip displays portrait', async () => {
    const file = await loadFixture(rotatedUrl, 'rotated.mp4');
    const { meta } = await inspectFile(file);
    const plan = buildOutputPlan(1, meta, 'whatsapp');
    const handle = realEncodeClip({
      file,
      segment: { id: 'a', start: 0, end: 1 },
      plan,
      onProgress: () => {},
    });
    const blob = await handle.result;
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const videoTrack = await input.getPrimaryVideoTrack();
    const width = await videoTrack!.getDisplayWidth();
    const height = await videoTrack!.getDisplayHeight();
    expect(height).toBeGreaterThan(width);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- --run src/lib/media/exporter.browser.test.ts`
Expected: FAIL — `./exporter` doesn't exist.

- [ ] **Step 3: Implement**

`src/lib/media/exporter.ts`:

```ts
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeAudio,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import { registerAacEncoder } from '@mediabunny/aac-encoder';
import type { Segment } from '$lib/domain/segments';
import type { OutputPlan } from '$lib/domain/bitrate';

export type EncodeArgs = {
  file: File;
  segment: Segment;
  plan: OutputPlan;
  onProgress: (progress: number) => void;
};

export type EncodeHandle = {
  result: Promise<Blob>;
  cancel: () => Promise<void>;
};

export type EncodeClipFactory = (args: EncodeArgs) => EncodeHandle;

let aacReady: Promise<void> | null = null;

function ensureAacSupport(): Promise<void> {
  aacReady ??= canEncodeAudio('aac').then((supported) => {
    if (!supported) registerAacEncoder();
  });
  return aacReady;
}

export const realEncodeClip: EncodeClipFactory = ({ file, segment, plan, onProgress }) => {
  let conversion: Conversion | null = null;

  const result = (async () => {
    await ensureAacSupport();

    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
    const output = new Output({ format, target: new BufferTarget() });

    const videoCodec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs());
    if (!videoCodec) throw new Error('No encodable video codec is available in this browser.');

    conversion = await Conversion.init({
      input,
      output,
      trim: { start: segment.start, end: segment.end },
      video: {
        codec: videoCodec,
        quality: new Quality({ bitrate: plan.videoKbps * 1000 }),
        width: plan.width,
        height: plan.height,
        fit: 'contain',
        frameRate: plan.frameRate,
        // Bake rotation/flip into pixels so clips display upright everywhere.
        allowTransformationMetadata: false,
      },
      audio:
        plan.audioKbps > 0
          ? { codec: 'aac', quality: new Quality({ bitrate: plan.audioKbps * 1000 }) }
          : { discard: true },
    });

    if (!conversion.isValid) {
      throw new Error('This clip cannot be converted with the current settings.');
    }

    conversion.onProgress = onProgress;
    await conversion.execute();

    const buffer = output.target.buffer;
    if (!buffer) throw new Error('Encoding finished but produced no data.');
    return new Blob([buffer], { type: 'video/mp4' });
  })();

  return {
    result,
    cancel: async () => {
      if (conversion) await conversion.cancel();
    },
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- --run src/lib/media/exporter.browser.test.ts`
Expected: PASS (duration within ±0.35s, first frame lit, rotated output portrait).

Note: if the portrait assertion fails, Mediabunny kept rotation as metadata instead of baking it — verify with `getRotation()` on the output track. The output must still *display* portrait (`getDisplayWidth/Height` account for rotation), which is what this test asserts.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media/exporter.ts src/lib/media/exporter.browser.test.ts
git commit -m "feat: per-clip MP4 encoder with baked rotation and AAC fallback"
```

---

### Task 9: Media utilities + export queue with cancel/retry

**Files:**
- Create: `src/lib/media/download.ts`, `src/lib/media/zip.ts`, `src/lib/state/export.svelte.ts`, `src/lib/media/zip.test.ts`, `src/lib/state/export.test.ts`

**Interfaces:**
- Consumes: `EncodeClipFactory`/`EncodeHandle` (Task 8), `Segment` (Task 3), `OutputPlan` (Task 4).
- Produces:
  - `downloadBlob(blob: Blob, fileName: string): void` (browser-only side effects).
  - `makeZip(entries: { name: string; blob: Blob }[]): Promise<Blob>`.
  - `type ClipStatus = 'idle' | 'encoding' | 'done' | 'failed' | 'canceled'`
  - `type ExportJob = { id: string; fileName: string; segment: Segment; plan: OutputPlan }`
  - `type FinishMode = { finish: 'download-first' } | { finish: 'zip'; zipName: string } | { finish: 'none' }`
  - `class ExportState` with injectable deps `{ encodeClip, downloadBlob, makeZip }`:
    - `statuses`, `progress`, `errors`, `results`, `busy` — all reactive `$state`.
    - `runJobs(file: File, jobs: ExportJob[], mode: FinishMode): Promise<void>`
    - `cancel(): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`src/lib/media/zip.test.ts` (Node — `client-zip` and `fflate` both work there):

```ts
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { makeZip } from './zip';

describe('makeZip', () => {
  it('creates a zip containing the given entries', async () => {
    const zip = await makeZip([
      { name: 'a_part01.mp4', blob: new Blob([new Uint8Array([1, 2, 3])]) },
      { name: 'a_part02.mp4', blob: new Blob([new Uint8Array([4, 5])]) },
    ]);
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(['a_part01.mp4', 'a_part02.mp4']);
    expect(Array.from(entries['a_part01.mp4'])).toEqual([1, 2, 3]);
  });
});
```

`src/lib/state/export.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { EncodeClipFactory, EncodeHandle } from '$lib/media/exporter';
import { ExportState, type ExportJob } from './export.svelte';

const job = (id: string): ExportJob => ({
  id,
  fileName: `vid_${id}.mp4`,
  segment: { id, start: 0, end: 1 },
  plan: { width: 320, height: 240, frameRate: 30, videoKbps: 1000, audioKbps: 128, estimatedBytes: 100 },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeEncoder() {
  const calls: { id: string; handle: EncodeHandle }[] = [];
  const factories: (() => EncodeHandle)[] = [];
  const factory: EncodeClipFactory = (args) => {
    const scripted = factories.shift();
    const handle = scripted ? scripted() : successHandle();
    calls.push({ id: args.segment.id, handle });
    return handle;
  };
  const successHandle = (): EncodeHandle => {
    const d = deferred<Blob>();
    d.resolve(new Blob([new Uint8Array([1])]));
    return { result: d.promise, cancel: async () => {} };
  };
  return { factory, calls, push: (fn: () => EncodeHandle) => factories.push(fn) };
}

const makeDeps = (encoder = fakeEncoder()) => {
  const downloads: string[] = [];
  const zips: { name: string; count: number }[] = [];
  const state = new ExportState({
    encodeClip: encoder.factory,
    downloadBlob: (_blob, name) => downloads.push(name),
    makeZip: async (entries) => {
      zips.push({ name: 'zip', count: entries.length });
      return new Blob([new Uint8Array([1])]);
    },
  });
  return { state, encoder, downloads, zips };
};

describe('ExportState', () => {
  it('downloads a single successful clip', async () => {
    const { state, downloads } = makeDeps();
    await state.runJobs(new File([], 'v.mp4'), [job('a')], { finish: 'download-first' });
    expect(state.statuses['a']).toBe('done');
    expect(state.results['a']).toBeInstanceOf(Blob);
    expect(downloads).toEqual(['vid_a.mp4']);
    expect(state.busy).toBe(false);
  });

  it('continues after a failure and downloads the first success', async () => {
    const { state, encoder, downloads } = makeDeps();
    encoder.push(() => ({ result: Promise.reject(new Error('boom')), cancel: async () => {} }));
    await state.runJobs(new File([], 'v.mp4'), [job('a'), job('b')], { finish: 'download-first' });
    expect(state.statuses['a']).toBe('failed');
    expect(state.errors['a']).toContain('boom');
    expect(state.statuses['b']).toBe('done');
    expect(downloads).toEqual(['vid_b.mp4']);
  });

  it('zips all successful clips', async () => {
    const { state, zips, downloads } = makeDeps();
    await state.runJobs(new File([], 'v.mp4'), [job('a'), job('b')], { finish: 'zip', zipName: 'all.zip' });
    expect(zips).toEqual([{ name: 'zip', count: 2 }]);
    expect(downloads).toEqual(['all.zip']);
  });

  it('cancels the current conversion and stops the queue without downloading', async () => {
    const { state, encoder, downloads } = makeDeps();
    let cancelCalled = false;
    const d = deferred<Blob>();
    encoder.push(() => ({
      result: d.promise,
      cancel: async () => {
        cancelCalled = true;
        d.reject(new Error('ConversionCanceledError'));
      },
    }));
    const run = state.runJobs(new File([], 'v.mp4'), [job('a'), job('b')], { finish: 'zip', zipName: 'all.zip' });
    await Promise.resolve();
    await state.cancel();
    await run;
    expect(cancelCalled).toBe(true);
    expect(state.statuses['a']).toBe('canceled');
    expect(state.statuses['b']).toBeUndefined();
    expect(downloads).toEqual([]);
    expect(state.busy).toBe(false);
  });

  it('supports retrying a failed clip', async () => {
    const { state, encoder } = makeDeps();
    encoder.push(() => ({ result: Promise.reject(new Error('boom')), cancel: async () => {} }));
    await state.runJobs(new File([], 'v.mp4'), [job('a')], { finish: 'none' });
    expect(state.statuses['a']).toBe('failed');
    await state.runJobs(new File([], 'v.mp4'), [job('a')], { finish: 'none' });
    expect(state.statuses['a']).toBe('done');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- --run src/lib/media/zip.test.ts src/lib/state/export.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement the media utilities**

`src/lib/media/download.ts`:

```ts
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
```

`src/lib/media/zip.ts`:

```ts
import { downloadZip } from 'client-zip';

export async function makeZip(entries: { name: string; blob: Blob }[]): Promise<Blob> {
  const response = downloadZip(
    entries.map((entry) => ({
      name: entry.name,
      input: entry.blob,
      lastModified: new Date(),
    }))
  );
  return await response.blob();
}
```

- [ ] **Step 4: Implement the export queue**

`src/lib/state/export.svelte.ts`:

```ts
import type { Segment } from '$lib/domain/segments';
import type { OutputPlan } from '$lib/domain/bitrate';
import type { EncodeClipFactory, EncodeHandle } from '$lib/media/exporter';

export type ClipStatus = 'idle' | 'encoding' | 'done' | 'failed' | 'canceled';

export type ExportJob = {
  id: string;
  fileName: string;
  segment: Segment;
  plan: OutputPlan;
};

export type FinishMode =
  | { finish: 'download-first' }
  | { finish: 'zip'; zipName: string }
  | { finish: 'none' };

export type ExportDeps = {
  encodeClip: EncodeClipFactory;
  downloadBlob: (blob: Blob, fileName: string) => void;
  makeZip: (entries: { name: string; blob: Blob }[]) => Promise<Blob>;
};

const isCancelError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'ConversionCanceledError' || error.constructor.name === 'ConversionCanceledError');

export class ExportState {
  statuses = $state<Record<string, ClipStatus>>({});
  progress = $state<Record<string, number>>({});
  errors = $state<Record<string, string>>({});
  results = $state<Record<string, Blob>>({});
  busy = $state(false);

  #deps: ExportDeps;
  #current: EncodeHandle | null = null;
  #cancelRequested = false;

  constructor(deps: ExportDeps) {
    this.#deps = deps;
  }

  async runJobs(file: File, jobs: ExportJob[], mode: FinishMode): Promise<void> {
    this.busy = true;
    this.#cancelRequested = false;
    const succeeded: { name: string; blob: Blob }[] = [];

    for (const job of jobs) {
      if (this.#cancelRequested) break;
      this.statuses[job.id] = 'encoding';
      this.progress[job.id] = 0;
      this.errors[job.id] = '';

      const handle = this.#deps.encodeClip({
        file,
        segment: job.segment,
        plan: job.plan,
        onProgress: (value) => {
          this.progress[job.id] = value;
        },
      });
      this.#current = handle;

      try {
        const blob = await handle.result;
        this.statuses[job.id] = 'done';
        this.progress[job.id] = 1;
        this.results[job.id] = blob;
        succeeded.push({ name: job.fileName, blob });
      } catch (error) {
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

    if (mode.finish === 'download-first' && succeeded[0]) {
      this.#deps.downloadBlob(succeeded[0].blob, succeeded[0].name);
    } else if (mode.finish === 'zip' && succeeded.length > 0) {
      const zip = await this.#deps.makeZip(succeeded);
      this.#deps.downloadBlob(zip, mode.zipName);
    }

    this.busy = false;
  }

  async cancel(): Promise<void> {
    this.#cancelRequested = true;
    await this.#current?.cancel();
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:unit -- --run src/lib/media/zip.test.ts src/lib/state/export.test.ts`
Expected: PASS. If `client-zip` misbehaves under Node, keep the interface and swap the implementation for `fflate.zipSync` — the tests define the contract.

- [ ] **Step 6: Commit**

```bash
git add src/lib/media/download.ts src/lib/media/zip.ts src/lib/media/zip.test.ts src/lib/state/export.svelte.ts src/lib/state/export.test.ts
git commit -m "feat: export queue with cancel, retry, zip and download plumbing"
```

---

### Task 10: State — project store

**Files:**
- Create: `src/lib/state/project.svelte.ts`, `src/lib/state/project.test.ts`

**Interfaces:**
- Consumes: everything from `$lib/domain/segments` (Task 3), `QualityPreset`/`VideoMeta` (Task 4).
- Produces: `class ProjectState` and the singleton `project`:
  - Reactive fields: `file`, `meta`, `duration`, `segments`, `selectedId`, `dirty`, `maxClipDuration` (default 30), `preset` (default `'whatsapp'`), `zoom`, `loopPreview` (default `true`), `error`, `notice`, `thumbs`.
  - `get selected(): Segment | null`, `get coverage(): { gaps: Interval[]; overlaps: Interval[] }`, `get sortedSegments(): Segment[]`
  - `begin(file: File): void` — reset everything for a newly picked file.
  - `ready(duration: number, meta: VideoMeta): void` — set metadata, auto-split, select first clip; sets `notice` when audio exists but is undecodable.
  - `setMaxClipDuration(value: number): void` — clamp to 1–300, re-clamp all segments, mark dirty.
  - `select(id: string | null): void`
  - `updateSegment(id: string, next: Segment, moved?: 'start' | 'end'): void` — clamps through domain, marks dirty.
  - `nudgeSelected(edge: 'start' | 'end', delta: number): void`
  - `setSelectedField(field: 'start' | 'end' | 'duration', value: number): void`
  - `splitSelected(): void`
  - `deleteSelected(): void`
  - `resetSplit(): void` — fresh auto-split, clears dirty.
  - `setThumbs(thumbs: { time: number; url: string }[]): void` — revokes previous object URLs.
  - `setError(message: string | null): void`

- [ ] **Step 1: Write the failing tests**

`src/lib/state/project.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { VideoMeta } from '$lib/domain/bitrate';
import { ProjectState } from './project.svelte';

const meta = (overrides: Partial<VideoMeta> = {}): VideoMeta => ({
  displayWidth: 1920,
  displayHeight: 1080,
  rotation: 0,
  frameRate: 30,
  videoCodec: 'avc1.42001f',
  audioCodec: 'mp4a.40.2',
  hasAudio: true,
  audioDecodable: true,
  videoDecodable: true,
  ...overrides,
});

const loaded = () => {
  const state = new ProjectState();
  state.begin(new File([], 'video.mp4'));
  state.ready(80, meta());
  return state;
};

describe('ProjectState', () => {
  it('auto-splits 80s into 30/30/20 and selects the first clip', () => {
    const state = loaded();
    expect(state.segments.map((s) => [s.start, s.end])).toEqual([
      [0, 30],
      [30, 60],
      [60, 80],
    ]);
    expect(state.selectedId).toBe(state.segments[0].id);
    expect(state.dirty).toBe(false);
  });

  it('notices when the audio track cannot be decoded', () => {
    const state = new ProjectState();
    state.begin(new File([], 'video.mp4'));
    state.ready(10, meta({ audioDecodable: false }));
    expect(state.notice).toMatch(/silent/i);
  });

  it('re-clamps all clips when the max length is lowered', () => {
    const state = loaded();
    state.setMaxClipDuration(15);
    expect(state.maxClipDuration).toBe(15);
    for (const segment of state.segments) {
      expect(segment.end - segment.start).toBeLessThanOrEqual(15);
    }
    expect(state.dirty).toBe(true);
  });

  it('clamps updates made through updateSegment', () => {
    const state = loaded();
    const last = state.segments[2];
    state.updateSegment(last.id, { ...last, end: 100 }, 'end');
    expect(state.segments[2].end).toBe(80);
  });

  it('splits the selected clip in half', () => {
    const state = loaded();
    state.select(state.segments[0].id);
    state.splitSelected();
    expect(state.segments.length).toBe(4);
    expect(state.segments.map((s) => [s.start, s.end])).toEqual([
      [0, 15],
      [15, 30],
      [30, 60],
      [60, 80],
    ]);
    expect(state.dirty).toBe(true);
  });

  it('deletes the selected clip and selects a neighbor', () => {
    const state = loaded();
    state.select(state.segments[1].id);
    state.deleteSelected();
    expect(state.segments.length).toBe(2);
    expect(state.selectedId).not.toBeNull();
    expect(state.segments.some((s) => s.id === state.selectedId)).toBe(true);
  });

  it('resets to a clean auto-split', () => {
    const state = loaded();
    state.setMaxClipDuration(15);
    state.resetSplit();
    expect(state.segments.map((s) => [s.start, s.end])).toEqual([
      [0, 15],
      [15, 30],
      [30, 45],
      [45, 60],
      [60, 75],
      [75, 80],
    ]);
    expect(state.dirty).toBe(false);
  });

  it('reports gaps in coverage', () => {
    const state = loaded();
    state.updateSegment(state.segments[1].id, { ...state.segments[1], start: 35 }, 'start');
    expect(state.coverage.gaps).toEqual([{ start: 30, end: 35 }]);
  });

  it('clears everything on begin', () => {
    const state = loaded();
    state.begin(new File([], 'next.mp4'));
    expect(state.segments).toEqual([]);
    expect(state.selectedId).toBeNull();
    expect(state.dirty).toBe(false);
    expect(state.notice).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- --run src/lib/state/project.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

`src/lib/state/project.svelte.ts`:

```ts
import {
  autoSplit,
  clampSegment,
  computeCoverage,
  nudge,
  setField,
  sortSegments,
  splitInHalf,
  type ClampOpts,
  type Interval,
  type Segment,
} from '$lib/domain/segments';
import type { QualityPreset, VideoMeta } from '$lib/domain/bitrate';

export class ProjectState {
  file = $state<File | null>(null);
  meta = $state<VideoMeta | null>(null);
  duration = $state(0);
  segments = $state<Segment[]>([]);
  selectedId = $state<string | null>(null);
  dirty = $state(false);
  maxClipDuration = $state(30);
  preset = $state<QualityPreset>('whatsapp');
  zoom = $state(1);
  loopPreview = $state(true);
  error = $state<string | null>(null);
  notice = $state<string | null>(null);
  thumbs = $state<{ time: number; url: string }[]>([]);

  get selected(): Segment | null {
    return this.segments.find((segment) => segment.id === this.selectedId) ?? null;
  }

  get sortedSegments(): Segment[] {
    return sortSegments(this.segments);
  }

  get coverage(): { gaps: Interval[]; overlaps: Interval[] } {
    return computeCoverage(this.segments, this.duration);
  }

  #opts(): ClampOpts {
    return { duration: this.duration, maxClipDuration: this.maxClipDuration };
  }

  begin(file: File): void {
    this.setThumbs([]);
    this.file = file;
    this.meta = null;
    this.duration = 0;
    this.segments = [];
    this.selectedId = null;
    this.dirty = false;
    this.zoom = 1;
    this.error = null;
    this.notice = null;
  }

  ready(duration: number, meta: VideoMeta): void {
    this.duration = duration;
    this.meta = meta;
    this.segments = autoSplit(duration, this.maxClipDuration);
    this.selectedId = this.segments[0]?.id ?? null;
    this.dirty = false;
    if (meta.hasAudio && !meta.audioDecodable) {
      this.notice = 'The audio track cannot be decoded; exported clips will be silent.';
    }
  }

  setMaxClipDuration(value: number): void {
    const next = Math.min(300, Math.max(1, Math.round(value)));
    if (next === this.maxClipDuration) return;
    this.maxClipDuration = next;
    this.segments = this.segments.map((segment) => clampSegment(segment, this.#opts()));
    this.dirty = true;
  }

  select(id: string | null): void {
    this.selectedId = id;
  }

  updateSegment(id: string, next: Segment, moved: 'start' | 'end' = 'end'): void {
    const clamped = clampSegment(next, this.#opts(), moved);
    this.segments = this.segments.map((segment) => (segment.id === id ? clamped : segment));
    this.dirty = true;
  }

  nudgeSelected(edge: 'start' | 'end', delta: number): void {
    const selected = this.selected;
    if (!selected) return;
    this.updateSegment(selected.id, nudge(selected, edge, delta, this.#opts()), edge);
  }

  setSelectedField(field: 'start' | 'end' | 'duration', value: number): void {
    const selected = this.selected;
    if (!selected) return;
    this.updateSegment(selected.id, setField(selected, field, value, this.#opts()), field === 'start' ? 'start' : 'end');
  }

  splitSelected(): void {
    const selected = this.selected;
    if (!selected) return;
    const parts = splitInHalf(selected, this.#opts());
    if (!parts) return;
    const index = this.segments.findIndex((segment) => segment.id === selected.id);
    this.segments = [...this.segments.slice(0, index), ...parts, ...this.segments.slice(index + 1)];
    this.selectedId = parts[0].id;
    this.dirty = true;
  }

  deleteSelected(): void {
    const selected = this.selected;
    if (!selected) return;
    const index = this.segments.findIndex((segment) => segment.id === selected.id);
    const remaining = this.segments.filter((segment) => segment.id !== selected.id);
    this.segments = remaining;
    this.selectedId = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
    this.dirty = true;
  }

  resetSplit(): void {
    this.segments = autoSplit(this.duration, this.maxClipDuration);
    this.selectedId = this.segments[0]?.id ?? null;
    this.dirty = false;
  }

  setThumbs(thumbs: { time: number; url: string }[]): void {
    for (const thumb of this.thumbs) {
      try {
        URL.revokeObjectURL(thumb.url);
      } catch (error) {
        console.error('[thumbs] failed to revoke url', error);
      }
    }
    this.thumbs = thumbs;
  }

  setError(message: string | null): void {
    this.error = message;
  }
}

export const project = new ProjectState();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- --run src/lib/state/project.test.ts`
Expected: PASS. If Vitest cannot compile `$state` inside `project.svelte.ts`, confirm the svelte plugin is active for the unit project (it must process `*.svelte.ts` modules); do not rewrite the store to avoid runes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/project.svelte.ts src/lib/state/project.test.ts
git commit -m "feat: project store (segments, selection, dirty flag, notices)"
```

### Task 11: App shell — layout, DropZone, load flow, banners

**Files:**
- Modify: `src/routes/+layout.svelte`, `src/routes/+page.svelte`
- Create: `src/lib/components/DropZone.svelte`, `src/lib/components/DropZone.svelte.test.ts`, `src/routes/page.browser.test.ts`

**Interfaces:**
- Consumes: `inspectFile`/`assertDecodable` (Task 7), `project` store (Task 10).
- Produces: `DropZone` component with props `{ onFile: (file: File) => void; error?: string | null }` and testids `dropzone`, `file-input`, `dropzone-error`; a page shell where a loaded project renders header (`file-name`), `error-banner`, `notice-banner`, and placeholder slots `preview-slot`, `timeline-slot`, `panel-slot`, `export-slot` that later tasks fill.

- [ ] **Step 1: Write the failing DropZone test**

`src/lib/components/DropZone.svelte.test.ts` (browser project — note `render` returns a Promise):

```ts
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DropZone from './DropZone.svelte';

describe('DropZone', () => {
  it('calls onFile when a file is chosen', async () => {
    const onFile = vi.fn();
    const screen = await render(DropZone, { onFile });
    const input = screen.container.querySelector('[data-testid="file-input"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1])], 'a.mp4', { type: 'video/mp4' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('shows the error message', async () => {
    const screen = await render(DropZone, { onFile: () => {}, error: 'nope' });
    expect(screen.container.querySelector('[data-testid="dropzone-error"]')?.textContent).toContain('nope');
  });
});
```

- [ ] **Step 2: Implement DropZone**

`src/lib/components/DropZone.svelte`:

```svelte
<script lang="ts">
  let { onFile, error = null }: { onFile: (file: File) => void; error?: string | null } = $props();
  let dragging = $state(false);

  function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) onFile(file);
    input.value = '';
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) onFile(file);
  }
</script>

<label
  class="dropzone flex min-h-[60vh] cursor-pointer flex-col items-center justify-center gap-4 rounded-box border-2 border-dashed border-base-300 bg-base-100 p-8 text-center"
  class:border-primary={dragging}
  ondragover={(event) => {
    event.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  {ondrop}
  data-testid="dropzone"
>
  <input data-testid="file-input" class="hidden" type="file" accept="video/*" onchange={pick} />
  <h2 class="text-2xl font-semibold">Drop a video here</h2>
  <p class="text-base-content/70">
    Or click to choose a file. You can also drag a video straight out of the Photos app.
  </p>
  {#if error}
    <p class="text-error" data-testid="dropzone-error">{error}</p>
  {/if}
</label>
```

- [ ] **Step 3: Run the DropZone test**

Run: `pnpm test:unit -- --run src/lib/components/DropZone.svelte.test.ts`
Expected: PASS.

- [ ] **Step 4: Build the shell page**

`src/routes/+layout.svelte` must import the DaisyUI stylesheet and render children:

```svelte
<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

{@render children()}
```

`src/routes/+page.svelte`:

```svelte
<script lang="ts">
  import DropZone from '$lib/components/DropZone.svelte';
  import { assertDecodable, inspectFile } from '$lib/media/inspect';
  import { project } from '$lib/state/project.svelte';

  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let objectUrl = $state<string | null>(null);

  async function handleFile(file: File) {
    if (project.dirty && !confirm('Discard the current editing state and load a new video?')) return;
    loadError = null;
    project.begin(file);
    loading = true;
    try {
      const { duration, meta } = await inspectFile(file);
      const blocked = assertDecodable(meta);
      if (blocked) {
        loadError = blocked;
        return;
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(file);
      project.ready(duration, meta);
    } catch (error) {
      console.error('[load] failed to load video', error);
      loadError = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }
</script>

<div class="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4">
  <header class="flex items-center justify-between">
    <h1 class="text-xl font-bold">WhatsApp Status Splitter</h1>
    {#if project.meta}
      <span class="text-sm text-base-content/70" data-testid="file-name">{project.file?.name}</span>
    {/if}
  </header>

  {#if project.error}
    <div class="alert alert-error" data-testid="error-banner">{project.error}</div>
  {/if}
  {#if project.notice}
    <div class="alert alert-warning" data-testid="notice-banner">{project.notice}</div>
  {/if}

  {#if !project.meta}
    {#if loading}<span class="loading loading-spinner"></span>{/if}
    <DropZone onFile={handleFile} error={loadError} />
  {:else}
    <section class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div class="flex flex-col gap-4">
        <div class="rounded-box bg-base-200 p-4" data-testid="preview-slot">Preview</div>
        <div class="rounded-box bg-base-200 p-4" data-testid="timeline-slot">Timeline</div>
      </div>
      <div class="flex flex-col gap-4">
        <div class="rounded-box bg-base-200 p-4" data-testid="panel-slot">Clip controls</div>
        <div class="rounded-box bg-base-200 p-4" data-testid="export-slot">Export</div>
      </div>
    </section>
  {/if}
</div>
```

- [ ] **Step 5: Write the page integration test**

`src/routes/page.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import tiny5sUrl from '../../static/test-fixtures/tiny-5s.mp4?url';
import Page from './+page.svelte';

describe('page shell', () => {
  it('loads a video and shows the editor', async () => {
    const screen = await render(Page);
    const blob = await (await fetch(tiny5sUrl)).blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'tiny-5s.mp4', { type: 'video/mp4' }));
    const input = screen.container.querySelector('[data-testid="file-input"]') as HTMLInputElement;
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await expect.poll(() => screen.container.querySelector('[data-testid="file-name"]')?.textContent).toContain('tiny-5s.mp4');
    expect(screen.container.querySelector('[data-testid="timeline-slot"]')).not.toBeNull();
  });
});
```

If the scaffold created an example Playwright spec (`e2e/*.spec.ts` or `e2e/demo.test.ts`) that asserts the old welcome page, delete it now — the home page no longer exists in that form.

- [ ] **Step 6: Run tests and checks**

Run: `pnpm test:unit -- --run src/routes/page.browser.test.ts src/lib/components/DropZone.svelte.test.ts`
Expected: PASS.

Run: `pnpm check`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/+layout.svelte src/routes/+page.svelte src/routes/page.browser.test.ts src/lib/components/DropZone.svelte src/lib/components/DropZone.svelte.test.ts e2e
git commit -m "feat: app shell with dropzone, load flow and preflight errors"
```

---

### Task 12: VideoPreview component

**Files:**
- Create: `src/lib/components/VideoPreview.svelte`, `src/lib/components/VideoPreview.svelte.test.ts`
- Modify: `src/routes/+page.svelte` (replace `preview-slot`)

**Interfaces:**
- Consumes: `project` store (Task 10).
- Produces: `VideoPreview` with props `{ src: string; range?: { start: number; end: number } | null; loop?: boolean; seekRequest?: { t: number } | null; onTime?: (t: number) => void; onSeekHandled?: () => void }`; component exports `play()`, `pause()`, `toggle()`; testids `video`, `btn-play`, `btn-loop`, `preview-time`.
  - Play behavior: starting playback while outside the range seeks to `range.start`; playback inside a range stops (or loops) at `range.end`.
  - `seekRequest` is an object so repeated seeks to the same time still trigger; the component calls `onSeekHandled()` once applied.

- [ ] **Step 1: Write the failing test**

`src/lib/components/VideoPreview.svelte.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import tiny5sUrl from '../../../static/test-fixtures/tiny-5s.mp4?url';
import VideoPreview from './VideoPreview.svelte';

describe('VideoPreview', () => {
  it('seeks to the clip start when playing from outside the range', async () => {
    const source = URL.createObjectURL(await (await fetch(tiny5sUrl)).blob());
    const screen = await render(VideoPreview, { src: source, range: { start: 2, end: 3 }, loop: false });
    const video = screen.container.querySelector('video') as HTMLVideoElement;
    if (video.readyState === 0) {
      await new Promise<void>((resolve) => video.addEventListener('loadedmetadata', () => resolve(), { once: true }));
    }
    (screen.container.querySelector('[data-testid="btn-play"]') as HTMLButtonElement).click();
    await expect.poll(() => video.currentTime).toBeGreaterThanOrEqual(1.95);
  });

  it('applies parent-driven seeks and acknowledges them', async () => {
    const source = URL.createObjectURL(await (await fetch(tiny5sUrl)).blob());
    const onSeekHandled = vi.fn();
    const screen = await render(VideoPreview, { src: source, seekRequest: { t: 3 }, onSeekHandled });
    const video = screen.container.querySelector('video') as HTMLVideoElement;
    if (video.readyState === 0) {
      await new Promise<void>((resolve) => video.addEventListener('loadedmetadata', () => resolve(), { once: true }));
    }
    await expect.poll(() => onSeekHandled).toHaveBeenCalled();
    await expect.poll(() => video.currentTime).toBeGreaterThanOrEqual(2.95);
  });
});
```

(Add `vi` to the vitest import.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit -- --run src/lib/components/VideoPreview.svelte.test.ts`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement**

`src/lib/components/VideoPreview.svelte`:

```svelte
<script lang="ts">
  type Range = { start: number; end: number } | null;

  let {
    src,
    range = null,
    loop = $bindable(true),
    seekRequest = null,
    onTime,
    onSeekHandled,
  }: {
    src: string;
    range?: Range;
    loop?: boolean;
    seekRequest?: { t: number } | null;
    onTime?: (time: number) => void;
    onSeekHandled?: () => void;
  } = $props();

  let video = $state<HTMLVideoElement | null>(null);
  let paused = $state(true);

  export function play() {
    const element = video;
    if (!element) return;
    if (range && (element.currentTime < range.start - 0.05 || element.currentTime >= range.end - 0.05)) {
      element.currentTime = range.start;
    }
    void element.play().catch((error) => console.error('[preview] play failed', error));
  }

  export function pause() {
    video?.pause();
  }

  export function toggle() {
    if (paused) play();
    else pause();
  }

  $effect(() => {
    if (video && seekRequest) {
      video.currentTime = seekRequest.t;
      onSeekHandled?.();
    }
  });

  function handleTimeUpdate() {
    if (!video) return;
    const time = video.currentTime;
    onTime?.(time);
    if (range && time >= range.end - 0.02) {
      if (loop) video.currentTime = range.start;
      else video.pause();
    }
  }
</script>

<div class="flex flex-col gap-2">
  <video
    bind:this={video}
    {src}
    class="max-h-[45vh] w-full rounded-box bg-black"
    playsinline
    onplay={() => (paused = false)}
    onpause={() => (paused = true)}
    ontimeupdate={handleTimeUpdate}
    data-testid="video"
  ></video>
  <div class="flex items-center gap-2">
    <button class="btn btn-sm" type="button" data-testid="btn-play" onclick={toggle}>
      {paused ? 'Play' : 'Pause'}
    </button>
    <button
      class="btn btn-sm"
      class:btn-active={loop}
      type="button"
      data-testid="btn-loop"
      onclick={() => (loop = !loop)}
    >
      Loop clip
    </button>
  </div>
</div>
```

Note: `loop` is declared `$bindable(true)` so the page can bind `bind:loop={project.loopPreview}`.

- [ ] **Step 4: Wire it into the page**

In `src/routes/+page.svelte`, add state and handlers:

```ts
let currentTime = $state(0);
let seekRequest = $state<{ t: number } | null>(null);

function selectClip(id: string) {
  project.select(id);
  const segment = project.segments.find((candidate) => candidate.id === id);
  if (segment) {
    currentTime = segment.start;
    seekRequest = { t: segment.start };
  }
}
```

Replace the `preview-slot` div with:

```svelte
<VideoPreview
  src={objectUrl!}
  range={project.selected ? { start: project.selected.start, end: project.selected.end } : null}
  bind:loop={project.loopPreview}
  {seekRequest}
  onSeekHandled={() => (seekRequest = null)}
  onTime={(time) => (currentTime = time)}
/>
```

- [ ] **Step 5: Run tests and checks**

Run: `pnpm test:unit -- --run src/lib/components/VideoPreview.svelte.test.ts`
Expected: PASS.

Run: `pnpm check`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/VideoPreview.svelte src/lib/components/VideoPreview.svelte.test.ts src/routes/+page.svelte
git commit -m "feat: clip-range video preview with loop and parent-driven seeks"
```

---

### Task 13: SegmentBar component (drag handles + keyboard)

**Files:**
- Create: `src/lib/components/SegmentBar.svelte`, `src/lib/components/SegmentBar.svelte.test.ts`

**Interfaces:**
- Consumes: `formatClock` (Task 2), `Segment` (Task 3).
- Produces: `SegmentBar` with props `{ segment: Segment; lane: number; pxPerSecond: number; selected?: boolean; index: number; onSelect?: (id: string) => void; onChange?: (id: string, next: Segment, moved: 'start' | 'end') => void }`.
  - Positioned absolutely: `left = start × pxPerSecond`, `width = (end − start) × pxPerSecond`, `top = lane × 44px`.
  - Emits **raw candidate segments** (no clamping) with the moved edge; the store clamps.
  - Testids/attributes: `segment-bar` with `data-start`, `data-end`, `data-duration`; handles `handle-start`, `handle-end` (each `role="slider"`, focusable, arrow keys nudge 0.1s / Shift 1s).

- [ ] **Step 1: Write the failing tests**

`src/lib/components/SegmentBar.svelte.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SegmentBar from './SegmentBar.svelte';

const segment = { id: 's1', start: 10, end: 20 };

describe('SegmentBar', () => {
  it('renders position attributes', async () => {
    const screen = await render(SegmentBar, { segment, lane: 0, pxPerSecond: 10, index: 0 });
    const bar = screen.container.querySelector('[data-testid="segment-bar"]') as HTMLElement;
    expect(bar.dataset.start).toBe('10.000');
    expect(bar.dataset.end).toBe('20.000');
    expect(bar.dataset.duration).toBe('10.000');
    expect(bar.style.left).toBe('100px');
    expect(bar.style.width).toBe('100px');
  });

  it('emits raw candidate updates while dragging the end handle', async () => {
    const onChange = vi.fn();
    const screen = await render(SegmentBar, { segment, lane: 0, pxPerSecond: 10, index: 0, onChange });
    const handle = screen.container.querySelector('[data-testid="handle-end"]') as HTMLElement;
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, bubbles: true, pointerId: 1 }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 220, bubbles: true, pointerId: 1 }));
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 220, bubbles: true, pointerId: 1 }));
    expect(onChange).toHaveBeenCalled();
    const [id, next, moved] = onChange.mock.calls.at(-1)!;
    expect(id).toBe('s1');
    expect(moved).toBe('end');
    expect(next.end).toBeCloseTo(22, 3);
  });

  it('nudges the focused handle with the keyboard', async () => {
    const onChange = vi.fn();
    const screen = await render(SegmentBar, { segment, lane: 0, pxPerSecond: 10, index: 0, onChange });
    const handle = screen.container.querySelector('[data-testid="handle-end"]') as HTMLElement;
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(onChange.mock.calls.at(-1)![1].end).toBeCloseTo(20.1, 3);
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
    expect(onChange.mock.calls.at(-1)![1].end).toBeCloseTo(19, 3);
  });

  it('highlights when selected', async () => {
    const screen = await render(SegmentBar, { segment, lane: 0, pxPerSecond: 10, index: 0, selected: true });
    const bar = screen.container.querySelector('[data-testid="segment-bar"]') as HTMLElement;
    expect(bar.className).toContain('selected');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- --run src/lib/components/SegmentBar.svelte.test.ts`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement**

`src/lib/components/SegmentBar.svelte`:

```svelte
<script lang="ts">
  import { formatClock } from '$lib/domain/format';
  import type { Segment } from '$lib/domain/segments';

  let {
    segment,
    lane,
    pxPerSecond,
    selected = false,
    index,
    onSelect,
    onChange,
  }: {
    segment: Segment;
    lane: number;
    pxPerSecond: number;
    selected?: boolean;
    index: number;
    onSelect?: (id: string) => void;
    onChange?: (id: string, next: Segment, moved: 'start' | 'end') => void;
  } = $props();

  let drag = $state<{ edge: 'start' | 'end'; pointerX: number; initial: Segment } | null>(null);

  function startDrag(edge: 'start' | 'end', event: PointerEvent) {
    event.stopPropagation();
    onSelect?.(segment.id);
    const target = event.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events in tests have no real pointer to capture.
    }
    drag = { edge, pointerX: event.clientX, initial: { ...segment } };
  }

  function moveDrag(event: PointerEvent) {
    if (!drag) return;
    const delta = (event.clientX - drag.pointerX) / pxPerSecond;
    const next: Segment =
      drag.edge === 'start'
        ? { ...drag.initial, start: drag.initial.start + delta }
        : { ...drag.initial, end: drag.initial.end + delta };
    onChange?.(segment.id, next, drag.edge);
  }

  function endDrag() {
    drag = null;
  }

  function handleKey(event: KeyboardEvent, edge: 'start' | 'end') {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = (event.shiftKey ? 1 : 0.1) * (event.key === 'ArrowLeft' ? -1 : 1);
    const next: Segment =
      edge === 'start' ? { ...segment, start: segment.start + step } : { ...segment, end: segment.end + step };
    onChange?.(segment.id, next, edge);
  }

  const duration = $derived(segment.end - segment.start);
</script>

<div
  class="segment-bar absolute flex h-9 items-center rounded-selector border border-base-content/20"
  class:selected
  style="left:{segment.start * pxPerSecond}px; width:{duration * pxPerSecond}px; top:{lane * 44}px"
  role="button"
  tabindex="0"
  data-testid="segment-bar"
  data-start={segment.start.toFixed(3)}
  data-end={segment.end.toFixed(3)}
  data-duration={duration.toFixed(3)}
  onpointerdown={() => onSelect?.(segment.id)}
  onkeydown={(event) => {
    if (event.key === 'Enter' || event.key === ' ') onSelect?.(segment.id);
  }}
>
  <span
    class="handle absolute left-0 top-0 h-full w-3 cursor-ew-resize rounded-l bg-primary"
    role="slider"
    tabindex="0"
    aria-label={`Clip ${index + 1} start`}
    aria-valuemin={0}
    aria-valuenow={segment.start}
    aria-valuemax={segment.end}
    data-testid="handle-start"
    onpointerdown={(event) => startDrag('start', event)}
    onpointermove={moveDrag}
    onpointerup={endDrag}
    onkeydown={(event) => handleKey(event, 'start')}
  ></span>
  <span class="pointer-events-none mx-auto truncate px-4 text-xs">
    Clip {index + 1} · {formatClock(duration)}
  </span>
  <span
    class="handle absolute right-0 top-0 h-full w-3 cursor-ew-resize rounded-r bg-primary"
    role="slider"
    tabindex="0"
    aria-label={`Clip ${index + 1} end`}
    aria-valuemin={segment.start}
    aria-valuenow={segment.end}
    aria-valuemax={100000}
    data-testid="handle-end"
    onpointerdown={(event) => startDrag('end', event)}
    onpointermove={moveDrag}
    onpointerup={endDrag}
    onkeydown={(event) => handleKey(event, 'end')}
  ></span>
</div>

<style>
  .segment-bar {
    background: color-mix(in oklab, var(--color-primary) 18%, transparent);
  }
  .segment-bar.selected {
    background: color-mix(in oklab, var(--color-primary) 38%, transparent);
    outline: 2px solid var(--color-primary);
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- --run src/lib/components/SegmentBar.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/SegmentBar.svelte src/lib/components/SegmentBar.svelte.test.ts
git commit -m "feat: segment bar with independent drag handles and keyboard nudging"
```

---

### Task 14: Timeline, filmstrip thumbnails, and page wiring

**Files:**
- Create: `src/lib/media/thumbnails.ts`, `src/lib/media/thumbnails.browser.test.ts`, `src/lib/components/Filmstrip.svelte`, `src/lib/components/Timeline.svelte`, `src/lib/components/Timeline.svelte.test.ts`
- Modify: `src/lib/state/project.svelte.ts` (add `addThumb`), `src/routes/+page.svelte` (replace `timeline-slot`)

**Interfaces:**
- Consumes: `generateTicks`/`assignLanes` (Task 5), `SegmentBar` (Task 13), `formatClock` (Task 2), `project` (Task 10).
- Produces:
  - `extractThumbnails(file: File, count: number, width: number, onThumb?: (thumb: { time: number; url: string }) => void): Promise<{ time: number; url: string }[]>`
  - `ProjectState.addThumb(thumb: { time: number; url: string }): void` — appends without revoking (used for progressive rendering; `setThumbs([])` from `begin()` cleans up).
  - `Timeline` with props `{ duration, segments, selectedId, currentTime, zoom (bindable), thumbs, coverage, onSeek, onSelect, onSegmentChange }`; testids `timeline`, `ruler`, `filmstrip`, `playhead`, `zoom-slider`.

- [ ] **Step 1: Write the failing thumbnails test**

`src/lib/media/thumbnails.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import tiny5sUrl from '../../../static/test-fixtures/tiny-5s.mp4?url';
import { extractThumbnails } from './thumbnails';

describe('extractThumbnails', () => {
  it('extracts the requested number of thumbnails with object URLs', async () => {
    const blob = await (await fetch(tiny5sUrl)).blob();
    const file = new File([blob], 'tiny-5s.mp4', { type: 'video/mp4' });
    const progressive: number[] = [];
    const thumbs = await extractThumbnails(file, 4, 160, () => progressive.push(1));
    expect(thumbs).toHaveLength(4);
    expect(progressive).toHaveLength(4);
    for (const thumb of thumbs) {
      expect(thumb.url.startsWith('blob:')).toBe(true);
      expect(thumb.time).toBeGreaterThanOrEqual(0);
      expect(thumb.time).toBeLessThanOrEqual(5);
    }
  });
});
```

- [ ] **Step 2: Implement thumbnails**

`src/lib/media/thumbnails.ts`:

```ts
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';

export async function extractThumbnails(
  file: File,
  count: number,
  width: number,
  onThumb?: (thumb: { time: number; url: string }) => void
): Promise<{ time: number; url: string }[]> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) return [];
  const duration = await input.computeDuration();
  const sink = new VideoSampleSink(track);
  const out: { time: number; url: string }[] = [];

  for (let i = 0; i < count; i++) {
    const time = Math.min(((i + 0.5) / count) * duration, Math.max(duration - 0.05, 0));
    const sample = await sink.getSample(time);
    if (!sample) continue;
    const scale = Math.min(1, width / sample.displayWidth);
    const canvas = new OffscreenCanvas(
      Math.max(2, Math.round(sample.displayWidth * scale)),
      Math.max(2, Math.round(sample.displayHeight * scale))
    );
    const context = canvas.getContext('2d');
    if (!context) continue;
    sample.draw(context, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    const thumb = { time, url: URL.createObjectURL(blob) };
    out.push(thumb);
    onThumb?.(thumb);
  }

  return out;
}
```

Add to `ProjectState` (Task 10 file):

```ts
  addThumb(thumb: { time: number; url: string }): void {
    this.thumbs = [...this.thumbs, thumb];
  }
```

- [ ] **Step 3: Run the thumbnails test**

Run: `pnpm test:unit -- --run src/lib/media/thumbnails.browser.test.ts`
Expected: PASS. If `Onscreencanvas.convertToBlob` is unavailable, fall back to `canvas.toDataURL('image/jpeg', 0.7)` converted via `await fetch(dataUrl).then((r) => r.blob())`.

- [ ] **Step 4: Implement Filmstrip and Timeline**

`src/lib/components/Filmstrip.svelte`:

```svelte
<script lang="ts">
  let {
    thumbs,
    pxPerSecond,
  }: { thumbs: { time: number; url: string }[]; pxPerSecond: number } = $props();
</script>

<div class="absolute left-0 top-7 h-12 opacity-60" data-testid="filmstrip">
  {#each thumbs as thumb (thumb.url)}
    <img
      src={thumb.url}
      alt=""
      class="absolute top-0 h-12 w-16 rounded-sm object-cover"
      style="left:{thumb.time * pxPerSecond}px"
    />
  {/each}
</div>
```

`src/lib/components/Timeline.svelte`:

```svelte
<script lang="ts">
  import { formatClock } from '$lib/domain/format';
  import type { Interval, Segment } from '$lib/domain/segments';
  import { assignLanes, generateTicks } from '$lib/domain/timeline';
  import Filmstrip from './Filmstrip.svelte';
  import SegmentBar from './SegmentBar.svelte';

  let {
    duration,
    segments,
    selectedId,
    currentTime,
    zoom = $bindable(1),
    thumbs,
    coverage,
    onSeek,
    onSelect,
    onSegmentChange,
  }: {
    duration: number;
    segments: Segment[];
    selectedId: string | null;
    currentTime: number;
    zoom?: number;
    thumbs: { time: number; url: string }[];
    coverage: { gaps: Interval[]; overlaps: Interval[] };
    onSeek: (time: number) => void;
    onSelect: (id: string) => void;
    onSegmentChange: (id: string, next: Segment, moved: 'start' | 'end') => void;
  } = $props();

  let scroller = $state<HTMLDivElement | null>(null);
  let viewportWidth = $state(800);
  let lastPxPerSecond = 0;

  const pxPerSecond = $derived((viewportWidth * zoom) / Math.max(duration, 0.001));
  const contentWidth = $derived(viewportWidth * zoom);
  const ticks = $derived(generateTicks(duration, pxPerSecond));
  const lanes = $derived(assignLanes(segments));
  const laneCount = $derived(Math.max(1, ...lanes.map((lane) => lane + 1)));

  $effect(() => {
    const pps = pxPerSecond;
    if (scroller && lastPxPerSecond !== 0 && pps !== lastPxPerSecond) {
      scroller.scrollLeft = currentTime * pps - viewportWidth / 2;
    }
    lastPxPerSecond = pps;
  });

  function seek(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const time = (event.clientX - rect.left) / pxPerSecond;
    onSeek(Math.min(Math.max(time, 0), duration));
  }
</script>

<div class="flex flex-col gap-2">
  <div class="overflow-x-auto rounded-box bg-base-200 p-2" bind:this={scroller} bind:clientWidth={viewportWidth}>
    <div
      class="relative"
      style="width:{contentWidth}px; height:{64 + laneCount * 44}px"
      onclick={seek}
      data-testid="timeline"
    >
      <Filmstrip {thumbs} {pxPerSecond} />
      <div class="absolute left-0 top-0 h-6 w-full" data-testid="ruler">
        {#each ticks as tick (tick.time)}
          <span class="absolute top-0 text-[10px] text-base-content/60" style="left:{tick.time * pxPerSecond}px">
            {tick.major ? formatClock(tick.time) : ''}
          </span>
        {/each}
      </div>
      {#each coverage.gaps as gap}
        <div
          class="absolute bg-warning/40"
          style="left:{gap.start * pxPerSecond}px; width:{Math.max(2, (gap.end - gap.start) * pxPerSecond)}px; top:20px; height:{laneCount * 44}px"
          title="Uncovered"
        ></div>
      {/each}
      {#each segments as segment, index (segment.id)}
        <SegmentBar
          {segment}
          lane={lanes[index]}
          {pxPerSecond}
          selected={segment.id === selectedId}
          {index}
          onSelect={(id) => onSelect(id)}
          onChange={(id, next, moved) => onSegmentChange(id, next, moved)}
        />
      {/each}
      <div
        class="absolute top-0 h-full w-0.5 bg-error"
        style="left:{currentTime * pxPerSecond}px"
        data-testid="playhead"
      ></div>
    </div>
  </div>
  <label class="flex items-center gap-2 text-xs">
    Zoom
    <input
      class="range range-xs max-w-xs"
      type="range"
      min="1"
      max="20"
      step="0.1"
      bind:value={zoom}
      data-testid="zoom-slider"
    />
  </label>
</div>
```

- [ ] **Step 5: Write the Timeline test**

`src/lib/components/Timeline.svelte.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Timeline from './Timeline.svelte';

const segments = [
  { id: 'a', start: 0, end: 30 },
  { id: 'b', start: 30, end: 60 },
  { id: 'c', start: 60, end: 80 },
];

describe('Timeline', () => {
  it('renders one bar per segment', async () => {
    const screen = await render(Timeline, {
      duration: 80,
      segments,
      selectedId: 'a',
      currentTime: 0,
      thumbs: [],
      coverage: { gaps: [], overlaps: [] },
      onSeek: () => {},
      onSelect: () => {},
      onSegmentChange: () => {},
    });
    expect(screen.container.querySelectorAll('[data-testid="segment-bar"]')).toHaveLength(3);
  });

  it('seeks to the clicked time', async () => {
    const onSeek = vi.fn();
    const screen = await render(Timeline, {
      duration: 80,
      segments,
      selectedId: null,
      currentTime: 0,
      thumbs: [],
      coverage: { gaps: [], overlaps: [] },
      onSeek,
      onSelect: () => {},
      onSegmentChange: () => {},
    });
    const timeline = screen.container.querySelector('[data-testid="timeline"]') as HTMLElement;
    const rect = timeline.getBoundingClientRect();
    timeline.dispatchEvent(
      new MouseEvent('click', { clientX: rect.left + rect.width / 2, bubbles: true })
    );
    expect(onSeek).toHaveBeenCalled();
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(40, 0);
  });
});
```

- [ ] **Step 6: Wire the Timeline into the page**

In `src/routes/+page.svelte`, add the thumbnail effect (module scope inside `<script>`):

```ts
import { extractThumbnails } from '$lib/media/thumbnails';
import Timeline from '$lib/components/Timeline.svelte';

$effect(() => {
  const file = project.file;
  const meta = project.meta;
  if (!file || !meta) return;
  let cancelled = false;
  extractThumbnails(file, 30, 160, (thumb) => {
    if (!cancelled) project.addThumb(thumb);
  }).catch((error) => {
    console.error('[thumbs] extraction failed', error);
  });
  return () => {
    cancelled = true;
  };
});
```

Replace the `timeline-slot` div with:

```svelte
<Timeline
  duration={project.duration}
  segments={project.sortedSegments}
  selectedId={project.selectedId}
  {currentTime}
  bind:zoom={project.zoom}
  thumbs={project.thumbs}
  coverage={project.coverage}
  onSeek={(time) => {
    currentTime = time;
    seekRequest = { t: time };
  }}
  onSelect={selectClip}
  onSegmentChange={(id, next, moved) => project.updateSegment(id, next, moved)}
/>
```

Note: the thumbnail effect must be cancelled-safe; when a new file is loaded, `begin()` revokes old URLs and the cleanup flag stops in-flight appends.

- [ ] **Step 7: Run tests and checks**

Run: `pnpm test:unit -- --run src/lib/components/Timeline.svelte.test.ts src/lib/media/thumbnails.browser.test.ts`
Expected: PASS.

Run: `pnpm check`
Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/media/thumbnails.ts src/lib/media/thumbnails.browser.test.ts src/lib/components/Filmstrip.svelte src/lib/components/Timeline.svelte src/lib/components/Timeline.svelte.test.ts src/lib/state/project.svelte.ts src/routes/+page.svelte
git commit -m "feat: shared timeline with filmstrip, ruler, lanes and zoom"
```

### Task 15: SegmentPanel and TimeField (numeric editing, split/delete/reset, max length)

**Files:**
- Create: `src/lib/components/TimeField.svelte`, `src/lib/components/TimeField.svelte.test.ts`, `src/lib/components/SegmentPanel.svelte`, `src/lib/components/SegmentPanel.svelte.test.ts`
- Modify: `src/routes/+page.svelte` (replace `panel-slot`)

**Interfaces:**
- Consumes: `formatClock`/`parseClock` (Task 2), `project` store (Task 10).
- Produces:
  - `TimeField` props `{ label: string; seconds: number; onCommit: (value: number) => void; testid?: string }` — shows `MM:SS.d`, commits on Enter/blur through `parseClock`, shows an error style and does not commit on invalid input.
  - `SegmentPanel` (uses the `project` singleton) with testids: `clip-count`, `input-max-length`, `time-field-start/-end/-duration`, `btn-split`, `btn-delete`, `btn-reset`. Split is disabled when the selected clip is shorter than 2 × 0.5s.

- [ ] **Step 1: Write the failing TimeField test**

`src/lib/components/TimeField.svelte.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TimeField from './TimeField.svelte';

describe('TimeField', () => {
  it('shows a formatted value and commits parsed input', async () => {
    const onCommit = vi.fn();
    const screen = await render(TimeField, { label: 'Start', seconds: 12.3, onCommit, testid: 'tf' });
    const input = screen.container.querySelector('[data-testid="tf"]') as HTMLInputElement;
    expect(input.value).toBe('00:12.3');

    input.value = '15.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCommit).toHaveBeenCalledWith(15.5);
  });

  it('rejects invalid input without committing', async () => {
    const onCommit = vi.fn();
    const screen = await render(TimeField, { label: 'Start', seconds: 1, onCommit, testid: 'tf' });
    const input = screen.container.querySelector('[data-testid="tf"]') as HTMLInputElement;
    input.value = 'abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.className).toContain('input-error');
  });
});
```

- [ ] **Step 2: Implement TimeField**

`src/lib/components/TimeField.svelte`:

```svelte
<script lang="ts">
  import { formatClock, parseClock } from '$lib/domain/format';

  let {
    label,
    seconds,
    onCommit,
    testid,
  }: {
    label: string;
    seconds: number;
    onCommit: (value: number) => void;
    testid?: string;
  } = $props();

  let text = $state(formatClock(seconds));
  let invalid = $state(false);

  $effect(() => {
    text = formatClock(seconds);
    invalid = false;
  });

  function commit() {
    const value = parseClock(text);
    if (value === null) {
      invalid = true;
      return;
    }
    invalid = false;
    onCommit(value);
  }
</script>

<label class="flex flex-col gap-1 text-xs">
  {label}
  <input
    class="input input-xs w-24"
    class:input-error={invalid}
    data-testid={testid}
    bind:value={text}
    onblur={commit}
    onkeydown={(event) => {
      if (event.key === 'Enter') commit();
    }}
  />
</label>
```

- [ ] **Step 3: Implement SegmentPanel and its test**

`src/lib/components/SegmentPanel.svelte`:

```svelte
<script lang="ts">
  import { project } from '$lib/state/project.svelte';
  import TimeField from './TimeField.svelte';

  const selected = $derived(project.selected);
  const canSplit = $derived(selected !== null && selected.end - selected.start >= 1);
  const clipNumber = $derived(project.sortedSegments.findIndex((s) => s.id === selected?.id) + 1);
</script>

<div class="flex flex-col gap-3">
  <div class="flex items-center justify-between">
    <h2 class="font-semibold">Clip controls</h2>
    <span class="text-xs text-base-content/60" data-testid="clip-count">
      {project.segments.length} clip{project.segments.length === 1 ? '' : 's'}
    </span>
  </div>

  <label class="flex items-center gap-2 text-xs">
    Max clip length
    <input
      class="input input-xs w-20"
      type="number"
      min="1"
      max="300"
      step="1"
      value={project.maxClipDuration}
      data-testid="input-max-length"
      onchange={(event) => project.setMaxClipDuration(Number((event.currentTarget as HTMLInputElement).value))}
    />
    s
  </label>

  {#if selected}
    <div class="flex flex-wrap items-end gap-3">
      <TimeField
        label={`Clip ${clipNumber} start`}
        seconds={selected.start}
        testid="time-field-start"
        onCommit={(value) => project.setSelectedField('start', value)}
      />
      <TimeField
        label="End"
        seconds={selected.end}
        testid="time-field-end"
        onCommit={(value) => project.setSelectedField('end', value)}
      />
      <TimeField
        label="Duration"
        seconds={selected.end - selected.start}
        testid="time-field-duration"
        onCommit={(value) => project.setSelectedField('duration', value)}
      />
    </div>
    <div class="flex flex-wrap gap-2">
      <button class="btn btn-sm" type="button" data-testid="btn-split" disabled={!canSplit} onclick={() => project.splitSelected()}>
        Split in half
      </button>
      <button class="btn btn-sm btn-ghost" type="button" data-testid="btn-delete" onclick={() => project.deleteSelected()}>
        Delete
      </button>
      <button class="btn btn-sm btn-ghost" type="button" data-testid="btn-reset" onclick={() => project.resetSplit()}>
        Reset to auto-split
      </button>
    </div>
  {:else}
    <p class="text-sm text-base-content/60">Select a clip on the timeline.</p>
  {/if}
</div>
```

`src/lib/components/SegmentPanel.svelte.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { VideoMeta } from '$lib/domain/bitrate';
import { project } from '$lib/state/project.svelte';
import SegmentPanel from './SegmentPanel.svelte';

const meta = (): VideoMeta => ({
  displayWidth: 1920,
  displayHeight: 1080,
  rotation: 0,
  frameRate: 30,
  videoCodec: 'avc1.42001f',
  audioCodec: 'mp4a.40.2',
  hasAudio: true,
  audioDecodable: true,
  videoDecodable: true,
});

describe('SegmentPanel', () => {
  beforeEach(() => {
    project.begin(new File([], 'v.mp4'));
    project.ready(80, meta());
  });

  it('shows the clip count and edits the selected duration', async () => {
    const screen = await render(SegmentPanel);
    expect(screen.container.querySelector('[data-testid="clip-count"]')?.textContent).toContain('3 clips');
    const duration = screen.container.querySelector('[data-testid="time-field-duration"]') as HTMLInputElement;
    duration.value = '10';
    duration.dispatchEvent(new Event('input', { bubbles: true }));
    duration.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(project.selected!.end - project.selected!.start).toBeCloseTo(10, 1);
  });

  it('splits, deletes and resets', async () => {
    const screen = await render(SegmentPanel);
    (screen.container.querySelector('[data-testid="btn-split"]') as HTMLButtonElement).click();
    expect(project.segments.length).toBe(4);
    (screen.container.querySelector('[data-testid="btn-delete"]') as HTMLButtonElement).click();
    expect(project.segments.length).toBe(3);
    (screen.container.querySelector('[data-testid="btn-reset"]') as HTMLButtonElement).click();
    expect(project.segments.length).toBe(3);
    expect(project.dirty).toBe(false);
  });
});
```

- [ ] **Step 4: Wire into the page**

In `src/routes/+page.svelte`, import `SegmentPanel` and replace the `panel-slot` div with:

```svelte
<SegmentPanel />
```

- [ ] **Step 5: Run tests and checks**

Run: `pnpm test:unit -- --run src/lib/components/TimeField.svelte.test.ts src/lib/components/SegmentPanel.svelte.test.ts`
Expected: PASS.

Run: `pnpm check`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/TimeField.svelte src/lib/components/TimeField.svelte.test.ts src/lib/components/SegmentPanel.svelte src/lib/components/SegmentPanel.svelte.test.ts src/routes/+page.svelte
git commit -m "feat: clip control panel with exact time fields and clip operations"
```

---

### Task 16: ExportPanel, share sheet, and final page assembly

**Files:**
- Create: `src/lib/media/share.ts`, `src/lib/media/share.browser.test.ts`, `src/lib/components/ExportPanel.svelte`, `src/lib/components/ExportPanel.svelte.test.ts`
- Modify: `src/routes/+page.svelte` (replace `export-slot`, add Space shortcut)

**Interfaces:**
- Consumes: `ExportState` (Task 9), `realEncodeClip` (Task 8), `downloadBlob` (Task 9), `makeZip` (Task 9), `buildOutputPlan`/`PRESET_LIMITS` (Task 4), naming helpers (Task 2), `project` (Task 10).
- Produces:
  - `canShareFiles(): boolean`, `shareBlob(blob: Blob, fileName: string): Promise<void>`.
  - `ExportPanel` with an optional `exporter?: ExportState | null` prop (dependency injection for tests; defaults to a real instance). Testids: `preset-select`, `export-row`, `btn-export-clip`, `btn-share-clip`, `btn-retry-clip`, `export-error`, `btn-export-all`, `btn-cancel-export`.
  - Deviation from the spec's file list: no separate `ProgressBar.svelte` — a native `<progress>` element is used inline (YAGNI).

- [ ] **Step 1: Write the failing share test**

`src/lib/media/share.browser.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareFiles, shareBlob } from './share';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('share helpers', () => {
  it('reports unsupported when navigator.share is missing', () => {
    vi.stubGlobal('navigator', {});
    expect(canShareFiles()).toBe(false);
  });

  it('detects file sharing support', () => {
    vi.stubGlobal('navigator', { canShare: () => true, share: async () => {} });
    expect(canShareFiles()).toBe(true);
  });

  it('shares a blob as a named file', async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', { canShare: () => true, share });
    await shareBlob(new Blob([new Uint8Array([1])]), 'clip.mp4');
    expect(share).toHaveBeenCalledOnce();
    const files = (share.mock.calls[0][0] as { files: File[] }).files;
    expect(files[0].name).toBe('clip.mp4');
    expect(files[0].type).toBe('video/mp4');
  });
});
```

(If `vi.stubGlobal('navigator', ...)` misbehaves in browser mode, use `Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })` in a `beforeEach` and restore in `afterEach`.)

- [ ] **Step 2: Implement share**

`src/lib/media/share.ts`:

```ts
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') return false;
  try {
    return navigator.canShare({
      files: [new File([new Uint8Array([1])], 'probe.mp4', { type: 'video/mp4' })],
    });
  } catch (error) {
    console.error('[share] capability probe failed', error);
    return false;
  }
}

export async function shareBlob(blob: Blob, fileName: string): Promise<void> {
  const file = new File([blob], fileName, { type: 'video/mp4' });
  await navigator.share({ files: [file], title: fileName });
}
```

- [ ] **Step 3: Implement ExportPanel and its test**

`src/lib/components/ExportPanel.svelte`:

```svelte
<script lang="ts">
  import { buildOutputPlan } from '$lib/domain/bitrate';
  import { clipFileName, sanitizeBaseName, zipFileName } from '$lib/domain/naming';
  import { downloadBlob } from '$lib/media/download';
  import { realEncodeClip } from '$lib/media/exporter';
  import { canShareFiles, shareBlob } from '$lib/media/share';
  import { makeZip } from '$lib/media/zip';
  import { ExportState } from '$lib/state/export.svelte';
  import { project } from '$lib/state/project.svelte';

  let { exporter = null }: { exporter?: ExportState | null } = $props();
  const state = exporter ?? new ExportState({ encodeClip: realEncodeClip, downloadBlob, makeZip });

  const base = $derived(sanitizeBaseName(project.file?.name ?? 'video'));
  const jobs = $derived(
    project.meta
      ? project.sortedSegments.map((segment, index) => ({
          id: segment.id,
          fileName: clipFileName(base, index),
          segment,
          plan: buildOutputPlan(segment.end - segment.start, project.meta!, project.preset),
        }))
      : []
  );
  const shareable = canShareFiles();

  const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  async function exportClip(job: (typeof jobs)[number]) {
    if (!project.file) return;
    await state.runJobs(project.file, [job], { finish: 'download-first' });
  }

  async function exportAll() {
    if (!project.file) return;
    await state.runJobs(project.file, jobs, { finish: 'zip', zipName: zipFileName(base) });
  }

  async function shareClip(job: (typeof jobs)[number]) {
    if (!project.file) return;
    let blob = state.results[job.id];
    if (!blob) {
      await state.runJobs(project.file, [job], { finish: 'none' });
      blob = state.results[job.id];
    }
    if (!blob) return;
    try {
      await shareBlob(blob, job.fileName);
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        console.error('[share] failed', error);
        project.setError('Sharing failed. The clip was still exported and can be downloaded.');
      }
    }
  }
</script>

<div class="flex flex-col gap-3">
  <div class="flex items-center justify-between">
    <h2 class="font-semibold">Export</h2>
    <select class="select select-xs" bind:value={project.preset} data-testid="preset-select">
      <option value="whatsapp">WhatsApp (≤16MB)</option>
      <option value="high">High quality</option>
      <option value="small">Small file</option>
    </select>
  </div>

  <ul class="flex flex-col gap-2">
    {#each jobs as job (job.id)}
      <li class="rounded-box bg-base-200 p-2" data-testid="export-row">
        <div class="flex items-center justify-between gap-2 text-xs">
          <span class="truncate">{job.fileName}</span>
          <span class="shrink-0 text-base-content/60">{formatSize(job.plan.estimatedBytes)}</span>
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-2">
          <button
            class="btn btn-xs"
            type="button"
            data-testid="btn-export-clip"
            disabled={state.busy}
            onclick={() => exportClip(job)}
          >
            Download
          </button>
          {#if shareable}
            <button
              class="btn btn-xs btn-ghost"
              type="button"
              data-testid="btn-share-clip"
              disabled={state.busy}
              onclick={() => shareClip(job)}
            >
              Share
            </button>
          {/if}
          {#if state.statuses[job.id] === 'failed'}
            <button
              class="btn btn-xs btn-warning"
              type="button"
              data-testid="btn-retry-clip"
              disabled={state.busy}
              onclick={() => exportClip(job)}
            >
              Retry
            </button>
          {/if}
          {#if state.statuses[job.id] === 'encoding'}
            <progress class="progress progress-primary w-24" value={state.progress[job.id] ?? 0} max="1"></progress>
          {:else if state.statuses[job.id] === 'done'}
            <span class="text-xs text-success">Done</span>
          {:else if state.statuses[job.id] === 'canceled'}
            <span class="text-xs text-base-content/60">Canceled</span>
          {/if}
          {#if state.errors[job.id]}
            <span class="text-xs text-error" data-testid="export-error">{state.errors[job.id]}</span>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  <div class="flex gap-2">
    <button
      class="btn btn-sm btn-primary"
      type="button"
      data-testid="btn-export-all"
      disabled={state.busy || jobs.length === 0}
      onclick={exportAll}
    >
      Export all (ZIP)
    </button>
    {#if state.busy}
      <button class="btn btn-sm btn-ghost" type="button" data-testid="btn-cancel-export" onclick={() => state.cancel()}>
        Cancel
      </button>
    {/if}
  </div>
</div>
```

`src/lib/components/ExportPanel.svelte.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { VideoMeta } from '$lib/domain/bitrate';
import { ExportState } from '$lib/state/export.svelte';
import { project } from '$lib/state/project.svelte';
import ExportPanel from './ExportPanel.svelte';

const meta = (): VideoMeta => ({
  displayWidth: 1920,
  displayHeight: 1080,
  rotation: 0,
  frameRate: 30,
  videoCodec: 'avc1.42001f',
  audioCodec: 'mp4a.40.2',
  hasAudio: true,
  audioDecodable: true,
  videoDecodable: true,
});

const fakeBlob = new Blob([new Uint8Array([1])]);

function makeExporter(downloads: string[]) {
  return new ExportState({
    encodeClip: () => ({
      result: Promise.resolve(fakeBlob),
      cancel: async () => {},
    }),
    downloadBlob: (_blob, name) => downloads.push(name),
    makeZip: async () => fakeBlob,
  });
}

describe('ExportPanel', () => {
  beforeEach(() => {
    project.begin(new File([], 'vid.mp4'));
    project.ready(80, meta());
  });

  it('lists one row per clip with estimated sizes', async () => {
    const screen = await render(ExportPanel, { exporter: makeExporter([]) });
    expect(screen.container.querySelectorAll('[data-testid="export-row"]')).toHaveLength(3);
  });

  it('downloads the clicked clip with its part name', async () => {
    const downloads: string[] = [];
    const screen = await render(ExportPanel, { exporter: makeExporter(downloads) });
    (screen.container.querySelector('[data-testid="btn-export-clip"]') as HTMLButtonElement).click();
    await expect.poll(() => downloads.length).toBe(1);
    expect(downloads[0]).toBe('vid_part01.mp4');
  });

  it('changes the quality preset', async () => {
    const screen = await render(ExportPanel, { exporter: makeExporter([]) });
    const select = screen.container.querySelector('[data-testid="preset-select"]') as HTMLSelectElement;
    select.value = 'small';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(project.preset).toBe('small');
  });
});
```

- [ ] **Step 4: Finish the page**

In `src/routes/+page.svelte`: import `ExportPanel`, replace the `export-slot` div with `<ExportPanel />`, and add a Space shortcut that toggles preview playback:

```ts
import VideoPreview from '$lib/components/VideoPreview.svelte';
let preview = $state<VideoPreview | null>(null);

function handleKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (event.key === ' ' && target && !['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) {
    event.preventDefault();
    preview?.toggle();
  }
}
```

Add `bind:this={preview}` to the `<VideoPreview ...>` element and `<svelte:window onkeydown={handleKeydown} />` inside the markup.

- [ ] **Step 5: Run tests and checks**

Run: `pnpm test:unit -- --run src/lib/media/share.browser.test.ts src/lib/components/ExportPanel.svelte.test.ts`
Expected: PASS.

Run: `pnpm check && pnpm lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/media/share.ts src/lib/media/share.browser.test.ts src/lib/components/ExportPanel.svelte src/lib/components/ExportPanel.svelte.test.ts src/routes/+page.svelte
git commit -m "feat: export panel with presets, progress, cancel, retry and share sheet"
```

---

### Task 17: End-to-end suite (Playwright)

**Files:**
- Create: `e2e/helpers/media.ts`, `e2e/splitter.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: the whole app; fixtures from Task 6; Mediabunny demuxing in Node (`BufferSource`) for output verification.
- Produces: seven end-to-end tests covering auto-split, dragging, clip operations, single export (mid-GOP + duration), ZIP export, rotation, and no-audio.

- [ ] **Step 1: Configure Playwright**

Set `playwright.config.ts` to serve the dev server deterministically:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1440, height: 900 },
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite dev --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Step 2: Write the media helper**

`e2e/helpers/media.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';

export async function readMediaMeta(path: string) {
  const bytes = await readFile(path);
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(new Uint8Array(bytes)) });
  const video = await input.getPrimaryVideoTrack();
  return {
    duration: await input.computeDuration(),
    displayWidth: video ? await video.getDisplayWidth() : 0,
    displayHeight: video ? await video.getDisplayHeight() : 0,
    rotation: video ? await video.getRotation() : 0,
    hasAudio: (await input.getPrimaryAudioTrack()) !== null,
  };
}
```

- [ ] **Step 3: Write the e2e tests**

`e2e/splitter.spec.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readMediaMeta } from './helpers/media';

const FIXTURES = 'static/test-fixtures';

async function loadFixture(page: Page, name: string) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(`${FIXTURES}/${name}`);
  await expect(page.getByTestId('file-name')).toContainText(name);
}

async function splitIntoTwoSecondClips(page: Page) {
  const input = page.getByTestId('input-max-length');
  await input.fill('2');
  await input.press('Enter');
  await page.getByTestId('btn-reset').click();
}

test('auto-splits a 5s video into 2/2/1 clips', async ({ page }) => {
  await loadFixture(page, 'tiny-5s.mp4');
  await splitIntoTwoSecondClips(page);
  const bars = page.getByTestId('segment-bar');
  await expect(bars).toHaveCount(3);
  await expect(bars.nth(0)).toHaveAttribute('data-duration', '2.000');
  await expect(bars.nth(1)).toHaveAttribute('data-duration', '2.000');
  await expect(bars.nth(2)).toHaveAttribute('data-duration', '1.000');
});

test('dragging a clip start moves only that clip and respects clamps', async ({ page }) => {
  await loadFixture(page, 'tiny-5s.mp4');
  await splitIntoTwoSecondClips(page);
  const handle = page.getByTestId('segment-bar').nth(1).getByTestId('handle-start');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  const second = page.getByTestId('segment-bar').nth(1);
  const start = Number(await second.getAttribute('data-start'));
  const duration = Number(await second.getAttribute('data-duration'));
  expect(start).toBeGreaterThan(2);
  expect(duration).toBeLessThanOrEqual(2.0001);
  // First clip did not move.
  await expect(page.getByTestId('segment-bar').nth(0)).toHaveAttribute('data-start', '0.000');
});

test('split, delete and reset edit the clip set', async ({ page }) => {
  await loadFixture(page, 'tiny-5s.mp4');
  await splitIntoTwoSecondClips(page);
  await page.getByTestId('segment-bar').nth(0).click();
  await page.getByTestId('btn-split').click();
  await expect(page.getByTestId('segment-bar')).toHaveCount(4);
  await page.getByTestId('btn-delete').click();
  await expect(page.getByTestId('segment-bar')).toHaveCount(3);
  await page.getByTestId('btn-reset').click();
  await expect(page.getByTestId('segment-bar')).toHaveCount(3);
});

test('exports a single clip: valid MP4, exact duration, part01 name', async ({ page }) => {
  await loadFixture(page, 'tiny-5s.mp4');
  await splitIntoTwoSecondClips(page);
  await page.getByTestId('segment-bar').nth(0).click();

  const start = page.getByTestId('time-field-start');
  await start.fill('1');
  await start.press('Enter');
  const end = page.getByTestId('time-field-end');
  await end.fill('2.5');
  await end.press('Enter');

  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('btn-export-clip').first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('tiny-5s_part01.mp4');

  const path = (await download.path())!;
  const bytes = await readFile(path);
  expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
  const meta = await readMediaMeta(path);
  expect(Math.abs(meta.duration - 1.5)).toBeLessThanOrEqual(0.35);
  expect(meta.hasAudio).toBe(true);
});

test('export all produces a ZIP with one entry per clip', async ({ page }) => {
  await loadFixture(page, 'tiny-5s.mp4');
  await splitIntoTwoSecondClips(page);

  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByTestId('btn-export-all').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('tiny-5s_parts.zip');

  const bytes = await readFile((await download.path())!);
  const entries = unzipSync(new Uint8Array(bytes));
  expect(Object.keys(entries).sort()).toEqual([
    'tiny-5s_part01.mp4',
    'tiny-5s_part02.mp4',
    'tiny-5s_part03.mp4',
  ]);
});

test('rotated portrait source exports portrait', async ({ page }) => {
  await loadFixture(page, 'tiny-portrait-rotated.mp4');
  await splitIntoTwoSecondClips(page);

  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('btn-export-clip').first().click();
  const download = await downloadPromise;
  const meta = await readMediaMeta((await download.path())!);
  expect(meta.displayHeight).toBeGreaterThan(meta.displayWidth);
});

test('video without audio exports a silent MP4', async ({ page }) => {
  await loadFixture(page, 'tiny-noaudio.mp4');
  await splitIntoTwoSecondClips(page);

  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('btn-export-clip').first().click();
  const download = await downloadPromise;
  const meta = await readMediaMeta((await download.path())!);
  expect(meta.hasAudio).toBe(false);
  expect(Math.abs(meta.duration - 2)).toBeLessThanOrEqual(0.35);
});
```

- [ ] **Step 4: Run the suite**

Run: `pnpm test:e2e`
Expected: 7 passing tests. First run downloads browser binaries if missing (`pnpm exec playwright install chromium`).

- [ ] **Step 5: Commit**

```bash
git add e2e/splitter.spec.ts e2e/helpers/media.ts playwright.config.ts
git commit -m "test: end-to-end suite (split, drag, export, zip, rotation, silent video)"
```

---

### Task 18: README, manual smoke checklist, final verification

**Files:**
- Create: `README.md`
- Modify: none (verification only)

**Interfaces:**
- Consumes: everything.
- Produces: a README a human can follow, and a green full check run.

- [ ] **Step 1: Write the README**

`README.md` must contain:

1. **What it is** — one paragraph: splits one video into independent, trimmable ≤30s clips for WhatsApp Status, entirely in the browser.
2. **Prerequisites** — Node 20+, pnpm, Chrome (WebCodecs). ffmpeg only needed to regenerate fixtures.
3. **Setup / run** — `pnpm install`, `pnpm dev`, open the printed URL.
4. **Usage** — load (file picker, drag-drop, drag out of Photos) → set max clip length and Reset to re-split → drag handles / numeric fields / keyboard (Tab to a handle, arrows 0.1s, Shift+arrows 1s) → Split/Delete/Reset → Export clip, Export all (ZIP), or Share to WhatsApp.
5. **Limits & presets** — the Global Constraints table (max clip length default 30s, WhatsApp 720p/≤16MB, etc.), plus: newer WhatsApp versions accept 60–90s, so the 30s is configurable.
6. **Browser support** — Chrome on macOS supported; Safari/Firefox show a notice when WebCodecs is missing.
7. **Testing** — `pnpm test:unit -- --run`, `pnpm test:e2e`, `pnpm check`, `pnpm lint`; note fixtures live in `static/test-fixtures/` and are regenerated with `bash static/test-fixtures/generate.sh`.
8. **Manual smoke checklist** — with a **real** iPhone HEVC portrait video (ideally rotated / 4K), an Android H.264 video, and a macOS screen recording: load without errors → auto-split looks right → drag + numeric trims → export default preset → file ≤16MB → plays in QuickTime → uploads to WhatsApp Status; rotated video exports upright.
9. **Project layout** — short tree of `src/lib/{domain,media,state,components}`.
10. **Non-goals** — the spec's Section 3 list (short).

- [ ] **Step 2: Full verification**

```bash
pnpm check
pnpm lint
pnpm test:unit -- --run
pnpm test:e2e
pnpm build
```

Expected: all green; `pnpm build` produces `build/index.html` (SPA fallback).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with usage, presets, testing and smoke checklist"
```

- [ ] **Step 4: Manual smoke run (human)**

Run `pnpm dev`, then walk the README's checklist with a real phone video. This is the only step that validates real WhatsApp-Status acceptance; report anything it surfaces.

---

## Plan self-review notes

- **Spec coverage:** FR-1→T11, FR-2→T7, FR-3→T3/T10, FR-4→T13/T14, FR-5→T3/T13, FR-6→T3/T15, FR-7→T12, FR-8→T9/T16, FR-9→T9/T16, FR-10→T16, FR-11→T4/T8, FR-12→T14; error surfaces→T7/T9/T11/T16; testing strategy→T2–T10 (unit/browser), T17 (e2e), T18 (manual).
- **Review Focus pinning:** (1) T6/T8/T17, (2) T4/T7/T10/T17, (3) T4, (4) T8/T17, (5) T9/T16.
- **Known deviations from the spec's indicative file list, called out inline:** `domain/timeline.ts` added (tick/lane math), `media/download.ts` added, no `ProgressBar.svelte` (inline `<progress>`), fixtures live in `static/test-fixtures/` so browser tests can fetch them.
- **Type consistency:** `Segment`, `VideoMeta`, `OutputPlan`, `ExportJob`, `EncodeHandle` are defined once and referenced by name everywhere; clamp semantics use the `moved` edge consistently (`clampSegment(…, moved)`, `updateSegment(id, next, moved)`).



