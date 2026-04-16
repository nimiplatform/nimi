import { convertFileSrc as tauriConvertFileSrc, invoke as tauriCoreInvoke, type InvokeArgs } from '@tauri-apps/api/core';
import { listen as tauriEventListen } from '@tauri-apps/api/event';

export type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;
export type TauriEventUnsubscribe = () => void;
export type TauriEventListen = (
  eventName: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<TauriEventUnsubscribe | undefined> | TauriEventUnsubscribe | undefined;

type TauriTestHook = {
  invoke?: TauriInvoke;
  listen?: TauriEventListen;
};
type TauriRuntimeHook = TauriTestHook;

type TauriRuntimeGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: TauriTestHook;
  __NIMI_TAURI_RUNTIME__?: TauriRuntimeHook;
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
  window?: {
    __NIMI_TAURI_TEST__?: TauriTestHook;
    __NIMI_TAURI_RUNTIME__?: TauriRuntimeHook;
    __TAURI_INTERNALS__?: unknown;
    __TAURI_IPC__?: unknown;
  };
};

function tauriGlobal(): TauriRuntimeGlobal {
  return globalThis as TauriRuntimeGlobal;
}

function tauriTestHook(): TauriTestHook | undefined {
  const value = tauriGlobal();
  return value.__NIMI_TAURI_TEST__ || value.window?.__NIMI_TAURI_TEST__;
}

function createSdkTauriRuntimeHook(): TauriRuntimeHook {
  return {
    invoke: async (command, payload) => {
      const hook = tauriTestHook()?.invoke;
      if (hook) {
        return await hook(command, payload);
      }
      return await tauriCoreInvoke(command, payload as InvokeArgs | undefined);
    },
    listen: async (eventName, handler) => {
      const hook = tauriTestHook()?.listen;
      if (hook) {
        const unsubscribe = await Promise.resolve(hook(eventName, handler));
        return typeof unsubscribe === 'function' ? unsubscribe : () => {};
      }
      return await tauriEventListen(eventName, handler);
    },
  };
}

export function installSdkTauriRuntimeHook(): void {
  const value = tauriGlobal();
  const hook = createSdkTauriRuntimeHook();
  value.__NIMI_TAURI_RUNTIME__ = hook;
  if (value.window && typeof value.window === 'object') {
    value.window.__NIMI_TAURI_RUNTIME__ = hook;
  }
}

export function hasTauriRuntime(): boolean {
  const value = tauriGlobal();
  return Boolean(
    tauriTestHook()?.invoke
      || tauriTestHook()?.listen
      || value.__NIMI_TAURI_RUNTIME__
      || value.__TAURI_INTERNALS__
      || value.__TAURI_IPC__
      || value.window?.__NIMI_TAURI_RUNTIME__
      || value.window?.__TAURI_INTERNALS__
      || value.window?.__TAURI_IPC__,
  );
}

export function hasTauriInvoke(): boolean {
  return hasTauriRuntime();
}

export async function invokeTauri<T>(command: string, payload: unknown = {}): Promise<T> {
  const hook = tauriTestHook()?.invoke;
  if (hook) {
    return await hook(command, payload) as T;
  }
  return await tauriCoreInvoke<T>(command, payload as InvokeArgs | undefined);
}

export async function listenTauri(
  eventName: string,
  handler: (event: { payload: unknown }) => void,
): Promise<TauriEventUnsubscribe> {
  const hook = tauriTestHook()?.listen;
  if (hook) {
    const unsubscribe = await Promise.resolve(hook(eventName, handler));
    return typeof unsubscribe === 'function' ? unsubscribe : () => {};
  }
  return await tauriEventListen(eventName, handler);
}

export function convertTauriFileSrc(fileUrl: string): string {
  const value = tauriGlobal();
  if (typeof value.window === 'undefined' || !value.window?.__TAURI_INTERNALS__) {
    return fileUrl;
  }
  return tauriConvertFileSrc(fileUrl);
}
