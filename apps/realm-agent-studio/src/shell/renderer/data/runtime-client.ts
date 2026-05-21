import type { PlatformClient } from '@nimiplatform/sdk';

type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type TauriTestHook = {
  invoke?: TauriInvoke;
};
type TauriRuntimeHook = TauriTestHook;

type TauriRuntimeGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: TauriTestHook;
  __NIMI_TAURI_RUNTIME__?: TauriRuntimeHook;
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
  window?: TauriRuntimeGlobal;
};

const DEFAULT_RUNTIME_APP_ID = 'realm-agent-studio';
const DEFAULT_REALM_BASE_URL = 'http://127.0.0.1:3000';

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

export async function createStudioRuntimeClient(): Promise<PlatformClient['runtime'] | null> {
  if (!hasTauriIpcRuntime()) {
    return null;
  }

  const { createPlatformClient } = await import('@nimiplatform/sdk');
  const client = await createPlatformClient({
    appId: import.meta.env.VITE_RUNTIME_APP_ID || DEFAULT_RUNTIME_APP_ID,
    realmBaseUrl: import.meta.env.VITE_REALM_BASE_URL || DEFAULT_REALM_BASE_URL,
    accessToken: import.meta.env.VITE_REALM_ACCESS_TOKEN || '',
    allowAnonymousRealm: true,
    runtimeTransport: {
      type: 'tauri-ipc',
      commandNamespace: 'runtime_bridge',
      eventNamespace: 'runtime_bridge',
    },
    runtimeDefaults: {
      appInstanceId: 'realm-agent-studio-renderer',
      surfaceId: 'realm-agent-studio',
    },
  });
  return client.runtime;
}
