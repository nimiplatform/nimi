import { useHomeNavigation, useHomeDestination, useHomeEntryKey } from '../../app-shell/providers/app-store.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../app-shell/providers/app-store';
import type { RuntimeConfigActionFocus, RuntimePageIdV11 } from './runtime-config-state-types';
import { homeRuntimeDestination, type HomeRuntimePosition } from '../../app-shell/providers/home-navigation.js';
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
  const homeNavigation = useHomeNavigation();
  const bindings = useDesktopRendererBindings();
  const runtimeConnectorSdk = useRuntimeConfigConnectorSdk();
  const runtimeConfigNavigation = bindings.app.commands.runtimeConfigNavigation;
  const destination = useHomeDestination();
  const entryKey = useHomeEntryKey();
  const position = destination.runtime;
  const activeTab = destination.id;
  const activePage: RuntimePageIdV11 = activeTab === 'cloud' ? 'cloudServices' : activeTab === 'diagnostics' ? 'advancedDiagnostics' : position?.page ?? 'aiSettings';
  const draftKey = (value: HomeRuntimePosition) => JSON.stringify([value.capabilityContract, value.recipeId, value.recipeRevision, value.slotId]);
  const drafts = useRef(new Map<string, RuntimeConfigLoadoutNavigationContext['draft']>());
  const marketData = useRef(new Map<string, Extract<RuntimeConfigModelMarketContext, { kind: 'slot' }>>());
  const [offeredSelection, setOfferedSelection] = useState<{ entryKey: string; offerRef: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<{ entryKey: string; action: RuntimeConfigActionFocus } | null>(null);
  const actionFocus = pendingAction?.entryKey === entryKey ? pendingAction.action : null;
  const loadoutNavigationContext = useMemo<RuntimeConfigLoadoutNavigationContext | null>(() => activePage === 'aiSettings' && position?.section === 'saved' && position.capabilityContract ? {
    capabilityContract: position.capabilityContract, recipeId: position.recipeId, recipeRevision: position.recipeRevision, slotId: position.slotId,
    draft: drafts.current.get(draftKey(position)), autoSelectOfferRef: offeredSelection?.entryKey === entryKey ? offeredSelection.offerRef : undefined,
  } : null, [activePage, position, offeredSelection, entryKey]);
  const modelMarketContext: RuntimeConfigModelMarketContext | null = activePage === 'modelLibrary' && position?.market && position.capabilityContract
    ? position.market === 'browse' ? { kind: 'browse', capabilityContract: position.capabilityContract } : marketData.current.get(position.offerRef ?? '') ?? null : null;
  const setupTaskFocus = activePage === 'aiSettings' && position?.setupTaskId ? { taskId: position.setupTaskId } : null;
  const profileUseOwner = activePage === 'aiSettings' ? position?.profileOwner ?? null : null;
  useEffect(() => {
    setOfferedSelection(previous => previous?.entryKey === entryKey ? previous : null);
    setPendingAction(previous => previous?.entryKey === entryKey ? previous : null);
  }, [entryKey]);
  const runtimeTabActive = ['runtime', 'cloud', 'diagnostics'].includes(activeTab);

  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const offlineTier = useAppStore((state) => state.offlineTier);
  const setPageFeedback = emitFeedbackToast;
  const setConnectorTestFeedback = emitFeedbackToast;

  const panelState = useRuntimeConfigPanelState();
  const derived = useRuntimeConfigPanelDerived({
    state: panelState.state,
    connectorModelQuery: panelState.connectorModelQuery,
    selectedConnectorId: activeTab === 'cloud' ? position?.connectorId : undefined,
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

  const onChangePage = useCallback((page: RuntimePageIdV11) => { void homeNavigation.push(homeRuntimeDestination(page)); }, [homeNavigation]);
  const onOpenSetupTask = useCallback((taskId: string) => { void homeNavigation.push(homeRuntimeDestination('aiSettings', { setupTaskId: taskId })); }, [homeNavigation]);
  const onCloseSetupTask = useCallback(() => { void homeNavigation.push(homeRuntimeDestination('aiSettings', { capabilityContract: position?.capabilityContract })); }, [homeNavigation, position]);
  const onOpenSavedConfigs = useCallback((context?: RuntimeConfigLoadoutNavigationContext) => {
    const refs: HomeRuntimePosition = { section: 'saved', capabilityContract: context?.capabilityContract, recipeId: context?.recipeId, recipeRevision: context?.recipeRevision, slotId: context?.slotId };
    if (context?.draft) drafts.current.set(draftKey(refs), context.draft);
    void homeNavigation.push(homeRuntimeDestination('aiSettings', refs));
    if (context?.autoSelectOfferRef) setOfferedSelection({ entryKey: homeNavigation.getSnapshot().current.key, offerRef: context.autoSelectOfferRef });
  }, [homeNavigation]);
  const onOpenModelMarket = useCallback((context: RuntimeConfigModelMarketContext) => {
    if (context.kind === 'slot') {
      marketData.current.set(context.candidate.offerRef, context);
      drafts.current.set(draftKey(context), context.draft);
    }
    void homeNavigation.push(homeRuntimeDestination('modelLibrary', context.kind === 'browse'
      ? { market: 'browse', capabilityContract: context.capabilityContract }
      : { market: 'slot', capabilityContract: context.capabilityContract, recipeId: context.recipeId, recipeRevision: context.recipeRevision, slotId: context.slotId, offerRef: context.candidate.offerRef }));
  }, [homeNavigation]);
  const onOpenModelImport = useCallback(() => runtimeConfigNavigation.focusAction({ page: 'modelLibrary', action: 'import-model-files', focus: 'runtime-config-action-focus.model-library-import' }), [runtimeConfigNavigation]);
  const onOpenModelFiles = useCallback(() => { void homeNavigation.push(homeRuntimeDestination('modelLibrary', { section: 'downloaded' })); }, [homeNavigation]);
  const onReturnToContextualLoadout = useCallback(() => {
    if (modelMarketContext?.kind === 'browse') { void homeNavigation.push(homeRuntimeDestination('aiSettings', { capabilityContract: modelMarketContext.capabilityContract })); return; }
    onOpenSavedConfigs(modelMarketContext ? { capabilityContract: modelMarketContext.capabilityContract, recipeId: modelMarketContext.recipeId,
      recipeRevision: modelMarketContext.recipeRevision, slotId: modelMarketContext.slotId, draft: modelMarketContext.draft, autoSelectOfferRef: modelMarketContext.candidate.offerRef } : undefined);
  }, [homeNavigation, modelMarketContext, onOpenSavedConfigs]);
  const onOpenProfileUseForOwner = useCallback((owner: RuntimeConfigProfileUseOwner) => runtimeConfigNavigation.openProfileUse(owner), [runtimeConfigNavigation]);
  const onCloseProfileUseOwner = useCallback(() => onChangePage('aiSettings'), [onChangePage]);
  const onCloseSavedConfigs = useCallback(() => { void homeNavigation.push(homeRuntimeDestination('aiSettings', { capabilityContract: position?.capabilityContract })); }, [homeNavigation, position]);
  const clearActionFocus = useCallback(() => setPendingAction(null), []);

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
    const consume = () => {
      const action = runtimeConfigNavigation.takeAction();
      if (action) setPendingAction({ action, entryKey: homeNavigation.getSnapshot().current.key });
    };
    consume(); return runtimeConfigNavigation.subscribe(consume);
  }, [runtimeConfigNavigation, homeNavigation]);

  return {
    state: panelState.state,
    hydrated: panelState.hydrated,
    runtimeStatus: derived.runtimeStatus,
    activePage,
    actionFocus,
    clearActionFocus,
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
    setShowCloudApiKey: panelState.setShowCloudApiKey,
    setConnectorModelQuery: panelState.setConnectorModelQuery,
    setPageFeedback,
    onChangePage,
    onOpenSavedConfigs,
    onOpenModelMarket,
    onOpenModelImport,
    onOpenModelFiles,
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
