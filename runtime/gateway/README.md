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

This module still does not implement socket-level DNS pinning or structured
audit logging yet.

## Wisp upgrade

The Wisp upgrade boundary is now available through the official
`@mercuryworkshop/wisp-js@0.4.1` server package:

```ts
const upgrade = await createOfficialWispUpgradeHandler({ policy });
const gateway = await listenHttpGatewayServer({ policy, upgrade });
```

Only the exact `/wisp/` endpoint is accepted. The handler configures Wisp's
hostname allowlist, direct-IP policy, private/loopback restrictions, TCP/UDP
switches, total stream limit, and raw WebSocket connection-byte limit. UDP is
disabled by default.

The Wisp package's `stream_limit_per_host` option is left disabled because
version `0.4.1` iterates its internal streams object as if it were an array;
the working total-per-connection limit remains enabled. Direct Wisp wsproxy
paths such as `/wisp/host:port` are intentionally not accepted in this slice.

The Wisp server package is AGPL-3.0 and is a server-only dependency; it is not
included in the browser runtime asset bundle.
