import {
	createServer,
	type RequestListener,
	type Server,
	type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import {
	DEFAULT_BROWSER_RUNTIME_ASSETS,
	type BrowserRuntimeAssets,
	type BrowserTransportKind,
} from "../adapter/official.ts";
import {
	attachGatewayUpgradeHandler,
	createHttpGatewayRequestHandler,
	type HttpGatewayServerOptions,
} from "../gateway/server.ts";
import {
	createGatewayPolicy,
	type GatewayPolicy,
} from "../gateway/policy.ts";
import { createOfficialWispUpgradeHandler } from "../gateway/wisp.ts";
import {
	createRuntimeAssetServer,
	type ListeningRuntimeAssetServer,
} from "../assets/server.ts";
import { createRuntimeHarnessSource } from "./source.ts";

export interface RuntimeCompositionServerOptions {
	readonly root: string;
	readonly targetOrigin: string;
	readonly policy: GatewayPolicy;
	readonly transport?: BrowserTransportKind;
	readonly assets?: Partial<BrowserRuntimeAssets>;
	readonly host?: string;
	readonly port?: number;
	readonly harnessPath?: string;
}

export interface ListeningRuntimeCompositionServer {
	readonly server: Server;
	readonly assetServer: ReturnType<typeof createRuntimeAssetServer>;
	readonly origin: string;
	readonly harnessUrl: string;
	close(): Promise<void>;
}

function requestPath(request: { url?: string }): string | null {
	if (!request.url) return null;
	try {
		return new URL(request.url, "http://scramjet-ng-composition.invalid").pathname;
	} catch {
		return null;
	}
}

function writeText(
	response: ServerResponse,
	status: number,
	contentType: string,
	body: string
): void {
	response.statusCode = status;
	response.setHeader("content-type", contentType);
	response.setHeader("cache-control", "no-store");
	response.end(body);
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

function runtimeAssetPaths(
	transport: BrowserTransportKind,
	assets: Partial<BrowserRuntimeAssets> | undefined,
	assetServer: ReturnType<typeof createRuntimeAssetServer>
): Partial<BrowserRuntimeAssets> {
	const defaults = {
		...DEFAULT_BROWSER_RUNTIME_ASSETS,
		...assets,
		transportPath:
			assets?.transportPath ??
				(transport === "epoxy"
					? "/clients/epoxy-client.js"
					: DEFAULT_BROWSER_RUNTIME_ASSETS.transportPath),
	};

	return {
		...defaults,
		serviceWorkerPath: assetServer.manifest.serviceWorkerPath,
		controllerSwPath: assetServer.manifest.controllerServiceWorkerPath,
	};
}

export async function listenRuntimeCompositionServer(
	options: RuntimeCompositionServerOptions
): Promise<ListeningRuntimeCompositionServer> {
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 0;
	const transport = options.transport ?? "libcurl";
	const policy = createGatewayPolicy(options.policy);
	const assetServer = createRuntimeAssetServer({
		root: options.root,
		transport,
		assets: options.assets,
	});
	const assetPaths = new Set([
		assetServer.manifest.serviceWorkerPath,
		...assetServer.manifest.files.map((file) => file.path),
	]);
	const harnessPath = options.harnessPath ?? "/";
	if (!harnessPath.startsWith("/") || harnessPath.includes("?")) {
		throw new TypeError("harnessPath must be an absolute URL path");
	}

	const harnessAssets = runtimeAssetPaths(transport, options.assets, assetServer);
	const harnessSource = createRuntimeHarnessSource({
		targetUrl: options.targetOrigin,
		transport,
		assets: harnessAssets,
	});
	const gatewayOptions: HttpGatewayServerOptions = {
		proxyOrigin: `http://${host}:${port}`,
		policy,
	};
	const gatewayRequestHandler = createHttpGatewayRequestHandler(gatewayOptions);
	const wispUpgradeHandler = await createOfficialWispUpgradeHandler({ policy });

	const requestHandler: RequestListener = (request, response) => {
		const path = requestPath(request);
		if (!path) {
			writeText(response, 400, "text/plain; charset=utf-8", "Bad Request");
			return;
		}

		if (path === "/healthz") {
			writeText(response, 200, "text/plain; charset=utf-8", "ok\n");
			return;
		}

		if (path === harnessPath) {
			writeText(response, 200, "text/html; charset=utf-8", harnessSource);
			return;
		}

		if (assetPaths.has(path)) {
			assetServer.requestHandler(request, response);
			return;
		}

		if (path.startsWith("/~/sj/")) {
			gatewayRequestHandler(request, response);
			return;
		}

		assetServer.requestHandler(request, response);
	};

	const server = createServer(requestHandler);
	const sockets = new Set<Socket>();
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	});
	attachGatewayUpgradeHandler(server, wispUpgradeHandler);

	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		await closeServer(server);
		throw new Error("Runtime composition server did not expose a TCP address");
	}

	const origin = `http://${host}:${address.port}`;
	const close = async () => {
		for (const socket of sockets) {
			socket.destroy();
		}
		await closeServer(server);
	};
	return {
		server,
		assetServer,
		origin,
		harnessUrl: `${origin}${harnessPath}`,
		close,
	};
}
