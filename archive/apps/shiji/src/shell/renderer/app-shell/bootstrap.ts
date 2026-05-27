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
import {
  getRuntimeDefaults,
  getDaemonStatus,
  invoke,
  startDaemon,
} from '@renderer/bridge';
import { useAppStore, type AuthUser } from './app-store.js';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';

// SJ-SHELL-010 / SJ-SHELL-011: ShiJi admitted as local-first-party Runtime
// account / session consumer. Caller fixed; runtime owns refresh-token
// custody and short-lived access-token projection. No app-owned token surface.
// Concrete identifiers are authoritative in tables/runtime-account-caller.yaml.
export const SHIJI_RUNTIME_APP_ID = 'app.nimi.shiji';
export const SHIJI_RUNTIME_APP_INSTANCE_ID = `${SHIJI_RUNTIME_APP_ID}.local-first-party`;
export const SHIJI_RUNTIME_DEVICE_ID = 'local-first-party-device';

export const shijiRuntimeAccountCaller: AccountCaller = {
  appId: SHIJI_RUNTIME_APP_ID,
  appInstanceId: SHIJI_RUNTIME_APP_INSTANCE_ID,
  deviceId: SHIJI_RUNTIME_DEVICE_ID,
  mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
  scopes: [],
};

let bootstrapPromise: Promise<void> | null = null;
let bootstrapSettled = false;

const SHIJI_RUNTIME_READY_TIMEOUT_MS = 15_000;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeShiJiAccountProjection(
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

export async function loadShiJiRuntimeAccountUser(
  runtime: Runtime,
): Promise<AuthUser | null> {
  const response = await runtime.account.getAccountSessionStatus({
    caller: shijiRuntimeAccountCaller,
  });
  if (response.state !== AccountSessionState.AUTHENTICATED) {
    return null;
  }
  return normalizeShiJiAccountProjection(response.accountProjection);
}

/**
 * runShiJiBootstrap — Phase 0 bootstrap sequence (SJ-SHELL-001 /
 * SJ-SHELL-010 / SJ-SHELL-011 / SJ-SHELL-012).
 *
 * 1. Runtime defaults (Tauri bridge)
 * 2. createLocalFirstPartyRuntimePlatformClient — type-rejects token / session
 *    inputs (SJ-SHELL-011 / spec K-ACCSVC-008).
 * 3. Account projection from runtime (anonymous / unavailable / RPC error
 *    do NOT fail bootstrap)
 * 4. SQLite init (BLOCKING — fail-close on failure; SJ-SHELL-001:6)
 * 5. Runtime readiness check (BLOCKING — 15s timeout, fail-close;
 *    SJ-SHELL-001:5)
 * 6. bootstrapReady = true → routes render
 */
export async function runShiJiBootstrap(): Promise<void> {
  if (bootstrapPromise && !bootstrapSettled) {
    return bootstrapPromise;
  }
  if (bootstrapPromise && useAppStore.getState().bootstrapReady) {
    return bootstrapPromise;
  }

  bootstrapSettled = false;
  bootstrapPromise = doRunShiJiBootstrap().finally(() => {
    bootstrapSettled = true;
    if (!useAppStore.getState().bootstrapReady) {
      bootstrapPromise = null;
    }
  });

  return bootstrapPromise;
}

export async function ensureShiJiBootstrapReady(): Promise<void> {
  const store = useAppStore.getState();
  if (store.bootstrapReady) {
    return;
  }

  await runShiJiBootstrap();

  const nextStore = useAppStore.getState();
  if (!nextStore.bootstrapReady) {
    throw new Error(nextStore.bootstrapError || 'ShiJi bootstrap did not complete');
  }
}

async function buildShiJiPlatformClient(realmBaseUrl: string): Promise<PlatformClient> {
  // SJ-SHELL-010 / SJ-SHELL-011 / spec K-ACCSVC-008: type-level rejection of
  // any app-owned token surface. Runtime is the sole owner of access /
  // refresh-token custody.
  return createLocalFirstPartyRuntimePlatformClient({
    appId: SHIJI_RUNTIME_APP_ID,
    realmBaseUrl,
    runtimeTransport: {
      type: 'tauri-ipc',
      commandNamespace: 'runtime_bridge',
      eventNamespace: 'runtime_bridge',
    },
  });
}

async function doRunShiJiBootstrap(): Promise<void> {
  const store = useAppStore.getState();

  logRendererEvent({
    level: 'info',
    area: 'shiji-bootstrap',
    message: 'phase:bootstrap:start',
  });

  try {
    // SJ-SHELL-001 Step 1: Runtime defaults
    const runtimeDefaults = await getRuntimeDefaults();
    store.setRuntimeDefaults(runtimeDefaults);
    if (!store.aiModel && runtimeDefaults.runtime.localProviderModel) {
      store.setAiModel(runtimeDefaults.runtime.localProviderModel);
    }

    // SJ-SHELL-001 Step 2: Platform client (SJ-SHELL-010 / SJ-SHELL-011).
    clearPlatformClient();
    const { runtime } = await buildShiJiPlatformClient(runtimeDefaults.realm.realmBaseUrl);

    // SJ-SHELL-001 Step 3 / SJ-SHELL-002: Account projection from runtime.
    // ANONYMOUS / UNAVAILABLE / RPC error MUST NOT fail bootstrap; the shell
    // opens unauthenticated and the user signs in via the broker.
    const runtimeAccountUser = await loadShiJiRuntimeAccountUser(runtime).catch((error) => {
      logRendererEvent({
        level: 'warn',
        area: 'shiji-bootstrap.account',
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

    // SJ-SHELL-001 Step 4: SQLite init (blocking — local data is required for
    // all stable paths).
    await invoke('db_init', {});
    logRendererEvent({
      level: 'info',
      area: 'shiji-bootstrap',
      message: 'phase:sqlite:ready',
    });

    // SJ-SHELL-001 Step 5: Runtime readiness check (BLOCKING — hard cut).
    // Runtime must be available for AI generation. No cloud-only fallback.
    const daemonStatus = await getDaemonStatus();
    if (!daemonStatus.running) {
      const startedDaemon = await startDaemon();
      if (!startedDaemon.running) {
        throw new Error(startedDaemon.lastError?.trim() || 'runtime daemon failed to start');
      }
    }
    const runtimeReadyTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`runtime ready timeout (${SHIJI_RUNTIME_READY_TIMEOUT_MS / 1000}s)`)), SHIJI_RUNTIME_READY_TIMEOUT_MS),
    );
    await Promise.race([runtime.ready(), runtimeReadyTimeout]);
    logRendererEvent({
      level: 'info',
      area: 'shiji-bootstrap',
      message: 'phase:runtime:ready',
    });

    // SJ-SHELL-001 Step 6: Ready — routes render.
    store.setBootstrapReady(true);
    logRendererEvent({
      level: 'info',
      area: 'shiji-bootstrap',
      message: 'phase:bootstrap:ready',
    });
  } catch (error) {
    const message = describeError(error);
    store.setBootstrapError(message);
    logRendererEvent({
      level: 'error',
      area: 'shiji-bootstrap',
      message: 'action:bootstrap:error',
      details: { error: message },
    });
  }
}
