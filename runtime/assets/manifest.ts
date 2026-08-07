import {
	DEFAULT_BROWSER_RUNTIME_ASSETS,
	type BrowserRuntimeAssets,
	type BrowserTransportKind,
} from "../adapter/official.ts";

const ASSET_ORIGIN = "https://scramjet-ng.invalid";

export interface RuntimeAssetDescriptor {
	readonly path: string;
	readonly filePath: string;
	readonly contentType: string;
}

export interface RuntimeAssetManifest {
	readonly serviceWorkerPath: string;
	readonly controllerServiceWorkerPath: string;
	readonly files: readonly RuntimeAssetDescriptor[];
}

export interface RuntimeAssetManifestOptions {
	readonly transport?: BrowserTransportKind;
	readonly assets?: Partial<BrowserRuntimeAssets>;
}

/**
 * Normalize an asset URL into a same-origin path that can be safely mapped
 * below an explicitly configured local asset root.
 */
export function normalizeRuntimeAssetPath(
	value: string,
	field = "runtime asset path"
): string {
	if (!value || value.startsWith("//")) {
		throw new TypeError(`${field} must be a same-origin path`);
	}

	let url: URL;
	try {
		url = new URL(value, `${ASSET_ORIGIN}/`);
	} catch {
		throw new TypeError(`${field} must be a valid URL path`);
	}

	if (
		url.origin !== ASSET_ORIGIN ||
		url.protocol !== "https:" ||
		url.username ||
		url.password
	) {
		throw new TypeError(`${field} must be a same-origin path`);
	}

	if (url.search || url.hash || url.pathname === "/") {
		throw new TypeError(`${field} must identify a path without query or hash`);
	}

	return url.pathname;
}

function createDescriptor(
	path: string,
	contentType: string,
	field: string
): RuntimeAssetDescriptor {
	const normalizedPath = normalizeRuntimeAssetPath(path, field);
	return {
		path: normalizedPath,
		filePath: normalizedPath,
		contentType,
	};
}

export function createRuntimeAssetManifest(
	options: RuntimeAssetManifestOptions = {}
): RuntimeAssetManifest {
	const transport = options.transport ?? "libcurl";
	const assets = {
		...DEFAULT_BROWSER_RUNTIME_ASSETS,
		...options.assets,
		transportPath:
			options.assets?.transportPath ??
				(transport === "epoxy"
					? "/clients/epoxy-client.js"
					: DEFAULT_BROWSER_RUNTIME_ASSETS.transportPath),
	};

	const serviceWorkerPath = normalizeRuntimeAssetPath(
		assets.serviceWorkerPath,
		"serviceWorkerPath"
	);
	const controllerServiceWorkerPath = normalizeRuntimeAssetPath(
		assets.controllerSwPath,
		"controllerSwPath"
	);
	const files = [
		createDescriptor(
			assets.scramjetBundlePath,
			"application/javascript",
			"scramjetBundlePath"
		),
		createDescriptor(
			assets.scramjetWasmPath,
			"application/wasm",
			"scramjetWasmPath"
		),
		createDescriptor(
			assets.controllerApiPath,
			"application/javascript",
			"controllerApiPath"
		),
		createDescriptor(
			assets.controllerInjectPath,
			"application/javascript",
			"controllerInjectPath"
		),
		createDescriptor(
			controllerServiceWorkerPath,
			"application/javascript",
			"controllerSwPath"
		),
		createDescriptor(assets.transportPath, "application/javascript", "transportPath"),
	];

	const paths = new Set<string>();
	for (const path of [serviceWorkerPath, ...files.map((file) => file.path)]) {
		if (paths.has(path)) {
			throw new TypeError(`Runtime asset path is duplicated: ${path}`);
		}
		paths.add(path);
	}

	return {
		serviceWorkerPath,
		controllerServiceWorkerPath,
		files,
	};
}

