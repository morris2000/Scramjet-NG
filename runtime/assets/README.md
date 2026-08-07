# Runtime assets

This module owns the local HTTP serving contract for Scramjet browser assets.

`listenRuntimeAssetServer()` serves:

- a generated `/sw.js` entrypoint that imports the controller Service Worker;
- only the configured Scramjet core, WASM, controller, and transport files;
- `GET` and `HEAD` requests, with same-origin asset paths and explicit content
  types.

The server intentionally does not fetch packages from a CDN and does not act as
the proxy gateway. Populate the configured asset root from a reviewed,
version-pinned Scramjet build before using it with the browser bootstrap.

