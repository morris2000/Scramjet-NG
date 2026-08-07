import {
	DEFAULT_BROWSER_RUNTIME_ASSETS,
	type BrowserRuntimeAssets,
} from "../adapter/official.ts";
import { normalizeRuntimeAssetPath } from "./manifest.ts";

export interface ScramjetServiceWorkerOptions {
	readonly controllerSwPath?: string;
	readonly assets?: Partial<BrowserRuntimeAssets>;
}

/**
 * Generate the small application-owned Service Worker entrypoint used by the
 * official Scramjet controller bundle.
 */
export function createScramjetServiceWorkerSource(
	options: ScramjetServiceWorkerOptions = {}
): string {
	const controllerSwPath = normalizeRuntimeAssetPath(
		options.controllerSwPath ??
			options.assets?.controllerSwPath ??
			DEFAULT_BROWSER_RUNTIME_ASSETS.controllerSwPath,
		"controllerSwPath"
	);

	return [
		`importScripts(${JSON.stringify(controllerSwPath)});`,
		"",
		"addEventListener(\"fetch\", (event) => {",
		"\tif ($scramjetController.shouldRoute(event)) {",
		"\t\tevent.respondWith($scramjetController.route(event));",
		"\t}",
	"});",
		"",
	].join("\n");
}

