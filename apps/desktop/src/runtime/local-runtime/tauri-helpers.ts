type TauriInvokeSource = {
  invoke?: (command: string, payload?: unknown) => Promise<unknown>;
};

function readTauriInvokeSource(): TauriInvokeSource | null {
  const globalRecord = globalThis as Record<string, unknown>;
  const testHook = globalRecord.__NIMI_TAURI_TEST__;
  if (testHook && typeof testHook === 'object') {
    return testHook as TauriInvokeSource;
  }
  const runtimeHook = globalRecord.__NIMI_TAURI_RUNTIME__;
  if (runtimeHook && typeof runtimeHook === 'object') {
    return runtimeHook as TauriInvokeSource;
  }
  const tauriHook = globalRecord.__TAURI__;
  if (tauriHook && typeof tauriHook === 'object') {
    const core = (tauriHook as { core?: unknown }).core;
    if (core && typeof core === 'object') {
      return core as TauriInvokeSource;
    }
    return tauriHook as TauriInvokeSource;
  }
  return null;
}

export function hasTauriInvoke() {
  return typeof readTauriInvokeSource()?.invoke === 'function';
}

export async function tauriInvoke<T>(command: string, payload: unknown = {}): Promise<T> {
  const invoke = readTauriInvokeSource()?.invoke;
  if (typeof invoke !== 'function') {
    throw new Error(`Tauri invoke unavailable for command: ${command}`);
  }
  return await invoke(command, payload) as T;
}
