import assert from "node:assert/strict";
import test from "node:test";
import { registerScramjetRuntime } from "../runtime/bootstrap/register.ts";

test("does not claim runtime registration without the Service Worker API", async () => {
	const result = await registerScramjetRuntime({
		global: {
			location: new URL("http://127.0.0.1:8080/"),
		} as never,
	});

	assert.equal(result.registered, false);
	assert.match(result.reason ?? "", /Service Worker API/);
});

