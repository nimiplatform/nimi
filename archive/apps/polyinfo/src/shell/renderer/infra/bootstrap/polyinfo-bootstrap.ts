import {
  getDaemonStatus,
  getRuntimeDefaults,
  restartDaemon,
  startDaemon,
  type RuntimeDefaults,
} from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import type { PlatformClient } from '@nimiplatform/sdk';
import { clearPlatformClient } from '@nimiplatform/sdk';
import { loadPersistedAIConfig } from '@renderer/data/runtime-routes.js';
import {
  createPolyinfoLocalFirstPartyPlatformClient,
  isMissingRuntimeAccountService,
  loadPolyinfoRuntimeAccountUser,
  staleRuntimeAccountServiceError,
} from './polyinfo-runtime-account.js';

async function ensureRuntimeDaemonReady(): Promise<void> {
  const status = await getDaemonStatus();
  if (status.running) {
    return;
  }
  const started = await startDaemon();
  if (!started.running) {
    throw new Error(started.lastError?.trim() || 'runtime daemon failed to start');
  }
}

async function createRuntimeClientAndLoadAccount(
  runtimeDefaults: RuntimeDefaults,
): Promise<{
  platformClient: PlatformClient;
  runtimeAccountUser: Awaited<ReturnType<typeof loadPolyinfoRuntimeAccountUser>>;
}> {
  clearPlatformClient();
  const platformClient = await createPolyinfoLocalFirstPartyPlatformClient(runtimeDefaults);
  const runtimeAccountUser = await loadPolyinfoRuntimeAccountUser(platformClient.runtime);
  return {
    platformClient,
    runtimeAccountUser,
  };
}

export async function runPolyinfoBootstrap(): Promise<void> {
  const store = useAppStore.getState();
  try {
    store.setAuthBootstrapping();
    const runtimeDefaults = await getRuntimeDefaults();
    store.setRuntimeDefaults(runtimeDefaults);

    await ensureRuntimeDaemonReady();
    let runtimeAccountUser: Awaited<ReturnType<typeof loadPolyinfoRuntimeAccountUser>>;
    try {
      ({ runtimeAccountUser } = await createRuntimeClientAndLoadAccount(runtimeDefaults));
    } catch (error) {
      if (!isMissingRuntimeAccountService(error)) {
        throw error;
      }
      await restartDaemon();
      try {
        ({ runtimeAccountUser } = await createRuntimeClientAndLoadAccount(runtimeDefaults));
      } catch (retryError) {
        if (isMissingRuntimeAccountService(retryError)) {
          throw staleRuntimeAccountServiceError();
        }
        throw retryError;
      }
    }
    if (runtimeAccountUser) {
      store.setAuthSession(runtimeAccountUser, '', '');
    } else {
      store.clearAuthSession();
    }

    store.setAIConfig(loadPersistedAIConfig(runtimeDefaults));
    store.setBootstrapReady(true);
    store.setBootstrapError(null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setBootstrapError(message);
  }
}
