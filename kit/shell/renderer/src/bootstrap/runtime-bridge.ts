// The sole renderer-side raw Tauri adapter seam: it installs the standard Nimi shell runtime hook before bridge consumers run.
// App renderer code must consume shell/renderer and shell/capabilities instead of importing raw Tauri APIs.
import { convertFileSrc as tauriConvertFileSrc, invoke as tauriCoreInvoke, isTauri, type InvokeArgs } from '@tauri-apps/api/core';
import { listen as tauriEventListen } from '@tauri-apps/api/event';
import {
  hasElectronRuntime,
  resolveTauriStandardCommand,
  type NimiShellRuntimeBridgeResult,
  type NimiShellRuntimeHook,
  type ShellEventUnsubscribe,
  type TauriRuntimeGlobal,
} from '../bridge/tauri-api.js';

function shellGlobal(): TauriRuntimeGlobal {
  return globalThis as TauriRuntimeGlobal;
}

function hasNativeTauriRuntime(): boolean {
  const value = shellGlobal();
  const windowRecord = value.window && typeof value.window === 'object'
    ? value.window as unknown as Record<string, unknown>
    : undefined;
  const globalRecord = value as Record<string, unknown>;
  return (
    isTauri()
    || hasNativeTauriInvoke(windowRecord?.__TAURI_INTERNALS__)
    || hasNativeTauriInvoke(globalRecord.__TAURI_INTERNALS__)
  );
}

function hasNativeTauriInvoke(candidate: unknown): boolean {
  return Boolean(
    candidate
    && typeof candidate === 'object'
    && typeof (candidate as { invoke?: unknown }).invoke === 'function',
  );
}

function createNimiShellRuntimeHook(): NimiShellRuntimeHook {
  return {
    invoke: async (command, payload) => (
      await tauriCoreInvoke(resolveTauriStandardCommand(command), payload as InvokeArgs | undefined)
    ),
    listen: async (eventName, handler): Promise<ShellEventUnsubscribe> => {
      const unsubscribe = await tauriEventListen(eventName, (event) => handler(event));
      return unsubscribe;
    },
    convertFileSrc: (fileUrl) => tauriConvertFileSrc(fileUrl),
  };
}

function createNimiShellTestRuntimeHook(value: TauriRuntimeGlobal): NimiShellRuntimeHook | undefined {
  const hook = value.__NIMI_TAURI_TEST__ || value.window?.__NIMI_TAURI_TEST__;
  if (!hook?.invoke || !hook.listen) {
    return undefined;
  }
  return {
    invoke: hook.invoke,
    listen: async (eventName, handler) => {
      const unsubscribe = await Promise.resolve(hook.listen?.(eventName, handler));
      if (typeof unsubscribe !== 'function') {
        throw new Error(`Tauri event listener for "${eventName}" did not return an unsubscribe function`);
      }
      return unsubscribe;
    },
    convertFileSrc: hook.convertFileSrc,
  };
}

export function installNimiShellRuntimeBridge(): NimiShellRuntimeBridgeResult {
  if (hasElectronRuntime()) {
    return { installed: true, host: 'electron', reason: 'electron-preload-present' };
  }
  const value = shellGlobal();
  const testHook = createNimiShellTestRuntimeHook(value);
  if (testHook) {
    value.__NIMI_TAURI_RUNTIME__ = testHook;
    if (value.window && typeof value.window === 'object') {
      value.window.__NIMI_TAURI_RUNTIME__ = testHook;
    }
    return { installed: true, host: 'tauri' };
  }
  if (!hasNativeTauriRuntime()) {
    return { installed: false, reason: 'standard-host-preload-required' };
  }
  const hook = createNimiShellRuntimeHook();
  value.__NIMI_TAURI_RUNTIME__ = hook;
  if (value.window && typeof value.window === 'object') {
    value.window.__NIMI_TAURI_RUNTIME__ = hook;
  }
  return { installed: true, host: 'tauri' };
}
