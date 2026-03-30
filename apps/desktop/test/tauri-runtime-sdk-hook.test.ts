import assert from 'node:assert/strict';
import test from 'node:test';

import { installSdkTauriRuntimeHook } from '../src/runtime/tauri-api';

type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type TauriListen = (
  eventName: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<(() => void) | undefined> | (() => void) | undefined;

type MutableRuntimeGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: {
    invoke?: TauriInvoke;
    listen?: TauriListen;
  };
  __NIMI_TAURI_RUNTIME__?: {
    invoke?: TauriInvoke;
    listen?: TauriListen;
  };
  window?: {
    __NIMI_TAURI_TEST__?: {
      invoke?: TauriInvoke;
      listen?: TauriListen;
    };
    __NIMI_TAURI_RUNTIME__?: {
      invoke?: TauriInvoke;
      listen?: TauriListen;
    };
  };
};

test('installSdkTauriRuntimeHook publishes SDK-compatible invoke and listen hook', async () => {
  const target = globalThis as MutableRuntimeGlobal;
  const previousRootRuntime = target.__NIMI_TAURI_RUNTIME__;
  const previousRootTest = target.__NIMI_TAURI_TEST__;
  const previousWindow = target.window;

  let invokedCommand = '';
  let listenedEvent = '';
  const windowObject = previousWindow || {};
  const testHook = {
    invoke: async (command: string) => {
      invokedCommand = command;
      return { ok: true };
    },
    listen: (eventName: string) => {
      listenedEvent = eventName;
      return () => {};
    },
  };

  target.__NIMI_TAURI_TEST__ = testHook;
  target.window = windowObject;
  windowObject.__NIMI_TAURI_TEST__ = testHook;

  try {
    installSdkTauriRuntimeHook();
    assert.equal(typeof target.__NIMI_TAURI_RUNTIME__?.invoke, 'function');
    assert.equal(typeof target.__NIMI_TAURI_RUNTIME__?.listen, 'function');
    assert.equal(target.window?.__NIMI_TAURI_RUNTIME__, target.__NIMI_TAURI_RUNTIME__);

    const invokeResult = await target.__NIMI_TAURI_RUNTIME__?.invoke?.('runtime_bridge_status');
    assert.deepEqual(invokeResult, { ok: true });
    assert.equal(invokedCommand, 'runtime_bridge_status');

    const unsubscribe = await target.__NIMI_TAURI_RUNTIME__?.listen?.('runtime_bridge:stream:test', () => {});
    assert.equal(typeof unsubscribe, 'function');
    assert.equal(listenedEvent, 'runtime_bridge:stream:test');
  } finally {
    if (previousRootRuntime === undefined) {
      delete target.__NIMI_TAURI_RUNTIME__;
    } else {
      target.__NIMI_TAURI_RUNTIME__ = previousRootRuntime;
    }
    if (previousRootTest === undefined) {
      delete target.__NIMI_TAURI_TEST__;
    } else {
      target.__NIMI_TAURI_TEST__ = previousRootTest;
    }
    if (previousWindow === undefined) {
      Reflect.deleteProperty(target, 'window');
    } else {
      target.window = previousWindow;
    }
  }
});
