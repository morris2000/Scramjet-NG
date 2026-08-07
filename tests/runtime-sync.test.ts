import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	DEFAULT_SCRAMJET_RUNTIME_PINS,
	getPinnedRuntimePackages,
	syncRuntimeAssets,
	type PinnedRuntimePackage,
	type ScramjetRuntimePins,
} from "../runtime/assets/index.ts";

const fixtureBody = new TextEncoder().encode("scramjet-ng runtime fixture");
const fixtureHash = createHash("sha256").update(fixtureBody).digest("hex");

function createPackage(
	packageName: string,
	version: string,
	packagePath: string,
	runtimePath: string
): PinnedRuntimePackage {
	return {
		packageName,
		version,
		license: "AGPL-3.0-only",
		files: [
			{
				packagePath,
				runtimePath,
				contentType: "application/javascript",
				size: fixtureBody.byteLength,
				sha256: fixtureHash,
			},
		],
	};
}

function createFixturePins(): ScramjetRuntimePins {
	return {
		core: createPackage(
			"@mercuryworkshop/scramjet",
			"1.0.0",
			"/dist/scramjet.js",
			"/scram/scramjet.js"
		),
		controller: createPackage(
			"@mercuryworkshop/scramjet-controller",
			"1.0.0",
			"/dist/controller.api.js",
			"/controller/controller.api.js"
		),
		utils: createPackage(
			"@mercuryworkshop/scramjet-utils",
			"1.0.0",
			"/dist/scramjet-utils.js",
			"/scram/scramjet-utils.js"
		),
		libcurl: createPackage(
			"@mercuryworkshop/libcurl-transport",
			"1.0.0",
			"/dist/index.js",
			"/clients/libcurl-client.js"
		),
		epoxy: createPackage(
			"@mercuryworkshop/epoxy-transport",
			"1.0.0",
			"/dist/index.js",
			"/clients/epoxy-client.js"
		),
	};
}

test("selects the pinned transport package and keeps official pins explicit", () => {
	assert.deepEqual(
		getPinnedRuntimePackages(DEFAULT_SCRAMJET_RUNTIME_PINS, "epoxy").map(
			(packagePin) => packagePin.packageName
		),
		[
			"@mercuryworkshop/scramjet",
			"@mercuryworkshop/scramjet-controller",
			"@mercuryworkshop/scramjet-utils",
			"@mercuryworkshop/epoxy-transport",
		]
	);
	assert.equal(DEFAULT_SCRAMJET_RUNTIME_PINS.core.version, "2.0.67-alpha.2");
	assert.equal(DEFAULT_SCRAMJET_RUNTIME_PINS.core.license, "AGPL-3.0-only");
});

test("downloads, verifies, and writes a complete pinned asset set", async () => {
	const root = await mkdtemp(join(tmpdir(), "scramjet-ng-sync-"));
	const pins = createFixturePins();
	const calls: string[] = [];

	try {
		const result = await syncRuntimeAssets({
			root,
			pins,
			fetch: async (input) => {
				calls.push(input);
				return new Response(fixtureBody, { status: 200 });
			},
		});

		assert.equal(result.files.length, 4);
		assert.equal(
			calls[0],
			"https://cdn.jsdelivr.net/npm/@mercuryworkshop/scramjet@1.0.0/dist/scramjet.js"
		);
		for (const file of result.files) {
			assert.deepEqual(
				new Uint8Array(await readFile(join(root, file.runtimePath.slice(1)))),
				fixtureBody
			);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("does not write files after a hash mismatch or unsafe pin", async () => {
	const root = await mkdtemp(join(tmpdir(), "scramjet-ng-sync-"));
	const pins = createFixturePins();
	const badHashPins: ScramjetRuntimePins = {
		...pins,
		core: {
			...pins.core,
			files: [{ ...pins.core.files[0], sha256: "0".repeat(64) }],
		},
	};

	try {
		await assert.rejects(
			syncRuntimeAssets({
				root,
				pins: badHashPins,
				fetch: async () => new Response(fixtureBody, { status: 200 }),
			}),
			/hash mismatch/
		);
		await assert.rejects(readFile(join(root, "scram/scramjet.js")), /ENOENT/);

		const unsafePins: ScramjetRuntimePins = {
			...pins,
			core: {
				...pins.core,
				files: [
					{ ...pins.core.files[0], runtimePath: "https://cdn.example.test/a.js" },
				],
			},
		};
		await assert.rejects(
			syncRuntimeAssets({
				root,
				pins: unsafePins,
				fetch: async () => new Response(fixtureBody, { status: 200 }),
			}),
			/same-origin path/
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

