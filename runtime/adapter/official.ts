import type {
	RewriteUrlMetadata,
	ScramjetRuntimeBindings,
	ServiceWorkerLike,
} from "./types.ts";

export type BrowserTransportKind = "libcurl" | "epoxy";

export interface BrowserRuntimeAssets {
	serviceWorkerPath: string;
	scramjetBundlePath: string;
	scramjetWasmPath: string;
	scramjetUtilsBundlePath: string;
	controllerApiPath: string;
	controllerInjectPath: string;
	controllerSwPath: string;
	transportPath: string;
	wispPath: string;
}

export const DEFAULT_BROWSER_RUNTIME_ASSETS: BrowserRuntimeAssets = {
	serviceWorkerPath: "/sw.js",
	scramjetBundlePath: "/scram/scramjet.js",
	scramjetWasmPath: "/scram/scramjet.wasm",
	scramjetUtilsBundlePath: "/scram/scramjet-utils.js",
	controllerApiPath: "/controller/controller.api.js",
	controllerInjectPath: "/controller/controller.inject.js",
	controllerSwPath: "/controller/controller.sw.js",
	transportPath: "/clients/libcurl-client.js",
	wispPath: "/wisp/",
};

export interface BrowserTransportLike {
	request(...args: unknown[]): Promise<unknown>;
	connect(...args: unknown[]): unknown;
}

export interface BrowserFrameLike {
	readonly context: unknown;
	go(target: string): void | Promise<void>;
}

export interface BrowserControllerLike {
	wait(): Promise<void>;
	createFrame(
		element?: HTMLIFrameElement,
		options?: unknown
	): BrowserFrameLike;
}

interface ControllerApi {
	Controller: new (init: {
		serviceworker: ServiceWorker;
		transport: BrowserTransportLike;
	}) => BrowserControllerLike;
	config: {
		injectPath: string;
		wasmPath: string;
		scramjetPath: string;
	};
}

interface CoreApi {
	rewriteUrl(
		target: string,
		context: unknown,
		metadata: RewriteUrlMetadata
	): string;
}

interface TransportNamespace {
	LibcurlClient?: new (options: { wisp: string }) => BrowserTransportLike;
	EpoxyClient?: new (options: { wisp: string }) => BrowserTransportLike;
}

export type BrowserRuntimeGlobal = typeof globalThis & {
	$scramjet?: CoreApi;
	$scramjetController?: ControllerApi;
	LibcurlTransport?: TransportNamespace;
	EpoxyTransport?: TransportNamespace;
};

export interface BrowserRuntimeBindingOptions {
	transport?: BrowserTransportKind;
	assets?: Partial<BrowserRuntimeAssets>;
	global?: BrowserRuntimeGlobal;
}

export type BrowserScramjetBindings = ScramjetRuntimeBindings<
	BrowserTransportLike,
	BrowserControllerLike,
	BrowserFrameLike,
	HTMLIFrameElement,
	unknown
>;

function asBrowserGlobal(value?: BrowserRuntimeGlobal): BrowserRuntimeGlobal {
	return value ?? (globalThis as BrowserRuntimeGlobal);
}

function resolveSameOriginAsset(
	globalObject: BrowserRuntimeGlobal,
	path: string
): string {
	if (!globalObject.location) {
		throw new Error("Browser location is required to resolve runtime assets");
	}

	const url = new URL(path, globalObject.location.href);
	if (url.origin !== globalObject.location.origin) {
		throw new Error(`Runtime asset must be same-origin: ${path}`);
	}

	return url.href;
}

function loadScript(
	globalObject: BrowserRuntimeGlobal,
	path: string,
	loaded: Map<string, Promise<void>>
): Promise<void> {
	const absoluteUrl = resolveSameOriginAsset(globalObject, path);
	const existing = loaded.get(absoluteUrl);
	if (existing) {
		return existing;
	}

	if (!globalObject.document?.head) {
		return Promise.reject(new Error("Browser document is required to load runtime assets"));
	}

	const promise = new Promise<void>((resolve, reject) => {
		const script = globalObject.document.createElement("script");
		script.src = absoluteUrl;
		script.async = false;
		script.dataset.scramjetNgRuntime = absoluteUrl;
		script.onload = () => resolve();
		script.onerror = () =>
			reject(new Error(`Failed to load Scramjet runtime asset: ${path}`));
		globalObject.document.head.appendChild(script);
	});

	loaded.set(absoluteUrl, promise);
	return promise;
}

