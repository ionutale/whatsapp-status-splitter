import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

// HTTPS_DEV=1 enables a self-signed HTTPS dev server (for LAN testing from a
// phone, which needs a secure context for WebCodecs/Web Share). The plugin is
// gated so normal dev, tests, and builds are unaffected.
export default defineConfig({
	plugins: [
		...(process.env.HTTPS_DEV === '1' ? [basicSsl()] : []),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.browser.test.ts', 'src/**/*.svelte.test.ts'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.test.ts'],
					exclude: ['src/**/*.browser.test.ts', 'src/**/*.svelte.test.ts']
				}
			}
		]
	}
});
