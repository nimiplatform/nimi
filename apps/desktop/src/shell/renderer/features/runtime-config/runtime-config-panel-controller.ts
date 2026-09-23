import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../app-shell/providers/app-store';
import type { RuntimeAdvancedDiagnosticsPane, RuntimePageIdV11 } from './runtime-config-state-types';
import { persistRuntimeConfigStateV11 } from './runtime-config-storage-persist';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useRuntimeConfigPanelEffects } from './runtime-config-panel-effects';
import type {
  RuntimeConfigLoadoutNavigationContext,
  RuntimeConfigModelMarketContext,
  RuntimeConfigPanelControllerModel,
  RuntimeConfigProfileUseOwner,
} from './runtime-config-panel-types';
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
  const [loadoutNavigationContext, setLoadoutNavigationContext] = useState<RuntimeConfigLoadoutNavigationContext | null>(null);
  const [modelMarketContext, setModelMarketContext] = useState<RuntimeConfigModelMarketContext | null>(null);
  const [setupTaskFocus, setSetupTaskFocus] = useState<{ readonly taskId: string } | null>(null);
  const [profileUseOwner, setProfileUseOwner] = useState<RuntimeConfigProfileUseOwner | null>(null);
  const [advancedDiagnosticsPaneRequest, setAdvancedDiagnosticsPaneRequest] = useState<{ readonly pane: RuntimeAdvancedDiagnosticsPane; readonly revision: number } | null>(null);
  const bindings = useDesktopRendererBindings();
  const runtimeConnectorSdk = useRuntimeConfigConnectorSdk();
  const runtimeConfigNavigation = bindings.app.commands.runtimeConfigNavigation;
  const activeTab = useAppStore((state) => state.activeTab);
  const runtimeTabActive = ['runtime', 'cloud', 'diagnostics'].includes(activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const [navigationRevision, setNavigationRevision] = useState(0);
  const navigationSeen = useRef(0);
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
      setActiveTab(
        pageId === 'cloudServices' ? 'cloud' : pageId === 'advancedDiagnostics' ? 'diagnostics' : 'runtime',
      );
      setLoadoutNavigationContext(null);
      setModelMarketContext(null);
      setSetupTaskFocus(null);
      setProfileUseOwner(null);
    panelState.updateState((prev) => ({
      ...prev,
      activePage: pageId,
    }));
  }, [panelState.updateState, setActiveTab],
  );

  const onOpenSetupTask = useCallback((taskId: string) => {
    setLoadoutNavigationContext(null);
    setModelMarketContext(null);
    setSetupTaskFocus({ taskId });
    panelState.updateState((previous) => ({ ...previous, activePage: 'aiSettings', actionFocus: null }));
  }, [panelState.updateState]);

  const onCloseSetupTask = useCallback(() => {
    setSetupTaskFocus(null);
  }, []);

  // Saved configurations live inside AI Settings; the action focus carries
  // deep links across page switches (the view consumes and clears it).
  const onOpenSavedConfigs = useCallback((context?: RuntimeConfigLoadoutNavigationContext) => {
    setLoadoutNavigationContext(context ?? null);
    setModelMarketContext(null);
    setSetupTaskFocus(null);
    setProfileUseOwner(null);
    panelState.updateState((previous) => ({
      ...previous,
      activePage: 'aiSettings',
      actionFocus: {
        page: 'aiSettings',
        action: 'open-saved-configs',
        focus: 'runtime-config-action-focus.saved-configs',
      },
    }));
  }, [panelState.updateState]);

  const onOpenModelMarket = useCallback((context: RuntimeConfigModelMarketContext) => {
    setModelMarketContext(context);
    panelState.updateState((previous) => ({ ...previous, activePage: 'modelLibrary', actionFocus: null }));
  }, [panelState.updateState]);

  // "Import model files" is a local-files intent, not discovery: the library
  // lands on the downloaded files and opens the import menu (the view consumes
  // and clears the focus).
  const onOpenModelImport = useCallback(() => {
    setModelMarketContext(null);
    panelState.updateState((previous) => ({
      ...previous,
      activePage: 'modelLibrary',
      actionFocus: {
        page: 'modelLibrary',
        action: 'import-model-files',
        focus: 'runtime-config-action-focus.model-library-import',
      },
    }));
  }, [panelState.updateState]);

  const onReturnToContextualLoadout = useCallback(() => {
    const context = modelMarketContext;
    setModelMarketContext(null);
    if (context?.kind === 'browse') {
      setLoadoutNavigationContext({ capabilityContract: context.capabilityContract });
      setSetupTaskFocus(null);
      panelState.updateState((previous) => ({ ...previous, activePage: 'aiSettings', actionFocus: null }));
      return;
    }
    onOpenSavedConfigs(context ? {
      capabilityContract: context.capabilityContract,
      recipeId: context.recipeId,
      recipeRevision: context.recipeRevision,
      slotId: context.slotId,
      draft: context.draft,
      autoSelectOfferRef: context.candidate.offerRef,
    } : undefined);
  }, [modelMarketContext, onOpenSavedConfigs, panelState.updateState]);

  const onOpenProfileUseForOwner = useCallback((owner: RuntimeConfigProfileUseOwner) => {
    setLoadoutNavigationContext(null);
    setModelMarketContext(null);
    setSetupTaskFocus(null);
    setProfileUseOwner(owner);
    panelState.updateState((previous) => ({ ...previous, activePage: 'aiSettings', actionFocus: null }));
  }, [panelState.updateState]);

  const onCloseProfileUseOwner = useCallback(() => {
    setProfileUseOwner(null);
  }, []);

  const onCloseSavedConfigs = useCallback(() => {
    setLoadoutNavigationContext(null);
  }, []);

  const installActions = useRuntimeConfigInstallActions({
    setStatusBanner: setPageFeedback,
    onOpenSavedConfigs: () => onOpenSavedConfigs(),
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
    if (!panelState.hydrated) return;
    const navigation = runtimeConfigNavigation.get();
    if (!navigation.intent || navigation.revision === navigationSeen.current) {
      panelState.updateState((prev) => {
        const page =
          activeTab === 'cloud'
            ? 'cloudServices'
            : activeTab === 'diagnostics'
              ? 'advancedDiagnostics'
              : activeTab === 'runtime'
                ? prev.activePage === 'modelLibrary'
                  ? 'modelLibrary'
                  : 'aiSettings'
                : null;
        return !page || prev.activePage === page ? prev : { ...prev, activePage: page };
      });
      return;
    }
    navigationSeen.current = navigation.revision;
    const applyNavigation = () => {
      const navigation = runtimeConfigNavigation.get();
      if (navigation.revision === 0 || !navigation.intent) return;
      const intent = navigation.intent;
      setLoadoutNavigationContext(null);
      setModelMarketContext(null);
      setProfileUseOwner(null);
      const targetPage =
        intent.kind === 'open-page'
          ? intent.page
          : intent.kind === 'focus-action'
            ? intent.actionFocus.page
            : 'aiSettings';
      setActiveTab(
        targetPage === 'cloudServices'
          ? 'cloud'
          : targetPage === 'advancedDiagnostics'
            ? 'diagnostics'
            : 'runtime',
      );
      if (intent.kind === 'open-page') {
        setSetupTaskFocus(null);
        if (intent.pane) setAdvancedDiagnosticsPaneRequest({ pane: intent.pane, revision: navigation.revision });
        panelState.updateState((prev) => ({
          ...prev,
          activePage: intent.page,
        }));
        return;
      }
      if (intent.kind === 'open-setup-task') {
        setSetupTaskFocus({ taskId: intent.taskId });
        panelState.updateState((prev) => ({
          ...prev,
          activePage: 'aiSettings',
          actionFocus: null,
        }));
        return;
      }
      if (intent.kind === 'open-profile-use') {
        setSetupTaskFocus(null);
        setProfileUseOwner(intent.owner);
        panelState.updateState((prev) => ({
          ...prev,
          activePage: 'aiSettings',
          actionFocus: null,
        }));
        return;
      }
      if (intent.kind === 'open-capability') {
        setSetupTaskFocus(null);
        setLoadoutNavigationContext({ capabilityContract: intent.capabilityContract });
        panelState.updateState(prev => ({ ...prev, activePage: 'aiSettings', actionFocus: null }));
        return;
      }
      setSetupTaskFocus(null);
      panelState.updateState((prev) => ({
        ...prev,
        activePage: intent.actionFocus.page,
        actionFocus: intent.actionFocus,
      }));
    };
    applyNavigation();
  }, [panelState.updateState,
    panelState.hydrated,
    activeTab,
    runtimeConfigNavigation,
    navigationRevision,
    setActiveTab,
  ]);

  useEffect(
    () =>
      runtimeConfigNavigation.subscribe(() => setNavigationRevision(runtimeConfigNavigation.get().revision)),
    [runtimeConfigNavigation],
  );

  return {
    state: panelState.state,
    hydrated: panelState.hydrated,
    runtimeStatus: derived.runtimeStatus,
    activePage: panelState.state?.activePage || 'aiSettings',
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
    loadoutNavigationContext,
    modelMarketContext,
    setupTaskFocus,
    profileUseOwner,
    advancedDiagnosticsPaneRequest,
    setShowCloudApiKey: panelState.setShowCloudApiKey,
    setConnectorModelQuery: panelState.setConnectorModelQuery,
    setPageFeedback,
    onChangePage,
    onOpenSavedConfigs,
    onOpenModelMarket,
    onOpenModelImport,
    onOpenSetupTask,
    onCloseSetupTask,
    onReturnToContextualLoadout,
    onOpenProfileUseForOwner,
    onCloseProfileUseOwner,
    onCloseSavedConfigs,
    updateState: panelState.updateState,
    runLocalHealthCheck: commands.runLocalHealthCheck,
    testSelectedConnector: commands.testSelectedConnector,
    installResolvedModelPlan: installActions.installResolvedModelPlan,
    installConfirmation: installActions.installConfirmation,
    resolveInstallConfirmation: installActions.resolveInstallConfirmation,
    refreshRuntimeDaemonStatus: daemon.refreshRuntimeDaemonStatus,
    startRuntimeDaemon: daemon.startRuntimeDaemon,
    restartRuntimeDaemon: daemon.restartRuntimeDaemon,
    onVaultChanged,
  };
}
