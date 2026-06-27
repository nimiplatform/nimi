import { afterEach, describe, expect, it } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  convertTauriFileSrc,
  hasElectronInvoke,
  hasElectronRuntime,
  hasNimiShellRuntime,
  hasShellHostInvoke,
  hasTauriInvoke,
  hasTauriRuntime,
  invokeShell,
  invokeTauri,
  listenShell,
  listenTauri,
  installNimiShellRuntimeBridge,
  parseRuntimeBridgeConfigGetResult,
  parseRuntimeBridgeConfigSetResult,
  parseRuntimeBridgeDaemonStatus,
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
  __NIMI_ELECTRON_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: (eventName: string, handler: (event: { payload: unknown }) => void) => () => void;
  };
  __NIMI_ELECTRON_RUNTIME__?: TauriRuntimeTestGlobal['__NIMI_ELECTRON_TEST__'];
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
  window?: {
    __NIMI_TAURI_TEST__?: TauriRuntimeTestGlobal['__NIMI_TAURI_TEST__'];
    __NIMI_TAURI_RUNTIME__?: TauriRuntimeTestGlobal['__NIMI_TAURI_RUNTIME__'];
    __NIMI_ELECTRON_TEST__?: TauriRuntimeTestGlobal['__NIMI_ELECTRON_TEST__'];
    __NIMI_ELECTRON_RUNTIME__?: TauriRuntimeTestGlobal['__NIMI_ELECTRON_RUNTIME__'];
    __TAURI_INTERNALS__?: unknown;
    __TAURI_IPC__?: unknown;
  };
};

const testGlobal = globalThis as TauriRuntimeTestGlobal;

function resetTauriGlobals(): void {
  delete testGlobal.__NIMI_TAURI_TEST__;
  delete testGlobal.__NIMI_TAURI_RUNTIME__;
  delete testGlobal.__NIMI_ELECTRON_TEST__;
  delete testGlobal.__NIMI_ELECTRON_RUNTIME__;
  delete testGlobal.__TAURI_INTERNALS__;
  delete testGlobal.__TAURI_IPC__;
  delete testGlobal.window;
}

