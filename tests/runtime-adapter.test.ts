import assert from "node:assert/strict";
import test from "node:test";
import { ScramjetRuntimeAdapter } from "../runtime/adapter/adapter.ts";
import { createRuntimeConfig } from "../runtime/adapter/config.ts";
import type {
	ScramjetRuntimeBindings,
	ScramjetRuntimeConfig,
} from "../runtime/adapter/types.ts";

type FakeTransport = { name: string };
type FakeFrame = {
	context: { id: string };
	lastNavigation?: string;
	go(target: string): void;
};
type FakeController = { id: string; waitCount: number };

type FakeHarness = {
	bindings: ScramjetRuntimeBindings<
		FakeTransport,
		FakeController,
		FakeFrame,
		{ tag: string },
		{ plugins?: string[] }
	>;
	config: ScramjetRuntimeConfig;
	counts: {
		register: number;
		transport: number;
		controller: number;
		wait: number;
	};
	setReadyFailure(value: boolean): void;
};

function createFakeHarness(): FakeHarness {
	const counts = { register: 0, transport: 0, controller: 0, wait: 0 };
	let failReady = false;
	const config = createRuntimeConfig({
		proxyOrigin: "http://127.0.0.1:8080",
		targetOrigin: "http://127.0.0.1:3000/fixture/",
		serviceWorkerPath: "./sw.js",
	});

	const bindings: FakeHarness["bindings"] = {
		async registerServiceWorker(path) {
			counts.register += 1;
			assert.equal(path, "/sw.js");
			return { name: "fake-service-worker" };
		},
		async createTransport() {
			counts.transport += 1;
			return { name: "fake-transport" };
		},
		createController() {
			counts.controller += 1;
			return { id: `controller-${counts.controller}`, waitCount: 0 };
		},
		async waitForController(controller) {
			counts.wait += 1;
			controller.waitCount += 1;
			if (failReady) {
				throw new Error("controller readiness failed");
			}
		},
		createFrame() {
			const frame: FakeFrame = {
				context: { id: "frame-1" },
				go(target) {
					this.lastNavigation = target;
				},
			};
			return frame;
		},
		navigate(frame, target) {
			frame.go(target);
		},
		rewriteUrl(target, frame, metadata) {
			assert.equal(frame.context.id, "frame-1");
			assert.equal(metadata.origin.origin, "http://127.0.0.1:8080");
			return `${metadata.origin.origin}/~/sj/${encodeURIComponent(target)}`;
		},
	};

	return {
		bindings,
		config,
		counts,
		setReadyFailure(value) {
			failReady = value;
		},
	};
}

test("normalizes runtime config and keeps the Service Worker same-origin", () => {
	const config = createRuntimeConfig({
		proxyOrigin: "https://proxy.example.test/",
		targetOrigin: "http://fixture.example.test/app",
		serviceWorkerPath: "./runtime/sw.js?version=1",
		development: false,
	});

	assert.deepEqual(config, {
		proxyOrigin: "https://proxy.example.test",
		targetOrigin: "http://fixture.example.test/app",
		serviceWorkerPath: "/runtime/sw.js?version=1",
		development: false,
	});

	assert.throws(
		() => createRuntimeConfig({ proxyOrigin: "ftp://proxy.example.test" }),
		/http or https/
	);
	assert.throws(
		() =>
			createRuntimeConfig({
				proxyOrigin: "https://proxy.example.test",
				serviceWorkerPath: "https://other.example.test/sw.js",
			}),
		/same-origin/
	);
});

test("initializes once and shares concurrent initialization", async () => {
	const harness = createFakeHarness();
	const adapter = new ScramjetRuntimeAdapter(harness.config, harness.bindings);

	const first = adapter.initialize();
	const second = adapter.initialize();
	const [firstHandle, secondHandle] = await Promise.all([first, second]);

	assert.strictEqual(firstHandle, secondHandle);
	assert.equal(adapter.state, "ready");
	assert.equal(adapter.lastError, null);
	assert.deepEqual(harness.counts, {
		register: 1,
		transport: 1,
		controller: 1,
		wait: 1,
	});
});

test("delegates proxy URL creation and navigation to upstream bindings", async () => {
	const harness = createFakeHarness();
	const adapter = new ScramjetRuntimeAdapter(harness.config, harness.bindings);
	await adapter.initialize();

	const frame = adapter.createFrame({ tag: "iframe" }, { plugins: ["fixture"] });
	const proxyUrl = adapter.createProxyUrl("/api/json", frame);
	await adapter.navigate(frame, "/api/json");

	assert.equal(
		proxyUrl,
		"http://127.0.0.1:8080/~/sj/http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Fjson"
	);
	assert.equal(frame.lastNavigation, "http://127.0.0.1:3000/api/json");
});

test("records initialization failures and allows an explicit retry", async () => {
	const harness = createFakeHarness();
	harness.setReadyFailure(true);
	const adapter = new ScramjetRuntimeAdapter(harness.config, harness.bindings);

	await assert.rejects(adapter.initialize(), /controller readiness failed/);
	assert.equal(adapter.state, "failed");
	assert.match(adapter.lastError?.message ?? "", /controller readiness failed/);

	harness.setReadyFailure(false);
	await adapter.initialize();
	assert.equal(adapter.state, "ready");
	assert.equal(harness.counts.register, 2);
	assert.equal(harness.counts.controller, 2);
});

test("does not expose frame operations before readiness", () => {
	const harness = createFakeHarness();
	const adapter = new ScramjetRuntimeAdapter(harness.config, harness.bindings);

	assert.throws(() => adapter.createFrame(), /state: idle/);
	assert.throws(
		() => adapter.createProxyUrl("/api/json", {} as FakeFrame),
		/state: idle/
	);
});
