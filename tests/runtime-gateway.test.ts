import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer, type Server as TcpServer } from "node:net";
import { Duplex } from "node:stream";
import test from "node:test";
import { client as wispClient } from "@mercuryworkshop/wisp-js/client";
import {
	createGatewayPolicy,
	createScramjetProxyPath,
	createOfficialWispUpgradeHandler,
	createWispUpgradeHandler,
	isLoopbackAddress,
	isRestrictedAddress,
	listenHttpGatewayServer,
  parseScramjetProxyUrl,
  validateGatewayTarget,
} from "../runtime/gateway/index.ts";

interface ListeningFixture {
  readonly server: Server;
  readonly origin: string;
  close(): Promise<void>;
}

interface ListeningTcpEcho {
	readonly server: TcpServer;
	readonly port: number;
	close(): Promise<void>;
}

async function listenTcpEcho(closeAfterEcho = false): Promise<ListeningTcpEcho> {
	const server = createTcpServer((socket) => {
		socket.on("data", (data) => {
			socket.write(data, () => {
				if (closeAfterEcho) socket.end();
			});
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});

	const address = server.address();
	assert.ok(address && typeof address !== "string");

	return {
		server,
		port: address.port,
		close: () => new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		}),
	};
}

function createDuplexSocket(): Duplex {
	return new Duplex({
		read() {},
		write(_chunk, _encoding, callback) {
			callback();
		},
	});
}

function waitForWispOpen(connection: {
	onopen: () => void;
	onerror: () => void;
}): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Wisp connection timed out")), 3000);
		connection.onopen = () => {
			clearTimeout(timer);
			resolve();
		};
		connection.onerror = () => {
			clearTimeout(timer);
			reject(new Error("Wisp connection failed"));
		};
	});
}

function waitForWispMessage(stream: {
	onmessage: (data: Uint8Array) => void;
	onclose: (reason: number) => void;
}): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Wisp stream timed out")), 3000);
		stream.onmessage = (data) => {
			clearTimeout(timer);
			resolve(data);
		};
		stream.onclose = (reason) => {
			clearTimeout(timer);
			reject(new Error(`Wisp stream closed: ${reason}`));
		};
	});
}

function waitForWispClose(stream: {
	onclose: (reason: number) => void;
}): Promise<number> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Wisp close timed out")), 3000);
		stream.onclose = (reason) => {
			clearTimeout(timer);
			resolve(reason);
		};
	});
}

async function listenFixture(): Promise<ListeningFixture> {
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://fixture.invalid");

    if (requestUrl.pathname === "/json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, query: requestUrl.searchParams.get("mode") }));
      return;
    }

    if (requestUrl.pathname === "/echo") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(`${request.method}:${request.headers["x-fixture-header"] ?? ""}:${Buffer.concat(chunks).toString("utf8")}`);
      return;
    }

    if (requestUrl.pathname === "/stream") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.write("first-");
      setTimeout(() => response.end("second"), 20);
      return;
    }

    if (requestUrl.pathname === "/redirect") {
      response.writeHead(302, { location: "/json?mode=redirect" });
      response.end();
      return;
    }

    if (requestUrl.pathname === "/external-redirect") {
      response.writeHead(302, { location: "http://example.com/not-allowed" });
      response.end();
      return;
    }

    if (requestUrl.pathname === "/slow") {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("late");
      }, 100);
      return;
    }

    response.writeHead(404);
    response.end("missing");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");

  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

function targetPath(origin: string, pathname: string): string {
  return createScramjetProxyPath(`${origin}${pathname}`, {
    controllerId: "controller-test",
    frameId: "frame-test",
  });
}

test("uses the official Scramjet prefix and keeps target query separate from gateway metadata", () => {
  const path = createScramjetProxyPath(
    "https://example.test/app/page?mode=1#section",
    { controllerId: "controller-test", frameId: "frame-test" },
  );

  assert.match(path, /^\/~\/sj\/controller-test\/frame-test\/https%3A%2F%2F/);
  const route = parseScramjetProxyUrl(new URL(path, "https://proxy.test"));
  assert.equal(route.controllerId, "controller-test");
  assert.equal(route.frameId, "frame-test");
  assert.equal(route.target, "https://example.test/app/page?mode=1#section");
  assert.equal(route.metadata.toString(), "");
});

