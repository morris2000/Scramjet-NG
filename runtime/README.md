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
- `official.ts` binds those contracts to the official browser-global scripts;
- `url.ts` centralizes target validation and rewrite metadata;
- `index.ts` exposes the public adapter entrypoint.

`runtime/bootstrap/register.ts` exposes `registerScramjetRuntime()` for a
browser page. It loads same-origin runtime assets, registers the Service Worker,
creates the selected transport, and initializes the controller.

## Runtime asset server

`runtime/assets/` provides the local serving contract for those browser assets:

- `manifest.ts` allowlists the expected Scramjet, controller, and transport
  paths;
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

## Security boundary

The adapter only validates URL schemes, URL credentials, and same-origin
Service Worker paths. It is not the network gateway and must not be treated as
SSRF protection. The future gateway still needs host/IP validation, redirect
validation, limits, timeouts, and audit logging before it forwards a request.

`reset()` only clears adapter state. It does not unregister a Service Worker
or close a transport; those resource operations belong in an explicit
transport lifecycle contract when concrete runtime bindings are wired.

The binding only wires browser runtime assets. Scramjet-NG still needs a proxy
gateway, Wisp endpoint, Service Worker bundle, and served runtime assets before
the Playwright fixture can be loaded through a live proxy.

