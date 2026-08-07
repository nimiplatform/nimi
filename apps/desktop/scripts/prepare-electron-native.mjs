#!/usr/bin/env node

if (process.platform === 'win32') {
  if (process.arch !== 'x64') {
    throw new Error(`Desktop Electron native preparation is not admitted for win32/${process.arch}`);
  }
  if (process.env.NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT === '1') {
    await import('../../../kit/shell/protected-local-node/scripts/build-windows-x64-source-local-development-package.mjs');
  } else {
    await import('../../../kit/shell/protected-local-node/scripts/build-windows-x64-package.mjs');
  }
} else if (process.platform === 'darwin' && process.env.NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT === '1') {
  if (process.arch !== 'arm64') {
    throw new Error(`Desktop source local development native preparation is not admitted for darwin/${process.arch}`);
  }
  process.argv.push('--source-local-development');
  await import('../../../kit/shell/protected-local-node/scripts/build-darwin-arm64-package.mjs');
}
