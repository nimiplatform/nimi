import { invoke as tauriCoreInvoke, type InvokeArgs } from '@tauri-apps/api/core';
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

function tauriTestHook(): TauriTestHook | undefined {
  const value = tauriGlobal();
  return value.__NIMI_TAURI_TEST__ || value.window?.__NIMI_TAURI_TEST__;
}

export function hasTauriRuntime(): boolean {
  const value = tauriGlobal();
  return Boolean(
    tauriTestHook()?.invoke
      || tauriTestHook()?.listen
      || value.__TAURI_INTERNALS__
      || value.__TAURI_IPC__
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
