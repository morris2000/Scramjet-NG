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
  WebSocket frames, and SPA History API navigation;
- direct fixture regression tests independent of the browser for WebSocket echo
  and SSE framing/stream completion.

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
does not yet claim long-lived reconnect/retry compatibility. Workers, dynamic
imports, cookies, and storage remain future coverage.

## Rollback

Remove the composition server, fixture, and Playwright live test command. The
existing unit and gateway tests remain independently runnable.
