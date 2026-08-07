import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 60_000,
	fullyParallel: false,
	globalSetup: "./tests/e2e/global-setup.ts",
	use: {
		headless: true,
		channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
	},
});
