import { createRuntimeConfig } from "./config.ts";
import {
	createRewriteUrlMetadata,
	resolveTargetUrl,
} from "./url.ts";
import type {
	RuntimeHandle,
	RuntimeState,
	ScramjetRuntimeBindings,
	ScramjetRuntimeConfig,
} from "./types.ts";

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

export class ScramjetRuntimeAdapter<
	TTransport,
	TController,
	TFrame,
	TElement = unknown,
	TFrameOptions = unknown,
> {
	readonly config: ScramjetRuntimeConfig;

	private currentState: RuntimeState = "idle";
	private currentError: Error | null = null;
	private currentHandle: RuntimeHandle<TTransport, TController> | null = null;
	private initialization: Promise<RuntimeHandle<TTransport, TController>> | null =
		null;
	private readonly bindings: ScramjetRuntimeBindings<
		TTransport,
		TController,
		TFrame,
		TElement,
		TFrameOptions
	>;

	constructor(
		config: Partial<ScramjetRuntimeConfig>,
		bindings: ScramjetRuntimeBindings<
			TTransport,
			TController,
			TFrame,
			TElement,
			TFrameOptions
		>
	) {
		this.bindings = bindings;
		this.config = createRuntimeConfig(config);
	}

	get state(): RuntimeState {
		return this.currentState;
	}

	get lastError(): Error | null {
		return this.currentError;
	}

	async initialize(): Promise<RuntimeHandle<TTransport, TController>> {
		if (this.currentHandle) {
			return this.currentHandle;
		}

		if (this.initialization) {
			return this.initialization;
		}

		this.currentState = "initializing";
		this.currentError = null;

		const initialization = (async () => {
			const serviceWorker = await this.bindings.registerServiceWorker(
				this.config.serviceWorkerPath
			);
			if (!serviceWorker || typeof serviceWorker !== "object") {
				throw new Error("Service Worker registration returned no worker");
			}

			const transport = await this.bindings.createTransport(this.config);
			const controller = await this.bindings.createController({
				serviceworker: serviceWorker,
				transport,
			});
			if (
				!controller ||
				(typeof controller !== "object" && typeof controller !== "function")
			) {
				throw new Error("Scramjet controller factory returned no controller");
			}

			await this.bindings.waitForController(controller);

			const handle = { serviceWorker, transport, controller };
			this.currentHandle = handle;
			this.currentState = "ready";
			return handle;
		})();

		this.initialization = initialization;
		try {
			return await initialization;
		} catch (error) {
			this.currentError = asError(error);
			this.currentState = "failed";
			throw error;
		} finally {
			if (this.initialization === initialization) {
				this.initialization = null;
			}
		}
	}

	/**
	 * Clear adapter state so a later initialize() can retry. This does not
	 * unregister the Service Worker or close the transport.
	 */
	reset(): void {
		if (this.initialization) {
			throw new Error("Cannot reset while Scramjet runtime is initializing");
		}

		this.currentHandle = null;
		this.currentError = null;
		this.currentState = "idle";
	}

	createFrame(element?: TElement, options?: TFrameOptions): TFrame {
		const handle = this.requireReady();
		return this.bindings.createFrame(handle.controller, element, options);
	}

	createProxyUrl(target: string, frame: TFrame): string {
		this.requireReady();
		const resolvedTarget = resolveTargetUrl(target, this.config.targetOrigin);
		return this.bindings.rewriteUrl(
			resolvedTarget,
			frame,
			createRewriteUrlMetadata(this.config.proxyOrigin)
		);
	}

	async navigate(frame: TFrame, target: string): Promise<void> {
		this.requireReady();
		const resolvedTarget = resolveTargetUrl(target, this.config.targetOrigin);
		await this.bindings.navigate(frame, resolvedTarget);
	}

	private requireReady(): RuntimeHandle<TTransport, TController> {
		if (!this.currentHandle || this.currentState !== "ready") {
			throw new Error(
				`Scramjet runtime is not ready (state: ${this.currentState}); ` +
					"await adapter.initialize() first"
			);
		}

		return this.currentHandle;
	}
}
