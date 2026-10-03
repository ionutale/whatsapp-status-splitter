# WhatsApp Status Splitter

A browser app that splits a video into independently trimmable clips and exports
WhatsApp-ready MP4s — all on-device via WebCodecs and Mediabunny, with no uploads.

## Prerequisites

- Node.js and [pnpm](https://pnpm.io/)
- Chrome on macOS (WebCodecs support)

## Development

```sh
pnpm install
pnpm dev
```

## Checks

```sh
pnpm check              # svelte-check + TypeScript
pnpm lint               # Prettier + ESLint
pnpm test:unit -- --run # Vitest: Node unit project + Chromium browser project
pnpm test:e2e           # Playwright end-to-end (Chromium)
```

## Recreating this scaffold

```sh
pnpm dlx sv@1.0.1 create --template minimal --types ts --add prettier eslint vitest="usages:unit,component" playwright tailwindcss="plugins:typography,forms" sveltekit-adapter="adapter:static" --install pnpm . --no-dir-check
```

This README will be expanded in a later task.
