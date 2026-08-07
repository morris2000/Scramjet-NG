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

## High Level Flow

```
Browser
  |
Scramjet Runtime
  |
Scramjet-NG Compatibility Layer
  |
Proxy Transport
  |
Upstream Application
```
