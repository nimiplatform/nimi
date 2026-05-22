type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type TauriTestHook = {
  invoke?: TauriInvoke;
};
type TauriRuntimeHook = TauriTestHook;

export type TauriRuntimeGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: TauriTestHook;
  __NIMI_TAURI_RUNTIME__?: TauriRuntimeHook;
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
  window?: TauriRuntimeGlobal;
};

export function hasTauriIpcRuntime(value: TauriRuntimeGlobal = globalThis as TauriRuntimeGlobal): boolean {
  return Boolean(
    typeof value.__NIMI_TAURI_TEST__?.invoke === 'function'
      || typeof value.window?.__NIMI_TAURI_TEST__?.invoke === 'function'
      || typeof value.__NIMI_TAURI_RUNTIME__?.invoke === 'function'
      || typeof value.window?.__NIMI_TAURI_RUNTIME__?.invoke === 'function'
      || typeof (value.__TAURI__ as { core?: { invoke?: unknown }; invoke?: unknown } | undefined)?.core?.invoke === 'function'
      || typeof (value.window?.__TAURI__ as { core?: { invoke?: unknown }; invoke?: unknown } | undefined)?.core?.invoke === 'function'
      || typeof (value.__TAURI__ as { invoke?: unknown } | undefined)?.invoke === 'function'
      || typeof (value.window?.__TAURI__ as { invoke?: unknown } | undefined)?.invoke === 'function'
      || typeof (value.__TAURI_INTERNALS__ as { invoke?: unknown } | undefined)?.invoke === 'function'
      || typeof (value.window?.__TAURI_INTERNALS__ as { invoke?: unknown } | undefined)?.invoke === 'function'
      || typeof (value.__TAURI_IPC__ as { invoke?: unknown } | undefined)?.invoke === 'function'
      || typeof (value.window?.__TAURI_IPC__ as { invoke?: unknown } | undefined)?.invoke === 'function',
  );
}
