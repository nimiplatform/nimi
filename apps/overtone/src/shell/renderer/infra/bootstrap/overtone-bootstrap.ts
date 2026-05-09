import {
  clearPlatformClient,
  createLocalFirstPartyRuntimePlatformClient,
  type PlatformClient,
} from '@nimiplatform/sdk';
import {
  AccountCallerMode,
  AccountSessionState,
  type AccountCaller,
  type AccountProjection,
} from '@nimiplatform/sdk/runtime/browser';
import type { Runtime } from '@nimiplatform/sdk/runtime';
import { useAppStore, type AuthUser } from '@renderer/app-shell/providers/app-store.js';

// Overtone admitted as local-first-party Runtime account / session consumer.
// Caller fixed; runtime owns refresh-token custody and short-lived access-
// token projection. No app-owned token surface. Concrete identifiers are
// authoritative in apps/overtone/spec/tables/runtime-account-caller.yaml.
// See spec/architecture.md §"Auth & Runtime Account".
export const OVERTONE_RUNTIME_APP_ID = 'app.nimi.overtone';
export const OVERTONE_RUNTIME_APP_INSTANCE_ID = `${OVERTONE_RUNTIME_APP_ID}.local-first-party`;
export const OVERTONE_RUNTIME_DEVICE_ID = 'local-first-party-device';

export const overtoneRuntimeAccountCaller: AccountCaller = {
  appId: OVERTONE_RUNTIME_APP_ID,
  appInstanceId: OVERTONE_RUNTIME_APP_INSTANCE_ID,
  deviceId: OVERTONE_RUNTIME_DEVICE_ID,
  mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
  scopes: [],
};

let bootstrapPromise: Promise<void> | null = null;
let bootstrapSettled = false;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getOvertoneRealmBaseUrl(): string {
  const baseUrl = String(
    import.meta.env.VITE_NIMI_REALM_BASE_URL
    || import.meta.env.NIMI_REALM_URL
    || '',
  ).trim();
  if (!baseUrl) {
    throw new Error('Missing VITE_NIMI_REALM_BASE_URL (or NIMI_REALM_URL) configuration');
  }
  return baseUrl;
}

export function normalizeOvertoneAccountProjection(
  projection: AccountProjection | null | undefined,
): AuthUser | null {
  const accountId = String(projection?.accountId || '').trim();
  if (!accountId) {
    return null;
  }
  return {
    id: accountId,
    displayName: String(projection?.displayName || '').trim(),
  };
}

export async function loadOvertoneRuntimeAccountUser(
  runtime: Runtime,
): Promise<AuthUser | null> {
  const response = await runtime.account.getAccountSessionStatus({
    caller: overtoneRuntimeAccountCaller,
  });
  if (response.state !== AccountSessionState.AUTHENTICATED) {
    return null;
  }
  return normalizeOvertoneAccountProjection(response.accountProjection);
}

export async function runOvertoneBootstrap(): Promise<void> {
  if (bootstrapPromise && !bootstrapSettled) {
    return bootstrapPromise;
  }
  bootstrapSettled = false;
  bootstrapPromise = doRunOvertoneBootstrap().finally(() => {
    bootstrapSettled = true;
  });
  return bootstrapPromise;
}

export async function ensureOvertoneBootstrapReady(): Promise<void> {
  if (useAppStore.getState().authStatus !== 'bootstrapping') {
    return;
  }
  await runOvertoneBootstrap();
}

async function buildOvertonePlatformClient(realmBaseUrl: string): Promise<PlatformClient> {
  // Type-level rejection of any app-owned token surface. Runtime is the sole
  // owner of access / refresh-token custody (spec K-ACCSVC-008).
  return createLocalFirstPartyRuntimePlatformClient({
    appId: OVERTONE_RUNTIME_APP_ID,
    realmBaseUrl,
    runtimeTransport: {
      type: 'tauri-ipc',
      commandNamespace: 'runtime_bridge',
      eventNamespace: 'runtime_bridge',
    },
  });
}

async function doRunOvertoneBootstrap(): Promise<void> {
  const store = useAppStore.getState();

  let realmBaseUrl: string;
  try {
    realmBaseUrl = getOvertoneRealmBaseUrl();
  } catch (error) {
    // Without a configured realm base URL we cannot construct the platform
    // client. Open unauthenticated; surface the misconfiguration via the
    // realm-connection flag so the studio layout can show a degraded UI.
    store.clearAuthSession();
    store.setRealmConnection(false, false);
    void describeError(error);
    return;
  }

  store.setRealmConnection(true, false);

  // Anonymous / unavailable / RPC error MUST NOT fail bootstrap; the shell
  // opens unauthenticated and the user signs in via the broker login.
  let runtimeAccountUser: AuthUser | null = null;
  try {
    clearPlatformClient();
    const { runtime } = await buildOvertonePlatformClient(realmBaseUrl);
    runtimeAccountUser = await loadOvertoneRuntimeAccountUser(runtime).catch(() => null);
  } catch {
    runtimeAccountUser = null;
  }

  if (runtimeAccountUser) {
    store.setAuthSession(runtimeAccountUser);
    store.setRealmConnection(true, true);
  } else {
    store.clearAuthSession();
    store.setRealmConnection(true, false);
  }
}
