import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	reporter: 'list',
	use: {
		baseURL: 'http://localhost:4173',
		viewport: { width: 1440, height: 900 },
		trace: 'on-first-retry'
	},
	webServer: {
		// Serve through the direct node_modules/.bin path: pnpm runs script
		// children in their own process group, so a pnpm-spawned server survives
		// Playwright's webServer teardown and hangs the run.
		command:
			process.env.E2E_BUILD === '1'
				? 'pnpm build && ./node_modules/.bin/vite preview --port 4173 --strictPort'
				: './node_modules/.bin/vite dev --port 4173 --strictPort',
		url: 'http://localhost:4173',
		reuseExistingServer: !process.env.CI
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
