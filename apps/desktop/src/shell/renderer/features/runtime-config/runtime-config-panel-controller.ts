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
    connectorModelQuery: panelState.connectorModelQuery,
  });

  // Live refs so the command context reads the latest state/guard values at
  // call time instead of capturing them in the useMemo dependency array.
  // Keeping `commandInput` (and therefore `commands`) referentially stable
  // across state updates prevents command effects from re-subscribing on every
  // render. Assign in render body (not an effect) so reads are never stale.
  const stateRef = useRef(panelState.state);
  const checkingHealthRef = useRef(panelState.checkingHealth);
  const testingConnectorRef = useRef(panelState.testingConnector);
  const selectedConnectorRef = useRef(derived.selectedConnector);
  stateRef.current = panelState.state;
  checkingHealthRef.current = panelState.checkingHealth;
  testingConnectorRef.current = panelState.testingConnector;
  selectedConnectorRef.current = derived.selectedConnector;

  const commandInput = useMemo(() => ({
    guard: {
      get testingConnector() { return testingConnectorRef.current; },
      get checkingHealth() { return checkingHealthRef.current; },
      setTestingConnector: panelState.setTestingConnector,
      setCheckingHealth: panelState.setCheckingHealth,
    },
    provider: {
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
    runtimeConnectorSdk,
    panelState.setCheckingHealth,
    panelState.setTestingConnector,
    panelState.updateState,
  ]);

  const commands = useMemo(
    () => createRuntimeConfigPanelCommands(commandInput),
    [commandInput],
  );

  const daemon = useRuntimeConfigDaemonController({
    updateState: panelState.updateState,
    runLocalHealthCheck: commands.runLocalHealthCheck,
    setStatusBanner: setPageFeedback,
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

  const onOpenLoadouts = useCallback(() => {
    onChangePage('loadouts');
  }, [onChangePage]);

  const installActions = useRuntimeConfigInstallActions({
    setStatusBanner: setPageFeedback,
    onOpenLoadouts,
  });

  useRuntimeConfigPanelEffects({
    bootstrapReady,
    hydrated: panelState.hydrated,
    setHydrated: panelState.setHydrated,
    state: panelState.state,
    setState: panelState.setState,
    setStatusBanner: setPageFeedback,
    setVaultEntryCount: panelState.setVaultEntryCount,
    vaultVersion: panelState.vaultVersion,
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

  return {
    state: panelState.state,
    hydrated: panelState.hydrated,
    runtimeStatus: derived.runtimeStatus,
    activePage: panelState.state?.activePage || 'overview',
    showCloudApiKey: panelState.showCloudApiKey,
    connectorModelQuery: panelState.connectorModelQuery,
    vaultEntryCount: panelState.vaultEntryCount,
    testingConnector: panelState.testingConnector,
    checkingHealth: panelState.checkingHealth,
    runtimeWritesDisabled: offlineTier === 'L2',
    selectedConnector: derived.selectedConnector,
    orderedConnectors: derived.orderedConnectors,
    filteredConnectorModels: derived.filteredConnectorModels,
    registeredRuntimePackageIds: [],
    runtimeDaemonStatus: daemon.runtimeDaemonStatus,
    runtimeDaemonBusyAction: daemon.runtimeDaemonBusyAction,
    runtimeDaemonError: daemon.runtimeDaemonError,
    runtimeDaemonUpdatedAt: daemon.runtimeDaemonUpdatedAt,
    setShowCloudApiKey: panelState.setShowCloudApiKey,
    setConnectorModelQuery: panelState.setConnectorModelQuery,
    setPageFeedback,
    onChangePage,
    updateState: panelState.updateState,
    runLocalHealthCheck: commands.runLocalHealthCheck,
    testSelectedConnector: commands.testSelectedConnector,
    installCatalogLocalModel: installActions.installCatalogLocalModel,
    installResolvedModelPlan: installActions.installResolvedModelPlan,
    installCatalogModelAsset: installActions.installCatalogModelAsset,
    refreshRuntimeDaemonStatus: daemon.refreshRuntimeDaemonStatus,
    startRuntimeDaemon: daemon.startRuntimeDaemon,
    restartRuntimeDaemon: daemon.restartRuntimeDaemon,
    onVaultChanged,
  };
}
