import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { RuntimePageIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { persistRuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-storage-persist';
import { addRuntimeConfigOpenPageListener } from '@renderer/features/runtime-config/runtime-config-navigation-events';
import { useRuntimeConfigPanelEffects } from './runtime-config-panel-effects';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { createRuntimeConfigPanelCommands } from './runtime-config-panel-commands';
import { useRuntimeConfigPanelDerived } from './runtime-config-panel-derived';
import { useRuntimeConfigPanelState } from './runtime-config-panel-state';
import { useRuntimeConfigDaemonController } from './runtime-config-panel-controller-daemon';
import { useRuntimeConfigInstallActions } from './runtime-config-panel-controller-install-actions';
import { useRuntimeConfigBridgeSync } from './runtime-config-panel-controller-bridge-sync';
import type { InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';

export type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';

const RUNTIME_DAEMON_STATUS_POLL_INTERVAL_MS = 30_000;

export function useRuntimeConfigPanelController(): RuntimeConfigPanelControllerModel {
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const offlineTier = useAppStore((state) => state.offlineTier);
  const runtimeFields = useAppStore((state) => state.runtimeFields);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const registeredRuntimeModIds = useAppStore((state) => state.registeredRuntimeModIds);
  const localManifestSummaries = useAppStore((state) => state.localManifestSummaries);
  const [pageFeedback, setPageFeedback] = useState<InlineFeedbackState | null>(null);
  const [connectorTestFeedback, setConnectorTestFeedback] = useState<InlineFeedbackState | null>(null);

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
        setStatusBanner: setPageFeedback,
      },
      health: {
        state: panelState.state,
        checkingHealth: panelState.checkingHealth,
        updateState: panelState.updateState,
        setStatusBanner: setPageFeedback,
      },
      testSelectedConnector: {
        state: panelState.state,
        selectedConnector: derived.selectedConnector,
        testingConnector: panelState.testingConnector,
        updateState: panelState.updateState,
        setStatusBanner: setPageFeedback,
        setControlFeedback: setConnectorTestFeedback,
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
    setConnectorTestFeedback,
    setPageFeedback,
  ]);

  const commands = useMemo(
    () => createRuntimeConfigPanelCommands(commandInput),
    [commandInput],
  );

  const refreshLocalSnapshot = useCallback(async () => {
    await Promise.all([
      commands.discoverLocalModels(),
      commands.runLocalHealthCheck(),
    ]);
  }, [commands]);

  const daemon = useRuntimeConfigDaemonController({
    updateState: panelState.updateState,
    runLocalHealthCheck: commands.runLocalHealthCheck,
    setStatusBanner: setPageFeedback,
  });

  const installActions = useRuntimeConfigInstallActions({
    localManifestSummaries,
    refreshLocalSnapshot,
    setStatusBanner: setPageFeedback,
    updateState: panelState.updateState,
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
    setStatusBanner: setPageFeedback,
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

  useEffect(() => addRuntimeConfigOpenPageListener((pageId) => {
    panelState.updateState((prev) => ({
      ...prev,
      activePage: pageId,
    }));
  }), [panelState.updateState]);

  useRuntimeConfigBridgeSync({
    hydrated: panelState.hydrated,
    state: panelState.state,
    setState: panelState.setState,
    setStatusBanner: setPageFeedback,
  });

  const resolveRuntimeProfile = useCallback(async (
    modId: string,
    profileId: string,
    capability?: string,
  ) => installActions.resolveRuntimeProfile(modId, profileId, capability), [installActions]);

  const applyRuntimeProfile = useCallback(async (
    modId: string,
    profileId: string,
    capability?: string,
  ) => installActions.applyRuntimeProfile(modId, profileId, capability), [installActions]);

  return {
    state: panelState.state,
    hydrated: panelState.hydrated,
    runtimeStatus: derived.runtimeStatus,
    activePage: panelState.state?.activePage || 'overview',
    showCloudApiKey: panelState.showCloudApiKey,
    localModelQuery: panelState.localModelQuery,
    connectorModelQuery: panelState.connectorModelQuery,
    vaultEntryCount: panelState.vaultEntryCount,
    discovering: panelState.discovering,
    testingConnector: panelState.testingConnector,
    checkingHealth: panelState.checkingHealth,
    runtimeWritesDisabled: offlineTier === 'L2',
    selectedConnector: derived.selectedConnector,
    orderedConnectors: derived.orderedConnectors,
    filteredLocalModels: derived.filteredLocalModels,
    filteredConnectorModels: derived.filteredConnectorModels,
    runtimeProfileTargets: derived.runtimeProfileTargets,
    registeredRuntimeModIds,
    runtimeDaemonStatus: daemon.runtimeDaemonStatus,
    runtimeDaemonBusyAction: daemon.runtimeDaemonBusyAction,
    runtimeDaemonError: daemon.runtimeDaemonError,
    runtimeDaemonUpdatedAt: daemon.runtimeDaemonUpdatedAt,
    pageFeedback,
    connectorTestFeedback,
    localModelLifecycleById: installActions.localModelLifecycleById,
    localModelLifecycleErrorById: installActions.localModelLifecycleErrorById,
    setShowCloudApiKey: panelState.setShowCloudApiKey,
    setLocalModelQuery: panelState.setLocalModelQuery,
    setConnectorModelQuery: panelState.setConnectorModelQuery,
    setPageFeedback,
    setConnectorTestFeedback,
    onChangePage,
    updateState: panelState.updateState,
    discoverLocalModels: commands.discoverLocalModels,
    runLocalHealthCheck: commands.runLocalHealthCheck,
    testSelectedConnector: commands.testSelectedConnector,
    resolveRuntimeProfile,
    applyRuntimeProfile,
    installCatalogLocalModel: installActions.installCatalogLocalModel,
    installLocalModel: installActions.installLocalModel,
    installVerifiedLocalModel: installActions.installVerifiedLocalModel,
    importLocalModel: installActions.importLocalModel,
    installVerifiedLocalAsset: installActions.installVerifiedLocalAsset,
    importLocalAsset: installActions.importLocalAsset,
    scaffoldLocalAssetOrphan: installActions.scaffoldLocalAssetOrphan,
    importLocalModelFile: installActions.importLocalModelFile,
    startLocalModel: installActions.startLocalModel,
    stopLocalModel: installActions.stopLocalModel,
    restartLocalModel: installActions.restartLocalModel,
    removeLocalModel: installActions.removeLocalModel,
    removeLocalAsset: installActions.removeLocalAsset,
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
