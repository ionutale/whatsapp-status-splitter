# Mobile-first UI — Phone-First Core Flow

Date: 2026-10-03
Status: Approved in brainstorming (Sections 1–3); pending spec review.

## Context

The app is a desktop-first SvelteKit SPA for splitting videos into
WhatsApp-Status clips. It is published (GitHub + Vercel), installable, and works
offline. The layout currently assumes a mouse: shared timeline with ruler,
filmstrip, zoom, and lane view. On phones the stacked fallback is usable but
desktop-shaped.

Objective: make the **phone the primary experience for the core flow** — load a
video, auto-split, trim simply, export/share — while the desktop keeps the
existing precision editor unchanged.

## Approach (approved)

**Responsive same-page redesign.** One route, one set of stores and actions.
Tailwind styles become phone-first: base = phone layout, `md:`/`lg:` = desktop
layout. No separate route, no mode switch, no logic duplication.

## Phone column (top → bottom)

1. **Sticky mini-header** — app name (small), file name (truncated), current
   time.
2. Existing notices/errors/alerts — unchanged.
3. **Video preview** — 16:9, tap to play/pause, loops the selected clip.
4. **Trim bar** — the new touch trimmer for the selected clip (below).
5. **Clip strip** — horizontal scroll of clip chips (`1 · 0:30`), tap to select;
   plus compact **Max clip length** stepper and **Reset to auto-split**.
6. **Export panel** — the existing `ExportPanel` reused full-width (preset,
   9:16 crop, estimates, per-clip Share/Download, Export all ZIP,
   progress/cancel/retry).

Not rendered on phones: filmstrip, ruler, zoom, lane view. Keyboard support on
handles survives for attached keyboards. Batch panel is unchanged and stays
functional (unoptimized) on phones. Landscape uses the same column.

## Trim bar

- Full-width bar (~72px tall) showing **only the selected clip**, fitted to the
  available width with a minimum scale so short clips stay draggable.
- Two handle knobs: ~24px visible, ≥44px hit area, at the clip's start/end.
- Live mono labels above: `start · end · duration`, updating while dragging.
- **Dragging:** pointer events with pointer capture; reuse the proven
  `SegmentBar` math — idempotent from the drag-start snapshot
  (`delta_seconds = Δx / pxPerSecond`), then `project.updateSegment` enforces
  min length / bounds / clamps exactly as on desktop.
- **Precision trade-off (explicit):** the bar maps the whole clip to the screen
  width. A 30s clip gives ~0.08s/px on a 360px phone — sub-0.1s drag precision;
  clips longer than ~60s trade drag precision for simplicity (no scrolling), and
  the tap-to-type start/end entry covers anyone who needs exactness there.
- **Preview scrub:** while dragging a handle, the preview seeks to that frame
  (start handle → first frame; end handle → last frame); on release it stays.
- **Exact entry:** tapping a start/end label opens a numeric input with the
  same clamping (the desktop fields' logic).
- **Quick actions:** Split in half (midpoint of selected clip) · Delete · Reset
  to auto-split — same store calls as desktop.
- **Accessibility:** handles keep `role="slider"`, aria labels, and
  Tab + ←/→ nudge with the existing step sizes.

## Edge cases & platform notes

- iOS safe area: `env(safe-area-inset-bottom)` padding on the phone container
  (status bar is already `black`, not translucent).
- Rotating mid-drag: safe via pointer capture; bar re-fits on resize.
- Compatibility mode: reused as-is; the 31MB single-threaded core is slow on
  phones and the existing "slower" warning stands.
- Offline/PWA: unchanged; no new dependencies; precache untouched.
- Desktop: no behavior changes by construction.

## Testing & success criteria

- **New Playwright `mobile` project** (Pixel-7-class device emulation, touch
  enabled): load → touch-drag a trim handle → export one clip → valid MP4;
  tap-label exact entry; clip chip select + quick actions.
- **TrimBar browser tests** (client project): drag math, clamp delegation to
  `updateSegment`, preview-scrub callback, keyboard nudge.
- Existing desktop e2e (9) and unit/browser suites (31 files / 215 tests) stay
  green unchanged.
- Real-phone smoke: the full load → trim → export/share flow on a phone.

Success = the above suites green, no desktop regressions, and the real-phone
smoke pass completes without mouse-only affordances.

## Out of scope

- Batch queue redesign for phones.
- Filmstrip/zoom/ruler on phones.
- Full precision-editor parity on phones.
- Any change to export presets, encoding, offline behavior, or deploy setup.

## Constraints

- Reuse existing stores/actions; no new runtime dependencies.
- Keep testid conventions. New components: `TrimBar.svelte` and
  `ClipStrip.svelte`; the phone column branches in `+page.svelte` on a
  breakpoint-driven condition (so desktop-only heavy components aren't mounted
  on phones).
- All work on `main`, local commits, push + Vercel redeploy when verified.
