import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";

const FIXTURE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLIENT_FILE = join(FIXTURE_ROOT, "client", "main.ts");
const fixtureWebSocketServers = new WeakMap<Server, WebSocketServer>();

export interface ListeningCompatibilityFixture {
	readonly server: Server;
	readonly origin: string;
	close(): Promise<void>;
}

function requestPath(request: IncomingMessage): URL | null {
	if (!request.url) return null;
	try {
		return new URL(request.url, "http://scramjet-ng-fixture.invalid");
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

async function readBody(request: AsyncIterable<Buffer>): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buffer.byteLength;
		if (total > 1024 * 1024) {
			throw new Error("Fixture request body exceeds the test limit");
		}
		chunks.push(buffer);
	}
	return Buffer.concat(chunks, total);
}

async function handleFixtureRequest(
	request: IncomingMessage,
	response: ServerResponse
): Promise<void> {
	const url = requestPath(request);
	if (!url) {
		writeText(response, 400, "text/plain; charset=utf-8", "Bad Request");
		return;
	}

	if (url.pathname === "/" && request.method === "GET") {
		writeFixtureHtml(response);
		return;
	}

	if (url.pathname === "/main.js" && request.method === "GET") {
		try {
			writeText(
				response,
				200,
				"application/javascript; charset=utf-8",
				await readFile(CLIENT_FILE, "utf8")
			);
		} catch {
			writeText(response, 500, "text/plain; charset=utf-8", "Client asset error");
		}
		return;
	}

	if (url.pathname === "/api/json" && request.method === "GET") {
		writeText(
			response,
			200,
			"application/json; charset=utf-8",
			JSON.stringify({ ok: true, fixture: "compatibility-app" })
		);
		return;
	}

	if (url.pathname === "/stream" && request.method === "GET") {
		response.writeHead(200, {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store",
			"transfer-encoding": "chunked",
		});
		response.write("chunk-1\\n");
		setTimeout(() => response.write("chunk-2\\n"), 50);
		setTimeout(() => response.end("chunk-3\\n"), 100);
		return;
	}

	if (url.pathname === "/events" && request.method === "GET") {
		response.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-store",
			"connection": "keep-alive",
			"transfer-encoding": "chunked",
		});
		response.write(": fixture connected\n\n");
		response.write("id: 1\ndata: hello from fixture\n\n");
		setTimeout(
			() => response.write("event: named\nid: 2\ndata: world from fixture\n\n"),
			25
		);
		setTimeout(() => {
			response.write("event: done\nid: 3\ndata: complete\n\n");
			response.end();
		}, 50);
		return;
	}

	if (url.pathname === "/api/echo" && request.method === "POST") {
		try {
			const body = await readBody(request);
			writeText(
				response,
				200,
				"application/json; charset=utf-8",
				JSON.stringify({ body: body.toString("utf8") })
			);
		} catch {
			writeText(response, 413, "text/plain; charset=utf-8", "Request too large");
		}
		return;
	}

	writeText(response, 404, "text/plain; charset=utf-8", "Not Found");
}

class UpgradeResponse {
	statusCode = 200;
	private readonly headers = new Map<string, string>();
	private headersSent = false;
	private chunked = false;
	private readonly socket: import("node:net").Socket;

	constructor(socket: import("node:net").Socket) {
		this.socket = socket;
	}

	setHeader(name: string, value: string | number | readonly string[]): this {
		this.headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
		return this;
	}

	writeHead(
		statusCode: number,
		headers?: Record<string, string | number | readonly string[]>
	): this {
		this.statusCode = statusCode;
		for (const [name, value] of Object.entries(headers ?? {})) {
			this.setHeader(name, value);
		}
		return this;
	}

	private sendHeaders(forceChunked: boolean): void {
		if (this.headersSent) return;
		if (forceChunked && !this.headers.has("content-length")) {
			this.headers.set("transfer-encoding", "chunked");
		}
		this.headers.set("connection", "close");
		this.chunked = this.headers.get("transfer-encoding")?.toLowerCase() === "chunked";
		const reason =
			({
				200: "OK",
				400: "Bad Request",
				404: "Not Found",
				413: "Payload Too Large",
				500: "Internal Server Error",
			} as Record<number, string>)[this.statusCode] ?? "Error";
		const lines = [`HTTP/1.1 ${this.statusCode} ${reason}`];
		for (const [name, value] of this.headers) lines.push(`${name}: ${value}`);
		lines.push("", "");
		this.socket.write(lines.join("\r\n"));
		this.headersSent = true;
	}

	write(chunk: string | Uint8Array): boolean {
		this.sendHeaders(true);
		const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
		if (this.chunked) {
			this.socket.write(`${buffer.byteLength.toString(16)}\r\n`);
			this.socket.write(buffer);
			this.socket.write("\r\n");
		} else {
			this.socket.write(buffer);
		}
		return true;
	}

	end(chunk?: string | Uint8Array): void {
		if (!this.headersSent && chunk !== undefined && !this.headers.has("content-length")) {
			const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
			this.headers.set("content-length", String(buffer.byteLength));
			this.sendHeaders(false);
			this.socket.end(buffer);
			return;
		}

		if (!this.headersSent) this.sendHeaders(false);
		if (chunk !== undefined) this.write(chunk);
		if (this.chunked) this.socket.write("0\r\n\r\n");
		this.socket.end();
	}
}

