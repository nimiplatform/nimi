import assert from 'node:assert/strict';
import test from 'node:test';

import { assertMacOSElectronSecurity } from '../src-electron/macos-electron-security.js';

test('macOS Electron rejects Chromium switches that weaken process or origin security', () => {
  for (const forbidden of ['no-sandbox', 'disable-web-security', 'remote-debugging-pipe']) {
    assert.throws(
      () => assertMacOSElectronSecurity({
        platform: 'darwin',
        commandLine: {
          hasSwitch: (name) => name === forbidden,
        },
      }),
      (error) => error instanceof Error
        && 'reasonCode' in error
        && error.reasonCode === 'macos-electron-unsafe-chromium-switch',
    );
  }
});

test('macOS Electron security guard is inert on other platforms', () => {
  assert.doesNotThrow(() => assertMacOSElectronSecurity({
    platform: 'win32',
    commandLine: { hasSwitch: () => true },
  }));
});
