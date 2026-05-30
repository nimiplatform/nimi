import { afterEach, describe, expect, it } from 'vitest';
import { hasTauriRuntime, installNimiShellRuntimeBridge } from '../src/bridge/index.js';

type TauriEventHandler = (event: { event?: string; id?: number; payload: unknown }) => void;

type TauriRuntimeTestGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: {
    invoke?: (command: string, payload?: unknown) => Promise<unknown>;
    listen?: (
      eventName: string,
      handler: TauriEventHandler,
    ) => Promise<(() => void) | undefined> | (() => void) | undefined;
  };
  __NIMI_TAURI_RUNTIME__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: (eventName: string, handler: TauriEventHandler) => Promise<() => void>;
  };
};

const testGlobal = globalThis as TauriRuntimeTestGlobal;

afterEach(() => {
  delete testGlobal.__NIMI_TAURI_TEST__;
  delete testGlobal.__NIMI_TAURI_RUNTIME__;
});

describe('installNimiShellRuntimeBridge', () => {
  it('installs the scoped invoke + listen hook the SDK tauri-ipc transport resolves', async () => {
    const invokeCalls: Array<{ command: string; payload: unknown }> = [];
    const listenCalls: string[] = [];
    let unsubscribed = false;
    testGlobal.__NIMI_TAURI_TEST__ = {
      invoke: async (command, payload) => {
        invokeCalls.push({ command, payload });
        return 'ok';
      },
      listen: async (eventName) => {
        listenCalls.push(eventName);
        return () => {
          unsubscribed = true;
        };
      },
    };

    const result = installNimiShellRuntimeBridge();
    expect(result).toEqual({ installed: true });

    const hook = testGlobal.__NIMI_TAURI_RUNTIME__;
    expect(typeof hook?.invoke).toBe('function');
    expect(typeof hook?.listen).toBe('function');

    await expect(hook!.invoke('runtime_bridge_unary', { a: 1 })).resolves.toBe('ok');
    expect(invokeCalls).toEqual([{ command: 'runtime_bridge_unary', payload: { a: 1 } }]);

    const unsubscribe = await hook!.listen('runtime_bridge:stream:1', () => {});
    expect(listenCalls).toEqual(['runtime_bridge:stream:1']);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    expect(unsubscribed).toBe(true);
  });

  it('is a typed no-op outside a Tauri environment, never a thrown error', () => {
    expect(hasTauriRuntime()).toBe(false);
    const result = installNimiShellRuntimeBridge();
    expect(result).toEqual({ installed: false, reason: 'non-tauri-environment' });
    expect(testGlobal.__NIMI_TAURI_RUNTIME__).toBeUndefined();
  });

  it('fails closed when the underlying listener does not return an unsubscribe', async () => {
    testGlobal.__NIMI_TAURI_TEST__ = {
      invoke: async () => 'ok',
      listen: async () => undefined,
    };
    installNimiShellRuntimeBridge();
    const hook = testGlobal.__NIMI_TAURI_RUNTIME__;
    await expect(hook!.listen('evt', () => {})).rejects.toThrow(/unsubscribe/);
  });
});
