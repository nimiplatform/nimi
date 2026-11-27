import { afterEach, describe, expect, it } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  convertShellFileSrc,
  hasElectronInvoke,
  hasElectronRuntime,
  hasNimiShellRuntime,
  hasShellHostInvoke,
  invokeShell,
  listenShell,
  installNimiShellRuntimeBridge,
  parseRuntimeBridgeConfigGetResult,
  parseRuntimeBridgeConfigSetResult,
  parseRuntimeBridgeDaemonStatus,
} from '../src/bridge/index.js';

type ShellRuntimeTestGlobal = typeof globalThis & {
  __NIMI_ELECTRON_TEST__?: {
    invoke?: (command: string, payload?: unknown) => Promise<unknown>;
    listen?: (
      eventName: string,
      handler: (event: { payload: unknown }) => void,
    ) => (() => void) | undefined;
  };
  __NIMI_ELECTRON_RUNTIME__?: ShellRuntimeTestGlobal['__NIMI_ELECTRON_TEST__'];
  __NIMI_TAURI_RUNTIME__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  window?: {
    __NIMI_ELECTRON_TEST__?: ShellRuntimeTestGlobal['__NIMI_ELECTRON_TEST__'];
    __NIMI_ELECTRON_RUNTIME__?: ShellRuntimeTestGlobal['__NIMI_ELECTRON_TEST__'];
    __NIMI_TAURI_RUNTIME__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
};

const testGlobal = globalThis as ShellRuntimeTestGlobal;

function resetShellGlobals(): void {
  delete testGlobal.__NIMI_ELECTRON_TEST__;
  delete testGlobal.__NIMI_ELECTRON_RUNTIME__;
  delete testGlobal.__NIMI_TAURI_RUNTIME__;
  delete testGlobal.__TAURI_INTERNALS__;
  delete testGlobal.window;
}

afterEach(() => {
  resetShellGlobals();
});

describe('installNimiShellRuntimeBridge', () => {
  it('fails closed outside a standard Electron shell host', async () => {
    expect(hasElectronRuntime()).toBe(false);
    expect(hasNimiShellRuntime()).toBe(false);
    const result = installNimiShellRuntimeBridge();
    expect(result).toEqual({ installed: false, reason: 'standard-host-preload-required' });
    await expect(invokeShell(NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'], {})).rejects.toThrow(/not available/);
    await expect(Promise.resolve().then(() => convertShellFileSrc('/tmp/avatar.vrm'))).rejects.toThrow(/not available/);
  });

  it('fails closed when the Electron listener does not return an unsubscribe', async () => {
    testGlobal.__NIMI_ELECTRON_TEST__ = {
      invoke: async () => 'ok',
      listen: () => undefined,
    };
    await expect(listenShell('evt', () => {})).rejects.toThrow(/unsubscribe/);
  });

  it('uses an Electron preload runtime hook through host-neutral invoke, listen, and file src conversion', async () => {
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
    expect(hasNimiShellRuntime()).toBe(true);
    expect(hasShellHostInvoke()).toBe(true);
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
    expect(convertShellFileSrc('/tmp/avatar.vrm')).toMatch(/^nimi-shell-file:\/\/local\/\?path=/u);
    expect(convertShellFileSrc('https://example.com/a.vrm')).toBe('https://example.com/a.vrm');
  });

  it('ignores retired Tauri globals and fails closed without Electron preload', async () => {
    testGlobal.__TAURI_INTERNALS__ = { invoke: () => Promise.resolve(null) };
    testGlobal.__NIMI_TAURI_RUNTIME__ = {
      invoke: () => Promise.resolve('should-not-run'),
      listen: () => () => undefined,
    };

    expect(hasElectronRuntime()).toBe(false);
    expect(hasNimiShellRuntime()).toBe(false);
    expect(hasShellHostInvoke()).toBe(false);
    expect(installNimiShellRuntimeBridge()).toEqual({
      installed: false,
      reason: 'standard-host-preload-required',
    });
    await expect(invokeShell(NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'], {})).rejects.toThrow(/not available/);
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
    expect(parseRuntimeBridgeDaemonStatus({
      running: true,
      managed: false,
      launchMode: 'source',
      grpcAddr: 'protected-local://source-current-user-desktop',
    })).toEqual({
      running: true,
      managed: false,
      launchMode: 'SOURCE',
      grpcAddr: 'protected-local://source-current-user-desktop',
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
