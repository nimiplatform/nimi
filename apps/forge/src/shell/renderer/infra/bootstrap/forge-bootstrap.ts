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
import { registerForgeModSdkHost } from './forge-runtime-host.js';

// FG-SHELL-011 / FG-SHELL-012: Forge admitted as local-first-party Runtime
// account / session consumer. Caller fixed; runtime owns refresh-token
// custody and short-lived access-token projection. No app-owned token surface.
// Concrete identifiers are authoritative in tables/runtime-account-caller.yaml.
export const FORGE_RUNTIME_APP_ID = 'app.nimi.forge';
export const FORGE_RUNTIME_APP_INSTANCE_ID = `${FORGE_RUNTIME_APP_ID}.local-first-party`;
export const FORGE_RUNTIME_DEVICE_ID = 'local-first-party-device';

export const forgeRuntimeAccountCaller: AccountCaller = {
  appId: FORGE_RUNTIME_APP_ID,
  appInstanceId: FORGE_RUNTIME_APP_INSTANCE_ID,
  deviceId: FORGE_RUNTIME_DEVICE_ID,
  mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
  scopes: [],
};

let bootstrapPromise: Promise<void> | null = null;
let bootstrapSettled = false;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeForgeAccountProjection(
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

export async function loadForgeRuntimeAccountUser(
  runtime: Runtime,
): Promise<AuthUser | null> {
  const response = await runtime.account.getAccountSessionStatus({
    caller: forgeRuntimeAccountCaller,
  });
  if (response.state !== AccountSessionState.AUTHENTICATED) {
    return null;
  }
  return normalizeForgeAccountProjection(response.accountProjection);
}

export async function runForgeBootstrap(): Promise<void> {
  if (bootstrapPromise && !bootstrapSettled) {
    return bootstrapPromise;
  }
  if (bootstrapPromise && useAppStore.getState().bootstrapReady) {
    return bootstrapPromise;
  }

  bootstrapSettled = false;
  bootstrapPromise = doRunForgeBootstrap().finally(() => {
    bootstrapSettled = true;
    if (!useAppStore.getState().bootstrapReady) {
      bootstrapPromise = null;
    }
  });

  return bootstrapPromise;
}

export async function ensureForgeBootstrapReady(): Promise<void> {
  const store = useAppStore.getState();
  if (store.bootstrapReady) {
    return;
  }

  await runForgeBootstrap();

  const nextStore = useAppStore.getState();
  if (!nextStore.bootstrapReady) {
    throw new Error(nextStore.bootstrapError || 'Forge bootstrap did not complete');
  }
}

async function buildForgePlatformClient(realmBaseUrl: string): Promise<PlatformClient> {
  // FG-SHELL-011 / FG-SHELL-012 / spec K-ACCSVC-008: type-level rejection of
  // any app-owned token surface. Runtime is the sole owner of access /
  // refresh-token custody.
  return createLocalFirstPartyRuntimePlatformClient({
    appId: FORGE_RUNTIME_APP_ID,
    realmBaseUrl,
    runtimeTransport: {
      type: 'tauri-ipc',
      commandNamespace: 'runtime_bridge',
      eventNamespace: 'runtime_bridge',
    },
  });
}

async function doRunForgeBootstrap(): Promise<void> {
  const store = useAppStore.getState();

  logRendererEvent({
    level: 'info',
    area: 'forge-bootstrap',
    message: 'phase:bootstrap:start',
  });

  try {
    // FG-SHELL-003 Step 1: Runtime defaults (i18n is eagerly initialized at module load).
    const runtimeDefaults = await getRuntimeDefaults();
    store.setRuntimeDefaults(runtimeDefaults);

    // FG-SHELL-003 Step 2: Platform client (FG-SHELL-011 / FG-SHELL-012).
    clearPlatformClient();
    const { runtime } = await buildForgePlatformClient(runtimeDefaults.realm.realmBaseUrl);

    // FG-SHELL-003 Step 3: Runtime mod SDK host capabilities (FG-ROUTE-003).
    registerForgeModSdkHost();

    // FG-SHELL-003 Step 4 / FG-SHELL-004: Account projection from runtime.
    // ANONYMOUS / UNAVAILABLE / RPC error MUST NOT fail bootstrap; the shell
    // opens unauthenticated and the user signs in via the broker.
    const runtimeAccountUser = await loadForgeRuntimeAccountUser(runtime).catch((error) => {
      logRendererEvent({
        level: 'warn',
        area: 'forge-bootstrap.account',
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

    // FG-SHELL-003 Step 6: Runtime SDK readiness (non-blocking — creator
    // surfaces work without runtime extras and the bootstrap should not
    // block on local AI runtime availability).
    try {
      await runtime.ready();
    } catch (error) {
      logRendererEvent({
        level: 'warn',
        area: 'forge-bootstrap.runtime',
        message: 'action:runtime-ready-nonblocking-failed',
        details: { error: describeError(error) },
      });
    }

    // FG-SHELL-003 Step 7: Daemon status check (informational).
    try {
      await getDaemonStatus();
    } catch {
      // Non-blocking — daemon may not be running.
    }

    // FG-SHELL-003 Step 8: Ready.
    store.setBootstrapReady(true);
    logRendererEvent({
      level: 'info',
      area: 'forge-bootstrap',
      message: 'phase:bootstrap:ready',
    });
  } catch (error) {
    const message = describeError(error);
    store.setBootstrapError(message);
    logRendererEvent({
      level: 'error',
      area: 'forge-bootstrap',
      message: 'action:bootstrap:error',
      details: { error: message },
    });
  }
}
