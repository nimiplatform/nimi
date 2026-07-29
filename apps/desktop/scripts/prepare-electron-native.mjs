#!/usr/bin/env node

if (process.platform === 'win32') {
  if (process.arch !== 'x64') {
    throw new Error(`Desktop Electron native preparation is not admitted for win32/${process.arch}`);
  }
  await import('../product-control-node/scripts/build-windows-x64-package.mjs');
}
