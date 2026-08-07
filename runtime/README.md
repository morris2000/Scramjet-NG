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

This is an HTTP gateway slice only. Wisp/WebSocket transport, browser asset
composition, and DNS-to-connection pinning remain separate follow-up work.

## Security boundary

The adapter only validates URL schemes, URL credentials, and same-origin
Service Worker paths. The HTTP gateway adds the first SSRF controls, but it is
still an MVP boundary: DNS is resolved and checked before each forward, while
socket-level DNS pinning and structured audit logging are still pending.

`reset()` only clears adapter state. It does not unregister a Service Worker
or close a transport; those resource operations belong in an explicit
transport lifecycle contract when concrete runtime bindings are wired.

The binding only wires browser runtime assets. The HTTP gateway is currently a
standalone slice; Scramjet-NG still needs Wisp/WebSocket transport and final
composition of the adapter, gateway, Service Worker, and fixture before the
Playwright fixture can be loaded through a live proxy.
