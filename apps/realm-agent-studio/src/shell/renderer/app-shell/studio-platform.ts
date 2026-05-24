import {
  clearPlatformClient,
  createLocalFirstPartyRuntimePlatformClient,
  getPlatformClient,
  type PlatformClient,
} from '@nimiplatform/sdk';
import { getRuntimeDefaults } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  AccountCallerMode,
  AccountSessionState,
  type AccountCaller,
  type AccountProjection,
} from '@nimiplatform/sdk/runtime/browser';
import { hasTauriIpcRuntime } from './tauri-runtime.js';

export const STUDIO_RUNTIME_APP_ID = 'app.nimi.realm-agent-studio';
export const STUDIO_RUNTIME_APP_INSTANCE_ID = `${STUDIO_RUNTIME_APP_ID}.local-first-party`;
export const STUDIO_RUNTIME_DEVICE_ID = 'local-first-party-device';
export const DEFAULT_REALM_BASE_URL = 'http://localhost:3002';

export const studioRuntimeAccountCaller: AccountCaller = {
  appId: STUDIO_RUNTIME_APP_ID,
  appInstanceId: STUDIO_RUNTIME_APP_INSTANCE_ID,
  deviceId: STUDIO_RUNTIME_DEVICE_ID,
  mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
  scopes: [],
};

export type StudioAuthUser = {
  id: string;
  displayName: string;
};

export type StudioBootstrapResult =
  | {
    ok: true;
    client: PlatformClient;
    user: StudioAuthUser | null;
    realmBaseUrl: string;
  }
  | {
    ok: false;
    error: string;
    realmBaseUrl: string;
  };

function readRuntimeEnv(name: string): string {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  return String(value || '').trim();
}

export function resolveStudioRealmBaseUrl(): string {
  return readRuntimeEnv('VITE_NIMI_REALM_BASE_URL')
    || readRuntimeEnv('VITE_REALM_BASE_URL')
    || readRuntimeEnv('NIMI_REALM_URL')
    || DEFAULT_REALM_BASE_URL;
}

export function normalizeStudioAccountProjection(projection: AccountProjection | null | undefined): StudioAuthUser | null {
  const accountId = String(projection?.accountId || '').trim();
  if (!accountId) {
    return null;
  }
  return {
    id: accountId,
    displayName: String(projection?.displayName || accountId).trim(),
  };
}

export async function loadStudioRuntimeAccountUser(client: PlatformClient): Promise<StudioAuthUser | null> {
  const response = await client.runtime.account.getAccountSessionStatus({
    caller: studioRuntimeAccountCaller,
  });
  if (response.state !== AccountSessionState.AUTHENTICATED) {
    return null;
  }
  return normalizeStudioAccountProjection(response.accountProjection);
}

export async function runStudioBootstrap(): Promise<StudioBootstrapResult> {
  let realmBaseUrl = resolveStudioRealmBaseUrl();
  if (!hasTauriIpcRuntime()) {
    clearPlatformClient();
    return {
      ok: false,
      realmBaseUrl,
      error: 'Desktop Runtime connection is unavailable. Launch Realm Agent Studio from the Nimi desktop shell and make sure the Runtime account session is active.',
    };
  }

  try {
    const runtimeDefaults = await getRuntimeDefaults();
    realmBaseUrl = runtimeDefaults.realm.realmBaseUrl || realmBaseUrl;
    clearPlatformClient();
    const client = await createLocalFirstPartyRuntimePlatformClient({
      appId: STUDIO_RUNTIME_APP_ID,
      realmBaseUrl,
      runtimeTransport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
      runtimeDefaults: {
        appInstanceId: STUDIO_RUNTIME_APP_INSTANCE_ID,
        callerId: STUDIO_RUNTIME_APP_ID,
        surfaceId: 'realm-agent-studio',
      },
    });
    const user = await loadStudioRuntimeAccountUser(client).catch(() => null);
    return { ok: true, client, user, realmBaseUrl };
  } catch (error) {
    clearPlatformClient();
    return {
      ok: false,
      realmBaseUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getStudioPlatformClient(): PlatformClient {
  return getPlatformClient();
}
