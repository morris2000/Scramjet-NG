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
pnpm check:gateway
pnpm check:wisp
pnpm check:composition
pnpm e2e
```

The gateway is intentionally allowlist-first. Production policy rejects
loopback, private, link-local, metadata, and reserved addresses; a local
fixture requires an explicit development policy with `allowLoopback: true`.
The current tests use a self-owned local fixture and do not claim that a
general-purpose public proxy is safe or already running.

## Development Status

Phase 1: Repository audit, runtime composition, and live compatibility harness.
