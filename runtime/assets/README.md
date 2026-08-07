# Runtime assets

This module owns the local HTTP serving contract for Scramjet browser assets.

`listenRuntimeAssetServer()` serves:

- a generated `/sw.js` entrypoint that imports the controller Service Worker;
- only the configured Scramjet core, WASM, utils, controller, and transport files;
- `GET` and `HEAD` requests, with same-origin asset paths and explicit content
  types.

The server itself does not fetch packages from a CDN and does not act as the
proxy gateway. `runtime/composition/` can mount its request handler beside the
gateway so both assets and proxied fixture traffic share one origin.
`pins.ts` and `sync.ts` provide the separate, explicit asset acquisition step:

- exact package versions and dist paths are recorded in `pins.ts`;
- each file has an expected byte size and SHA-256 hash;
- all files are downloaded and verified before any file is written;
- the default packages are AGPL-3.0-only MercuryWorkshop packages.

To populate the default Libcurl asset root:

```text
pnpm assets:sync
```

To use the pinned Epoxy transport instead in PowerShell:

```text
$env:SCRAMJET_TRANSPORT = "epoxy"
pnpm assets:sync
```

Set `$env:SCRAMJET_ASSET_ROOT` to choose another output directory. The sync
command requires network access and should be run only when the pinned hashes
have been reviewed.
