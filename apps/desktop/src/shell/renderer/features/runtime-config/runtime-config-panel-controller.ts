import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../../app-shell/providers/app-store';
import type { RuntimePageIdV11 } from './runtime-config-state-types';
import { persistRuntimeConfigStateV11 } from './runtime-config-storage-persist';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useRuntimeConfigPanelEffects } from './runtime-config-panel-effects';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { createRuntimeConfigPanelCommands } from './runtime-config-panel-commands';
import { useRuntimeConfigPanelDerived } from './runtime-config-panel-derived';
import { useRuntimeConfigPanelState } from './runtime-config-panel-state';
import { useRuntimeConfigDaemonController } from './runtime-config-panel-controller-daemon';
import { useRuntimeConfigInstallActions } from './runtime-config-panel-controller-install-actions';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';
import { useRuntimeConfigConnectorSdk } from './runtime-config-connector-sdk-context.js';

export type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';

const RUNTIME_DAEMON_STATUS_POLL_INTERVAL_MS = 30_000;

export function useRuntimeConfigPanelController(): RuntimeConfigPanelControllerModel {
  const bindings = useDesktopRendererBindings();
  const runtimeConnectorSdk = useRuntimeConfigConnectorSdk();
  const runtimeConfigNavigation = bindings.app.commands.runtimeConfigNavigation;
  const activeTab = useAppStore((state) => state.activeTab);
  const runtimeTabActive = activeTab === 'runtime';
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const offlineTier = useAppStore((state) => state.offlineTier);
  const setPageFeedback = emitFeedbackToast;
  const setConnectorTestFeedback = emitFeedbackToast;

  const panelState = useRuntimeConfigPanelState();
  const derived = useRuntimeConfigPanelDerived({
    state: panelState.state,
    localModelQuery: panelState.localModelQuery,
    connectorModelQuery: panelState.connectorModelQuery,
  });

  // Live refs so the command context reads the latest state/guard values at
  // call time instead of capturing them in the useMemo dependency array.
  // Keeping `commandInput` (and therefore `commands`, `refreshLocalSnapshot`,
  // and the download-complete handler) referentially stable across state
  // updates is what prevents the transfer-watch effect from re-subscribing on
  // every render — the feedback loop that made the discovering/checking badge
  // flicker. Assign in render body (not an effect) so reads are never stale.
  const stateRef = useRef(panelState.state);
  const discoveringRef = useRef(panelState.discovering);
  const checkingHealthRef = useRef(panelState.checkingHealth);
  const testingConnectorRef = useRef(panelState.testingConnector);
  const applyingRef = useRef(panelState.applying);
  const selectedConnectorRef = useRef(derived.selectedConnector);
  stateRef.current = panelState.state;
  discoveringRef.current = panelState.discovering;
  checkingHealthRef.current = panelState.checkingHealth;
  testingConnectorRef.current = panelState.testingConnector;
  applyingRef.current = panelState.applying;
  selectedConnectorRef.current = derived.selectedConnector;

  const commandInput = useMemo(() => ({
    guard: {
      get discovering() { return discoveringRef.current; },
      get testingConnector() { return testingConnectorRef.current; },
      get checkingHealth() { return checkingHealthRef.current; },
      get applying() { return applyingRef.current; },
      setDiscovering: panelState.setDiscovering,
      setTestingConnector: panelState.setTestingConnector,
      setCheckingHealth: panelState.setCheckingHealth,
      setApplying: panelState.setApplying,
    },
    provider: {
      discover: {
        get state() { return stateRef.current; },
        sdk: bindings.sdk,
        get discovering() { return discoveringRef.current; },
        updateState: panelState.updateState,
        setStatusBanner: setPageFeedback,
      },
      health: {
        get state() { return stateRef.current; },
        sdk: bindings.sdk,
        get checkingHealth() { return checkingHealthRef.current; },
        updateState: panelState.updateState,
        setStatusBanner: setPageFeedback,
      },
      testSelectedConnector: {
        get state() { return stateRef.current; },
        connectorSdk: runtimeConnectorSdk,
        now: bindings.clock.now,
        get selectedConnector() { return selectedConnectorRef.current; },
        get testingConnector() { return testingConnectorRef.current; },
        updateState: panelState.updateState,
        setStatusBanner: setPageFeedback,
        setControlFeedback: setConnectorTestFeedback,
      },
    },
  }), [
    bindings.clock.now,
    bindings.sdk,
    runtimeConnectorSdk,
    panelState.setApplying,
    panelState.setCheckingHealth,
    panelState.setDiscovering,
    panelState.setTestingConnector,
    panelState.updateState,
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
    localManifestSummaries: [],
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
    setStatusBanner: setPageFeedback,
    setVaultEntryCount: panelState.setVaultEntryCount,
    vaultVersion: panelState.vaultVersion,
    discoverLocalModels: commands.discoverLocalModels,
  });

  // Projection refresh is now driven centrally by surface subscription
  // (S-AICONF-006 via bindProjectionRefreshToSurface in runtime-slice bootstrap).

  useEffect(() => {
    if (!panelState.hydrated || !runtimeTabActive) return;
    void daemon.refreshRuntimeDaemonStatus();
    let active = true;
    let cancelScheduledRefresh: (() => void) | null = null;
    const scheduleRefresh = () => {
      cancelScheduledRefresh = bindings.clock.schedule(
        RUNTIME_DAEMON_STATUS_POLL_INTERVAL_MS,
        (result) => {
          cancelScheduledRefresh = null;
          if (!active || !result.ok) return;
          void daemon.refreshRuntimeDaemonStatus();
          scheduleRefresh();
        },
      );
    };
    scheduleRefresh();
    return () => {
      active = false;
      cancelScheduledRefresh?.();
    };
  }, [bindings.clock, daemon.refreshRuntimeDaemonStatus, panelState.hydrated, runtimeTabActive]);

  useEffect(() => {
    if (!panelState.hydrated || !panelState.state) return;
    persistRuntimeConfigStateV11(panelState.state);
  }, [panelState.hydrated, panelState.state]);

  useEffect(() => {
    const applyNavigation = () => {
      const navigation = runtimeConfigNavigation.get();
      if (navigation.revision === 0 || !navigation.intent) return;
      const intent = navigation.intent;
      if (intent.kind === 'open-page') {
        panelState.updateState((prev) => ({
          ...prev,
          activePage: intent.page,
        }));
        return;
      }
      panelState.updateState((prev) => ({
        ...prev,
        activePage: intent.actionFocus.page,
        actionFocus: intent.actionFocus,
      }));
    };
    applyNavigation();
    return runtimeConfigNavigation.subscribe(applyNavigation);
  }, [panelState.updateState, runtimeConfigNavigation]);

  const resolveRuntimeProfile = useCallback(async (
    targetId: string,
    profileId: string,
    capability?: string,
  ) => installActions.resolveRuntimeProfile(targetId, profileId, capability), [installActions]);

  const applyRuntimeProfile = useCallback(async (
    targetId: string,
    profileId: string,
    capability?: string,
  ) => installActions.applyRuntimeProfile(targetId, profileId, capability), [installActions]);

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
    registeredRuntimePackageIds: [],
    runtimeDaemonStatus: daemon.runtimeDaemonStatus,
    runtimeDaemonBusyAction: daemon.runtimeDaemonBusyAction,
    runtimeDaemonError: daemon.runtimeDaemonError,
    runtimeDaemonUpdatedAt: daemon.runtimeDaemonUpdatedAt,
    localModelLifecycleById: installActions.localModelLifecycleById,
    localModelLifecycleErrorById: installActions.localModelLifecycleErrorById,
    setShowCloudApiKey: panelState.setShowCloudApiKey,
    setLocalModelQuery: panelState.setLocalModelQuery,
    setConnectorModelQuery: panelState.setConnectorModelQuery,
    setPageFeedback,
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
    onVaultChanged,
    onDownloadComplete: installActions.onDownloadComplete,
    retryInstall: installActions.retryInstall,
    installSessionMeta: installActions.installSessionMeta,
  };
}
