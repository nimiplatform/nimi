#!/usr/bin/env node

// Avatar never launches an Electron binary itself. The official entry delegates
// to apps/desktop/scripts/run-electron-dev.mjs, whose signed supervisor owns the
// exact renderer URL, protected bundled-avatar carrier, app-private Chromium
// profile, and process lifetime.
process.argv.push('--avatar-only');
await import('../../desktop/scripts/run-electron-dev.mjs');
