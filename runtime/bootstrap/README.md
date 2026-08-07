# Scramjet Runtime Bootstrap

Bootstrap layer for integrating MercuryWorkshop Scramjet runtime.

## Purpose

This layer provides a stable integration boundary between Scramjet-NG tests and
the official Scramjet runtime.

Responsibilities:

- runtime configuration loading;
- Service Worker bootstrap coordination;
- proxy URL preparation;
- browser test integration.

## Current Status

The official binding is implemented in
`runtime/adapter/official.ts`. It loads the audited browser globals, creates
the selected transport, registers the Service Worker, and initializes the
controller adapter.

The live browser composition in `runtime/composition/` uses the same audited
asset and transport contract to boot a managed fixture iframe. The bootstrap
API remains available for application-owned integrations and test doubles.
