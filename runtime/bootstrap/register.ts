import { ScramjetRuntimeAdapter } from "../adapter/adapter.ts";
import {
	createBrowserScramjetBindings,
	type BrowserControllerLike,
	type BrowserFrameLike,
	type BrowserRuntimeAssets,
	type BrowserRuntimeGlobal,
	type BrowserRuntimeBindingOptions,
	type BrowserTransportLike,
} from "../adapter/official.ts";
import { createRuntimeConfig } from "../adapter/config.ts";
import type { ScramjetRuntimeConfig } from "../adapter/types.ts";

export type BrowserScramjetRuntimeAdapter = ScramjetRuntimeAdapter<
	BrowserTransportLike,
	BrowserControllerLike,
	BrowserFrameLike,
	HTMLIFrameElement,
	unknown
>;

export interface RuntimeRegistrationOptions {
	config?: Partial<ScramjetRuntimeConfig>;
	transport?: BrowserRuntimeBindingOptions["transport"];
	assets?: Partial<BrowserRuntimeAssets>;
	global?: BrowserRuntimeGlobal;
}

export interface RuntimeRegistrationResult {
	registered: boolean;
	reason?: string;
	adapter?: BrowserScramjetRuntimeAdapter;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function registerScramjetRuntime(
	options: RuntimeRegistrationOptions = {}
): Promise<RuntimeRegistrationResult> {
	const runtimeGlobal = options.global ?? (globalThis as BrowserRuntimeGlobal);
	if (!runtimeGlobal.navigator?.serviceWorker) {
		return {
			registered: false,
			reason: "Service Worker API is required for Scramjet runtime",
		};
	}

	try {
		const config = createRuntimeConfig({
			...options.config,
			serviceWorkerPath:
				options.assets?.serviceWorkerPath ??
				options.config?.serviceWorkerPath,
		});
		const adapter = new ScramjetRuntimeAdapter(
			config,
			createBrowserScramjetBindings({
				transport: options.transport,
				assets: options.assets,
				global: runtimeGlobal,
			})
		);

		await adapter.initialize();
		return { registered: true, adapter };
	} catch (error) {
		return {
			registered: false,
			reason: getErrorMessage(error),
		};
	}
}

