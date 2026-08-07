# Runtime composition

This module provides the first single-origin browser composition boundary.

It serves the application-owned harness and pinned Scramjet browser assets,
forwards `/~/sj/` HTTP routes through the gateway, and handles the `/wisp/`
WebSocket endpoint through the official Wisp server. The target policy remains
explicit and allowlist-first; a local fixture must opt into development
loopback access.

The composition server is a test harness, not a production deployment. DNS
pinning, audit logging, and a production lifecycle manager remain outside this
slice.
