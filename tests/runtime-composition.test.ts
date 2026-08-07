import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listenCompatibilityFixture } from "../fixtures/compatibility-app/server/index.ts";
import { createGatewayPolicy, createScramjetProxyPath } from "../runtime/gateway/index.ts";
import { listenRuntimeCompositionServer } from "../runtime/composition/index.ts";

test("composes harness, runtime assets, and HTTP gateway on one origin", async () => {
	const root = await mkdtemp(join(tmpdir(), "scramjet-ng-composition-"));
	const fixture = await listenCompatibilityFixture();
	const runtimeAssetFiles = [
		"scram/scramjet.js",
		"scram/scramjet.wasm",
		"scram/scramjet-utils.js",
		"controller/controller.api.js",
		"controller/controller.inject.js",
		"controller/controller.sw.js",
		"clients/libcurl-client.js",
	];

	try {
		for (const file of runtimeAssetFiles) {
			const path = join(root, file);
			await mkdir(join(path, ".."), { recursive: true });
			await writeFile(path, file.endsWith(".wasm") ? new Uint8Array([0]) : "// test asset\n");
		}

		const runtime = await listenRuntimeCompositionServer({
			root,
			targetOrigin: fixture.origin,
			policy: createGatewayPolicy({
				development: true,
				allowedHosts: ["127.0.0.1"],
				allowLoopback: true,
			}),
		});

		try {
			const health = await fetch(`${runtime.origin}/healthz`);
			assert.equal(health.status, 200);

			const harness = await fetch(runtime.harnessUrl);
			assert.equal(harness.status, 200);
			assert.match(await harness.text(), /scramjet-frame/);

			const serviceWorker = await fetch(`${runtime.origin}/sw.js`);
			assert.equal(serviceWorker.status, 200);
			assert.match(await serviceWorker.text(), /controller\/controller\.sw\.js/);

			const targetPath = createScramjetProxyPath(`${fixture.origin}/api/json`, {
				controllerId: "composition-test",
				frameId: "frame-test",
			});
			const proxied = await fetch(`${runtime.origin}${targetPath}`);
			assert.equal(proxied.status, 200);
			assert.deepEqual(await proxied.json(), {
				ok: true,
				fixture: "compatibility-app",
			});
		} finally {
			await runtime.close();
		}
	} finally {
		await fixture.close();
		await rm(root, { recursive: true, force: true });
	}
});
