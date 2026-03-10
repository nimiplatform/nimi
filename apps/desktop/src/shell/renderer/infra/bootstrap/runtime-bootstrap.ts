import { dataSync } from '@runtime/data-sync';
import {
  checkLocalLlmHealth,
  executeLocalKernelTurn,
} from '@runtime/llm-adapter';
import { withOpenApiContextLock } from '@runtime/context/openapi-context';
import {
  getRuntimeHookRuntime,
  listRegisteredRuntimeModIds,
  setRuntimeModSdkContextProvider,
  setRuntimeHttpContextProvider,
  type RuntimeModRegisterFailure,
} from '@runtime/mod';
import { setRuntimeLogger } from '@runtime/telemetry/logger';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { desktopBridge, toRendererLogMessage } from '@renderer/bridge';
import { createProxyFetch } from '@renderer/infra/bridge/proxy-fetch';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { initializePlatformClient } from '@runtime/platform-client';
import { getOfflineCoordinator } from '@runtime/offline';
import { wireModSdkHost } from './runtime-bootstrap-host';
import { bootstrapAuthSession } from './runtime-bootstrap-auth';
import {
  ensureCoreWorldDataCapabilitiesRegistered,
  isCoreWorldDataCapability,
} from './runtime-bootstrap-data-capabilities';
import { registerBootstrapRuntimeMods } from './runtime-bootstrap-runtime-mods';
import {
  safeErrorMessage,
} from './runtime-bootstrap-utils';
import {
  buildRuntimeHostCapabilities,
} from './runtime-bootstrap-host-capabilities';
import { syncRuntimeJwtConfig } from './runtime-bootstrap-jwt-sync';
import { reconcileLocalAiRuntimeBootstrapState } from './runtime-bootstrap-local-ai';
import { attachOfflineCoordinatorBindings } from './runtime-bootstrap-offline';
import {
  startExternalAgentActionBridge,
  resyncExternalAgentActionDescriptors,
} from '@runtime/external-agent';
import { registerExternalAgentTier1Actions } from '@runtime/external-agent/tier1-actions';
import { startAuthStateWatcher } from './auth-state-watcher';
import { checkDaemonVersion } from './version-check';
import { registerExitHandler } from './exit-handler';

let bootstrapPromise: Promise<void> | null = null;
let offlineCoordinatorBindingsReady = false;
const MOD_STATE_CAPABILITY = 'data.store.mod-state';
const MOD_STATE_STORAGE_PREFIX = 'nimi:mod-state:';
const MOD_STATE_MAX_KEY_LENGTH = 256;
const MOD_STATE_MAX_VALUE_LENGTH = 512 * 1024;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeModStateKey(value: unknown): string {
  const key = String(value || '').trim();
  if (!key || key.length > MOD_STATE_MAX_KEY_LENGTH) {
    return '';
  }
  return key;
}

function scopedModStateStorageKey(key: string): string {
  return `${MOD_STATE_STORAGE_PREFIX}${key}`;
}

function registerModStateDataCapability(): void {
  const hookRuntime = getRuntimeHookRuntime();
  hookRuntime.registerDataCapability(MOD_STATE_CAPABILITY, async (query) => {
    const input = asRecord(query);
    const op = String(input.op || '').trim().toLowerCase();
    const key = normalizeModStateKey(input.key);
    if (!key) {
      return { ok: false, reasonCode: ReasonCode.MOD_STATE_INVALID_KEY };
    }
    if (typeof globalThis === 'undefined' || !globalThis.localStorage) {
      return { ok: false, reasonCode: ReasonCode.MOD_STATE_UNAVAILABLE };
    }

    const storageKey = scopedModStateStorageKey(key);
    try {
      if (op === 'get') {
        const value = globalThis.localStorage.getItem(storageKey);
        return { ok: true, value };
      }
      if (op === 'set') {
        const value = String(input.value || '');
        if (value.length > MOD_STATE_MAX_VALUE_LENGTH) {
          return { ok: false, reasonCode: ReasonCode.MOD_STATE_VALUE_TOO_LARGE };
        }
        globalThis.localStorage.setItem(storageKey, value);
        return { ok: true };
      }
      if (op === 'delete') {
        globalThis.localStorage.removeItem(storageKey);
        return { ok: true };
      }
      return { ok: false, reasonCode: ReasonCode.MOD_STATE_INVALID_OP };
    } catch {
      return { ok: false, reasonCode: ReasonCode.MOD_STATE_STORAGE_ERROR };
    }
  });
}

