# Compatibility Matrix

| Feature | Supported | Partial | Unsupported | Notes | Test |
|---|---|---|---|---|---|
| Runtime harness boot | ✓ |  |  | Same-origin harness loads audited browser globals | `tests/e2e/compatibility.spec.ts` |
| Service Worker | ✓ |  |  | Active on the composition origin | `tests/e2e/compatibility.spec.ts` |
| Relative Fetch |  | ✓ |  | GET is covered through the managed fixture; broader methods remain in progress | `tests/e2e/compatibility.spec.ts` |
| POST request/body | ✓ |  |  | Fixture echo is reached through the live transport | `tests/e2e/compatibility.spec.ts` |
| Streaming Fetch | ✓ |  |  | Three response chunks remain readable | `tests/e2e/compatibility.spec.ts` |
| HTTP gateway | ✓ |  |  | Allowlist, redirects, limits, and streaming are covered | `tests/runtime-gateway.test.ts` |
| Wisp text/binary streams | ✓ |  |  | Official Wisp client round-trip | `tests/runtime-gateway.test.ts` |
| Browser WebSocket | ✓ |  |  | Text and binary frames pass through the official rewrite, Libcurl transport, and Wisp endpoint | `tests/fixture.test.ts`, `tests/e2e/compatibility.spec.ts` |
| Server-Sent Events | ✓ |  |  | EventSource framing, named events, event IDs, streaming, and close lifecycle pass through Libcurl/Wisp | `tests/fixture.test.ts`, `tests/e2e/compatibility.spec.ts` |
| SPA navigation | ✓ |  |  | Fixture `pushState`, `popstate`, and back navigation retain the virtual route | `tests/e2e/compatibility.spec.ts` |
| Dynamic import | ✓ |  |  | Same-origin relative module is rewritten and evaluated through the official module path | `tests/e2e/compatibility.spec.ts` |
| Web Worker | ✓ |  |  | Classic dedicated Worker script is rewritten/injected and completes a text message round-trip | `tests/e2e/compatibility.spec.ts` |
| Storage virtualization | ✓ |  |  | Basic local/session key operations are namespaced by the virtual target host; parent harness storage remains isolated | `tests/e2e/compatibility.spec.ts` |
| Cookie handling | ✓ |  |  | Basic `document.cookie`, response `Set-Cookie`, and subsequent request-cookie round-trips are covered | `tests/fixture.test.ts`, `tests/e2e/compatibility.spec.ts` |
| Dynamic import |  |  | ✓ | Not implemented or tested | — |
| Web Worker |  |  | ✓ | Not implemented or tested | — |

The dynamic import and Worker assertions cover same-origin relative module
loading and a classic dedicated Worker with text messages. Module Workers,
SharedWorkers, Worklets, binary messages, and Worker lifecycle/error behavior
remain additional coverage.

The cookie browser assertion allows a short asynchronous handoff after a
`document.cookie` setter before checking the next transport request. This
reflects the audited controller's Service Worker cookie-sync path; expiry,
domain/path edge cases, partitioning, and third-party cookie policy remain
additional coverage.

The SSE assertion uses a finite self-owned stream. Reconnect behavior across
long-lived production feeds remains additional coverage.

Untested features are not marked as supported.