test("classifies loopback and restricted addresses for the gateway policy", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isRestrictedAddress("10.0.0.1"), true);
  assert.equal(isRestrictedAddress("169.254.169.254"), true);
  assert.equal(isRestrictedAddress("fc00::1"), true);
  assert.equal(isRestrictedAddress("8.8.8.8"), false);
});

test("requires explicit development policy for a local fixture", async () => {
  const lookup = async () => [{ address: "127.0.0.1", family: 4 }];
  const developmentPolicy = createGatewayPolicy({
    development: true,
    allowedHosts: ["fixture.test"],
    allowLoopback: true,
  });

  await validateGatewayTarget(
    new URL("http://fixture.test:3000/app"),
    developmentPolicy,
    lookup,
  );

  await assert.rejects(
    validateGatewayTarget(
      new URL("http://fixture.test:3000/app"),
      createGatewayPolicy({ allowedHosts: ["fixture.test"] }),
      lookup,
    ),
    /Loopback upstream targets are disabled/,
  );

  await assert.rejects(
    validateGatewayTarget(
      new URL("http://fixture.test:3000/app"),
      developmentPolicy,
      async () => [{ address: "10.0.0.1", family: 4 }],
    ),
    /Private, link-local, metadata, or reserved upstream targets are disabled/,
  );

  assert.throws(
    () => createGatewayPolicy({ allowLoopback: true }),
    /development-only/,
  );
});

test("forwards HTTP methods and bodies, preserves streaming, and rewrites safe redirects", async () => {
  const fixture = await listenFixture();
  const gateway = await listenHttpGatewayServer({
    policy: createGatewayPolicy({
      development: true,
      allowedHosts: ["127.0.0.1"],
      allowLoopback: true,
      maxRequestBodyBytes: 16,
      maxResponseBodyBytes: 1024 * 1024,
      timeoutMs: 500,
    }),
  });

  try {
    const jsonResponse = await fetch(`${gateway.origin}${targetPath(fixture.origin, "/json?mode=direct")}`);
    assert.equal(jsonResponse.status, 200);
    assert.deepEqual(await jsonResponse.json(), { ok: true, query: "direct" });

    const postResponse = await fetch(`${gateway.origin}${targetPath(fixture.origin, "/echo")}`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-fixture-header": "present" },
      body: "payload",
    });
    assert.equal(postResponse.status, 200);
    assert.equal(await postResponse.text(), "POST:present:payload");

    const streamResponse = await fetch(`${gateway.origin}${targetPath(fixture.origin, "/stream")}`);
    assert.equal(streamResponse.status, 200);
    assert.ok(streamResponse.body);
    const reader = streamResponse.body.getReader();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }
    assert.equal(chunks.join(""), "first-second");

    const redirectResponse = await fetch(`${gateway.origin}${targetPath(fixture.origin, "/redirect")}`, {
      redirect: "manual",
    });
    assert.equal(redirectResponse.status, 302);
    const location = redirectResponse.headers.get("location");
    assert.ok(location);
    const redirectRoute = parseScramjetProxyUrl(new URL(location, gateway.origin));
    assert.equal(redirectRoute.target, `${fixture.origin}/json?mode=redirect`);
  } finally {
    await gateway.close();
    await fixture.close();
  }
});

test("rejects oversized requests, unsafe redirects, and upstream timeouts", async () => {
  const fixture = await listenFixture();
  const gateway = await listenHttpGatewayServer({
    policy: createGatewayPolicy({
      development: true,
      allowedHosts: ["127.0.0.1"],
      allowLoopback: true,
      maxRequestBodyBytes: 4,
      timeoutMs: 20,
    }),
  });

  try {
    const oversized = await fetch(`${gateway.origin}${targetPath(fixture.origin, "/echo")}`, {
      method: "POST",
      body: "12345",
    });
    assert.equal(oversized.status, 413);

    const unsafeRedirect = await fetch(`${gateway.origin}${targetPath(fixture.origin, "/external-redirect")}`, {
      redirect: "manual",
    });
    assert.equal(unsafeRedirect.status, 403);

    const timeout = await fetch(`${gateway.origin}${targetPath(fixture.origin, "/slow")}`);
    assert.equal(timeout.status, 504);
  } finally {
    await gateway.close();
    await fixture.close();
  }
});

