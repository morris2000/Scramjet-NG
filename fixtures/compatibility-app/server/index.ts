import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FIXTURE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLIENT_FILE = join(FIXTURE_ROOT, "client", "main.ts");

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

async function readBody(request: IncomingMessage): Promise<Buffer> {
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
  <main id="app">Loading fixture…</main>
  <dl>
    <dt>Relative fetch</dt><dd id="relative-result">pending</dd>
    <dt>Streaming fetch</dt><dd id="stream-result">pending</dd>
    <dt>POST echo</dt><dd id="echo-result">pending</dd>
    <dt>Error</dt><dd id="error-result"></dd>
  </dl>
  <script src="/main.js"></script>
</body>
</html>
`
	);
}

export function createCompatibilityFixtureServer(): Server {
	return createServer(async (request, response) => {
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
	});
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
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) =>
					error ? reject(error) : resolve()
				);
			}),
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
