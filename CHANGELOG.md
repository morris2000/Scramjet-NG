# Changelog

## Unreleased

### Added

- Initial Scramjet-NG architecture documentation.
- Compatibility testing strategy.
- RFC structure.
- A self-owned fixture WebSocket endpoint with text and binary echo.
- Browser-level WebSocket regression through the official Libcurl/Wisp path.
- SPA History API regression for `pushState`, `popstate`, and back navigation.
- A small h2c HTTP fallback in the fixture so ordinary Chromium/libcurl
  requests remain compatible when the fixture also owns a WebSocket upgrade
  listener.