function suspendRuntimeCallbacksForL2(): void {
  const hookRuntime = getRuntimeHookRuntime();
  for (const modId of listRegisteredRuntimeModIds()) {
    try {
      hookRuntime.suspendMod(modId);
    } catch {
      // Ignore suspend failures; reconnect bootstrap will rebuild runtime state.
    }
  }
}

function bindOfflineCoordinator(): void {
  if (offlineCoordinatorBindingsReady) {
    return;
  }
  offlineCoordinatorBindingsReady = true;
  const coordinator = getOfflineCoordinator();
  attachOfflineCoordinatorBindings({
    coordinator,
    setOfflineTier: (tier) => useAppStore.getState().setOfflineTier(tier),
    suspendRuntimeCallbacksForL2,
    probeRealmReachability: async () => {
      const authStatus = useAppStore.getState().auth.status;
      if (authStatus !== 'authenticated') {
        return false;
      }
      await dataSync.loadCurrentUser();
      return true;
    },
    probeRuntimeReachability: async () => {
      const daemonStatus = await desktopBridge.getRuntimeBridgeStatus();
      return checkDaemonVersion(daemonStatus.version).ok;
    },
    hasPendingRealmRecoveryWork: async () => dataSync.hasPendingOfflineRecoveryWork(),
    flushChatOutbox: async () => dataSync.flushChatOutbox(),
    flushSocialOutbox: async () => dataSync.flushSocialOutbox(),
    invalidateQueries: async () => queryClient.invalidateQueries(),
    rebootstrapRuntime: async () => {
      await rebootstrapRuntime();
    },
  });
}

export function rebootstrapRuntime(): Promise<void> {
  bootstrapPromise = null;
  return bootstrapRuntime();
}

