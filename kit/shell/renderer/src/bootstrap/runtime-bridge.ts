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
  return isTauri();
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
