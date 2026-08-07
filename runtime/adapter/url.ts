export function resolveTargetUrl(target: string, targetOrigin: string): string {
	let url: URL;
	try {
		url = new URL(target, targetOrigin);
	} catch {
		throw new TypeError("target must be a valid absolute or relative URL");
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new TypeError("target must use http or https");
	}

	if (url.username || url.password) {
		throw new TypeError("target must not contain URL credentials");
	}

	return url.href;
}

export function createRewriteUrlMetadata(proxyOrigin: string) {
	const origin = new URL(proxyOrigin);
	return {
		origin,
		base: new URL(origin.href),
	};
}
