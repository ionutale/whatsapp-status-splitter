# Mobile-First UI (Phone-First Core Flow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make phones the primary experience for load → auto-split → simple trim → export/share, with a phone-first layout and a touch trim bar, while the desktop precision editor stays untouched.

**Architecture:** One route, one set of stores/actions. `+page.svelte` branches on a reactive `MediaQuery('(max-width: 767px)')`; the phone branch composes the existing preview + `ExportPanel` with two new components (`TrimBar`, `ClipStrip`). Trim drags reuse the proven `SegmentBar` pointer math and delegate clamping to `project.updateSegment`; the trim bar shows a computed window around the selected clip so trimmed clips can be extended again.

**Tech Stack:** Svelte 5.57 runes (+ `MediaQuery` from `svelte/reactivity`), Tailwind 4 + DaisyUI, Vitest browser project, Playwright (new `mobile` project).

**Spec:** `docs/superpowers/specs/2026-10-03-mobile-first-design.md`

## Global Constraints

- **Desktop untouched:** all existing desktop behavior and tests stay green unchanged. The phone layout is additive, gated by the `md` breakpoint (768px).
- **No new dependencies.** `MediaQuery` ships with Svelte.
- **Touch targets ≥44px**; follow existing DaisyUI classes and kebab-case testids.
- **Phone column:** sticky mini-header → notices → preview → TrimBar → ClipStrip → ExportPanel (reused). No filmstrip/ruler/zoom/lane on phones; batch panel stays as-is above the branch.
- **Safe area:** phone container gets `padding-bottom: env(safe-area-inset-bottom)`.
- All work commits to local `main` with explicit `git add`; `pnpm check` 0/0 and `pnpm lint` clean per task.
- Do not touch export presets, encoding, offline/service-worker behavior, or deploy config (except Task 4's Playwright project).

## Review Focus

- **Extending a previously trimmed clip on the phone** — dragging a handle past the visible bar edge must keep changing the value (window recenters only after release; no "can't extend" dead end). Task 1 tests the far-drag; Task 4's e2e trims then re-extends.
- **Clamps from the phone bar** — min length 0.5s and video bounds must still hold when the component reports raw values; delegation to `project.updateSegment` is the clamp authority. Task 4 e2e drags the end handle far left and asserts `end ≥ start + 0.5`.
- **Short clips at phone width** (0.5–2s) — handles must remain distinguishable and ≥44px hit areas must not overlap the other handle. Task 1 renders a 0.5s clip and asserts geometry.
- **Long clips (up to 300s) drag precision** — drag is coarse by design; tap-to-type label entry must give exact values. Task 1 pins the exact-entry path with a 300s clip.
- **Breakpoint crossing keeps state** — rotating/resizing across 768px must swap views without losing selection or trims. Task 3 pins it with a viewport-change browser test.

---

### Task 1: `TrimBar` — touch trim component + window math

**Files:**

- Create: `src/lib/domain/trimWindow.ts`
- Create: `src/lib/domain/trimWindow.test.ts`
- Create: `src/lib/components/TrimBar.svelte`
- Create: `src/lib/components/TrimBar.svelte.test.ts`
- Reference: `src/lib/components/SegmentBar.svelte` (drag math + pointer-event test pattern in `SegmentBar.svelte.test.ts`), `src/lib/domain/segments.ts` (`Segment` type)

**Interfaces:**

- Consumes: `Segment` (`{ id, start, end }`) from `../domain/segments`; `formatClock` from `../domain/format`.
- Produces:
  - `computeTrimWindow(start: number, end: number, videoDuration: number): { windowStart: number; windowEnd: number }` — pad = `max(3, clipDuration * 0.5)` per side, clamped to `[0, videoDuration]`; degenerate cases collapse to a span of at least the clip duration then 0.5s.
  - `TrimBar` props: `{ segment: Segment; index: number; duration: number; onChange: (id: string, next: Segment, moved: 'start' | 'end') => void; onScrub: (time: number) => void; onSplit: () => void; onDelete: () => void }`.
  - Testids: `trim-bar` (with `data-start`/`data-end`/`data-duration`/`data-pps` = trackWidth/windowSpan), `trim-handle-start`, `trim-handle-end`, `trim-label-start`, `trim-label-end`, `trim-label-duration`, `trim-action-split`, `trim-action-delete`.

- [ ] **Step 1: Write failing unit tests for `computeTrimWindow`** (`src/lib/domain/trimWindow.test.ts`, node project)

```ts
import { describe, expect, it } from 'vitest';
import { computeTrimWindow } from './trimWindow';

describe('computeTrimWindow', () => {
	it('pads by max(3s, half the clip) and clamps to the video', () => {
		expect(computeTrimWindow(30, 60, 80)).toEqual({ windowStart: 15, windowEnd: 75 });
		expect(computeTrimWindow(0, 30, 80)).toEqual({ windowStart: 0, windowEnd: 45 });
		expect(computeTrimWindow(60, 80, 80)).toEqual({ windowStart: 45, windowEnd: 80 });
		expect(computeTrimWindow(1, 2, 10)).toEqual({ windowStart: 0, windowEnd: 5 });
	});
	it('keeps a sane span for a clip equal to the video', () => {
		expect(computeTrimWindow(0, 5, 5)).toEqual({ windowStart: 0, windowEnd: 5 });
	});
});
```

- [ ] **Step 2: Run it to verify it fails** — `pnpm exec vitest --run --project unit src/lib/domain/trimWindow.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `computeTrimWindow`** in `src/lib/domain/trimWindow.ts` per the Interfaces block.

- [ ] **Step 4: Run it to verify it passes** — same command → 2 passed.

- [ ] **Step 5: Write failing component tests** (`TrimBar.svelte.test.ts`, client project). Render with a known track width; mirror the pointer-event dispatch pattern from `SegmentBar.svelte.test.ts` (synthetic PointerEvents with matching `pointerId`). Tests:
  1. renders labels (`00:00.0 · 00:30.0 · 00:30.0` for a `0-30` segment at index 0) and the bar `data-*` values;
  2. dragging `trim-handle-end` right by +N px calls `onChange` with `end = initial.end + N / pps` (read `pps` from `data-pps`) and calls `onScrub(t)` while dragging;
  3. **far drag**: dragging `trim-handle-start` left by more than the window padding still calls `onChange` with the reduced start (no window clamp on the value);
  4. keyboard: focus `trim-handle-end`, press Shift+ArrowRight → `onChange` with `end + 1`;
  5. tap `trim-label-end` → input appears → on a **300s clip** type `150` + Enter → `onChange` with `end = 150` (the precision escape hatch for long clips);
  6. a 0.5s clip renders with `data-pps > 0` and both handles present (geometry sanity);
  7. action buttons call `onSplit` / `onDelete`.

- [ ] **Step 6: Run to verify they fail** — `pnpm exec vitest --run --project client src/lib/components/TrimBar.svelte.test.ts` → FAIL.

- [ ] **Step 7: Implement `TrimBar.svelte`** — window from `computeTrimWindow` recomputed from `segment`/`duration` (and again after each pointer-up); `pxPerSecond = trackWidth / (windowEnd - windowStart)` via `bind:clientWidth`; handle drag identical in shape to `SegmentBar` (`setPointerCapture`, snapshot `initial`, `delta = Δx / pxPerSecond`, report raw values — **no clamping in the component**); rendered handle positions clamped to `[0, trackWidth]` for display; labels with tap-to-input (input value parsed with `Number`, committed on Enter/blur, invalid input reverts); quick actions row (Split in half, Delete). Keep the component free of project-store imports.

- [ ] **Step 8: Run both suites** — unit file + client file → all pass; also `pnpm exec vitest --run --project client src/lib/components/SegmentBar.svelte.test.ts` untouched and green.

- [ ] **Step 9: Commit**

```bash
git add src/lib/domain/trimWindow.ts src/lib/domain/trimWindow.test.ts src/lib/components/TrimBar.svelte src/lib/components/TrimBar.svelte.test.ts
git commit -m "feat: TrimBar touch trimmer with window math"
```

### Task 2: `ClipStrip` — clip chips, max-length stepper, reset

**Files:**

- Create: `src/lib/components/ClipStrip.svelte`
- Create: `src/lib/components/ClipStrip.svelte.test.ts`
- Reference: `src/lib/components/SegmentPanel.svelte` (existing max-length semantics), `src/lib/domain/format.ts`

**Interfaces:**

- Consumes: `Segment` (ordered), `formatClock`.
- Produces: `ClipStrip` props `{ segments: Segment[]; selectedId: string | null; maxClipDuration: number; onSelect: (id: string) => void; onMaxClipDurationChange: (seconds: number) => void; onReset: () => void }`. Testids: `clip-strip`, `clip-chip` (one per segment, `data-selected`, `data-index`), `max-clip-minus`, `max-clip-plus`, `max-clip-value`, `reset-auto-split`.

- [ ] **Step 1: Write failing tests** (client project): renders one chip per segment with `index+1 · duration` text; tapping a chip calls `onSelect(id)`; selected chip carries `data-selected="true"`; minus/plus call `onMaxClipDurationChange` with ±5 clamped to `[1, 300]` (test at 1 and 300); reset calls `onReset`.

- [ ] **Step 2: Run to verify they fail** — `pnpm exec vitest --run --project client src/lib/components/ClipStrip.svelte.test.ts` → FAIL.

- [ ] **Step 3: Implement `ClipStrip.svelte`** — horizontal `overflow-x-auto` row of chips (min height 44px, `data-testid="clip-chip"`, tap → `onSelect`), followed by the stepper (`−` value `+`, step 5, clamp 1–300) and a `Reset to auto-split` button. Store-free, callback-only.

- [ ] **Step 4: Run to verify they pass** → all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/ClipStrip.svelte src/lib/components/ClipStrip.svelte.test.ts
git commit -m "feat: ClipStrip chips, max-length stepper, reset"
```

### Task 3: Phone column in the page + tap-to-play preview

**Files:**

- Modify: `src/lib/components/VideoPreview.svelte` (add `tapToToggle?: boolean = false`; when true, clicking the `<video>` calls `toggle()`)
- Modify: `src/routes/+page.svelte`
- Create/Modify test: `src/routes/page.phone.browser.test.ts`
- Reference: `src/routes/+page.svelte` current editor branch (lines ~293-327), `src/routes/page.browser.test.ts` (file-load mocking pattern), `src/lib/state/project.svelte.ts` (`setMaxClipDuration`, `splitSelected`, `deleteSelected`, `resetAutoSplit` — use the real method names found there)

**Interfaces:**

- Consumes: `TrimBar`, `ClipStrip` from Tasks 1–2; `MediaQuery` from `svelte/reactivity`; existing `project`/`exportState` singleton actions.
- Produces: phone editor branch in `+page.svelte`; `isPhone = new MediaQuery('(max-width: 767px)')`; testids unchanged on shared parts; new phone container testid `phone-editor`.

- [ ] **Step 1: Write the failing page test** (`page.phone.browser.test.ts`, client project) — mirror `page.browser.test.ts`'s mocked `inspect` to load a fixture; then:
  1. at a narrow viewport (e.g. `page.viewport(390, 844)` via the Vitest browser API): `phone-editor` visible, `trim-bar` visible, desktop `timeline`/filmstrip **not** in the DOM;
  2. selecting another chip updates the trim bar's `data-start`;
  3. widen to 1280×720: desktop branch renders (`segment-bar` present, `phone-editor` gone) and `project.segments` is unchanged (breakpoint crossing keeps state);
  4. dragging the end handle updates `time-field-end`/clip data after clamp delegation (assert `end ≥ start + 0.5` when dragged far left).

- [ ] **Step 2: Run to verify it fails** → FAIL (`phone-editor` absent).

- [ ] **Step 3: Implement** — in `+page.svelte`:
  - `const isPhone = new MediaQuery('(max-width: 767px)');`
  - wrap the editor branch: `{#if project.meta}{#if isPhone.current}<div class="flex flex-col gap-4 pb-[env(safe-area-inset-bottom)]" data-testid="phone-editor">…{/if}{:else}existing<section>…{/else}{/if}` — phone column = sticky mini-header (existing header content re-ordered for phone via classes), `VideoPreview` (with `tapToToggle`), `TrimBar` (wired: `onChange → project.updateSegment`, `onScrub → seekRequest`, `onSplit → project.splitSelected()`, `onDelete → project.deleteSelected()`), `ClipStrip` (wired: `onSelect → selectClip`, `onMaxClipDurationChange → project.setMaxClipDuration(seconds)`, `onReset → project.resetSplit()`), then `ExportPanel`.
  - Desktop branch and all shared logic untouched.

- [ ] **Step 4: Run the page tests** — new file + existing `page.browser.test.ts`, `page.rapid.browser.test.ts`, `compat.browser.test.ts` → all green (desktop behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/VideoPreview.svelte src/routes/+page.svelte src/routes/page.phone.browser.test.ts
git commit -m "feat: phone-first editor column with trim bar and clip strip"
```

### Task 4: Mobile Playwright project + phone-flow e2e

**Files:**

- Modify: `playwright.config.ts` (add `testMatch` to the existing chromium project: `splitter.spec.ts`; add `mobile` project using `devices['Pixel 7']`, `testMatch: 'mobile.spec.ts'`)
- Create: `e2e/mobile.spec.ts`
- Reference: `e2e/splitter.spec.ts` (fixtures path, download/zip helpers)

**Interfaces:**

- Consumes: app testids from Tasks 1–3; fixtures in `static/test-fixtures/`.

- [ ] **Step 1: Update the config** (existing suite must still run as `chromium` only; confirm `pnpm exec playwright test --list` shows 9 desktop tests + new mobile tests, not duplicates).

- [ ] **Step 2: Write `e2e/mobile.spec.ts`**:
  1. load `tiny-5s.mp4` → `phone-editor` + `trim-bar` visible, `segment-bar` (desktop) absent;
  2. drag `trim-handle-end` far left (mouse drag) → `data-end ≥ data-start + 0.5`; then drag it back right → `data-end` increases again (a trimmed clip can be re-extended on the phone; window recentering on release);
  3. tap `trim-label-end` → type an exact value → `data-end` equals it;
  4. quick actions: `trim-action-split` → two `clip-chip`s;
  5. export one clip (Download) → filename `…_part01.mp4` and non-empty download (reuse the splitter spec's helper style).

- [ ] **Step 3: Run dev-mode mobile project** — `pnpm exec playwright test --project mobile` → 5 passed.
- [ ] **Step 4: Run the desktop project** — `pnpm exec playwright test --project chromium` → 9 passed unchanged.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e/mobile.spec.ts
git commit -m "test: mobile Playwright project and phone-flow e2e"
```

### Task 5: README + phone screenshot

**Files:**

- Modify: `scripts/screenshot.mjs` (add a `phone` capture: viewport 390×844, `deviceScaleFactor: 2`, `isMobile: true`, `hasTouch: true`, output `docs/screenshot-phone.png`)
- Modify: `README.md` (add a short "On your phone" paragraph under Usage, referencing the phone screenshot)
- Run + commit the generated `docs/screenshot-phone.png`.

- [ ] **Step 1: Extend the script** and run it against the running dev server (`HTTPS_DEV=1 … --port 5180` or `SCREENSHOT_URL`), producing both the existing hero and `docs/screenshot-phone.png`.
- [ ] **Step 2: Verify the phone screenshot** looks right (trim bar visible, no desktop chrome) by reading the PNG.
- [ ] **Step 3: README** — one short subsection: the phone flow (load from Photos → trim with big handles → Share to WhatsApp), screenshot embedded.
- [ ] **Step 4: Commit**

```bash
git add scripts/screenshot.mjs docs/screenshot-phone.png README.md
git commit -m "docs: phone flow screenshot and README section"
```

---

## Verification (controller, after all tasks)

- `pnpm check` 0/0 · `pnpm lint` clean · `pnpm test:unit -- --run` (all files) · `pnpm test:e2e` (desktop 9 + mobile 5, offline skipped) · `pnpm test:e2e:build` (offline test green).
- Real-phone smoke: load from Photos, trim by dragging, exact entry, export → WhatsApp; rotate the phone mid-session.
- Push to GitHub and redeploy Vercel (`vercel build --prod` + `vercel deploy --prebuilt --prod`).
