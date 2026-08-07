# Changelog

## Unreleased

### Added

- Initial Scramjet-NG architecture documentation.
- Compatibility testing strategy.
- RFC structure.
- A self-owned fixture WebSocket endpoint with text and binary echo.
- Browser-level WebSocket regression through the official Libcurl/Wisp path.
- SPA History API regression for `pushState`, `popstate`, and back navigation.
- A finite fixture SSE endpoint with direct stream and native EventSource
  regressions for framing, named events, event IDs, and close/error lifecycle.
- A basic fixture cookie endpoint and browser regression for
  `document.cookie`, `Set-Cookie`, and subsequent request-cookie round-trips.
- Browser regression for host-namespaced local/session storage and isolation from
  the parent harness origin.
- Browser regression for same-origin dynamic module loading.
- Browser regression for classic dedicated Worker rewriting and text messages.
- Nested iframe fixture document with parent/child `postMessage` virtual-origin
  regression.
- Direct fixture coverage for the nested iframe document contract.
- A small h2c HTTP fallback in the fixture so ordinary Chromium/libcurl
  requests remain compatible when the fixture also owns a WebSocket upgrade
  listener.