async function registerServiceWorker(
	globalObject: BrowserRuntimeGlobal,
	path: string
): Promise<ServiceWorkerLike> {
	const serviceWorker = globalObject.navigator?.serviceWorker;
	if (!serviceWorker) {
		throw new Error("Service Worker API is required for Scramjet runtime");
	}

	const registration = await serviceWorker.register(path, {
		type: "classic",
		updateViaCache: "none",
	});
	await serviceWorker.ready;

	if (registration.active) {
		return registration.active;
	}

	const worker = registration.installing ?? registration.waiting;
	if (!worker) {
		throw new Error("No active or installing Scramjet Service Worker found");
	}

	if (worker.state !== "activated") {
		await new Promise<void>((resolve, reject) => {
			const onStateChange = () => {
				if (worker.state === "activated") {
					worker.removeEventListener("statechange", onStateChange);
					resolve();
				} else if (worker.state === "redundant") {
					worker.removeEventListener("statechange", onStateChange);
					reject(new Error("Scramjet Service Worker became redundant"));
				}
			};
			worker.addEventListener("statechange", onStateChange);
		});
	}

	return registration.active ?? worker;
}

function getControllerApi(globalObject: BrowserRuntimeGlobal): ControllerApi {
	if (!globalObject.$scramjetController) {
		throw new Error("Scramjet controller API script did not expose $scramjetController");
	}
	return globalObject.$scramjetController;
}

function getCoreApi(globalObject: BrowserRuntimeGlobal): CoreApi {
	if (!globalObject.$scramjet) {
		throw new Error("Scramjet bundle did not expose $scramjet");
	}
	return globalObject.$scramjet;
}

function createWispUrl(globalObject: BrowserRuntimeGlobal, path: string): string {
	const resolved = new URL(path, globalObject.location.href);
	if (resolved.origin !== globalObject.location.origin) {
		throw new Error("Wisp endpoint must be same-origin with the proxy");
	}

	const protocol = globalObject.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${globalObject.location.host}${resolved.pathname}${resolved.search}`;
}

export function createBrowserScramjetBindings(
	options: BrowserRuntimeBindingOptions = {}
): BrowserScramjetBindings {
	const globalObject = asBrowserGlobal(options.global);
	const transportKind = options.transport ?? "libcurl";
	const assets = {
		...DEFAULT_BROWSER_RUNTIME_ASSETS,
		...options.assets,
		transportPath:
			options.assets?.transportPath ??
				(transportKind === "epoxy"
					? "/clients/epoxy-client.js"
					: DEFAULT_BROWSER_RUNTIME_ASSETS.transportPath),
	};
	const loadedScripts = new Map<string, Promise<void>>();
	let runtimeScripts: Promise<void> | null = null;

	const ensureRuntimeScripts = async () => {
		if (!runtimeScripts) {
				runtimeScripts = (async () => {
				await loadScript(globalObject, assets.scramjetBundlePath, loadedScripts);
				await loadScript(globalObject, assets.controllerApiPath, loadedScripts);
				await loadScript(
					globalObject,
					assets.scramjetUtilsBundlePath,
					loadedScripts
				);
				await loadScript(globalObject, assets.transportPath, loadedScripts);
			})();
		}
		await runtimeScripts;
	};

	return {
		registerServiceWorker: (path) =>
			registerServiceWorker(globalObject, path || assets.serviceWorkerPath),
		createTransport: async () => {
			await ensureRuntimeScripts();
			const namespace =
				transportKind === "epoxy"
					? globalObject.EpoxyTransport
					: globalObject.LibcurlTransport;
			const Constructor =
				transportKind === "epoxy"
					? namespace?.EpoxyClient
					: namespace?.LibcurlClient;
			if (!Constructor) {
				throw new Error(
					`${transportKind} transport script did not expose its client constructor`
				);
			}
			return new Constructor({
				wisp: createWispUrl(globalObject, assets.wispPath),
			});
		},
		createController: ({ serviceworker, transport }) => {
			const controllerApi = getControllerApi(globalObject);
			controllerApi.config.injectPath = assets.controllerInjectPath;
			controllerApi.config.wasmPath = assets.scramjetWasmPath;
			controllerApi.config.scramjetPath = assets.scramjetBundlePath;
			return new controllerApi.Controller({
				serviceworker: serviceworker as ServiceWorker,
				transport,
			});
		},
		waitForController: (controller) => controller.wait(),
		createFrame: (controller, element, options) =>
			controller.createFrame(element, options),
		navigate: (frame, target) => frame.go(target),
		rewriteUrl: (target, frame, metadata) =>
			getCoreApi(globalObject).rewriteUrl(target, frame.context, metadata),
	};
}

