import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import {
  createGatewayPolicy,
  createScramjetProxyPath,
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
