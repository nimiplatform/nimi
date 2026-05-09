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
import { getRuntimeDefaults, getDaemonStatus } from '@renderer/bridge';
import { useAppStore, type AuthUser } from '@renderer/app-shell/providers/app-store.js';
import { logRendererEvent } from '@nimiplatform/nimi-kit/telemetry';

// LD-SHELL-010 / LD-SHELL-011: Lookdev admitted as local-first-party Runtime
// account / session consumer. Caller fixed; runtime owns refresh-token
// custody and short-lived access-token projection. No app-owned token surface.
// Concrete identifiers are authoritative in tables/runtime-account-caller.yaml.
export const LOOKDEV_RUNTIME_APP_ID = 'app.nimi.lookdev';
export const LOOKDEV_RUNTIME_APP_INSTANCE_ID = `${LOOKDEV_RUNTIME_APP_ID}.local-first-party`;
export const LOOKDEV_RUNTIME_DEVICE_ID = 'local-first-party-device';

export const lookdevRuntimeAccountCaller: AccountCaller = {
  appId: LOOKDEV_RUNTIME_APP_ID,
  appInstanceId: LOOKDEV_RUNTIME_APP_INSTANCE_ID,
  deviceId: LOOKDEV_RUNTIME_DEVICE_ID,
  mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
  scopes: [],
};

let bootstrapPromise: Promise<void> | null = null;
let bootstrapSettled = false;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeLookdevAccountProjection(
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

export async function loadLookdevRuntimeAccountUser(
  runtime: Runtime,
): Promise<AuthUser | null> {
  const response = await runtime.account.getAccountSessionStatus({
    caller: lookdevRuntimeAccountCaller,
  });
  if (response.state !== AccountSessionState.AUTHENTICATED) {
    return null;
  }
  return normalizeLookdevAccountProjection(response.accountProjection);
}

export async function runLookdevBootstrap(): Promise<void> {
  if (bootstrapPromise && !bootstrapSettled) {
    return bootstrapPromise;
  }
  if (bootstrapPromise && useAppStore.getState().bootstrapReady) {
    return bootstrapPromise;
  }

  bootstrapSettled = false;
  bootstrapPromise = doRunLookdevBootstrap().finally(() => {
    bootstrapSettled = true;
    if (!useAppStore.getState().bootstrapReady) {
      bootstrapPromise = null;
    }
  });

  return bootstrapPromise;
}

export async function ensureLookdevBootstrapReady(): Promise<void> {
  const store = useAppStore.getState();
  if (store.bootstrapReady) {
    return;
  }

  await runLookdevBootstrap();

  const nextStore = useAppStore.getState();
  if (!nextStore.bootstrapReady) {
    throw new Error(nextStore.bootstrapError || 'Lookdev bootstrap did not complete');
  }
}

async function buildLookdevPlatformClient(realmBaseUrl: string): Promise<PlatformClient> {
  // LD-SHELL-010 / LD-SHELL-011 / spec K-ACCSVC-008: type-level rejection of
  // any app-owned token surface. Runtime is the sole owner of access /
  // refresh-token custody.
  return createLocalFirstPartyRuntimePlatformClient({
    appId: LOOKDEV_RUNTIME_APP_ID,
    realmBaseUrl,
    runtimeTransport: {
      type: 'tauri-ipc',
      commandNamespace: 'runtime_bridge',
      eventNamespace: 'runtime_bridge',
    },
  });
}

async function doRunLookdevBootstrap(): Promise<void> {
  const store = useAppStore.getState();

  logRendererEvent({
    level: 'info',
    area: 'lookdev-bootstrap',
    message: 'phase:bootstrap:start',
  });

  try {
    // LD-SHELL-012 Step 1: Runtime defaults.
    const runtimeDefaults = await getRuntimeDefaults();
    store.setRuntimeDefaults(runtimeDefaults);

    // LD-SHELL-012 Step 2: Platform client (LD-SHELL-010 / LD-SHELL-011).
    clearPlatformClient();
    const { runtime } = await buildLookdevPlatformClient(runtimeDefaults.realm.realmBaseUrl);

    // LD-SHELL-012 Step 3: Account projection from runtime.
    // ANONYMOUS / UNAVAILABLE / RPC error MUST NOT fail bootstrap; the shell
    // opens unauthenticated and the user signs in via the broker.
    const runtimeAccountUser = await loadLookdevRuntimeAccountUser(runtime).catch((error) => {
      logRendererEvent({
        level: 'warn',
        area: 'lookdev-bootstrap.account',
        message: 'action:runtime-account-projection-unavailable',
        details: { error: describeError(error) },
      });
      return null;
    });
    if (runtimeAccountUser) {
      store.setAuthSession(runtimeAccountUser);
    } else {
      store.clearAuthSession();
    }

    // LD-SHELL-012 Step 4: Runtime SDK readiness (non-blocking).
    try {
      await runtime.ready();
    } catch (error) {
      logRendererEvent({
        level: 'warn',
        area: 'lookdev-bootstrap.runtime',
        message: 'action:runtime-ready-nonblocking-failed',
        details: { error: describeError(error) },
      });
    }

    // LD-SHELL-012 Step 4b: Daemon status (informational).
    try {
      await getDaemonStatus();
    } catch {
      // Non-blocking — daemon may not be running.
    }

    // LD-SHELL-012 Step 5: Ready.
    store.setBootstrapReady(true);
    logRendererEvent({
      level: 'info',
      area: 'lookdev-bootstrap',
      message: 'phase:bootstrap:ready',
    });
  } catch (error) {
    const message = describeError(error);
    store.setBootstrapError(message);
    logRendererEvent({
      level: 'error',
      area: 'lookdev-bootstrap',
      message: 'action:bootstrap:error',
      details: { error: message },
    });
  }
}
