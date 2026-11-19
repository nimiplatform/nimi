import {
  hasElectronRuntime,
  type NimiShellRuntimeBridgeResult,
  type NimiShellRuntimeHook,
  type TauriRuntimeGlobal,
} from '../bridge/tauri-api.js';

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
  const value = globalThis as TauriRuntimeGlobal;
  const testHook = createNimiShellTestRuntimeHook(value);
  if (testHook) {
    value.__NIMI_TAURI_RUNTIME__ = testHook;
    if (value.window && typeof value.window === 'object') {
      value.window.__NIMI_TAURI_RUNTIME__ = testHook;
    }
    return { installed: true, host: 'tauri' };
  }
  return { installed: false, reason: 'standard-host-preload-required' };
}
