# RFC-0002: Dynamic Application Compatibility Test Harness

Status: Implemented MVP slice

## Goal

Create a repeatable browser compatibility test environment.

## First Vertical Slice

The implemented harness provides:

- a self-owned compatibility fixture;
- pinned Scramjet browser assets;
- a same-origin runtime composition server;
- Service Worker registration;
- Wisp transport setup;
- Playwright browser regression tests for fixture loading, relative fetch,
  POST echo, streaming response, finite SSE EventSource behavior, text/binary
  WebSocket frames, SPA History API navigation, cookie round-trips, and
  parent-origin storage isolation, dynamic module loading, and dedicated
  Worker text message round-trip;
- direct fixture regression tests independent of the browser for WebSocket echo,
  SSE framing/stream completion, cookie headers, and module/Worker asset
  contracts.

## Security

The fixture is local and explicitly allowlisted in development mode. Production
policy remains restrictive and rejects private and loopback targets by default.

The fixture accepts only its explicit `/socket` WebSocket endpoint. Because
Chromium/libcurl can send h2c upgrade headers for ordinary HTTP requests, the
fixture keeps a small HTTP fallback for non-WebSocket upgrades rather than
treating every upgrade as a WebSocket.

## Compatibility Risks

The current browser harness exercises the audited runtime assets and the
Libcurl/Wisp path only. The SSE coverage intentionally uses a finite stream and
does not yet claim long-lived reconnect/retry compatibility. Dynamic import
and Worker coverage is limited to a same-origin module and classic dedicated
Worker text message. Module Workers, SharedWorkers, Worklets, binary messages,
Worker lifecycle/error cases, and broader cross-origin behavior remain follow-up
work. Cookie coverage is limited to basic `document.cookie`, `Set-Cookie`,
and request-cookie behavior; the controller's cookie sync is asynchronous and
advanced cookie attributes, partitioning, storage persistence, and broader
cross-origin cases remain follow-up work.

## Rollback

Remove the composition server, fixture, and Playwright live test command. The
existing unit and gateway tests remain independently runnable.
