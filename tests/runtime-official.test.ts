import assert from "node:assert/strict";
import test from "node:test";
import {
	createBrowserScramjetBindings,
	DEFAULT_BROWSER_RUNTIME_ASSETS,
} from "../runtime/adapter/official.ts";
import type { RewriteUrlMetadata } from "../runtime/adapter/types.ts";

type FakeScript = {
	src: string;
	async: boolean;
	dataset: Record<string, string>;
	onload: (() => void) | null;
	onerror: (() => void) | null;
};

function createFakeBrowser() {
	const scripts: FakeScript[] = [];
	const calls = {
		registerPath: "",
		registerOptions: undefined as Record<string, string> | undefined,
		transportWisp: "",
		controllerInit: undefined as
			| { serviceworker: object; transport: object }
			| undefined,
		wait: 0,
		navigation: "",
		rewrite: undefined as
			| { target: string; context: unknown; metadata: RewriteUrlMetadata }
			| undefined,
	};

	const runtimeGlobal = {
		location: new URL("https://proxy.example.test/app/"),
		document: {
			createElement() {
				return {
					src: "",
					async: true,
					dataset: {},
					onload: null,
					onerror: null,
				} as FakeScript;
			},
			head: {
			appendChild(script: FakeScript) {
				scripts.push(script);
				if (script.src.endsWith("scramjet.js")) {
					runtimeGlobal.$scramjet = {
						rewriteUrl(target, context, metadata) {
							calls.rewrite = { target, context, metadata };
							return `https://proxy.example.test/~/sj/${encodeURIComponent(target)}`;
						},
					};
				}
				if (script.src.endsWith("controller.api.js")) {
					runtimeGlobal.$scramjetController = {
						config: {
							injectPath: "",
							wasmPath: "",
							scramjetPath: "",
						},
						Controller: class {
							constructor(init: {
								serviceworker: ServiceWorker;
								transport: object;
							}) {
								calls.controllerInit = init as never;
							}

							async wait() {
								calls.wait += 1;
							}

							createFrame() {
								return {
									context: { frame: "context" },
									go(target: string) {
										calls.navigation = target;
										},
									};
								}
							},
					};
				}
				if (script.src.endsWith("libcurl-client.js")) {
					runtimeGlobal.LibcurlTransport = {
						LibcurlClient: class {
							constructor(options: { wisp: string }) {
								calls.transportWisp = options.wisp;
							}
						},
					};
				}
				script.onload?.();
			},
		},
		},
		navigator: {
			serviceWorker: {
				async register(path: string, options: Record<string, string>) {
					calls.registerPath = path;
					calls.registerOptions = options;
					return { active: { state: "activated" } };
				},
				ready: Promise.resolve({}),
			},
		},
	};

	return { runtimeGlobal, scripts, calls };
}

test("binds the official browser globals and Service Worker flow", async () => {
	const fake = createFakeBrowser();
	const bindings = createBrowserScramjetBindings({
		global: fake.runtimeGlobal as never,
	});

	const serviceWorker = await bindings.registerServiceWorker("/sw.js");
	const transport = await bindings.createTransport({} as never);
	const controller = bindings.createController({
		serviceworker: serviceWorker,
		transport,
	});
	await bindings.waitForController(controller);
	const frame = bindings.createFrame(controller);
	await bindings.navigate(frame, "https://target.example.test/page");
	const rewritten = bindings.rewriteUrl(
		"https://target.example.test/page",
		frame,
		{
			origin: new URL("https://proxy.example.test"),
			base: new URL("https://proxy.example.test"),
		}
	);

	assert.equal(serviceWorker instanceof Object, true);
	assert.equal(fake.calls.registerPath, "/sw.js");
	assert.deepEqual(fake.calls.registerOptions, {
		type: "classic",
		updateViaCache: "none",
	});
	assert.equal(
		fake.calls.transportWisp,
		"wss://proxy.example.test/wisp/"
	);
	assert.equal(fake.calls.wait, 1);
	assert.equal(fake.calls.navigation, "https://target.example.test/page");
	assert.equal(
		rewritten,
		"https://proxy.example.test/~/sj/https%3A%2F%2Ftarget.example.test%2Fpage"
	);
	assert.equal(fake.calls.rewrite?.context && "frame" in fake.calls.rewrite.context, true);
	assert.deepEqual(fake.calls.rewrite?.metadata, {
		origin: new URL("https://proxy.example.test"),
		base: new URL("https://proxy.example.test"),
	});
	assert.deepEqual(
		fake.scripts.map((script) => new URL(script.src).pathname),
		[
			DEFAULT_BROWSER_RUNTIME_ASSETS.scramjetBundlePath,
			DEFAULT_BROWSER_RUNTIME_ASSETS.controllerApiPath,
			DEFAULT_BROWSER_RUNTIME_ASSETS.transportPath,
		]
	);
	assert.deepEqual(fake.runtimeGlobal.$scramjetController?.config, {
		injectPath: DEFAULT_BROWSER_RUNTIME_ASSETS.controllerInjectPath,
		wasmPath: DEFAULT_BROWSER_RUNTIME_ASSETS.scramjetWasmPath,
		scramjetPath: DEFAULT_BROWSER_RUNTIME_ASSETS.scramjetBundlePath,
	});
});

