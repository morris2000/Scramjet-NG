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
- close codes and resource limits

### Browser Tests

Using Playwright and the self-owned fixture:

- runtime harness boot
- Service Worker activation
- fixture loading through the Scramjet-managed iframe
- relative fetch
- POST echo
- streaming fetch

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
```

The fixture is local and does not depend on third-party websites.

## Future Coverage

- SPA navigation and History API
- SSE
- browser WebSocket text/binary assertions
- dynamic import
- Web Worker
- iframe
- Blob URL
- file upload
- AbortController
- cookies and storage virtualization

Untested features are not marked as supported.
