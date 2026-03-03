import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  localAiRuntime,
  type LocalAiDependenciesDeclarationDescriptor,
  type LocalAiDependencyResolutionPlan,
  type LocalAiCatalogItemDescriptor,
  type LocalAiInstallPayload,
  type LocalAiInstallPlanDescriptor,
  type LocalAiInstallAcceptedResponse,
} from '@runtime/local-ai-runtime';
import { desktopBridge, type RuntimeBridgeDaemonStatus } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { CapabilityV11, RuntimeConfigStateV11, RuntimePageIdV11 } from '@renderer/features/runtime-config/state/types';
import { persistRuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/storage';
import { useRuntimeConfigPanelEffects } from './runtime-config-panel-effects';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { createRuntimeConfigPanelCommands } from './runtime-config-panel-commands';
import { useRuntimeConfigPanelDerived } from './runtime-config-panel-derived';
import { useRuntimeConfigPanelState } from './runtime-config-panel-state';
import { applyRuntimeDaemonStatusToConfigState } from './runtime-daemon-state';
import {
  applyRuntimeBridgeConfigToState,
  buildRuntimeBridgeConfigFromState,
  serializeRuntimeBridgeProjection,
} from './runtime-bridge-config';

export type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type RuntimeDaemonAction = 'start' | 'restart' | 'stop';
const RUNTIME_BRIDGE_CONFIG_RESTART_REQUIRED = 'CONFIG_RESTART_REQUIRED';

export function useRuntimeConfigPanelController(): RuntimeConfigPanelControllerModel {
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const runtimeFields = useAppStore((state) => state.runtimeFields);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const registeredRuntimeModIds = useAppStore((state) => state.registeredRuntimeModIds);
  const localManifestSummaries = useAppStore((state) => state.localManifestSummaries);

  const panelState = useRuntimeConfigPanelState();
  const derived = useRuntimeConfigPanelDerived({
    state: panelState.state,
    localRuntimeModelQuery: panelState.localRuntimeModelQuery,
    connectorModelQuery: panelState.connectorModelQuery,
    localManifestSummaries,
    registeredRuntimeModIds,
  });
  const [runtimeDaemonStatus, setRuntimeDaemonStatus] = useState<RuntimeBridgeDaemonStatus | null>(null);
  const [runtimeDaemonBusyAction, setRuntimeDaemonBusyAction] = useState<RuntimeDaemonAction | null>(null);
  const [runtimeDaemonError, setRuntimeDaemonError] = useState('');
  const [runtimeDaemonUpdatedAt, setRuntimeDaemonUpdatedAt] = useState<string | null>(null);
  const runtimeBridgeConfigRef = useRef<Record<string, unknown>>({});
  const runtimeBridgeProjectionRef = useRef('');
  const runtimeBridgeFailedProjectionRef = useRef('');
  const runtimeBridgeLoadStartedRef = useRef(false);
  const [bridgeRetryCount, setBridgeRetryCount] = useState(0);
  const runtimeBridgeReadyRef = useRef(false);
  const runtimeBridgeReadSucceededRef = useRef(false);
  const runtimeBridgeRestartHintShownRef = useRef(false);

  const commandInput = useMemo(() => ({
    guard: {
      discovering: panelState.discovering,
      testingConnector: panelState.testingConnector,
      checkingHealth: panelState.checkingHealth,
      applying: panelState.applying,
      setDiscovering: panelState.setDiscovering,
      setTestingConnector: panelState.setTestingConnector,
      setCheckingHealth: panelState.setCheckingHealth,
      setApplying: panelState.setApplying,
    },
    provider: {
      discover: {
        state: panelState.state,
        discovering: panelState.discovering,
        updateState: panelState.updateState,
        setStatusBanner,
      },
      health: {
        state: panelState.state,
        checkingHealth: panelState.checkingHealth,
        updateState: panelState.updateState,
        setStatusBanner,
      },
      testSelectedConnector: {
        state: panelState.state,
        selectedConnector: derived.selectedConnector,
        testingConnector: panelState.testingConnector,
        updateState: panelState.updateState,
        setStatusBanner,
      },
    },
  }), [
    derived.selectedConnector,
    panelState.applying,
    panelState.checkingHealth,
    panelState.discovering,
    panelState.setApplying,
    panelState.setCheckingHealth,
    panelState.setDiscovering,
    panelState.setTestingConnector,
    panelState.state,
    panelState.testingConnector,
    panelState.updateState,
    setStatusBanner,
  ]);

  const commands = useMemo(
    () => createRuntimeConfigPanelCommands(commandInput),
    [commandInput],
  );

  const applyRuntimeDaemonStatusToState = useCallback((
    status: RuntimeBridgeDaemonStatus,
    mode: 'poll' | 'action',
  ) => {
    const checkedAt = new Date().toISOString();
    panelState.updateState((previous) => {
      return applyRuntimeDaemonStatusToConfigState(previous, status, mode, checkedAt);
    });
  }, [panelState.updateState]);

  const refreshRuntimeDaemonStatus = useCallback(async () => {
    try {
      const status = await desktopBridge.getRuntimeBridgeStatus();
      setRuntimeDaemonStatus(status);
      setRuntimeDaemonUpdatedAt(new Date().toISOString());
      setRuntimeDaemonError('');
      applyRuntimeDaemonStatusToState(status, 'poll');
    } catch (error) {
      setRuntimeDaemonError(error instanceof Error ? error.message : String(error || 'runtime daemon status failed'));
    }
  }, [applyRuntimeDaemonStatusToState]);

  const runRuntimeDaemonAction = useCallback(async (action: RuntimeDaemonAction) => {
    setRuntimeDaemonBusyAction(action);
    setRuntimeDaemonError('');
    try {
      const status = action === 'start'
        ? await desktopBridge.startRuntimeBridge()
        : action === 'restart'
          ? await desktopBridge.restartRuntimeBridge()
          : await desktopBridge.stopRuntimeBridge();
      setRuntimeDaemonStatus(status);
      setRuntimeDaemonUpdatedAt(new Date().toISOString());
      applyRuntimeDaemonStatusToState(status, 'action');
      await commands.runLocalRuntimeHealthCheck();
      setStatusBanner({
        kind: status.running ? 'success' : 'warning',
        message: `Runtime daemon ${action} ${status.running ? 'completed' : 'stopped'}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || `runtime daemon ${action} failed`);
      setRuntimeDaemonError(message);
      setStatusBanner({
        kind: 'error',
        message: `Runtime daemon ${action} failed: ${message}`,
      });
      throw error;
    } finally {
      setRuntimeDaemonBusyAction(null);
    }
  }, [applyRuntimeDaemonStatusToState, commands, setStatusBanner]);

  const startRuntimeDaemon = useCallback(async () => {
    await runRuntimeDaemonAction('start');
  }, [runRuntimeDaemonAction]);

  const restartRuntimeDaemon = useCallback(async () => {
    await runRuntimeDaemonAction('restart');
  }, [runRuntimeDaemonAction]);

  const stopRuntimeDaemon = useCallback(async () => {
    await runRuntimeDaemonAction('stop');
  }, [runRuntimeDaemonAction]);

  const refreshLocalRuntimeSnapshot = useCallback(async () => {
    await commands.discoverLocalRuntimeModels();
    await commands.runLocalRuntimeHealthCheck();
  }, [commands]);

  const pendingInstallsRef = useRef(new Map<string, {
    accepted: LocalAiInstallAcceptedResponse;
    plan: LocalAiInstallPlanDescriptor;
    installSource: 'catalog' | 'manual' | 'verified';
  }>());
  const [pendingInstallVersion, setPendingInstallVersion] = useState(0);

  const installSessionMeta = useMemo(() => {
    const meta = new Map<string, { plan: LocalAiInstallPlanDescriptor; installSource: string }>();
    for (const [sessionId, entry] of pendingInstallsRef.current) {
      meta.set(sessionId, { plan: entry.plan, installSource: entry.installSource });
    }
    return meta;
  }, [pendingInstallVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDownloadComplete = useCallback(async (
    installSessionId: string,
    success: boolean,
    message?: string,
    localModelId?: string,
    modelId?: string,
  ) => {
    const session = pendingInstallsRef.current.get(installSessionId);

    if (!success) {
      // Keep entry in pendingInstallsRef so the Retry button can read session meta.
      setStatusBanner({
        kind: 'error',
        message: `Download failed: ${message || 'unknown error'}`,
      });
      return;
    }

    if (session) {
      // Download succeeded — remove from pending and run post-install lifecycle.
      pendingInstallsRef.current.delete(installSessionId);
      setPendingInstallVersion((v) => v + 1);
    }

    const resolvedLocalModelId = String(session?.accepted.localModelId || localModelId || '').trim();
    const resolvedModelId = String(session?.accepted.modelId || modelId || '').trim();
    if (!resolvedLocalModelId || !resolvedModelId) {
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({
        kind: 'success',
        message: 'Model download completed',
      });
      return;
    }

    const installSource = session?.installSource || 'resume';
    const capabilities = session?.plan.capabilities || [];
    try {
      await localAiRuntime.start(resolvedLocalModelId, { caller: 'core' });
      const healthRows = await localAiRuntime.health(resolvedLocalModelId);
      const targetHealth = healthRows.find((item) => item.localModelId === resolvedLocalModelId)
        || healthRows[0]
        || null;
      if (targetHealth?.status === 'unhealthy') {
        throw new Error(targetHealth.detail || 'local runtime model unhealthy');
      }
      await localAiRuntime.appendAudit({
        eventType: 'runtime_model_ready_after_install',
        modelId: resolvedModelId,
        localModelId: resolvedLocalModelId,
        payload: {
          source: installSource,
          capabilities,
          localModelId: resolvedLocalModelId,
        },
      });
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({
        kind: 'success',
        message: `Model installed and ready: ${resolvedModelId}`,
      });
    } catch (postError: unknown) {
      setStatusBanner({
        kind: 'error',
        message: `Post-install failed: ${postError instanceof Error ? postError.message : String(postError || '')}`,
      });
    }
  }, [refreshLocalRuntimeSnapshot, setStatusBanner]);

  const runInstallPlanLifecycle = useCallback((
    plan: LocalAiInstallPlanDescriptor,
    installSource: 'catalog' | 'manual' | 'verified',
  ) => {
    // Install command returns immediately after preflight.
    // Download runs on a background Rust thread; completion is signalled via progress events
    // which are handled by the component's global subscription calling onDownloadComplete.
    localAiRuntime.install({
      modelId: plan.modelId,
      repo: plan.repo,
      revision: plan.revision,
      capabilities: plan.capabilities,
      engine: plan.engine,
      entry: plan.entry,
      files: plan.files,
      license: plan.license,
      hashes: plan.hashes,
      endpoint: plan.endpoint,
    }, { caller: 'core' })
      .then((accepted) => {
        pendingInstallsRef.current.set(accepted.installSessionId, {
          accepted,
          plan,
          installSource,
        });
        setPendingInstallVersion((v) => v + 1);
      })
      .catch((error: unknown) => {
        setStatusBanner({
          kind: 'error',
          message: `Install lifecycle failed: ${error instanceof Error ? error.message : String(error || '')}`,
        });
      });
  }, [setStatusBanner]);

  const retryInstall = useCallback((
    plan: LocalAiInstallPlanDescriptor,
    source: 'catalog' | 'manual' | 'verified',
  ) => {
    runInstallPlanLifecycle(plan, source);
    setStatusBanner({
      kind: 'info',
      message: `Retrying install: ${plan.modelId}. Download progress will appear below.`,
    });
  }, [runInstallPlanLifecycle, setStatusBanner]);

  const findManifestDependenciesByModId = useCallback((modId: string): LocalAiDependenciesDeclarationDescriptor | null => {
    const normalizedModId = String(modId || '').trim();
    if (!normalizedModId) return null;
    const summary = localManifestSummaries.find((item) => String(item.id || '').trim() === normalizedModId) || null;
    if (!summary) return null;
    const manifest = asRecord(summary.manifest);
    const ai = asRecord(manifest.ai);
    const dependencies = ai.dependencies;
    if (dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)) {
      return dependencies as LocalAiDependenciesDeclarationDescriptor;
    }
    return null;
  }, [localManifestSummaries]);

  const resolveRuntimeDependencies = useCallback(async (
    modId: string,
    capability?: CapabilityV11 | string,
  ): Promise<LocalAiDependencyResolutionPlan> => {
    const dependencies = findManifestDependenciesByModId(modId);
    if (!dependencies) {
      throw new Error(`dependencies missing in manifest: ${modId}`);
    }
    const deviceProfile = await localAiRuntime.collectDeviceProfile();
    return localAiRuntime.resolveDependencies({
      modId,
      capability: String(capability || '').trim() || undefined,
      dependencies,
      deviceProfile,
    });
  }, [findManifestDependenciesByModId]);

  const applyRuntimeDependencies = useCallback(async (
    modId: string,
    capability?: CapabilityV11 | string,
  ) => {
    try {
      const plan = await resolveRuntimeDependencies(modId, capability);
      const result = await localAiRuntime.applyDependencies(plan, { caller: 'core' });
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({
        kind: 'success',
        message: `Dependencies applied for ${modId}: ${result.installedModels.length} model(s), ${result.services.length} service(s)`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Dependency apply failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [refreshLocalRuntimeSnapshot, resolveRuntimeDependencies, setStatusBanner]);

  const onVaultChanged = useCallback(() => {
    panelState.setVaultVersion((v) => v + 1);
  }, [panelState.setVaultVersion]);

  const onChangePage = useCallback((pageId: RuntimePageIdV11) => {
    panelState.updateState((prev) => ({
      ...prev,
      activePage: pageId,
    }));
  }, [panelState.updateState]);

  const installCatalogLocalRuntimeModel = useCallback(async (item: LocalAiCatalogItemDescriptor) => {
    try {
      const plan = await localAiRuntime.resolveInstallPlan({
        itemId: item.itemId,
        source: item.source,
        templateId: item.templateId,
        modelId: item.modelId,
        repo: item.repo,
        revision: item.revision,
      });
      runInstallPlanLifecycle(plan, 'catalog');
      setStatusBanner({
        kind: 'info',
        message: `Catalog model install started: ${plan.modelId}. Download progress will appear below.`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Catalog model install failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [runInstallPlanLifecycle, setStatusBanner]);

  const installLocalRuntimeModel = useCallback(async (payload: LocalAiInstallPayload) => {
    try {
      const resolved = await localAiRuntime.resolveInstallPlan({
        source: 'huggingface',
        modelId: payload.modelId,
        repo: payload.repo,
        revision: payload.revision,
        capabilities: payload.capabilities,
        engine: payload.engine,
        entry: payload.entry,
        files: payload.files,
        license: payload.license,
        hashes: payload.hashes,
        endpoint: payload.endpoint,
      });
      const plan: LocalAiInstallPlanDescriptor = {
        ...resolved,
        modelId: String(payload.modelId || '').trim() || resolved.modelId,
        repo: String(payload.repo || '').trim() || resolved.repo,
        revision: String(payload.revision || '').trim() || resolved.revision,
        capabilities: payload.capabilities && payload.capabilities.length > 0
          ? payload.capabilities
          : resolved.capabilities,
        engine: String(payload.engine || '').trim() || resolved.engine,
        entry: String(payload.entry || '').trim() || resolved.entry,
        files: payload.files && payload.files.length > 0 ? payload.files : resolved.files,
        license: String(payload.license || '').trim() || resolved.license,
        hashes: payload.hashes && Object.keys(payload.hashes).length > 0 ? payload.hashes : resolved.hashes,
        endpoint: String(payload.endpoint || '').trim() || resolved.endpoint,
      };
      runInstallPlanLifecycle(plan, 'manual');
      setStatusBanner({
        kind: 'info',
        message: `Local model install started: ${plan.modelId}. Download progress will appear below.`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Local model install failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [runInstallPlanLifecycle, setStatusBanner]);

  const installVerifiedLocalRuntimeModel = useCallback(async (templateId: string) => {
    const normalizedTemplateId = String(templateId || '').trim();
    if (!normalizedTemplateId) {
      throw new Error('templateId is required');
    }
    try {
      const plan = await localAiRuntime.resolveInstallPlan({
        source: 'verified',
        templateId: normalizedTemplateId,
      });
      runInstallPlanLifecycle(plan, 'verified');
      setStatusBanner({
        kind: 'info',
        message: `Verified model install started: ${plan.modelId}. Download progress will appear below.`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Verified model install failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [runInstallPlanLifecycle, setStatusBanner]);

  const importLocalRuntimeModel = useCallback(async () => {
    try {
      const manifestPath = await localAiRuntime.pickManifestPath();
      if (!manifestPath) {
        return;
      }
      await localAiRuntime.import({ manifestPath }, { caller: 'core' });
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({
        kind: 'success',
        message: `Local model imported: ${manifestPath}`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Local model import failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [refreshLocalRuntimeSnapshot, setStatusBanner]);

  const importLocalRuntimeModelFile = useCallback(async (capabilities: string[], engine?: string) => {
    try {
      const filePath = await localAiRuntime.pickModelFile();
      if (!filePath) {
        return;
      }
      const accepted = await localAiRuntime.importFile({
        filePath,
        capabilities,
        engine: engine || undefined,
      }, { caller: 'core' });

      // File import completion is detected via the component's global download progress subscription
      // which calls onDownloadComplete. Store the session so post-import refresh can happen.
      pendingInstallsRef.current.set(accepted.installSessionId, {
        accepted,
        plan: {
          planId: accepted.installSessionId,
          itemId: accepted.modelId,
          source: 'huggingface',
          modelId: accepted.modelId,
          repo: '',
          revision: '',
          capabilities,
          engine: engine || '',
          engineRuntimeMode: 'supervised',
          installKind: 'file-import',
          installAvailable: true,
          entry: '',
          files: [],
          license: '',
          hashes: {},
          endpoint: '',
          warnings: [],
        } as LocalAiInstallPlanDescriptor,
        installSource: 'manual',
      });
      setPendingInstallVersion((v) => v + 1);

      setStatusBanner({
        kind: 'info',
        message: `File import started: ${accepted.modelId}. Progress will appear below.`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Model file import failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [setStatusBanner]);

  const startLocalRuntimeModel = useCallback(async (localModelId: string) => {
    try {
      await localAiRuntime.start(localModelId, { caller: 'core' });
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({ kind: 'success', message: `Model started: ${localModelId}` });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Start model failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [refreshLocalRuntimeSnapshot, setStatusBanner]);

  const stopLocalRuntimeModel = useCallback(async (localModelId: string) => {
    try {
      await localAiRuntime.stop(localModelId, { caller: 'core' });
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({ kind: 'success', message: `Model stopped: ${localModelId}` });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Stop model failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [refreshLocalRuntimeSnapshot, setStatusBanner]);

  const restartLocalRuntimeModel = useCallback(async (localModelId: string) => {
    try {
      await localAiRuntime.stop(localModelId, { caller: 'core' }).catch(() => null);
      await localAiRuntime.start(localModelId, { caller: 'core' });
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({ kind: 'success', message: `Model restarted: ${localModelId}` });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Restart model failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [refreshLocalRuntimeSnapshot, setStatusBanner]);

  const removeLocalRuntimeModel = useCallback(async (localModelId: string) => {
    try {
      await localAiRuntime.remove(localModelId, { caller: 'core' });
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({ kind: 'success', message: `Model removed: ${localModelId}` });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Remove model failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [refreshLocalRuntimeSnapshot, setStatusBanner]);

  useRuntimeConfigPanelEffects({
    bootstrapReady,
    hydrated: panelState.hydrated,
    setHydrated: panelState.setHydrated,
    state: panelState.state,
    setState: panelState.setState,
    runtimeFields,
    setRuntimeFields,
    setStatusBanner,
    setVaultEntryCount: panelState.setVaultEntryCount,
    vaultVersion: panelState.vaultVersion,
    discoverLocalRuntimeModels: commands.discoverLocalRuntimeModels,
  });

  useEffect(() => {
    if (!panelState.hydrated) return;
    void refreshRuntimeDaemonStatus();
    const timer = setInterval(() => {
      void refreshRuntimeDaemonStatus();
    }, 5000);
    return () => {
      clearInterval(timer);
    };
  }, [panelState.hydrated, refreshRuntimeDaemonStatus]);

  useEffect(() => {
    if (!panelState.hydrated || !panelState.state) return;
    persistRuntimeConfigStateV11(panelState.state);
  }, [panelState.hydrated, panelState.state]);

  useEffect(() => {
    if (!panelState.hydrated || runtimeBridgeLoadStartedRef.current) return;
    runtimeBridgeLoadStartedRef.current = true;

    if (!desktopBridge.hasTauriInvoke()) {
      runtimeBridgeReadyRef.current = true;
      return;
    }

    let cancelled = false;
    const loadBridgeConfig = async () => {
      try {
        const result = await desktopBridge.getRuntimeBridgeConfig();
        if (cancelled) return;
        runtimeBridgeConfigRef.current = asRecord(result.config);
        runtimeBridgeReadSucceededRef.current = true;
        panelState.setState((previous) => {
          if (!previous) return previous;
          const next = applyRuntimeBridgeConfigToState(previous, runtimeBridgeConfigRef.current);
          // localStorage no longer stores connectors — bridge config is the single source.
          // Initial projection matches the merged state directly.
          runtimeBridgeProjectionRef.current = serializeRuntimeBridgeProjection(next);
          runtimeBridgeFailedProjectionRef.current = '';
          return next;
        });
        // Load connectors from SDK after bridge config is ready (serial, not a separate effect).
        // Using a ref check to avoid re-running this block would race with the render cycle,
        // so we chain it directly here.
        if (!cancelled) {
          try {
            const { sdkListConnectors } = await import('./domain/provider-connectors/connector-sdk-service');
            const connectors = await sdkListConnectors();
            if (!cancelled && connectors.length > 0) {
              const { replaceConnectorsInState } = await import('./panels/provider-connectors/connector-actions');
              panelState.setState((previous) => {
                if (!previous) return previous;
                return replaceConnectorsInState(previous, connectors);
              });
            }
          } catch {
            // SDK connector load failed — connectors will remain from bridge config
          }
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error || 'runtime config bridge load failed');
        setStatusBanner({
          kind: 'warning',
          message: `Runtime config read failed, keep local view: ${message}`,
          actionLabel: 'Retry',
          onAction: () => {
            runtimeBridgeLoadStartedRef.current = false;
            setStatusBanner(null);
            setBridgeRetryCount((c) => c + 1);
          },
        });
      } finally {
        if (!cancelled) {
          runtimeBridgeReadyRef.current = true;
        }
      }
    };

    void loadBridgeConfig();
    return () => {
      cancelled = true;
    };
  }, [panelState.hydrated, panelState.setState, setStatusBanner, bridgeRetryCount]);

  useEffect(() => {
    const stateSnapshot = panelState.state;
    if (!panelState.hydrated || !stateSnapshot) return;
    if (!runtimeBridgeReadSucceededRef.current) return;
    if (!desktopBridge.hasTauriInvoke()) return;

    const nextProjection = serializeRuntimeBridgeProjection(stateSnapshot);
    if (nextProjection === runtimeBridgeProjectionRef.current) return;
    if (nextProjection === runtimeBridgeFailedProjectionRef.current) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      const persist = async (currentState: RuntimeConfigStateV11, projection: string) => {
        try {
          const nextConfig = buildRuntimeBridgeConfigFromState(currentState, runtimeBridgeConfigRef.current);
          const result = await desktopBridge.setRuntimeBridgeConfig(JSON.stringify(nextConfig));
          if (cancelled) return;

          runtimeBridgeConfigRef.current = asRecord(result.config);
          runtimeBridgeProjectionRef.current = projection;
          runtimeBridgeFailedProjectionRef.current = '';

          if (
            result.reasonCode === RUNTIME_BRIDGE_CONFIG_RESTART_REQUIRED
            && !runtimeBridgeRestartHintShownRef.current
          ) {
            runtimeBridgeRestartHintShownRef.current = true;
            const hint = String(result.actionHint || '').trim();
            setStatusBanner({
              kind: 'info',
              message: hint || 'Runtime config saved. Restart runtime to apply changes.',
            });
          }
        } catch (error) {
          if (cancelled) return;
          runtimeBridgeFailedProjectionRef.current = projection;
          const message = error instanceof Error ? error.message : String(error || 'runtime config bridge save failed');
          setStatusBanner({
            kind: 'error',
            message: `Runtime config save failed: ${message}`,
          });
        }
      };

      void persist(stateSnapshot, nextProjection);
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [panelState.hydrated, panelState.state, setStatusBanner]);

  return {
    state: panelState.state,
    runtimeStatus: derived.runtimeStatus,
    activePage: panelState.state?.activePage || 'overview',
    showTokenApiKey: panelState.showTokenApiKey,
    localRuntimeModelQuery: panelState.localRuntimeModelQuery,
    connectorModelQuery: panelState.connectorModelQuery,
    vaultEntryCount: panelState.vaultEntryCount,
    discovering: panelState.discovering,
    testingConnector: panelState.testingConnector,
    checkingHealth: panelState.checkingHealth,
    selectedConnector: derived.selectedConnector,
    orderedConnectors: derived.orderedConnectors,
    filteredLocalRuntimeModels: derived.filteredLocalRuntimeModels,
    filteredConnectorModels: derived.filteredConnectorModels,
    runtimeDependencyTargets: derived.runtimeDependencyTargets,
    registeredRuntimeModIds,
    runtimeDaemonStatus,
    runtimeDaemonBusyAction,
    runtimeDaemonError,
    runtimeDaemonUpdatedAt,
    setShowTokenApiKey: panelState.setShowTokenApiKey,
    setLocalRuntimeModelQuery: panelState.setLocalRuntimeModelQuery,
    setConnectorModelQuery: panelState.setConnectorModelQuery,
    onChangePage,
    updateState: panelState.updateState,
    discoverLocalRuntimeModels: commands.discoverLocalRuntimeModels,
    runLocalRuntimeHealthCheck: commands.runLocalRuntimeHealthCheck,
    testSelectedConnector: commands.testSelectedConnector,
    resolveRuntimeDependencies,
    applyRuntimeDependencies,
    installCatalogLocalRuntimeModel,
    installLocalRuntimeModel,
    installVerifiedLocalRuntimeModel,
    importLocalRuntimeModel,
    importLocalRuntimeModelFile,
    startLocalRuntimeModel,
    stopLocalRuntimeModel,
    restartLocalRuntimeModel,
    removeLocalRuntimeModel,
    refreshRuntimeDaemonStatus,
    startRuntimeDaemon,
    restartRuntimeDaemon,
    stopRuntimeDaemon,
    onVaultChanged,
    onDownloadComplete,
    retryInstall,
    installSessionMeta,
  };
}
