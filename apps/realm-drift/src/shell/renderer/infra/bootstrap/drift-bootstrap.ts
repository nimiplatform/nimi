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
import { getRuntimeDefaults } from '@renderer/bridge';
import { useAppStore, type AuthUser } from '@renderer/app-shell/app-store.js';
import { initI18n } from '@renderer/i18n/index.js';

// RD-SHELL-009 / RD-SHELL-010: Realm Drift admitted as local-first-party
// Runtime account / session consumer. Caller fixed; runtime owns refresh-token
// custody and short-lived access-token projection. No app-owned token surface.
// Concrete identifiers are authoritative in tables/runtime-account-caller.yaml.
export const DRIFT_RUNTIME_APP_ID = 'app.nimi.realm-drift';
export const DRIFT_RUNTIME_APP_INSTANCE_ID = `${DRIFT_RUNTIME_APP_ID}.local-first-party`;
export const DRIFT_RUNTIME_DEVICE_ID = 'local-first-party-device';

export const driftRuntimeAccountCaller: AccountCaller = {
  appId: DRIFT_RUNTIME_APP_ID,
  appInstanceId: DRIFT_RUNTIME_APP_INSTANCE_ID,
  deviceId: DRIFT_RUNTIME_DEVICE_ID,
  mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
  scopes: [],
};

let bootstrapPromise: Promise<void> | null = null;
let bootstrapSettled = false;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeDriftAccountProjection(
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

export async function loadDriftRuntimeAccountUser(
  runtime: Runtime,
): Promise<AuthUser | null> {
  const response = await runtime.account.getAccountSessionStatus({
    caller: driftRuntimeAccountCaller,
  });
  if (response.state !== AccountSessionState.AUTHENTICATED) {
    return null;
  }
  return normalizeDriftAccountProjection(response.accountProjection);
}

export async function runDriftBootstrap(): Promise<void> {
  if (bootstrapPromise && !bootstrapSettled) {
    return bootstrapPromise;
  }
  if (bootstrapPromise && useAppStore.getState().bootstrapReady) {
    return bootstrapPromise;
  }

  bootstrapSettled = false;
  bootstrapPromise = doRunDriftBootstrap().finally(() => {
    bootstrapSettled = true;
    if (!useAppStore.getState().bootstrapReady) {
      bootstrapPromise = null;
    }
  });

  return bootstrapPromise;
}

export async function ensureDriftBootstrapReady(): Promise<void> {
  const store = useAppStore.getState();
  if (store.bootstrapReady) {
    return;
  }

  await runDriftBootstrap();

  const nextStore = useAppStore.getState();
  if (!nextStore.bootstrapReady) {
    throw new Error(nextStore.bootstrapError || 'Realm Drift bootstrap did not complete');
  }
}

async function buildDriftPlatformClient(realmBaseUrl: string): Promise<PlatformClient> {
  // RD-SHELL-009 / RD-SHELL-010 / spec K-ACCSVC-008: type-level rejection of
  // any app-owned token surface. Runtime is the sole owner of access /
  // refresh-token custody.
  return createLocalFirstPartyRuntimePlatformClient({
    appId: DRIFT_RUNTIME_APP_ID,
    realmBaseUrl,
    runtimeTransport: {
      type: 'tauri-ipc',
      commandNamespace: 'runtime_bridge',
      eventNamespace: 'runtime_bridge',
    },
  });
}

async function doRunDriftBootstrap(): Promise<void> {
  const store = useAppStore.getState();

  try {
    // RD-SHELL-003 Step 1: i18n
    await initI18n();

    // RD-SHELL-003 Step 2: Runtime defaults
    const runtimeDefaults = await getRuntimeDefaults();
    store.setRuntimeDefaults(runtimeDefaults);

    // RD-SHELL-003 Step 3: Platform client (RD-SHELL-009 / RD-SHELL-010).
    clearPlatformClient();
    const { runtime } = await buildDriftPlatformClient(runtimeDefaults.realm.realmBaseUrl);

    // RD-SHELL-003 Step 4 / RD-SHELL-004: Account projection from runtime.
    // ANONYMOUS / UNAVAILABLE / RPC error MUST NOT fail bootstrap; the shell
    // opens unauthenticated and the user signs in via the broker login.
    const runtimeAccountUser = await loadDriftRuntimeAccountUser(runtime).catch(() => null);
    if (runtimeAccountUser) {
      store.setAuthSession(runtimeAccountUser);
    } else {
      store.clearAuthSession();
    }

    // RD-SHELL-003 Step 5: Ready
    store.setBootstrapReady(true);
  } catch (error) {
    const message = describeError(error);
    store.setBootstrapError(message);
  }
}
