import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  getDesktopUpdateState,
  subscribeDesktopUpdateState,
} from '../src/shell/renderer/bridge/runtime-bridge/desktop-release';

type TauriTestHook = {
  invoke?: (command: string, payload?: unknown) => Promise<unknown>;
  listen?: (
    eventName: string,
    handler: (event: { payload: unknown }) => void,
  ) => Promise<(() => void) | undefined> | (() => void) | undefined;
};

type TauriWindow = Record<string, unknown> & {
  __NIMI_TAURI_TEST__?: TauriTestHook;
  __NIMI_TAURI_RUNTIME__?: TauriTestHook;
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
};

type TauriGlobal = Record<string, unknown> & {
  __NIMI_TAURI_TEST__?: TauriTestHook;
  __NIMI_TAURI_RUNTIME__?: TauriTestHook;
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
  window?: TauriWindow;
};

const desktopDir = path.resolve(import.meta.dirname, '..');

function tauriGlobal(): TauriGlobal {
  return globalThis as unknown as TauriGlobal;
}

function resetTauriRuntime(): void {
  const target = tauriGlobal();
  delete target.__NIMI_TAURI_TEST__;
  delete target.__NIMI_TAURI_RUNTIME__;
  delete target.__TAURI_INTERNALS__;
  delete target.__TAURI_IPC__;
  if (!target.window || typeof target.window !== 'object') {
    target.window = {} as TauriWindow;
  }
  delete target.window.__NIMI_TAURI_TEST__;
  delete target.window.__NIMI_TAURI_RUNTIME__;
  delete target.window.__TAURI_INTERNALS__;
  delete target.window.__TAURI_IPC__;
}

test('desktop update state bridge fails close without Tauri runtime', async () => {
  resetTauriRuntime();

  await assert.rejects(
    () => getDesktopUpdateState(),
    /desktop_update_state_get requires Tauri runtime/,
  );
  await assert.rejects(
    () => subscribeDesktopUpdateState(() => {}),
    /desktop_update_state_subscribe requires Tauri runtime/,
  );
});

test('desktop update event subscription rejects missing unsubscribe', async () => {
  resetTauriRuntime();
  const target = tauriGlobal();
  const hook: TauriTestHook = {
    listen: async () => undefined,
  };
  target.__NIMI_TAURI_TEST__ = hook;
  target.window!.__NIMI_TAURI_TEST__ = hook;

  try {
    await assert.rejects(
      () => subscribeDesktopUpdateState(() => {}),
      { message: /did not return an unsubscribe function/ },
    );
  } finally {
    resetTauriRuntime();
  }
});

test('desktop release bridge source has no self-update pseudo-success fallbacks', () => {
  const source = readFileSync(
    path.join(desktopDir, 'src/shell/renderer/bridge/runtime-bridge/desktop-release.ts'),
    'utf8',
  );

  assert.doesNotMatch(source, /status:\s*'idle'/);
  assert.doesNotMatch(source, /return\s+\(\)\s*=>\s*\{\s*\}/);
});
