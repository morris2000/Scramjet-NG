import type { ScramjetRuntimeConfig } from "./types.ts";

export const DEFAULT_RUNTIME_CONFIG: ScramjetRuntimeConfig = {
	proxyOrigin: "http://127.0.0.1:8080",
	targetOrigin: "http://127.0.0.1:3000/",
	serviceWorkerPath: "/sw.js",
	development: true,
};

function parseHttpUrl(value: string, field: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError(`${field} must be an absolute URL`);
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new TypeError(`${field} must use http or https`);
	}

	if (url.username || url.password) {
		throw new TypeError(`${field} must not contain URL credentials`);
	}

	return url;
}

function normalizeProxyOrigin(value: string): string {
	const url = parseHttpUrl(value, "proxyOrigin");
	if (url.pathname !== "/" || url.search || url.hash) {
		throw new TypeError("proxyOrigin must contain only an origin");
	}
	return url.origin;
}

function normalizeServiceWorkerPath(value: string, proxyOrigin: string): string {
	if (!value || value.startsWith("//")) {
		throw new TypeError("serviceWorkerPath must be a same-origin path");
	}

	let resolved: URL;
	try {
		resolved = new URL(value, proxyOrigin);
	} catch {
		throw new TypeError("serviceWorkerPath must be a valid URL path");
	}

	if (resolved.origin !== proxyOrigin || resolved.protocol === "blob:") {
		throw new TypeError(
			"serviceWorkerPath must stay same-origin with proxyOrigin"
		);
	}

	if (resolved.hash) {
		throw new TypeError("serviceWorkerPath must not contain a URL hash");
	}

	return `${resolved.pathname}${resolved.search}`;
}

export function createRuntimeConfig(
	input: Partial<ScramjetRuntimeConfig> = {}
): ScramjetRuntimeConfig {
	const proxyOrigin = normalizeProxyOrigin(
		input.proxyOrigin ?? DEFAULT_RUNTIME_CONFIG.proxyOrigin
	);
	const targetUrl = parseHttpUrl(
		input.targetOrigin ?? DEFAULT_RUNTIME_CONFIG.targetOrigin,
		"targetOrigin"
	);

	return {
		proxyOrigin,
		targetOrigin: targetUrl.href,
		serviceWorkerPath: normalizeServiceWorkerPath(
			input.serviceWorkerPath ?? DEFAULT_RUNTIME_CONFIG.serviceWorkerPath,
			proxyOrigin
		),
		development: input.development ?? DEFAULT_RUNTIME_CONFIG.development,
	};
}
