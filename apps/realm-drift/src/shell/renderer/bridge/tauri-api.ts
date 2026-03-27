import { invoke as tauriCoreInvoke, type InvokeArgs } from '@tauri-apps/api/core';

type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type TauriTestHook = {
  invoke?: TauriInvoke;
};

type TauriRuntimeGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: TauriTestHook;
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
  window?: {
    __NIMI_TAURI_TEST__?: TauriTestHook;
    __TAURI_INTERNALS__?: unknown;
    __TAURI_IPC__?: unknown;
  };
};

function tauriGlobal(): TauriRuntimeGlobal {
  return globalThis as TauriRuntimeGlobal;
}

function testInvoke(): TauriInvoke | undefined {
  const value = tauriGlobal();
  return value.__NIMI_TAURI_TEST__?.invoke || value.window?.__NIMI_TAURI_TEST__?.invoke;
}

export function hasTauriRuntime(): boolean {
  const value = tauriGlobal();
  return Boolean(
    testInvoke()
      || value.__TAURI_INTERNALS__
      || value.__TAURI_IPC__
      || value.window?.__TAURI_INTERNALS__
      || value.window?.__TAURI_IPC__,
  );
}

export async function invokeTauri<T>(command: string, payload: unknown = {}): Promise<T> {
  const invoke = testInvoke();
  if (invoke) {
    return await invoke(command, payload) as T;
  }
  return await tauriCoreInvoke<T>(command, payload as InvokeArgs | undefined);
}
