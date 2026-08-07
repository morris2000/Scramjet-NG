# Testing Strategy

## Layers

### Unit Tests

Validate:

- URL mapping
- header rewriting
- runtime helpers

### Integration Tests

Validate:

- proxy transport
- HTTP behaviour
- streaming responses

### Browser Tests

Using Playwright:

- SPA navigation
- fetch
- streaming
- WebSocket
- worker
- dynamic import

## First Vertical Slice

Local compatibility fixture + Scramjet runtime + Playwright regression test.
