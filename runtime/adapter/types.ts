export type RuntimeState = "idle" | "initializing" | "ready" | "failed";

export interface ScramjetRuntimeConfig {
	/** Origin hosting the proxy application and Service Worker. */
	proxyOrigin: string;
	/** Default target URL used to resolve relative fixture URLs. */
	targetOrigin: string;
	/** Service Worker URL, restricted to the proxy origin. */
	serviceWorkerPath: string;
	/** Explicit development switch for local fixture environments. */
	development: boolean;
}

/**
 * The adapter never calls a Service Worker directly. Keeping this as an
 * opaque object lets a browser ServiceWorker and a test double share the
 * boundary without importing DOM types into the runtime core.
 */
export type ServiceWorkerLike = object;

export interface RewriteUrlMetadata {
	origin: URL;
	base: URL;
}

export interface RuntimeHandle<TTransport, TController> {
	serviceWorker: ServiceWorkerLike;
	transport: TTransport;
	controller: TController;
}

export interface ScramjetRuntimeBindings<
	TTransport,
	TController,
	TFrame,
	TElement = unknown,
	TFrameOptions = unknown,
> {
	registerServiceWorker(path: string): Promise<ServiceWorkerLike>;
	createTransport(
		config: ScramjetRuntimeConfig
	): TTransport | PromiseLike<TTransport>;
	createController(init: {
		serviceworker: ServiceWorkerLike;
		transport: TTransport;
	}): TController | PromiseLike<TController>;
	waitForController(controller: TController): Promise<void>;
	createFrame(
		controller: TController,
		element?: TElement,
		options?: TFrameOptions
	): TFrame;
	navigate(frame: TFrame, target: string): void | Promise<void>;
	rewriteUrl(
		target: string,
		frame: TFrame,
		metadata: RewriteUrlMetadata
	): string;
}
