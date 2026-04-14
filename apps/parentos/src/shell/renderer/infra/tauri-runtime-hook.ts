import { invoke as tauriCoreInvoke, type InvokeArgs } from '@tauri-apps/api/core';
import { listen as tauriEventListen } from '@tauri-apps/api/event';

type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type TauriEventUnsubscribe = () => void;
type TauriEventListen = (
  eventName: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<TauriEventUnsubscribe | undefined> | TauriEventUnsubscribe | undefined;

type TauriRuntimeHook = {
  invoke?: TauriInvoke;
  listen?: TauriEventListen;
};

type ParentosTauriRuntimeGlobal = typeof globalThis & {
  __NIMI_TAURI_RUNTIME__?: TauriRuntimeHook;
  window?: {
    __NIMI_TAURI_RUNTIME__?: TauriRuntimeHook;
  };
};

function tauriGlobal(): ParentosTauriRuntimeGlobal {
  return globalThis as ParentosTauriRuntimeGlobal;
}

function createParentosTauriRuntimeHook(): TauriRuntimeHook {
  return {
    invoke: async (command, payload) => tauriCoreInvoke(command, payload as InvokeArgs | undefined),
    listen: async (eventName, handler) => await tauriEventListen(eventName, handler),
  };
}

export function installParentosTauriRuntimeHook(): void {
  const value = tauriGlobal();
  const hook = createParentosTauriRuntimeHook();
  value.__NIMI_TAURI_RUNTIME__ = hook;
  if (value.window && typeof value.window === 'object') {
    value.window.__NIMI_TAURI_RUNTIME__ = hook;
  }
}