afterEach(() => {
  resetTauriGlobals();
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
    expect(result).toEqual({ installed: true, host: 'tauri' });

    const hook = testGlobal.__NIMI_TAURI_RUNTIME__;
    expect(typeof hook?.invoke).toBe('function');
    expect(typeof hook?.listen).toBe('function');

    await expect(hook!.invoke(NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'], { a: 1 })).resolves.toBe('ok');
    await expect(invokeShell(NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'], { a: 2 })).resolves.toBe('ok');
    expect(invokeCalls).toEqual([
      { command: NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'], payload: { a: 1 } },
      { command: NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'], payload: { a: 2 } },
    ]);

    const unsubscribe = await hook!.listen('nimi.shell.runtime:stream:1', () => {});
    expect(listenCalls).toEqual(['nimi.shell.runtime:stream:1']);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    expect(unsubscribed).toBe(true);
  });

  it('fails closed outside a standard shell host', async () => {
    expect(hasTauriRuntime()).toBe(false);
    expect(hasNimiShellRuntime()).toBe(false);
    const result = installNimiShellRuntimeBridge();
    expect(result).toEqual({ installed: false, reason: 'standard-host-preload-required' });
    expect(testGlobal.__NIMI_TAURI_RUNTIME__).toBeUndefined();
    await expect(invokeShell(NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'], {})).rejects.toThrow(/not available/);
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

    expect(hasTauriRuntime()).toBe(true);
    expect(hasTauriInvoke()).toBe(true);
    expect(hasNimiShellRuntime()).toBe(true);
    expect(hasShellHostInvoke()).toBe(true);
    await expect(invokeTauri('desktop_command', { ok: true })).resolves.toEqual({
      command: 'desktop_command',
      payload: { ok: true },
    });
    const unsubscribe = await listenTauri('menu-bar://quit-requested', () => {});
    expect(typeof unsubscribe).toBe('function');
    expect(invokeCalls).toEqual([{ command: 'desktop_command', payload: { ok: true } }]);
    expect(listenCalls).toEqual(['menu-bar://quit-requested']);
    await expect(Promise.resolve().then(() => convertTauriFileSrc('/tmp/avatar.vrm'))).rejects.toThrow(/not available/);
  });

  it('uses an Electron preload runtime hook through host-neutral invoke and listen', async () => {
    const invokeCalls: Array<{ command: string; payload: unknown }> = [];
    const listenCalls: string[] = [];
    let emittedPayload: unknown;
    testGlobal.__NIMI_ELECTRON_RUNTIME__ = {
      invoke: async (command, payload) => {
        invokeCalls.push({ command, payload });
        return { command, payload, host: 'electron' };
      },
      listen: (eventName, handler) => {
        listenCalls.push(eventName);
        handler({ payload: { host: 'electron-event' } });
        return () => {
          emittedPayload = 'unsubscribed';
        };
      },
    };

    expect(hasElectronRuntime()).toBe(true);
    expect(hasElectronInvoke()).toBe(true);
    expect(hasTauriRuntime()).toBe(false);
    expect(hasNimiShellRuntime()).toBe(true);
    expect(installNimiShellRuntimeBridge()).toEqual({
      installed: true,
      host: 'electron',
      reason: 'electron-preload-present',
    });

    await expect(invokeShell(NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'], { ok: true })).resolves.toEqual({
      command: NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'],
      payload: { ok: true },
      host: 'electron',
    });
    const unsubscribe = await listenShell('nimi.shell.runtime:stream:electron', (event) => {
      emittedPayload = event.payload;
    });
    expect(invokeCalls).toEqual([{ command: NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'], payload: { ok: true } }]);
    expect(listenCalls).toEqual(['nimi.shell.runtime:stream:electron']);
    expect(emittedPayload).toEqual({ host: 'electron-event' });
    unsubscribe();
    expect(emittedPayload).toBe('unsubscribed');
  });

  it('does not treat raw Tauri globals as an installed standard host', () => {
    testGlobal.__TAURI_INTERNALS__ = {
      invoke: () => Promise.resolve(null),
    };

    expect(hasTauriRuntime()).toBe(false);
    expect(hasTauriInvoke()).toBe(false);
  });
});

describe('runtime bridge daemon command payloads', () => {
  it('parses daemon status through the shared Kit bridge contract', () => {
    expect(parseRuntimeBridgeDaemonStatus({
      running: true,
      managed: true,
      launchMode: 'runtime',
      grpcAddr: '127.0.0.1:50051',
      pid: 42,
      version: '0.1.0',
      lastError: '',
      debugLogPath: '/tmp/runtime.log',
    })).toEqual({
      running: true,
      managed: true,
      launchMode: 'RUNTIME',
      grpcAddr: '127.0.0.1:50051',
      pid: 42,
      version: '0.1.0',
      debugLogPath: '/tmp/runtime.log',
    });
  });

  it('parses daemon config get and set results through Kit instead of app-local schemas', () => {
    expect(parseRuntimeBridgeConfigGetResult({
      path: '/tmp/runtime-config.json',
      config: { grpcAddr: '127.0.0.1:50051' },
    })).toEqual({
      path: '/tmp/runtime-config.json',
      config: { grpcAddr: '127.0.0.1:50051' },
    });

    expect(parseRuntimeBridgeConfigSetResult({
      path: '/tmp/runtime-config.json',
      reasonCode: 'runtime_config_changed',
      actionHint: 'restart_runtime',
      config: { grpcAddr: '127.0.0.1:50052' },
    })).toEqual({
      path: '/tmp/runtime-config.json',
      reasonCode: 'runtime_config_changed',
      actionHint: 'restart_runtime',
      config: { grpcAddr: '127.0.0.1:50052' },
    });
  });

  it('fails closed when required daemon payload fields are missing', () => {
    expect(() => parseRuntimeBridgeDaemonStatus({ running: true })).toThrow(/grpcAddr is required/);
    expect(() => parseRuntimeBridgeConfigGetResult({ path: '/tmp/config.json' })).toThrow(/config payload/);
    expect(() => parseRuntimeBridgeConfigSetResult({ config: {} })).toThrow(/path is required/);
  });
});
