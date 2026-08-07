import { test, expect } from "@playwright/test";

const fixtureUrl = process.env.FIXTURE_URL ?? "http://127.0.0.1:3000";

/**
 * Initial runtime compatibility smoke tests.
 *
 * These tests intentionally target the local fixture application first.
 * Scramjet runtime URL will be injected once the runtime harness is wired.
 */
test.describe("Scramjet-NG compatibility runtime", () => {
  test("loads fixture application", async ({ page }) => {
    await page.goto(fixtureUrl);
    await expect(page).toHaveTitle(/Scramjet-NG|Compatibility/i);
  });

  test("supports relative fetch", async ({ page }) => {
    await page.goto(fixtureUrl);

    const result = await page.evaluate(async () => {
      const response = await fetch("/api/json");
      return response.json();
    });

    expect(result).toBeTruthy();
  });

  test("receives streaming response", async ({ page }) => {
    await page.goto(fixtureUrl);

    const chunks = await page.evaluate(async () => {
      const response = await fetch("/stream");
      const reader = response.body!.getReader();
      const output: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output.push(new TextDecoder().decode(value));
      }

      return output;
    });

    expect(chunks.length).toBeGreaterThan(0);
  });
});
