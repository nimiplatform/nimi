import { clearPlatformClient } from '@nimiplatform/sdk';
import { logRendererEvent } from '@nimiplatform/nimi-kit/telemetry';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import {
  getRuntimeDefaults,
  getDaemonStatus,
  restartDaemon,
  startDaemon,
} from '@renderer/bridge';
import {
  createMomentLocalFirstPartyPlatformClient,
  isMissingRuntimeAccountService,
  loadMomentRuntimeAccountUser,
  staleRuntimeAccountServiceError,
} from './moment-runtime-account.js';

let bootstrapPromise: Promise<void> | null = null;
let bootstrapSettled = false;

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

export async function runMomentBootstrap(): Promise<void> {
  if (bootstrapPromise && !bootstrapSettled) {
    return bootstrapPromise;
  }
  if (bootstrapPromise && useAppStore.getState().bootstrapReady) {
    return bootstrapPromise;
  }

  bootstrapSettled = false;
  bootstrapPromise = doRunMomentBootstrap().finally(() => {
    bootstrapSettled = true;
    if (!useAppStore.getState().bootstrapReady) {
      bootstrapPromise = null;
    }
  });

  return bootstrapPromise;
}

export async function ensureMomentBootstrapReady(): Promise<void> {
  const store = useAppStore.getState();
  if (store.bootstrapReady) {
    return;
  }

  await runMomentBootstrap();

  const nextStore = useAppStore.getState();
  if (!nextStore.bootstrapReady) {
    throw new Error(nextStore.bootstrapError || 'Moment bootstrap did not complete');
  }
}

async function doRunMomentBootstrap(): Promise<void> {
  const store = useAppStore.getState();

  logRendererEvent({
    level: 'info',
    area: 'moment-bootstrap',
    message: 'phase:bootstrap:start',
  });

  try {
    const runtimeDefaults = await getRuntimeDefaults();
    store.setRuntimeDefaults(runtimeDefaults);
    await ensureRuntimeDaemonReady();

    clearPlatformClient();
    let platformClient = await createMomentLocalFirstPartyPlatformClient(runtimeDefaults);
    let runtimeAccountUser: Awaited<ReturnType<typeof loadMomentRuntimeAccountUser>>;
    try {
      runtimeAccountUser = await loadMomentRuntimeAccountUser(platformClient.runtime);
    } catch (error) {
      if (!isMissingRuntimeAccountService(error)) {
        throw error;
      }
      await restartDaemon();
      try {
        clearPlatformClient();
        platformClient = await createMomentLocalFirstPartyPlatformClient(runtimeDefaults);
        runtimeAccountUser = await loadMomentRuntimeAccountUser(platformClient.runtime);
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

    try {
      await platformClient.runtime.ready();
    } catch {
      // Runtime readiness is probed later and must stay observable.
    }

    store.setBootstrapReady(true);
    logRendererEvent({
      level: 'info',
      area: 'moment-bootstrap',
      message: 'phase:bootstrap:ready',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setBootstrapError(message);
    logRendererEvent({
      level: 'error',
      area: 'moment-bootstrap',
      message: 'action:bootstrap:error',
      details: { error: message },
    });
  }
}
