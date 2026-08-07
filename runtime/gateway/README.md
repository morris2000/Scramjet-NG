# HTTP gateway

This module is the HTTP forwarding boundary for the Scramjet-NG runtime.

It accepts only the official controller URL shape:

```text
/~/sj/<controller-id>/<frame-id>/<encoded-target>
```

The target is decoded once, validated against an explicit host allowlist, DNS
resolved, and then fetched with `redirect: "manual"`. Response bodies are
piped through the Web Streams reader without first buffering the complete
response. Redirect `Location` values must pass the same target policy and are
rewritten to the originating controller/frame route.

The default policy is restrictive. A production caller must provide an
allowlist and cannot enable loopback or private-network access. Development
fixtures may explicitly enable loopback access, for example:

```ts
const policy = createGatewayPolicy({
  development: true,
  allowedHosts: ["127.0.0.1"],
  allowLoopback: true,
});
```

This slice intentionally does not implement Wisp/WebSocket forwarding,
socket-level DNS pinning, or structured audit logging yet.
