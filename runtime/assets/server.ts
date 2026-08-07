import {
	createServer,
	type IncomingMessage,
	type RequestListener,
	type Server,
	type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
	createRuntimeAssetManifest,
	type RuntimeAssetManifest,
	type RuntimeAssetManifestOptions,
} from "./manifest.ts";
import { createScramjetServiceWorkerSource } from "./service-worker.ts";

export interface RuntimeAssetServerOptions extends RuntimeAssetManifestOptions {
	readonly root: string;
	readonly host?: string;
	readonly port?: number;
}

export interface RuntimeAssetServer {
	readonly server: Server;
	readonly requestHandler: RequestListener;
	readonly manifest: RuntimeAssetManifest;
	readonly root: string;
}

export interface ListeningRuntimeAssetServer extends RuntimeAssetServer {
	readonly host: string;
	readonly port: number;
	readonly origin: string;
	close(): Promise<void>;
}

function writeResponse(
	response: ServerResponse,
	status: number,
	contentType: string,
	body: string | Uint8Array,
	headOnly: boolean
): void {
	response.statusCode = status;
	response.setHeader("content-type", contentType);
	response.setHeader("cache-control", "no-store");
	if (!headOnly) {
		response.end(body);
		return;
	}
	response.end();
}

function getRequestPath(request: IncomingMessage): string | null {
	if (!request.url) return null;

	try {
		return new URL(request.url, "http://scramjet-ng-assets.invalid").pathname;
	} catch {
		return null;
	}
}

function resolveAssetFile(root: string, filePath: string): string {
	const candidate = resolve(root, `.${filePath}`);
	const relativePath = relative(root, candidate);
	if (
		candidate === root ||
		isAbsolute(relativePath) ||
		relativePath === ".." ||
		relativePath.startsWith("..\\") ||
		relativePath.startsWith("../")
	) {
		throw new Error(`Runtime asset escapes configured root: ${filePath}`);
	}
	return candidate;
}

async function handleRequest(
	request: IncomingMessage,
	response: ServerResponse,
	root: string,
	manifest: RuntimeAssetManifest,
	serviceWorkerSource: string
): Promise<void> {
	const headOnly = request.method === "HEAD";
	if (request.method !== "GET" && !headOnly) {
		response.setHeader("allow", "GET, HEAD");
		writeResponse(
			response,
			405,
			"text/plain; charset=utf-8",
			"Method Not Allowed",
			false
		);
		return;
	}

	const requestPath = getRequestPath(request);
	if (!requestPath) {
		writeResponse(
			response,
			400,
			"text/plain; charset=utf-8",
			"Bad Request",
			headOnly
		);
		return;
	}

	if (requestPath === manifest.serviceWorkerPath) {
		writeResponse(
			response,
			200,
			"application/javascript; charset=utf-8",
			serviceWorkerSource,
			headOnly
		);
		return;
	}

	const descriptor = manifest.files.find((file) => file.path === requestPath);
	if (!descriptor) {
		writeResponse(
			response,
			404,
			"text/plain; charset=utf-8",
			"Not Found",
			headOnly
		);
		return;
	}

	let file: string;
	try {
		file = resolveAssetFile(root, descriptor.filePath);
	} catch {
		writeResponse(
			response,
			500,
			"text/plain; charset=utf-8",
			"Invalid asset mapping",
			headOnly
		);
		return;
	}

	try {
		const content = await readFile(file);
		writeResponse(response, 200, descriptor.contentType, content, headOnly);
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error
				? error.code
				: undefined;
		const status = code === "ENOENT" ? 404 : 500;
		writeResponse(
			response,
			status,
			"text/plain; charset=utf-8",
			status === 404 ? "Not Found" : "Asset Read Error",
			headOnly
		);
	}
}

export function createRuntimeAssetServer(
	options: RuntimeAssetServerOptions
): RuntimeAssetServer {
	const root = resolve(options.root);
	const manifest = createRuntimeAssetManifest(options);
	const serviceWorkerSource = createScramjetServiceWorkerSource({
		controllerSwPath: manifest.controllerServiceWorkerPath,
	});
	const requestHandler: RequestListener = (request, response) => {
		void handleRequest(
			request,
			response,
			root,
			manifest,
			serviceWorkerSource
		).catch(() => {
			if (!response.headersSent) {
				writeResponse(
					response,
					500,
					"text/plain; charset=utf-8",
					"Asset Server Error",
					request.method === "HEAD"
				);
			}
		});
	};
	const server = createServer(requestHandler);

	return { server, requestHandler, manifest, root };
}

export async function listenRuntimeAssetServer(
	options: RuntimeAssetServerOptions
): Promise<ListeningRuntimeAssetServer> {
	const runtime = createRuntimeAssetServer(options);
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 0;

	await new Promise<void>((resolvePromise, reject) => {
		const onError = (error: Error) => {
			runtime.server.removeListener("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			runtime.server.removeListener("error", onError);
			resolvePromise();
		};

		runtime.server.once("error", onError);
		runtime.server.once("listening", onListening);
		runtime.server.listen(port, host);
	});

	const address = runtime.server.address();
	if (!address || typeof address === "string") {
		await new Promise<void>((resolvePromise) => runtime.server.close(() => resolvePromise()));
		throw new Error("Runtime asset server did not expose a TCP address");
	}

	const addressHost = address.address.includes(":")
		? `[${address.address}]`
		: address.address;

	return {
		...runtime,
		host: address.address,
		port: address.port,
		origin: `http://${addressHost}:${address.port}`,
		close: () =>
			new Promise<void>((resolvePromise, reject) => {
				runtime.server.close((error) =>
					error ? reject(error) : resolvePromise()
				);
			}),
	};
}
