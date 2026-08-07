# Testing Strategy

## Commands

Run the Node regression suite and syntax checks with:

```text
pnpm install --ignore-scripts --frozen-lockfile
pnpm test
pnpm check
pnpm check:official
pnpm check:assets
pnpm check:sync
pnpm check:gateway
pnpm check:wisp
pnpm check:composition
pnpm check:fixture
```

The live browser slice requires the pinned assets and a Playwright browser:

```text
pnpm assets:sync
pnpm e2e
```

## Layers

### Unit Tests

Validate:

- URL mapping
- target and address policy
- runtime helpers
- asset manifests and hash verification
- gateway limits
- Wisp upgrade policy

### Integration Tests

Validate:

- one-origin runtime composition
- generated Service Worker route
- HTTP forwarding
- streaming responses
- Wisp text and binary streams
- direct fixture WebSocket text and binary echo
- direct fixture SSE framing and stream completion
- direct fixture cookie header and `Set-Cookie` contract
- direct fixture dynamic module and Worker script responses
- direct fixture nested iframe document contract
- direct fixture runtime compatibility asset, multipart upload, and slow-response
  cancellation contracts
- close codes and resource limits

### Browser Tests

Using Playwright and the self-owned fixture:

- runtime harness boot
- Service Worker activation
- fixture loading through the Scramjet-managed iframe
- relative fetch
- POST echo
- streaming fetch
- WebSocket text and binary frames through Libcurl/Wisp
- EventSource open, message, named event, event ID, error, and close lifecycle
- basic `document.cookie` set/get and response/request cookie round-trips
- local/session storage key operations and parent harness isolation
- same-origin dynamic import
- classic dedicated Worker construction, runtime injection, and text message
  round-trip
- same-origin nested iframe loading and parent/child `postMessage` virtual-origin
  assertion
- Blob URL create/fetch/revoke
- native `FormData`/`File` multipart upload
- app-facing `AbortController` cancellation and standard `AbortError`
- SPA `pushState` and back navigation

## First Vertical Slice

The first live slice is implemented as:

```text
Playwright
    |
runtime composition origin
    |-- pinned browser assets + Service Worker
    |-- /~/sj/ HTTP gateway
    |-- /wisp/ WebSocket transport
    |
self-owned compatibility fixture
    |-- HTTP/streaming/POST endpoints
    |-- /events finite SSE endpoint
    |-- /socket WebSocket echo endpoint
    |-- /api/cookie Set-Cookie/request-cookie endpoint
    |-- /dynamic-module.js same-origin module endpoint
    |-- /worker.js dedicated Worker endpoint
    |-- /nested-frame.html nested document and postMessage round-trip
    |-- /runtime-compat.js app-facing AbortController compatibility shim
    |-- /api/upload multipart File upload endpoint
    |-- /api/slow delayed response for cancellation checks
    |-- document.cookie + local/session storage checks
    |-- SPA History API controls
```

The fixture is local and does not depend on third-party websites. Its server also
preserves ordinary HTTP requests that arrive with Chromium/libcurl's h2c upgrade
headers while reserving WebSocket upgrades for `/socket`.

The SSE browser check intentionally uses a finite stream so the test can verify
server-side close and native EventSource error handling without leaving a
reconnect loop running. The cookie browser check similarly allows the official
controller's asynchronous Service Worker cookie-sync handoff to complete before
asserting the next request.

## Future Coverage

- long-lived SSE reconnect and retry behavior
- transport-level AbortSignal propagation and request cleanup
- binary and large multipart uploads, upload progress, and resumable upload
  behavior
- cookie expiry, domain/path edge cases, partitioning, and third-party policy
- module Worker, SharedWorker, Worklet, Worker lifecycle/error cases, and
  binary Worker messages
- cross-origin iframe policy, strict `targetOrigin` filtering, MessagePort,
  structured-clone edge cases, sandboxed frames, and broader frame isolation
- broader cross-origin storage and frame isolation cases

Untested features are not marked as supported.
