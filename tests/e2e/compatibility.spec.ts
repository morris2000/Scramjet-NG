import { test, expect } from "@playwright/test";

const proxyUrl = process.env.SCRAMJET_PROXY_ORIGIN ?? "http://127.0.0.1:8080";

/**
 * The browser enters through the single-origin runtime composition harness.
 * The fixture itself is loaded into the Scramjet-managed iframe.
 */
test.describe("Scramjet-NG compatibility runtime", () => {
	test("loads the fixture through the live Scramjet runtime", async ({ page }) => {
		await page.goto(`${proxyUrl}/`);
		await expect(page.locator("#runtime-status")).toHaveAttribute(
			"data-state",
			"ready",
			{ timeout: 30_000 },
		);

		const fixture = page.frameLocator("#scramjet-frame");
		await expect(fixture.locator("#app")).toHaveText("Fixture loaded");
		await expect(fixture.locator("#relative-result")).not.toHaveText("pending");
	});

	test("supports relative fetch through the proxy route", async ({ page }) => {
		await page.goto(`${proxyUrl}/`);
		await expect(page.locator("#runtime-status")).toHaveAttribute("data-state", "ready");

		const fixture = page.frameLocator("#scramjet-frame");
		await expect(fixture.locator("#relative-result")).toContainText(
			'"ok":true',
		);
	});

	test("keeps streaming response readable in the fixture", async ({ page }) => {
		await page.goto(`${proxyUrl}/`);
		await expect(page.locator("#runtime-status")).toHaveAttribute("data-state", "ready");

		const fixture = page.frameLocator("#scramjet-frame");
		await expect(fixture.locator("#stream-result")).toContainText("3:", {
			timeout: 30_000,
		});
		await expect(fixture.locator("#echo-result")).toContainText("hello scramjet-ng");
	});

	test("exposes an active Service Worker on the proxy origin", async ({ page }) => {
		await page.goto(`${proxyUrl}/`);
		await expect(page.locator("#runtime-status")).toHaveAttribute("data-state", "ready");

		const state = await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.ready;
			return {
				active: Boolean(registration.active),
				scope: registration.scope,
			};
		});

		expect(state.active).toBe(true);
		expect(state.scope).toBe(`${proxyUrl}/`);
	});
});
