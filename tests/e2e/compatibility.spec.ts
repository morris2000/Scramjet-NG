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

	test("supports text and binary WebSocket frames through Wisp", async ({ page }) => {
		await page.goto(`${proxyUrl}/`);
		await expect(page.locator("#runtime-status")).toHaveAttribute("data-state", "ready");

		const fixture = page.frameLocator("#scramjet-frame");
		await expect(fixture.locator("#websocket-result")).toHaveText(
			"text:browser-text|binary:1,2,3,4",
			{ timeout: 30_000 },
		);
	});

	test("keeps EventSource framing and close lifecycle through the proxy", async ({ page }) => {
		await page.goto(`${proxyUrl}/`);
		await expect(page.locator("#runtime-status")).toHaveAttribute("data-state", "ready");

		const fixture = page.frameLocator("#scramjet-frame");
		await expect(fixture.locator("#sse-result")).toHaveText(
			"open:1|message:hello from fixture|named:world from fixture|id:2|closed:2",
			{ timeout: 30_000 },
		);
	});

	test("virtualizes cookies and storage away from the harness origin", async ({ page }) => {
		await page.goto(`${proxyUrl}/`);
		await expect(page.locator("#runtime-status")).toHaveAttribute("data-state", "ready");

		const fixture = page.frameLocator("#scramjet-frame");
		await expect(fixture.locator("#cookie-result")).toHaveText(
			"document:1|request1:1|response:1|request2:2",
			{ timeout: 30_000 },
		);
		await expect(fixture.locator("#storage-result")).toHaveText(
			"local:local-value|session:session-value",
			{ timeout: 30_000 },
		);

		const parentState = await page.evaluate(() => ({
			cookie: document.cookie,
			local: window.localStorage.getItem("fixture-local"),
			session: window.sessionStorage.getItem("fixture-session"),
		}));
		expect(parentState.cookie).not.toContain("fixture_document=");
		expect(parentState.cookie).not.toContain("fixture_server=");
		expect(parentState.local).toBeNull();
		expect(parentState.session).toBeNull();
	});

	test("loads dynamic modules and Worker scripts through the proxy", async ({ page }) => {
		await page.goto(`${proxyUrl}/`);
		await expect(page.locator("#runtime-status")).toHaveAttribute("data-state", "ready");

		const fixture = page.frameLocator("#scramjet-frame");
		await expect(fixture.locator("#dynamic-result")).toHaveText(
			"value:dynamic-value|describe:module-loaded",
			{ timeout: 30_000 },
		);
		await expect(fixture.locator("#worker-result")).toHaveText(
			"message:worker:ping",
			{ timeout: 30_000 },
		);
	});

	test("preserves nested iframe messaging and virtual origin", async ({ page }) => {
		await page.goto(`${proxyUrl}/`);
		await expect(page.locator("#runtime-status")).toHaveAttribute("data-state", "ready");

		const fixture = page.frameLocator("#scramjet-frame");
		await expect(fixture.locator("#iframe-result")).toHaveText(
			/same-origin:1\|origin:http:\/\/127\.0\.0\.1:3000/,
			{ timeout: 30_000 },
		);
	});

	test("preserves Blob URLs, file uploads, and AbortController", async ({ page }) => {
		await page.goto(`${proxyUrl}/`);
		await expect(page.locator("#runtime-status")).toHaveAttribute("data-state", "ready");

		const fixture = page.frameLocator("#scramjet-frame");
		await expect(fixture.locator("#blob-result")).toHaveText(
			"origin:http://127.0.0.1:3000|body:blob-body",
			{ timeout: 30_000 },
		);
		await expect(fixture.locator("#upload-result")).toHaveText(
			"name:fixture.txt|type:text/plain|bytes:12|body:hello upload",
			{ timeout: 30_000 },
		);
		await expect(fixture.locator("#abort-result")).toHaveText(
			"aborted:1|error:AbortError",
			{ timeout: 30_000 },
		);
	});

	test("preserves SPA pushState and back navigation", async ({ page }) => {
		await page.goto(`${proxyUrl}/`);
		await expect(page.locator("#runtime-status")).toHaveAttribute("data-state", "ready");

		const fixture = page.frameLocator("#scramjet-frame");
		await expect(fixture.locator("#spa-result")).toHaveText("home:/");
		await fixture.locator("#spa-next").click();
		await expect(fixture.locator("#spa-result")).toHaveText("next:/spa/next?step=2");
		await fixture.locator("#spa-back").click();
		await expect(fixture.locator("#spa-result")).toHaveText("home:/");
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
