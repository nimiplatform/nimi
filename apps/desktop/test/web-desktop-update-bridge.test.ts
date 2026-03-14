import assert from 'node:assert/strict';
import test from 'node:test';

if (typeof globalThis.window === 'undefined') {
  (globalThis as Record<string, unknown>).window = {};
}
if (typeof globalThis.document === 'undefined') {
  (globalThis as Record<string, unknown>).document = {};
}
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
}

import {
  desktopUpdateDownload,
  desktopUpdateInstall,
  desktopUpdateRestart,
  desktopUpdateCheck,
  getDesktopReleaseInfo,
  getDesktopUpdateState,
  subscribeDesktopUpdateState,
} from '../../web/src/desktop-adapter/bridge.web';

test('web desktop adapter fails close for desktop release metadata', async () => {
  await assert.rejects(
    () => getDesktopReleaseInfo(),
    /desktop runtime/i,
  );
});

test('web desktop adapter fails close for desktop update state', async () => {
  await assert.rejects(
    () => getDesktopUpdateState(),
    /desktop runtime/i,
  );
});

test('web desktop adapter fails close for desktop update commands and events', async () => {
  await assert.rejects(
    () => desktopUpdateCheck(),
    /desktop runtime/i,
  );
  await assert.rejects(
    () => desktopUpdateDownload(),
    /desktop runtime/i,
  );
  await assert.rejects(
    () => desktopUpdateInstall(),
    /desktop runtime/i,
  );
  await assert.rejects(
    () => desktopUpdateRestart(),
    /desktop runtime/i,
  );
  await assert.rejects(
    () => subscribeDesktopUpdateState(() => {}),
    /desktop runtime/i,
  );
});
