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
  POST echo, and streaming response.

## Security

The fixture is local and explicitly allowlisted in development mode. Production
policy remains restrictive and rejects private and loopback targets by default.

## Compatibility Risks

The current browser harness exercises the audited runtime assets and the
Libcurl/Wisp path only. SPA navigation, browser WebSocket assertions, SSE,
workers, dynamic imports, cookies, and storage remain future coverage.

## Rollback

Remove the composition server, fixture, and Playwright live test command. The
existing unit and gateway tests remain independently runnable.