export function bootstrapRuntime(): Promise<void> {
  bindOfflineCoordinator();
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    const flowId = createRendererFlowId('renderer-bootstrap');
    const startedAt = performance.now();
    const flags = getShellFeatureFlags();
    const appStore = useAppStore.getState();
    appStore.setAuthBootstrapping();
    appStore.setBootstrapReady(false);

    setRuntimeLogger((payload) => {
      desktopBridge.logRendererEvent({
        level: payload.level,
        area: payload.area,
        message: toRendererLogMessage(payload.message),
        traceId: payload.traceId,
        flowId: payload.flowId,
        source: payload.source,
        costMs: payload.costMs,
        details: payload.details,
      });
    });

    logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:runtime-defaults:start',
      flowId,
    });

    const defaults = await desktopBridge.getRuntimeDefaults();
    let daemonStatus = await desktopBridge.getRuntimeBridgeStatus();
    if (desktopBridge.hasTauriInvoke()) {
      daemonStatus = await syncRuntimeJwtConfig({
        daemonStatus,
        realmDefaults: defaults.realm,
        bridge: {
          getRuntimeBridgeConfig: () => desktopBridge.getRuntimeBridgeConfig(),
          setRuntimeBridgeConfig: (configJson: string) => desktopBridge.setRuntimeBridgeConfig(configJson),
          restartRuntimeBridge: () => desktopBridge.restartRuntimeBridge(),
        },
      });
    }
    const versionResult = checkDaemonVersion(daemonStatus.version);
    if (!versionResult.ok) {
      throw new Error(versionResult.message);
    }
    registerExitHandler({ managed: daemonStatus.managed });

    const resolveCurrentAccessToken = () => {
      const store = useAppStore.getState();
      const authToken = String(store.auth.token || '').trim();
      if (authToken) {
        return authToken;
      }

      // During initial auth bootstrapping we may still rely on env-provided token defaults.
      if (store.auth.status === 'bootstrapping') {
        const runtimeDefaultsAccessToken = String(store.runtimeDefaults?.realm?.accessToken || '').trim();
        return runtimeDefaultsAccessToken || defaults.realm.accessToken;
      }
      return '';
    };

    const resolveCurrentSubjectUserId = () => {
      const store = useAppStore.getState();
      const authUser = store.auth.user;
      if (!authUser || typeof authUser !== 'object' || Array.isArray(authUser)) {
        return '';
      }
      const user = authUser as Record<string, unknown>;
      const id = String(user.id || '').trim();
      if (id) {
        return id;
      }
      const userId = String(user.userId || '').trim();
      if (userId) {
        return userId;
      }
      return String(user.accountId || '').trim();
    };

    await initializePlatformClient({
      realmBaseUrl: defaults.realm.realmBaseUrl,
      accessToken: defaults.realm.accessToken,
      accessTokenProvider: resolveCurrentAccessToken,
      subjectUserIdProvider: resolveCurrentSubjectUserId,
    });
    await reconcileLocalAiRuntimeBootstrapState({ flowId });
    const proxyFetch = createProxyFetch();
    useAppStore.getState().setRuntimeDefaults(defaults);

    dataSync.initApi({
      realmBaseUrl: defaults.realm.realmBaseUrl,
      accessToken: defaults.realm.accessToken,
      fetchImpl: proxyFetch,
    });

    dataSync.setAuthCallbacks({
      setAuth: (user, token, refreshToken) => {
        useAppStore.getState().setAuthSession(user, token, refreshToken);
      },
      clearAuth: () => {
        useAppStore.getState().clearAuthSession();
      },
      getCurrentUser: () => {
        return useAppStore.getState().auth.user;
      },
      isFriend: () => false,
    });

    startAuthStateWatcher();

    let runtimeModFailures: RuntimeModRegisterFailure[] = [];
    let manifestCount = 0;

    if (flags.enableRuntimeBootstrap) {
      setRuntimeHttpContextProvider(() => {
        const store = useAppStore.getState();
        const runtimeDefaultsRealmBaseUrl = String(store.runtimeDefaults?.realm?.realmBaseUrl || '').trim();
        return {
          realmBaseUrl: runtimeDefaultsRealmBaseUrl || defaults.realm.realmBaseUrl,
          accessToken: resolveCurrentAccessToken(),
          fetchImpl: proxyFetch,
        };
      });

      const runtimeHostCapabilities = buildRuntimeHostCapabilities({
        checkLocalLlmHealth,
        executeLocalKernelTurn,
        withOpenApiContextLock: async <T>(
          context: { realmBaseUrl: string; accessToken?: string; fetchImpl?: typeof fetch },
          task: () => Promise<T>,
        ) => withOpenApiContextLock<T>(context, task),
        getRuntimeHookRuntime: () => getRuntimeHookRuntime(),
      });
      wireModSdkHost(runtimeHostCapabilities);
      setRuntimeModSdkContextProvider(() => ({
        runtimeHost: runtimeHostCapabilities.runtime,
        runtime: runtimeHostCapabilities.runtime.getRuntimeHookRuntime(),
      }));

      const hookRuntime = getRuntimeHookRuntime();
      hookRuntime.setMissingDataCapabilityResolver(async (capability) => {
        if (!isCoreWorldDataCapability(capability)) {
          return false;
        }
        await ensureCoreWorldDataCapabilitiesRegistered();
        return hookRuntime.listDataCapabilities().includes(capability);
      });
      registerModStateDataCapability();
      await ensureCoreWorldDataCapabilitiesRegistered();

      const runtimeModResult = await registerBootstrapRuntimeMods({
        flowId,
      });
      runtimeModFailures = runtimeModResult.runtimeModFailures;
      manifestCount = runtimeModResult.manifestCount;
      registerExternalAgentTier1Actions(hookRuntime);
      await startExternalAgentActionBridge();
      await resyncExternalAgentActionDescriptors();
    } else {
      appStore.setLocalManifestSummaries([]);
      appStore.setRegisteredRuntimeModIds([]);
      appStore.setRuntimeModFailures([]);
    }

    await bootstrapAuthSession({
      flowId,
      accessToken: defaults.realm.accessToken,
    });

    getOfflineCoordinator().markRuntimeReachable(true);

    useAppStore.getState().setBootstrapReady(true);
    useAppStore.getState().setBootstrapError(null);
    logRendererEvent({
      level: runtimeModFailures.length > 0 ? 'warn' : 'info',
      area: 'renderer-bootstrap',
      message: runtimeModFailures.length > 0 ? 'phase:bootstrap:done-with-mod-failures' : 'phase:bootstrap:done',
      flowId,
      costMs: Number((performance.now() - startedAt).toFixed(2)),
      details: {
        runtimeModCount: flags.enableRuntimeBootstrap ? listRegisteredRuntimeModIds().length : 0,
        manifestCount,
        runtimeModFailureCount: runtimeModFailures.length,
      },
    });
  })().catch((error) => {
    // D-BOOT-008 + D-OFFLINE-001: Bootstrap failure → L2 degradation
    getOfflineCoordinator().markRuntimeReachable(false);
    const message = safeErrorMessage(error);
    useAppStore.getState().setBootstrapError(message);
    useAppStore.getState().setBootstrapReady(false);
    useAppStore.getState().clearAuthSession();
    logRendererEvent({
      level: 'error',
      area: 'renderer-bootstrap',
      message: 'phase:bootstrap:failed',
      details: {
        error: message,
      },
    });
    throw error;
  });

  return bootstrapPromise;
}