test("configures Wisp restrictions and only handles the exact Wisp endpoint", () => {
	const calls: Array<{ url: string; headBytes: number }> = [];
	const wisp = {
		options: {},
		routeRequest(request: { url?: string }, _socket: Duplex, head: Buffer) {
			calls.push({ url: request.url ?? "", headBytes: head.byteLength });
		},
	};
	const policy = createGatewayPolicy({
		development: true,
		allowedHosts: ["127.0.0.1"],
		allowLoopback: true,
		maxWispStreamsTotal: 4,
		maxWebSocketConnectionBytes: 128,
	});
	const handler = createWispUpgradeHandler({ wisp, policy });

	const invalidSocket = createDuplexSocket();
	assert.equal(
		handler(
			{
				url: "/wisp/127.0.0.1:80",
				method: "GET",
				headers: { upgrade: "websocket" },
			} as never,
			invalidSocket,
			Buffer.alloc(0),
		),
		false,
	);
	assert.equal(calls.length, 0);
	invalidSocket.destroy();

	const validSocket = createDuplexSocket();
	assert.equal(
		handler(
			{
				url: "/wisp/?v=2",
				method: "GET",
				headers: { upgrade: "WebSocket" },
			} as never,
			validSocket,
			Buffer.from([1, 2]),
		),
		true,
	);
	assert.deepEqual(calls, [{ url: "/wisp/?v=2", headBytes: 2 }]);
	assert.equal(wisp.options.allow_loopback_ips, true);
	assert.equal(wisp.options.allow_private_ips, false);
	assert.equal(wisp.options.allow_udp_streams, false);
	assert.equal(wisp.options.stream_limit_per_host, -1);
	assert.equal(wisp.options.stream_limit_total, 4);
	assert.equal(wisp.options.hostname_whitelist?.[0]?.test("127.0.0.1"), true);
	validSocket.destroy();
});

test("forwards text and binary Wisp streams through the official Wisp server", async () => {
	const echo = await listenTcpEcho();
	const closeEcho = await listenTcpEcho(true);
	const policy = createGatewayPolicy({
		development: true,
		allowedHosts: ["127.0.0.1"],
		allowLoopback: true,
		maxWebSocketConnectionBytes: 1024 * 1024,
	});
	const upgrade = await createOfficialWispUpgradeHandler({ policy });
	const gateway = await listenHttpGatewayServer({ policy, upgrade });
	let connection: InstanceType<typeof wispClient.ClientConnection> | undefined;

	try {
		const wispUrl = `${gateway.origin.replace(/^http:/, "ws:")}/wisp/`;
		connection = new wispClient.ClientConnection(wispUrl);
		await waitForWispOpen(connection);

		const stream = connection.create_stream("127.0.0.1", echo.port);
		const textPayload = new TextEncoder().encode("wisp-text");
		stream.send(textPayload);
		assert.equal(
			new TextDecoder().decode(await waitForWispMessage(stream)),
			"wisp-text",
		);

		const binaryPayload = new Uint8Array([0, 1, 2, 127, 128, 255]);
		stream.send(binaryPayload);
		assert.deepEqual(
			Array.from(await waitForWispMessage(stream)),
			Array.from(binaryPayload),
		);

		stream.close(2);

		const closingStream = connection.create_stream("127.0.0.1", closeEcho.port);
		const serverClosePromise = waitForWispClose(closingStream);
		closingStream.send(new Uint8Array([42]));
		assert.equal(await serverClosePromise, 2);
	} finally {
		connection?.close();
		await new Promise((resolve) => setTimeout(resolve, 25));
		await gateway.close();
		await echo.close();
		await closeEcho.close();
	}
});
