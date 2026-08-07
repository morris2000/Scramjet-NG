# Threat Model

## Security Goals

Scramjet-NG must not become an unrestricted proxy.

## Gateway Controls

Required controls:

- scheme allowlist
- host validation
- private network blocking
- metadata IP blocking
- redirect validation
- request timeout
- body size limits
- WebSocket frame limits
- audit logging

Development exceptions must be explicit.
