# Scramjet Runtime Integration Layer

This directory contains the Scramjet-NG runtime integration boundary.

The goal is to avoid coupling tests directly to Scramjet internals.

Current responsibilities:

- runtime configuration
- proxy URL mapping
- Playwright integration helpers
- future service worker bootstrap integration

No Scramjet core code is modified here.
