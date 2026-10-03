import { defineConfig } from '@playwright/test';

export default defineConfig({
	// Build with pnpm, then serve from the local vite binary directly: pnpm runs
	// script children in their own process group, so `pnpm preview` survives
	// Playwright's webServer teardown and hangs the run.
	webServer: {
		command: 'pnpm build && ./node_modules/.bin/vite preview',
		port: 4173
	},
	testMatch: '**/*.e2e.{ts,js}'
});
