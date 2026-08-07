# Scramjet-NG Architecture

## Overview

Scramjet-NG is a compatibility layer built on top of MercuryWorkshop Scramjet.

The project treats the system as:

```
Browser Runtime Virtualization
          +
Scramjet Rewriting Engine
          +
Network Gateway
          +
Compatibility Layer
```

## Design Principles

- Keep Scramjet core unchanged where possible.
- Add small, testable compatibility extensions.
- Use self-owned fixtures for validation.
- Preserve browser observable behaviour.
- Keep the browser-visible proxy origin, virtual target URL, and upstream
  network connection as separate concepts.

## High Level Flow

The first live browser composition is single-origin:

```
Browser
  |
  v
Runtime composition origin
  |-- runtime harness + pinned assets
  |-- Service Worker
  |-- /~/sj/<controller>/<frame>/<target> HTTP gateway
  |-- /wisp/ WebSocket transport
  |
  v
Self-owned compatibility fixture
```

The Wisp transport carries browser network streams to the allowlisted fixture.
The HTTP gateway remains available for controller route requests and applies the
same target policy, limits, and redirect validation.

## Security Boundary

Production policy requires an explicit host allowlist and rejects loopback,
private, link-local, metadata, and reserved addresses by default. Local fixture
tests opt into development loopback access explicitly.

DNS-to-socket pinning, structured audit logging, and production lifecycle
management remain follow-up work. The composition server is a browser test
harness, not an unrestricted public proxy.
