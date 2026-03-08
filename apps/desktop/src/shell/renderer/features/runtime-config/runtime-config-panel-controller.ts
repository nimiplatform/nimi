import { useCallback, useEffect, useMemo } from 'react';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { CapabilityV11, RuntimePageIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { persistRuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-storage-persist';
import { useRuntimeConfigPanelEffects } from './runtime-config-panel-effects';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { createRuntimeConfigPanelCommands } from './runtime-config-panel-commands';
import { useRuntimeConfigPanelDerived } from './runtime-config-panel-derived';
import { useRuntimeConfigPanelState } from './runtime-config-panel-state';
import { useRuntimeConfigDaemonController } from './runtime-config-panel-controller-daemon';
import { useRuntimeConfigInstallActions } from './runtime-config-panel-controller-install-actions';
import { useRuntimeConfigBridgeSync } from './runtime-config-panel-controller-bridge-sync';

export type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';

const RUNTIME_DAEMON_STATUS_POLL_INTERVAL_MS = 30_000;

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
    localModelQuery: panelState.localModelQuery,
    connectorModelQuery: panelState.connectorModelQuery,
    localManifestSummaries,
    registeredRuntimeModIds,
  });

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

  const refreshLocalSnapshot = useCallback(async () => {
    await commands.discoverLocalModels();
    await commands.runLocalHealthCheck();
  }, [commands]);

  const daemon = useRuntimeConfigDaemonController({
    updateState: panelState.updateState,
    runLocalHealthCheck: commands.runLocalHealthCheck,
    setStatusBanner,
  });

  const installActions = useRuntimeConfigInstallActions({
    localManifestSummaries,
    refreshLocalSnapshot,
    setStatusBanner,
  });

  const onVaultChanged = useCallback(() => {
    panelState.setVaultVersion((v) => v + 1);
  }, [panelState.setVaultVersion]);

  const onChangePage = useCallback((pageId: RuntimePageIdV11) => {
    panelState.updateState((prev) => ({
      ...prev,
      activePage: pageId,
    }));
  }, [panelState.updateState]);

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
    discoverLocalModels: commands.discoverLocalModels,
  });

  useEffect(() => {
    if (!panelState.hydrated) return;
    void daemon.refreshRuntimeDaemonStatus();
    const timer = setInterval(() => {
      void daemon.refreshRuntimeDaemonStatus();
    }, RUNTIME_DAEMON_STATUS_POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [daemon.refreshRuntimeDaemonStatus, panelState.hydrated]);

  useEffect(() => {
    if (!panelState.hydrated || !panelState.state) return;
    persistRuntimeConfigStateV11(panelState.state);
  }, [panelState.hydrated, panelState.state]);

  useRuntimeConfigBridgeSync({
    hydrated: panelState.hydrated,
    state: panelState.state,
    setState: panelState.setState,
    setStatusBanner,
  });

  const resolveRuntimeDependencies = useCallback(async (
    modId: string,
    capability?: CapabilityV11 | string,
  ) => installActions.resolveRuntimeDependencies(modId, capability), [installActions]);

  const applyRuntimeDependencies = useCallback(async (
    modId: string,
    capability?: CapabilityV11 | string,
  ) => installActions.applyRuntimeDependencies(modId, capability), [installActions]);

  return {
    state: panelState.state,
    runtimeStatus: derived.runtimeStatus,
    activePage: panelState.state?.activePage || 'overview',
    showCloudApiKey: panelState.showCloudApiKey,
    localModelQuery: panelState.localModelQuery,
    connectorModelQuery: panelState.connectorModelQuery,
    vaultEntryCount: panelState.vaultEntryCount,
    discovering: panelState.discovering,
    testingConnector: panelState.testingConnector,
    checkingHealth: panelState.checkingHealth,
    selectedConnector: derived.selectedConnector,
    orderedConnectors: derived.orderedConnectors,
    filteredLocalModels: derived.filteredLocalModels,
    filteredConnectorModels: derived.filteredConnectorModels,
    runtimeDependencyTargets: derived.runtimeDependencyTargets,
    registeredRuntimeModIds,
    runtimeDaemonStatus: daemon.runtimeDaemonStatus,
    runtimeDaemonBusyAction: daemon.runtimeDaemonBusyAction,
    runtimeDaemonError: daemon.runtimeDaemonError,
    runtimeDaemonUpdatedAt: daemon.runtimeDaemonUpdatedAt,
    setShowCloudApiKey: panelState.setShowCloudApiKey,
    setLocalModelQuery: panelState.setLocalModelQuery,
    setConnectorModelQuery: panelState.setConnectorModelQuery,
    onChangePage,
    updateState: panelState.updateState,
    discoverLocalModels: commands.discoverLocalModels,
    runLocalHealthCheck: commands.runLocalHealthCheck,
    testSelectedConnector: commands.testSelectedConnector,
    resolveRuntimeDependencies,
    applyRuntimeDependencies,
    installCatalogLocalModel: installActions.installCatalogLocalModel,
    installLocalModel: installActions.installLocalModel,
    installVerifiedLocalModel: installActions.installVerifiedLocalModel,
    importLocalModel: installActions.importLocalModel,
    installVerifiedLocalArtifact: installActions.installVerifiedLocalArtifact,
    importLocalArtifact: installActions.importLocalArtifact,
    importLocalModelFile: installActions.importLocalModelFile,
    startLocalModel: installActions.startLocalModel,
    stopLocalModel: installActions.stopLocalModel,
    restartLocalModel: installActions.restartLocalModel,
    removeLocalModel: installActions.removeLocalModel,
    removeLocalArtifact: installActions.removeLocalArtifact,
    refreshRuntimeDaemonStatus: daemon.refreshRuntimeDaemonStatus,
    startRuntimeDaemon: daemon.startRuntimeDaemon,
    restartRuntimeDaemon: daemon.restartRuntimeDaemon,
    stopRuntimeDaemon: daemon.stopRuntimeDaemon,
    onVaultChanged,
    onDownloadComplete: installActions.onDownloadComplete,
    retryInstall: installActions.retryInstall,
    installSessionMeta: installActions.installSessionMeta,
  };
}
