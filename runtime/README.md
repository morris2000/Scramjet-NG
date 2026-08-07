# Scramjet-NG runtime integration

This directory contains the Scramjet-NG runtime integration boundary.

The adapter keeps the runtime lifecycle independent from the concrete Scramjet
package. The official browser binding in `runtime/adapter/official.ts` now
connects the upstream browser entry points:

- Scramjet core bundle (`$scramjet`);
- controller API (`$scramjetController`);
- Libcurl or Epoxy transport client;
- `navigator.serviceWorker.register()`;
- controller `wait()`, frame creation, `Frame.go()`, and `rewriteUrl()`.

The implementation is in `runtime/adapter/`:

- `config.ts` validates proxy, target, and Service Worker configuration;
- `types.ts` defines the controller, frame, transport, and URL-rewriter
  contracts;
- `adapter.ts` handles initialization, readiness, failure, retry, frame
  creation, navigation, and upstream URL delegation;
- `official.ts` binds those contracts to the official browser-global scripts,
  including the Scramjet Utils bundle;
- `url.ts` centralizes target validation and rewrite metadata;
- `index.ts` exposes the public adapter entrypoint.

`runtime/bootstrap/register.ts` exposes `registerScramjetRuntime()` for a
browser page. It loads same-origin runtime assets, registers the Service Worker,
creates the selected transport, and initializes the controller.

## Runtime asset server

`runtime/assets/` provides the local serving contract for those browser assets:

- `manifest.ts` allowlists the expected Scramjet, controller, and transport
  paths;
- `pins.ts` records reviewed package versions, dist paths, sizes, and hashes;
- `sync.ts` downloads and verifies the pinned runtime files before writing;
- `service-worker.ts` generates the application-owned `sw.js` entrypoint;
- `server.ts` serves the generated Service Worker and only the manifest's
  configured files from an explicit asset root.

The server does not download or invent upstream runtime bundles. The asset root
must contain built files using the official layout below. This keeps package
version selection and licensing explicit while still making the browser serving
boundary testable.

Example:

```ts
const runtime = await listenRuntimeAssetServer({
  root: "./runtime-assets",
});

console.log(runtime.origin);
```

The default asset layout mirrors the official Scramjet bootstrap conventions:

```text
/sw.js
/scram/scramjet.js
/scram/scramjet.wasm
/scram/scramjet-utils.js
/controller/controller.api.js
/controller/controller.inject.js
/controller/controller.sw.js
/clients/libcurl-client.js
/wisp/
```

Use `transport: "epoxy"` and provide the corresponding Epoxy client asset when
that transport is selected.

The adapter does not implement a second URL codec. This is important because
the upstream rewriter owns its prefix, encoded target, hash handling, and
request metadata.

## HTTP gateway

`runtime/gateway/` provides the first live network vertical slice. It follows
the official controller route format:

```text
/~/sj/<controller-id>/<frame-id>/<encoded-target>
```

The gateway:

- decodes only that route and drops Scramjet query metadata before forwarding;
- forwards HTTP methods, headers, request bodies, status, cookies, and a
  streaming response body;
- validates redirect destinations and rewrites safe `Location` headers back to
  the same Scramjet route;
- applies request/response size limits and an upstream timeout;
- requires an explicit host allowlist and resolves hostnames before forwarding;
- rejects loopback, private, link-local, metadata, and reserved addresses by
  default.

For a local fixture, construct the policy explicitly:

```ts
const policy = createGatewayPolicy({
  development: true,
  allowedHosts: ["127.0.0.1"],
  allowLoopback: true,
});
```

The Wisp upgrade boundary is available through the pinned
`@mercuryworkshop/wisp-js@0.4.1` server dependency. It accepts only `/wisp/`,
applies the same allowlist and development loopback policy, disables UDP by
default, and enforces a total stream/connection limit. Browser WebSocket
connections use the audited Scramjet rewrite and selected browser transport;
the fixture regression covers text and binary frames through the full
Libcurl/Wisp path. DNS-to-connection pinning remains separate follow-up work.

## Browser composition

`runtime/composition/` creates the first single-origin live test boundary. It
serves the application-owned runtime harness and pinned assets, forwards
`/~/sj/` HTTP routes through the gateway, and attaches the `/wisp/` WebSocket
upgrade handler. The harness loads the audited browser globals, registers the
Service Worker, creates the selected transport and controller, then navigates a
managed iframe to the self-owned fixture.

The live fixture currently covers:

- document load, relative JSON fetch, POST echo, and readable streaming;
- finite Server-Sent Events through native EventSource, including named events,
  event IDs, stream close, and error handling;
- WebSocket text and binary echo through the official rewrite, Libcurl, and Wisp
  layers;
- SPA `pushState`, `popstate`, and back navigation inside the managed frame;
- basic `document.cookie` set/get, response `Set-Cookie`, request-cookie
  round-trips, and local/session storage kept separate from the parent harness;
- same-origin dynamic module loading and a dedicated Worker text-message
  round-trip through the official rewrite and Worker injection path.

The dynamic import check uses a same-origin relative module and the Worker
check uses a classic dedicated Worker. Module Workers, SharedWorkers, Worklets,
binary Worker messages, and Worker lifecycle/error behavior remain follow-up
coverage.

The live cookie check allows a brief asynchronous handoff after a
`document.cookie` mutation because the audited controller propagates cookie
synchronization through a Service Worker message channel. Advanced cookie
attributes, partitioning, and long-lived storage policy remain follow-up
coverage.

The fixture server preserves ordinary Chromium/libcurl HTTP requests that carry
h2c upgrade headers while reserving WebSocket upgrades for its explicit
`/socket` endpoint.

The live Playwright checks are intentionally limited to the self-owned fixture;
this composition server is not a production lifecycle manager. The SSE fixture
uses a finite stream; long-lived reconnect and retry behavior remains follow-up
coverage.

## Security boundary

The adapter only validates URL schemes, URL credentials, and same-origin
Service Worker paths. The HTTP gateway adds the first SSRF controls, but it is
still an MVP boundary: DNS is resolved and checked before each forward, while
socket-level DNS pinning and structured audit logging are still pending.

`reset()` only clears adapter state. It does not unregister a Service Worker
or close a transport; those resource operations belong in an explicit
transport lifecycle contract when concrete runtime bindings are wired.

The binding still wires the browser runtime through the official globals, while
the composition server now connects that binding contract to the gateway,
Service Worker, Wisp transport, and fixture for the live Playwright slice.
