# Scramjet-NG

Next Generation Web Proxy Compatibility Layer based on MercuryWorkshop
Scramjet.

## Goal

Scramjet-NG extends Scramjet with a compatibility layer for modern dynamic web
applications.

The project focuses on:

- SPA compatibility
- Fetch and streaming fetch
- Server-Sent Events
- WebSocket
- Dynamic import
- Web Worker
- Nested iframe and postMessage
- Blob URL and multipart file upload
- AbortController compatibility
- Storage and origin virtualization
- Browser API compatibility testing

## Architecture Principle

Scramjet-NG is not a replacement for Scramjet.

The design keeps Scramjet core components and adds:

- compatibility patches
- runtime adapters
- diagnostics
- regression tests

## Current slice

The local runtime slice now contains four explicit boundaries:

- `runtime/adapter/` binds the audited official browser runtime;
- `runtime/assets/` serves only pinned, verified runtime assets;
- `runtime/gateway/` decodes the official `/~/sj/<controller>/<frame>/...`
  route and forwards only targets allowed by an explicit security policy,
  including the `/wisp/` WebSocket upgrade boundary.
- `runtime/composition/` combines the harness, browser assets, HTTP gateway,
  and Wisp endpoint on one proxy origin for live browser regression tests.
- `fixtures/compatibility-app/` provides the self-owned dynamic test app,
  including streaming and POST fetches, finite SSE, text/binary WebSocket echo,
  SPA History API controls, cookie round-trips, virtual-origin storage isolation,
  dynamic module loading, dedicated Worker message echo, nested iframe
  postMessage origin checks, Blob URL reads, multipart file uploads, and
  AbortController behavior.

The adapter boundary mirrors the audited upstream API:

1. register a Service Worker;
2. create a proxy transport;
3. construct the Scramjet controller;
4. await controller readiness;
5. create a frame and navigate with the frame's upstream `go()` method;
6. delegate proxy URL generation to upstream `rewriteUrl()`.

Run the available checks with:

```text
pnpm test
pnpm check
pnpm check:fixture
pnpm check:gateway
pnpm check:wisp
pnpm check:composition
pnpm e2e
```

The browser regression currently verifies the self-owned fixture through the
complete official network paths: browser rewrite, Libcurl transport, Wisp,
gateway policy, finite SSE framing, WebSocket text/binary frames, SPA
`pushState`/back navigation, cookie request/response round-trips, parent-origin storage isolation, dynamic import, Worker script rewriting with
message round-trip, nested iframe postMessage origin checks, Blob URL reads,
FormData/File upload forwarding, and app-facing AbortController `AbortError`
behavior.

The gateway is intentionally allowlist-first. Production policy rejects
loopback, private, link-local, metadata, and reserved addresses; a local
fixture requires an explicit development policy with `allowLoopback: true`.
The current tests use a self-owned local fixture and do not claim that a
general-purpose public proxy is safe or already running.

## Development Status

Phase 1: Repository audit, runtime composition, and live compatibility harness.
