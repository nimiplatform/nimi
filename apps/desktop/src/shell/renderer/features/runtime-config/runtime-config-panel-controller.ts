import { useCallback, useEffect, useMemo, useState } from 'react';
import { TauriCredentialVault } from '@runtime/llm-adapter';
import {
  localAiRuntime,
  type LocalAiDependenciesDeclarationDescriptor,
  type LocalAiDependencyResolutionPlan,
  type LocalAiCatalogItemDescriptor,
  type LocalAiInstallPayload,
  type LocalAiInstallPlanDescriptor,
} from '@runtime/local-ai-runtime';
import { desktopBridge, type RuntimeBridgeDaemonStatus } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { CapabilityV11, RuntimeSetupPageIdV11 } from '@renderer/features/runtime-config/state/v11/types';
import { persistRuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/v11/storage';
import { useRuntimeConfigPanelEffects } from './runtime-config-panel-effects';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { createRuntimeConfigPanelCommands } from './runtime-config-panel-commands';
import { useRuntimeConfigPanelDerived } from './runtime-config-panel-derived';
import { useRuntimeConfigPanelState } from './runtime-config-panel-state';
import { applyRuntimeDaemonStatusToConfigState } from './runtime-daemon-state';

export type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type RuntimeDaemonAction = 'start' | 'restart' | 'stop';

export function useRuntimeConfigPanelController(): RuntimeConfigPanelControllerModel {
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const runtimeFields = useAppStore((state) => state.runtimeFields);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const registeredRuntimeModIds = useAppStore((state) => state.registeredRuntimeModIds);
  const localManifestSummaries = useAppStore((state) => state.localManifestSummaries);

  const credentialVault = useMemo(() => new TauriCredentialVault(), []);
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

  const runInstallPlanLifecycle = useCallback(async (
    plan: LocalAiInstallPlanDescriptor,
    installSource: 'catalog' | 'manual' | 'verified',
  ) => {
    const installed = await localAiRuntime.install({
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
    }, { caller: 'core' });
    await localAiRuntime.start(installed.localModelId, { caller: 'core' });
    const healthRows = await localAiRuntime.health(installed.localModelId);
    const targetHealth = healthRows.find((item) => item.localModelId === installed.localModelId)
      || healthRows[0]
      || null;
    if (targetHealth?.status === 'unhealthy') {
      throw new Error(targetHealth.detail || 'local runtime model unhealthy');
    }
    await localAiRuntime.appendAudit({
      eventType: 'runtime_model_ready_after_install',
      modelId: installed.modelId,
      localModelId: installed.localModelId,
      payload: {
        source: installSource,
        capabilities: plan.capabilities,
        localModelId: installed.localModelId,
      },
    });
    await refreshLocalRuntimeSnapshot();
    return installed;
  }, [refreshLocalRuntimeSnapshot]);

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

  const onChangeSetupPage = useCallback((pageId: RuntimeSetupPageIdV11) => {
    panelState.updateState((prev) => ({
      ...prev,
      activeSetupPage: pageId,
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
      const installed = await runInstallPlanLifecycle(plan, 'catalog');
      setStatusBanner({
        kind: 'success',
        message: `Catalog model installed and ready: ${installed.modelId}`,
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
      const installed = await runInstallPlanLifecycle(plan, 'manual');
      setStatusBanner({
        kind: 'success',
        message: `Local model installed and ready: ${installed.modelId}`,
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
      const installed = await runInstallPlanLifecycle(plan, 'verified');
      setStatusBanner({
        kind: 'success',
        message: `Verified model installed and ready: ${installed.modelId}`,
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
    credentialVault,
    setVaultEntryCount: panelState.setVaultEntryCount,
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
    if (!panelState.state) return;
    persistRuntimeConfigStateV11(panelState.state);
  }, [panelState.state]);

  return {
    state: panelState.state,
    runtimeStatus: derived.runtimeStatus,
    activeSetupPage: panelState.state?.activeSetupPage || 'models',
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
    onChangeSetupPage,
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
    startLocalRuntimeModel,
    stopLocalRuntimeModel,
    restartLocalRuntimeModel,
    removeLocalRuntimeModel,
    refreshRuntimeDaemonStatus,
    startRuntimeDaemon,
    restartRuntimeDaemon,
    stopRuntimeDaemon,
  };
}
