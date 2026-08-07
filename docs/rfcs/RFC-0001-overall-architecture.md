# RFC-0001: Scramjet-NG Overall Architecture

Status: Draft

## Background

Scramjet-NG builds a modern web compatibility layer on top of MercuryWorkshop Scramjet.

## Goals

- Improve compatibility with dynamic web applications.
- Preserve Scramjet rewriting and runtime components.
- Add automated regression coverage.

## Non Goals

- Authentication bypass.
- Access control bypass.
- CAPTCHA or bot protection bypass.
- Unauthorised proxy usage.

## Proposed Architecture

```
Application
    |
Compatibility Layer
    |
Scramjet Core
    |
Transport
    |
Network
```

## Testing

All features require self-owned compatibility fixtures.
