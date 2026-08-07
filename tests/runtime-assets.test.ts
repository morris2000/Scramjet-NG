import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
	createRuntimeAssetManifest,
	createScramjetServiceWorkerSource,
	listenRuntimeAssetServer,
	normalizeRuntimeAssetPath,
} from "../runtime/assets/index.ts";

test("normalizes runtime assets and rejects external or duplicate paths", () => {
	assert.equal(normalizeRuntimeAssetPath("./controller/controller.sw.js"), "/controller/controller.sw.js");
	assert.throws(
		() => normalizeRuntimeAssetPath("https://cdn.example.test/controller.sw.js"),
		/same-origin path/
	);
	assert.throws(
		() => normalizeRuntimeAssetPath("/controller/controller.sw.js?version=1"),
		/without query or hash/
	);
	assert.throws(
		() =>
			createRuntimeAssetManifest({
				assets: {
					serviceWorkerPath: "/controller/controller.sw.js",
				},
			}),
		/duplicated/
	);
});

test("generates the official Scramjet Service Worker route contract", () => {
	const source = createScramjetServiceWorkerSource();

	assert.match(source, /^importScripts\("\/controller\/controller\.sw\.js"\);/);
	assert.match(source, /\$scramjetController\.shouldRoute\(event\)/);
	assert.match(source, /\$scramjetController\.route\(event\)/);
	assert.throws(
		() =>
			createScramjetServiceWorkerSource({
				controllerSwPath: "https://cdn.example.test/controller.sw.js",
			}),
		/same-origin path/
	);
});

test("serves generated Service Worker and allowlisted runtime files", async () => {
	const root = await mkdtemp(join(tmpdir(), "scramjet-ng-assets-"));
	const runtime = await listenRuntimeAssetServer({ root });

	try {
		const bundle = runtime.manifest.files.find(
			(file) => file.path === "/scram/scramjet.js"
		);
		assert.ok(bundle);
		const bundleFile = join(root, bundle.filePath.slice(1));
		await mkdir(dirname(bundleFile), { recursive: true });
		await writeFile(bundleFile, "window.$scramjet = {};\n", "utf8");

		const serviceWorkerResponse = await fetch(
			`${runtime.origin}${runtime.manifest.serviceWorkerPath}`
		);
		assert.equal(serviceWorkerResponse.status, 200);
		assert.match(
			serviceWorkerResponse.headers.get("content-type") ?? "",
			/application\/javascript/
		);
		assert.match(
			await serviceWorkerResponse.text(),
			/importScripts\("\/controller\/controller\.sw\.js"\)\;/
		);

		const bundleResponse = await fetch(`${runtime.origin}${bundle.path}?cache=1`);
		assert.equal(bundleResponse.status, 200);
		assert.equal(await bundleResponse.text(), "window.$scramjet = {};\n");

		const headResponse = await fetch(`${runtime.origin}${bundle.path}`, {
			method: "HEAD",
		});
		assert.equal(headResponse.status, 200);
		assert.equal(await headResponse.text(), "");

		const missingResponse = await fetch(`${runtime.origin}/not-an-asset`);
		assert.equal(missingResponse.status, 404);

		const methodResponse = await fetch(`${runtime.origin}${bundle.path}`, {
			method: "POST",
		});
		assert.equal(methodResponse.status, 405);
		assert.equal(methodResponse.headers.get("allow"), "GET, HEAD");
	} finally {
		await runtime.close();
		await rm(root, { recursive: true, force: true });
	}
});

