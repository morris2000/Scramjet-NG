# Scramjet-NG runtime integration

This directory contains the Scramjet-NG runtime integration boundary.

The adapter keeps the concrete Scramjet package behind injected bindings. The
upstream controller currently needs a Service Worker and a proxy transport,
exposes `wait()` and `createFrame()`, and performs navigation through
`Frame.go()`. Its URL rewriter needs the frame runtime context.

The implementation is in `runtime/adapter/`:

- `config.ts` validates proxy, target, and Service Worker configuration;
- `types.ts` defines the controller, frame, transport, and URL-rewriter
  contracts;
- `adapter.ts` handles initialization, readiness, failure, retry, frame
  creation, navigation, and upstream URL delegation;
- `url.ts` centralizes target validation and rewrite metadata;
- `index.ts` exposes the public adapter entrypoint.

A browser entry point can later connect these bindings to:

- `@mercuryworkshop/scramjet-controller`;
- the selected `@mercuryworkshop/*-transport` implementation;
- `navigator.serviceWorker.register()`;
- `@mercuryworkshop/scramjet`'s `rewriteUrl()`.

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

The existing `runtime/harness/` and `runtime/bootstrap/` files remain the
fixture/test-harness layer. They are not yet the concrete upstream Scramjet
runtime implementation.
