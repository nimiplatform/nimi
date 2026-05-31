import { afterEach, describe, expect, it } from 'vitest';
import {
  convertTauriFileSrc,
  hasTauriRuntime,
  invokeTauri,
  listenTauri,
  installNimiShellRuntimeBridge,
} from '../src/bridge/index.js';

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

  it('lets apps consume the scoped runtime hook without treating it as native Tauri', async () => {
    const invokeCalls: Array<{ command: string; payload: unknown }> = [];
    const listenCalls: string[] = [];
    testGlobal.__NIMI_TAURI_RUNTIME__ = {
      invoke: async (command, payload) => {
        invokeCalls.push({ command, payload });
        return { command, payload };
      },
      listen: async (eventName) => {
        listenCalls.push(eventName);
        return () => undefined;
      },
    };

    expect(hasTauriRuntime()).toBe(false);
    await expect(invokeTauri('desktop_command', { ok: true })).resolves.toEqual({
      command: 'desktop_command',
      payload: { ok: true },
    });
    const unsubscribe = await listenTauri('menu-bar://quit-requested', () => {});
    expect(typeof unsubscribe).toBe('function');
    expect(invokeCalls).toEqual([{ command: 'desktop_command', payload: { ok: true } }]);
    expect(listenCalls).toEqual(['menu-bar://quit-requested']);
    expect(convertTauriFileSrc('file:///tmp/avatar.vrm')).toBe('file:///tmp/avatar.vrm');
  });
});
