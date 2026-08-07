import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";

const FIXTURE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLIENT_FILE = join(FIXTURE_ROOT, "client", "main.ts");
const RUNTIME_COMPAT_FILE = join(FIXTURE_ROOT, "client", "runtime-compat.ts");
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

interface MultipartPart {
	name: string;
	filename?: string;
	contentType?: string;
	body: Buffer;
}

function parseMultipartBody(body: Buffer, contentType: string): MultipartPart[] {
	const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
	const boundary = (boundaryMatch?.[1] ?? boundaryMatch?.[2])?.trim();
	if (!boundary) throw new Error("Multipart boundary is missing");

	const delimiter = Buffer.from(`--${boundary}`);
	const headerSeparator = Buffer.from("\r\n\r\n");
	const parts: MultipartPart[] = [];
	let cursor = body.indexOf(delimiter);

	while (cursor >= 0) {
		let partStart = cursor + delimiter.byteLength;
		if (body.subarray(partStart, partStart + 2).toString() === "--") break;
		if (body.subarray(partStart, partStart + 2).toString() === "\r\n") {
			partStart += 2;
		}

		const nextDelimiter = body.indexOf(delimiter, partStart);
		if (nextDelimiter < 0) break;

		let partEnd = nextDelimiter;
		if (body.subarray(partEnd - 2, partEnd).toString() === "\r\n") {
			partEnd -= 2;
		}
		const part = body.subarray(partStart, partEnd);
		const separatorIndex = part.indexOf(headerSeparator);
		if (separatorIndex < 0) throw new Error("Multipart headers are malformed");

		const headers = part.subarray(0, separatorIndex).toString("utf8");
		const disposition = /content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i.exec(headers);
		if (!disposition) throw new Error("Multipart disposition is missing");

		const contentTypeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);
		parts.push({
			name: disposition[1],
			filename: disposition[2],
			contentType: contentTypeMatch?.[1],
			body: part.subarray(separatorIndex + headerSeparator.byteLength),
		});
		cursor = nextDelimiter;
	}

	return parts;
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

	if (url.pathname === "/runtime-compat.js" && request.method === "GET") {
		try {
			writeText(
				response,
				200,
				"application/javascript; charset=utf-8",
				await readFile(RUNTIME_COMPAT_FILE, "utf8")
			);
		} catch {
			writeText(response, 500, "text/plain; charset=utf-8", "Runtime compatibility asset error");
		}
		return;
	}

	if (url.pathname === "/dynamic-module.js" && request.method === "GET") {
		writeText(
			response,
			200,
			"application/javascript; charset=utf-8",
			`export const dynamicValue = "dynamic-value";
export function describeDynamicModule() {
	return "module-loaded";
}
`
		);
		return;
	}

	if (url.pathname === "/worker.js" && request.method === "GET") {
		writeText(
			response,
			200,
			"application/javascript; charset=utf-8",
			`self.addEventListener("message", (event) => {
	self.postMessage(\`worker:\${event.data}\`);
});
`
		);
		return;
	}

	if (url.pathname === "/nested-frame.html" && request.method === "GET") {
		writeText(
			response,
			200,
			"text/html; charset=utf-8",
			`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Nested Scramjet-NG Fixture</title>
</head>
<body>
  <p id="nested-app">Nested fixture ready</p>
  <script>
    window.addEventListener("message", (event) => {
      if (event.data !== "parent-ping") return;
      window.parent.postMessage({
        type: "nested-iframe-reply",
        childOrigin: window.location.origin,
        receivedOrigin: event.origin,
      }, "*");
    });
  </script>
</body>
</html>
`
		);
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

	if (url.pathname === "/api/upload" && request.method === "POST") {
		try {
			const body = await readBody(request);
			const contentTypeHeader = request.headers["content-type"];
			const contentType = Array.isArray(contentTypeHeader)
				? contentTypeHeader[0] ?? ""
				: contentTypeHeader ?? "";
			const parts = parseMultipartBody(body, contentType);
			const description = parts.find((part) => part.name === "description" && !part.filename);
			const file = parts.find((part) => part.name === "file" && part.filename);
			if (!description || !file || !file.filename) {
				throw new Error("Required upload parts are missing");
			}

			writeText(
				response,
				200,
				"application/json; charset=utf-8",
				JSON.stringify({
					description: description.body.toString("utf8"),
					fileName: file.filename,
					fileType: file.contentType ?? "",
					fileBytes: file.body.byteLength,
					fileBody: file.body.toString("utf8"),
					fileSha256: createHash("sha256").update(file.body).digest("hex"),
				})
			);
		} catch {
			writeText(response, 400, "text/plain; charset=utf-8", "Invalid multipart upload");
		}
		return;
	}

	if (url.pathname === "/api/slow" && request.method === "GET") {
		setTimeout(() => {
			if (response.destroyed) return;
			writeText(
				response,
				200,
				"text/plain; charset=utf-8",
				"slow response completed"
			);
		}, 1_000);
		return;
	}

	if (url.pathname === "/api/cookie" && request.method === "GET") {
		response.setHeader(
			"set-cookie",
			"fixture_server=from-server; Path=/; SameSite=Lax"
		);
		writeText(
			response,
			200,
			"application/json; charset=utf-8",
			JSON.stringify({ requestCookie: request.headers.cookie ?? "" })
		);
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

	get destroyed(): boolean {
		return this.socket.destroyed;
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
  <section aria-label="Nested iframe">
    <iframe id="nested-frame" title="Nested fixture" src="/nested-frame.html"></iframe>
    <p id="iframe-result">pending</p>
  </section>
  <dl>
    <dt>Relative fetch</dt><dd id="relative-result">pending</dd>
    <dt>Streaming fetch</dt><dd id="stream-result">pending</dd>
    <dt>POST echo</dt><dd id="echo-result">pending</dd>
    <dt>WebSocket</dt><dd id="websocket-result">pending</dd>
    <dt>Server-Sent Events</dt><dd id="sse-result">pending</dd>
    <dt>Cookie</dt><dd id="cookie-result">pending</dd>
    <dt>Storage</dt><dd id="storage-result">pending</dd>
    <dt>Dynamic Import</dt><dd id="dynamic-result">pending</dd>
    <dt>Web Worker</dt><dd id="worker-result">pending</dd>
    <dt>Blob URL</dt><dd id="blob-result">pending</dd>
    <dt>File upload</dt><dd id="upload-result">pending</dd>
    <dt>AbortController</dt><dd id="abort-result">pending</dd>
    <dt>Error</dt><dd id="error-result"></dd>
  </dl>
  <script src="/runtime-compat.js"></script>
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
