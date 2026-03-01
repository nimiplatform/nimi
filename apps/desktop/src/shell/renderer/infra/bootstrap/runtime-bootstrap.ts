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
import { desktopBridge, toRendererLogMessage } from '@renderer/bridge';
import { createProxyFetch } from '@renderer/infra/bridge/proxy-fetch';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { initializePlatformClient } from '@runtime/platform-client';
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
  createSpeechRouteResolver,
} from './runtime-bootstrap-route-resolvers';
import {
  buildRuntimeHostCapabilities,
} from './runtime-bootstrap-host-capabilities';
import {
  startExternalAgentActionBridge,
  resyncExternalAgentActionDescriptors,
} from '@runtime/external-agent';
import { registerExternalAgentTier1Actions } from '@runtime/external-agent/tier1-actions';
import { startAuthStateWatcher } from './auth-state-watcher';
import { checkDaemonVersion } from './version-check';
import { registerExitHandler } from './exit-handler';

let bootstrapPromise: Promise<void> | null = null;

export function bootstrapRuntime(): Promise<void> {
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
    await initializePlatformClient({
      realmBaseUrl: defaults.realm.realmBaseUrl,
      accessToken: defaults.realm.accessToken,
    });
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

    const daemonStatus = await desktopBridge.getRuntimeBridgeStatus();
    const versionResult = checkDaemonVersion(daemonStatus.version);
    if (!versionResult.ok) {
      throw new Error(versionResult.message);
    }

    registerExitHandler({ managed: daemonStatus.managed });

    let runtimeModFailures: RuntimeModRegisterFailure[] = [];
    let manifestCount = 0;

    if (flags.enableRuntimeBootstrap) {
      setRuntimeHttpContextProvider(() => {
        const store = useAppStore.getState();
        const runtimeDefaultsRealmBaseUrl = String(store.runtimeDefaults?.realm?.realmBaseUrl || '').trim();
        const runtimeDefaultsAccessToken = String(store.runtimeDefaults?.realm?.accessToken || '').trim();
        const token = String(store.auth.token || '').trim() || defaults.realm.accessToken;
        return {
          realmBaseUrl: runtimeDefaultsRealmBaseUrl || defaults.realm.realmBaseUrl,
          accessToken: token || runtimeDefaultsAccessToken || defaults.realm.accessToken,
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
      hookRuntime.setSpeechFetchImpl(proxyFetch);
      hookRuntime.setSpeechRouteResolver(
        createSpeechRouteResolver(() => {
          const runtime = useAppStore.getState().runtimeFields;
          return {
            provider: runtime.provider,
            runtimeModelType: runtime.runtimeModelType,
            localProviderEndpoint: runtime.localProviderEndpoint,
            localProviderModel: runtime.localProviderModel,
            localOpenAiEndpoint: runtime.localOpenAiEndpoint,
            connectorId: runtime.connectorId,
          };
        }),
      );
      hookRuntime.setMissingDataCapabilityResolver(async (capability) => {
        if (!isCoreWorldDataCapability(capability)) {
          return false;
        }
        await ensureCoreWorldDataCapabilitiesRegistered();
        return hookRuntime.listDataCapabilities().includes(capability);
      });
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
