type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type TauriCore = {
  invoke?: TauriInvoke;
};
type TauriLikeGlobal = {
  window?: {
    __TAURI__?: {
      core?: TauriCore;
    };
  };
  __TAURI__?: {
    core?: TauriCore;
  };
};

function readGlobalTauriInvoke(): TauriInvoke | null {
  const value = globalThis as TauriLikeGlobal;
  const windowCore = value.window?.__TAURI__?.core;
  const fromWindow = windowCore?.invoke;
  if (typeof fromWindow === 'function') {
    return fromWindow.bind(windowCore);
  }

  const globalCore = value.__TAURI__?.core;
  const fromGlobal = globalCore?.invoke;
  if (typeof fromGlobal === 'function') {
    return fromGlobal.bind(globalCore);
  }

  return null;
}

export function hasTauriInvoke() {
  return Boolean(readGlobalTauriInvoke());
}

export async function tauriInvoke<T>(command: string, payload: unknown = {}): Promise<T> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    throw new Error(`Tauri invoke unavailable for command: ${command}`);
  }

  return (await invoke(command, payload)) as T;
}
