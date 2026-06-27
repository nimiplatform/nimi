import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { _electron as electron } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const mainEntry = path.join(root, 'dist-electron', 'main.js');

test('Electron acceptance host boots the tester renderer with the narrowed preload bridge', { timeout: 90_000 }, async () => {
  const app = await electron.launch({
    args: [mainEntry],
    env: process.env,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
    const hookKeys = await page.evaluate(() => Object.keys(globalThis.window.__NIMI_ELECTRON_RUNTIME__).sort());
    assert.deepEqual(hookKeys, ['invoke', 'listen']);
    const rawApiPresence = await page.evaluate(() => ({
      ipcRenderer: 'ipcRenderer' in globalThis.window,
      electron: 'electron' in globalThis.window,
      require: 'require' in globalThis.window,
      process: 'process' in globalThis.window,
    }));
    assert.deepEqual(rawApiPresence, {
      ipcRenderer: false,
      electron: false,
      require: false,
      process: false,
    });
    const status = await page.evaluate(() => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke('runtime_bridge_status', {}));
    assert.equal(status.managed, false);
    assert.equal(status.launchMode, 'RUNTIME');
    assert.match(String(status.grpcAddr || ''), /^127\.0\.0\.1:/);
    const lifecycleError = await page.evaluate(async () => {
      try {
        await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke('runtime_bridge_start', {});
        return null;
      } catch (error) {
        return {
          code: error?.code,
          reasonCode: error?.reasonCode,
          message: String(error?.message || error || ''),
        };
      }
    });
    assert.notEqual(lifecycleError, null);
    assert.match(
      `${lifecycleError.reasonCode || ''} ${lifecycleError.message || ''}`,
      /external-daemon-required|requires an external daemon/,
    );
  } finally {
    await app.close();
  }
});