function handleNonWebSocketUpgrade(
	request: IncomingMessage,
	socket: import("node:net").Socket,
	head: Buffer
): void {
	const contentLengthHeader = request.headers["content-length"];
	const contentLength = Number.parseInt(
		Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader ?? "0",
		10
	);
	if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > 1024 * 1024) {
		socket.destroy();
		return;
	}

	const chunks: Buffer[] = [head];
	let received = head.byteLength;
	const finish = () => {
		if (received < contentLength) return;
		const body = Buffer.concat(chunks, received).subarray(0, contentLength);
		const syntheticRequest = {
			url: request.url,
			method: request.method,
			headers: request.headers,
			async *[Symbol.asyncIterator]() {
				if (body.byteLength > 0) yield body;
			},
		} as IncomingMessage;
		const response = new UpgradeResponse(socket);
		void handleFixtureRequest(
			syntheticRequest,
			response as unknown as ServerResponse
		).catch(() => socket.destroy());
	};
	const onData = (chunk: Buffer) => {
		chunks.push(chunk);
		received += chunk.byteLength;
		if (received >= contentLength) {
			socket.off("data", onData);
			finish();
		}
	};

	if (received < contentLength) socket.on("data", onData);
	else finish();
}

function writeFixtureHtml(response: ServerResponse): void {
	writeText(
		response,
		200,
		"text/html; charset=utf-8",
		`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Scramjet-NG Compatibility Fixture</title>
</head>
<body>
  <main id="app">Loading fixtureâ€¦</main>
  <section aria-label="SPA navigation">
    <button id="spa-next" type="button">Open SPA route</button>
    <button id="spa-back" type="button">Go back</button>
    <p id="spa-result">pending</p>
  </section>
  <dl>
    <dt>Relative fetch</dt><dd id="relative-result">pending</dd>
    <dt>Streaming fetch</dt><dd id="stream-result">pending</dd>
    <dt>POST echo</dt><dd id="echo-result">pending</dd>
    <dt>WebSocket</dt><dd id="websocket-result">pending</dd>
    <dt>Server-Sent Events</dt><dd id="sse-result">pending</dd>
    <dt>Error</dt><dd id="error-result"></dd>
  </dl>
  <script src="/main.js"></script>
</body>
</html>
`
	);
}

export function createCompatibilityFixtureServer(): Server {
	const webSocketServer = new WebSocketServer({ noServer: true });
	webSocketServer.on("connection", (socket) => {
		socket.on("message", (data, isBinary) => {
			if (isBinary) {
				socket.send(data, { binary: true });
				return;
			}
			socket.send(data.toString());
		});
	});

	const server = createServer((request, response) => {
		void handleFixtureRequest(request, response);
	});

	server.on("upgrade", (request, socket, head) => {
		const url = requestPath(request);
		if (request.headers.upgrade?.toLowerCase() !== "websocket") {
			// Chromium/libcurl may use h2c upgrade headers for ordinary HTTP
			// requests. Keep those requests on the fixture's HTTP path while
			// reserving the WebSocket upgrade for the explicit echo endpoint.
			handleNonWebSocketUpgrade(request, socket, head);
			return;
		}
		if (!url || url.pathname !== "/socket") {
			socket.destroy();
			return;
		}

		webSocketServer.handleUpgrade(request, socket, head, (client) => {
			webSocketServer.emit("connection", client, request);
		});
	});

	fixtureWebSocketServers.set(server, webSocketServer);
	return server;
}

export async function listenCompatibilityFixture(options: {
	host?: string;
	port?: number;
} = {}): Promise<ListeningCompatibilityFixture> {
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 0;
	const server = createCompatibilityFixtureServer();

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
		throw new Error("Fixture server did not expose a TCP address");
	}

	return {
		server,
		origin: `http://${host}:${address.port}`,
		close: async () => {
			const webSocketServer = fixtureWebSocketServers.get(server);
			for (const client of webSocketServer?.clients ?? []) {
				client.terminate();
			}

			await Promise.all([
				new Promise<void>((resolve, reject) => {
					server.close((error) =>
						error ? reject(error) : resolve()
					);
				}),
				webSocketServer
					? new Promise<void>((resolve, reject) => {
						webSocketServer.close((error) =>
							error ? reject(error) : resolve()
						);
					})
					: Promise.resolve(),
			]);
		},
	};
}

async function runCli(): Promise<void> {
	const fixture = await listenCompatibilityFixture({
		host: process.env.FIXTURE_HOST ?? "127.0.0.1",
		port: Number.parseInt(process.env.FIXTURE_PORT ?? "3000", 10),
	});
	console.log(`fixture listening on ${fixture.origin}`);

	let shuttingDown = false;
	const shutdown = async () => {
		if (shuttingDown) return;
		shuttingDown = true;
		const forceExit = setTimeout(() => process.exit(0), 2_000);
		try {
			await fixture.close();
		} finally {
			clearTimeout(forceExit);
			process.exit(0);
		}
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
}

const invokedPath = process.argv[1]
	? pathToFileURL(process.argv[1]).href
	: null;
if (invokedPath === import.meta.url) {
	runCli().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
}
