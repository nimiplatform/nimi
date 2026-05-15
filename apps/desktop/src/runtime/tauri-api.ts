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
  __TAURI__?: {
    core?: { invoke?: unknown };
    event?: { listen?: unknown };
    invoke?: unknown;
  };
  __TAURI_INTERNALS__?: { invoke?: unknown; listen?: unknown; transformCallback?: unknown };
  __TAURI_IPC__?: { invoke?: unknown; listen?: unknown };
  window?: {
    __NIMI_TAURI_TEST__?: TauriTestHook;
    __NIMI_TAURI_RUNTIME__?: TauriRuntimeHook;
    __TAURI__?: {
      core?: { invoke?: unknown };
      event?: { listen?: unknown };
      invoke?: unknown;
    };
    __TAURI_INTERNALS__?: { invoke?: unknown; listen?: unknown; transformCallback?: unknown };
    __TAURI_IPC__?: { invoke?: unknown; listen?: unknown };
  };
};

function tauriGlobal(): TauriRuntimeGlobal {
  return globalThis as TauriRuntimeGlobal;
}

function tauriTestHook(): TauriTestHook | undefined {
  const value = tauriGlobal();
  return value.__NIMI_TAURI_TEST__ || value.window?.__NIMI_TAURI_TEST__;
}

function tauriRuntimeHook(): TauriRuntimeHook | undefined {
  const value = tauriGlobal();
  return value.__NIMI_TAURI_RUNTIME__ || value.window?.__NIMI_TAURI_RUNTIME__;
}

function hasNativeTauriInvoke(): boolean {
  const value = tauriGlobal();
  return Boolean(
    typeof value.window?.__TAURI__?.core?.invoke === 'function'
      || typeof value.__TAURI__?.core?.invoke === 'function'
      || typeof value.window?.__TAURI__?.invoke === 'function'
      || typeof value.__TAURI__?.invoke === 'function'
      || typeof value.window?.__TAURI_INTERNALS__?.invoke === 'function'
      || typeof value.__TAURI_INTERNALS__?.invoke === 'function'
      || typeof value.window?.__TAURI_IPC__?.invoke === 'function'
      || typeof value.__TAURI_IPC__?.invoke === 'function',
  );
}

function hasNativeTauriListen(): boolean {
  const value = tauriGlobal();
  return Boolean(
    typeof value.window?.__TAURI__?.event?.listen === 'function'
      || typeof value.__TAURI__?.event?.listen === 'function'
      || typeof value.window?.__TAURI_INTERNALS__?.listen === 'function'
      || typeof value.__TAURI_INTERNALS__?.listen === 'function'
      || typeof value.window?.__TAURI_INTERNALS__?.transformCallback === 'function'
      || typeof value.__TAURI_INTERNALS__?.transformCallback === 'function'
      || typeof value.window?.__TAURI_IPC__?.listen === 'function'
      || typeof value.__TAURI_IPC__?.listen === 'function',
  );
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
        if (typeof unsubscribe !== 'function') {
          throw new Error(`Tauri event listener for ${eventName} did not return unsubscribe`);
        }
        return unsubscribe;
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
  return Boolean(
    tauriTestHook()?.invoke
      || tauriTestHook()?.listen
      || hasNativeTauriInvoke()
      || hasNativeTauriListen(),
  );
}

export function hasTauriInvoke(): boolean {
  return Boolean(tauriTestHook()?.invoke || hasNativeTauriInvoke());
}

export async function invokeTauri<T>(command: string, payload: unknown = {}): Promise<T> {
  const hook = tauriTestHook()?.invoke ?? tauriRuntimeHook()?.invoke;
  if (hook) {
    return await hook(command, payload) as T;
  }
  return await tauriCoreInvoke<T>(command, payload as InvokeArgs | undefined);
}

export async function listenTauri(
  eventName: string,
  handler: (event: { payload: unknown }) => void,
): Promise<TauriEventUnsubscribe> {
  const hook = tauriTestHook()?.listen ?? tauriRuntimeHook()?.listen;
  if (hook) {
    const unsubscribe = await Promise.resolve(hook(eventName, handler));
    if (typeof unsubscribe !== 'function') {
      throw new Error(`Tauri event listener for ${eventName} did not return unsubscribe`);
    }
    return unsubscribe;
  }
  return await tauriEventListen(eventName, handler);
}

export function convertTauriFileSrc(fileUrl: string): string {
  if (!hasNativeTauriInvoke()) {
    return fileUrl;
  }
  return tauriConvertFileSrc(fileUrl);
}
