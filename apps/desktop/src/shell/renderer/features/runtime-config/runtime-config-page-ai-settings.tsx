import { useHomeNavigation, useHomeDestination, useHomeEntryKey } from '../../app-shell/providers/app-store.js';
import { capabilityIcon, Button, InlineAlert, ScrollArea, Surface, Tooltip } from '@nimiplatform/kit/ui';
import { DesktopModuleSidebar } from '../../components/desktop-module-sidebar.js';
import type { NimiMachineLoadout } from '@nimiplatform/sdk/runtime';
import { CircleDashed, FolderOpen, LayoutGrid, LoaderCircle, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';
import { RuntimeCapabilityApps, useCapabilityAppsColumn } from './runtime-capability-apps.js';
import { RuntimeCapabilityDetail } from './runtime-capability-detail.js';
import { resetRuntimePageViewport } from './runtime-config-page-shell.js';
import { type CapabilityPreparationState, capabilityPreparationState, useCapabilityInventory } from './runtime-capability-inventory.js';
import { capabilityModelIdentity, capabilityRecommendedFilesOnDevice, capabilityRecommendedRecipeOnDevice, groupCapabilities, setupPlanAllowsDirectUse, setupTaskModelTitle } from './runtime-capability-presentation.js';
import { RuntimeConfigAiSettingsProfilesSection } from './runtime-config-ai-settings-profiles.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { useRuntimeEnvironmentObservation } from './runtime-environment-observation.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import type { RuntimeConfigLoadoutNavigationContext, RuntimeConfigModelMarketContext, RuntimeConfigProfileUseOwner } from './runtime-config-panel-types.js';
import { RuntimeConfigSetupTaskView } from './runtime-config-setup-task-view.js';
import type { RuntimeConfigActionFocus } from './runtime-config-state-types.js';
import { homeRuntimeDestination, type HomeRuntimePosition } from '../../app-shell/providers/home-navigation.js';
import { RuntimeLocalModelListSection } from './runtime-local-model-list-section.js';
import type { LocalModelConfiguration } from './runtime-local-model-list.js';
import { SavedConfigsView } from './runtime-config-page-loadouts.js';
import { RuntimeProfileTaskView } from './runtime-profile-task-view.js';
import { RuntimeSetupFailureMessage, runtimeSetupFailureText, type RuntimeSetupFailureNotice } from './runtime-setup-failure-message.js';
import { resolveRuntimeSetupReturnTarget, returnFromRuntimeSetup } from './runtime-setup-task-open.js';
import { createRuntimeSetupTaskRunnerPorts, currentDesktopAccountIdForSetup } from './runtime-setup-task-ports.js';
import { createRuntimeSetupCandidate, resolveRuntimeSetupPreparation, runRuntimeSetupPreparation } from './runtime-setup-task-runner.js';
import { getRuntimeSetupTaskStore, type RuntimeSetupTaskDraft } from './runtime-setup-task-store.js';
import { useRuntimeModelLibrary } from './use-runtime-model-library.js';

export type AiSettingsPageProps = {
  readonly advancedDiagnostics?: { readonly content: ReactNode; readonly onClose: () => void };
  readonly modelFiles?: ReactNode;
  readonly runtimeWritesDisabled: boolean;
  readonly focusedTaskId: string | null;
  readonly actionFocus: RuntimeConfigActionFocus | null;
  readonly savedConfigsContext: RuntimeConfigLoadoutNavigationContext | null;
  readonly profileUseOwner: RuntimeConfigProfileUseOwner | null;
  readonly onOpenSetupTask: (taskId: string) => void;
  readonly onCloseSetupTask: () => void;
  readonly onOpenModelFiles?: () => void;
  readonly onOpenModelImport?: () => void;
  readonly onOpenSavedConfigs: (context?: RuntimeConfigLoadoutNavigationContext) => void;
  readonly onOpenModelMarket: (context: RuntimeConfigModelMarketContext) => void;
  readonly onOpenAdvancedDiagnostics: () => void;
  readonly onOpenCloudServices: () => void;
  readonly onClearActionFocus: () => void;
  readonly onCloseProfileUseOwner: () => void;
  readonly onCloseSavedConfigs: () => void;
};

// Each rail row names the capability above one status mark and model, never
// a badge. Prepared is a success dot with its default model
// name beside it (selection, never a running claim); preparing is an info dot
// with a spinning mark; needs attention is a warning dot with visible status;
// not set up shows a hollow ring and text only when recommended files are
// on the device; otherwise its row keeps just the name and accessible state.
// Unknown is a dashed ring with its text. Every mark carries its
// state text, and for attention its reason, as hover and accessible label.
export function RailStatusMark(props: {
  readonly state: CapabilityPreparationState;
  readonly label: string;
  readonly preparingReplacement?: boolean;
}) {
  const dot = (color: string) => <span className={`inline-flex h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden="true" />;
  return (
    <span role="img" aria-label={props.label} data-rail-state={props.state} className="inline-flex shrink-0 items-center gap-1">
      {props.state === 'ready' ? dot('bg-[var(--nimi-status-success)]') : null}
      {props.state === 'ready' && props.preparingReplacement ? <LoaderCircle size={11} className="shrink-0 animate-spin text-[var(--nimi-status-info)]" aria-hidden="true" /> : null}
      {props.state === 'preparing' ? <>{dot('bg-[var(--nimi-status-info)]')}<LoaderCircle size={11} className="shrink-0 animate-spin text-[var(--nimi-status-info)]" aria-hidden="true" /></> : null}
      {props.state === 'attention' ? dot('bg-[var(--nimi-status-warning)]') : null}
      {props.state === 'unknown' ? <CircleDashed size={10} className="shrink-0 text-[var(--nimi-text-muted)]" aria-hidden="true" /> : null}
      {props.state === 'unset' ? <span className="inline-flex h-2 w-2 shrink-0 rounded-full border border-current opacity-60" aria-hidden="true" /> : null}
    </span>
  );
}

// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace
export function AiSettingsPage(props: AiSettingsPageProps) {
  const navigation = useHomeNavigation();
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();

  const destination = useHomeDestination();
  const position = destination.runtime;
  const modelFilesActive = props.modelFiles != null;
  const inventoryEnabled = destination.id === 'diagnostics'
    || destination.id === 'runtime' && ((position?.page ?? 'aiSettings') === 'aiSettings' || modelFilesActive);
  const store = getRuntimeSetupTaskStore();
  const localEnvironment = useRuntimeConfigLocalEnvironmentClient();
  const ports = useMemo(() => createRuntimeSetupTaskRunnerPorts(sdk, localEnvironment), [sdk, localEnvironment]);
  const entryKey = useHomeEntryKey();
  const capability = position?.capabilityContract ?? null;
  const section = position?.section ?? 'models';
  const modelConfiguration = position?.loadoutId && capability ? { loadoutId: position.loadoutId, capability } : null;
  const openSection = (value: string) => { void navigation.push(homeRuntimeDestination('aiSettings', { ...position, section: value as HomeRuntimePosition['section'] })); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RuntimeSetupFailureNotice | null>(null);
  const [homeRevision, setHomeRevision] = useState(0);
  const focusedTask = props.focusedTaskId ? store.getTask(props.focusedTaskId) : undefined;
  const focusedReturnTarget = resolveRuntimeSetupReturnTarget(focusedTask?.source.returnFocus);
  const cloudEntryTask = focusedReturnTarget?.kind === 'destination' && focusedReturnTarget.destination.id === 'cloud';
  const activeNavigationItem = props.advancedDiagnostics ? 'advancedDiagnostics'
    : modelFilesActive ? 'modelLibrary' : focusedTask?.capabilityContract ?? capability;
  const toolActive = activeNavigationItem === 'advancedDiagnostics' || activeNavigationItem === 'modelLibrary';
  const visibleCapability = toolActive ? null : activeNavigationItem;
  const inventory = useCapabilityInventory({
    enabled: inventoryEnabled,
    includePreparation: inventoryEnabled && !visibleCapability && !toolActive,
  });
  const library = useRuntimeModelLibrary(inventoryEnabled && !toolActive);
  const contentViewportRef = useRef<HTMLDivElement>(null);
  const diagnosticsActive = !!props.advancedDiagnostics;
  useEffect(() => {
    resetRuntimePageViewport(contentViewportRef.current);
  }, [diagnosticsActive, modelFilesActive, visibleCapability, section, props.focusedTaskId, modelConfiguration?.loadoutId, position?.profileViewId, position?.profileTaskDetailId]);
  const appsColumn = useCapabilityAppsColumn(visibleCapability);
  const label = (id: string) => displayRuntimeConfigCapabilityLabel(id, t);

  const selection = inventory.data?.aggregate.selections.find(
    (item) => item.capabilityContract === visibleCapability,
  );
  const selected = inventory.data?.aggregate.loadouts.find((item) => item.loadoutId === selection?.loadoutId);
  const configurationEnvironment = useRuntimeEnvironmentObservation(
    inventoryEnabled && inventory.fetchStatus === 'idle' && visibleCapability && selected && !modelConfiguration
      ? { capabilityContract: visibleCapability, candidateLoadoutId: selected.loadoutId }
      : null,
    false,
    `${selected?.revision ?? ''}|${inventory.dataUpdatedAt}`,
    selected?.revision ?? '',
  );
  const environment = configurationEnvironment.data?.plan
    ?? (inventory.fetchStatus === 'idle' && !configurationEnvironment.error && !configurationEnvironment.checking && visibleCapability ? inventory.data?.environments[visibleCapability] : undefined);
  const observedInventory = useMemo(() => inventory.data && visibleCapability && selected && !modelConfiguration
    ? { ...inventory.data, environments: { ...inventory.data.environments, [visibleCapability]: environment } }
    : inventory.data,
  [inventory.data, visibleCapability, selected, modelConfiguration, environment]);

  const railEntries = useMemo(
    () => inventory.capabilities.map((id) => {
      const state = capabilityPreparationState({
        capability: id,
        inventory: observedInventory,
        tasks: inventory.tasks,
        unavailable: inventory.isError,
      });
      const itemSelection = inventory.data?.aggregate.selections.find((item) => item.capabilityContract === id);
      const itemSelected = inventory.data?.aggregate.loadouts.find((item) => item.loadoutId === itemSelection?.loadoutId);
      const identity = capabilityModelIdentity(itemSelected, inventory.data?.recipes ?? []);
      // Files on device are a reading aid for unset capabilities, never readiness.
      const downloaded = state.state === 'unset' && capabilityRecommendedFilesOnDevice(id, inventory.data?.recipes ?? []);
      const taskModel = state.replacement && state.task
        ? setupTaskModelTitle(state.task, inventory.data?.aggregate.loadouts ?? [], inventory.data?.recipes ?? [])
        : '';
      return { id, state, model: identity.shortTitle, taskModel, downloaded };
    }),
    [inventory.capabilities, observedInventory, inventory.tasks, inventory.isError],
  );
  const railStateLabel = (entry: { state: { state: CapabilityPreparationState }; downloaded: boolean }) =>
    t(entry.downloaded && entry.state.state === 'unset'
      ? 'runtimeConfig.capabilities.state.downloaded'
      : `runtimeConfig.capabilities.state.${entry.state.state}`);

  const recipes = inventory.data?.recipes.filter((item) => item.capabilityContract === visibleCapability) ?? [];
  const status = visibleCapability
    ? capabilityPreparationState({ capability: visibleCapability, inventory: observedInventory, tasks: inventory.tasks, unavailable: inventory.isError })
    : null;
  const inlineTask = focusedTask?.source.kind === 'runtime' && !focusedTask.draft?.profileUseId ? focusedTask : undefined;
  const openSetupTask = (taskId: string) => {
    props.onOpenSetupTask(taskId);
  };
  const taskModel = status?.task ? setupTaskModelTitle(status.task, inventory.data?.aggregate.loadouts ?? [], recipes) : '';
  // Every saved configuration keeps its own identity and settings entry.
  const saved = inventory.data?.aggregate.loadouts.filter(
    item => item.capabilityContract === visibleCapability && item.validationState === 'configured',
  ) ?? [];
  // Files on this device are a preparation hint, never a readiness claim.
  const downloadedRecipe =
    visibleCapability && status?.state === 'unset'
      ? capabilityRecommendedRecipeOnDevice(visibleCapability, recipes)
      : null;
  const createSetupTask = async (targetCapability = visibleCapability) => {
    const owner = props.profileUseOwner;
    return store.createTask({
      capabilityContract: targetCapability!,
      source: {
        ...(owner ?? { kind: 'runtime' as const }),
        accountId: await currentDesktopAccountIdForSetup(),
        returnFocus: owner?.returnFocus ?? 'runtime.aiSettings',
      },
    });
  };
  // The setup task view shows the failure its task recorded, so the page
  // notice only carries a failure the opened task cannot show.
  const noticeUnlessShownByTask = (taskId: string, failure: RuntimeSetupFailureNotice) => {
    if (!store.getTask(taskId)?.failure) setError(failure);
  };
  const onStart = async (recipeId?: string, previous?: NimiMachineLoadout, targetCapability = visibleCapability) => {
    if (!targetCapability) return;
    setBusy(true);
    setError(null);
    try {
      const task = await createSetupTask(targetCapability);
      if (recipeId) {
        const result = await createRuntimeSetupCandidate(store, task.taskId, ports, {
          recipeId,
          ...(previous
            ? { axes: previous.modelAxes, options: previous.options, displayName: previous.displayName }
            : {}),
        });
        if (result.status !== 'ok') noticeUnlessShownByTask(task.taskId, result.failure);
        else await resolveRuntimeSetupPreparation(store, task.taskId, ports);
      }
      openSetupTask(task.taskId);
    } catch (caught) {
      setError({ message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(false);
    }
  };
  // Enabling and changing a model use the same task pipeline as "select".
  // A saved choice keeps its exact axes and options; the review is skipped only
  // when the resolved plan has nothing to download, install or choose; any
  // other outcome (missing components, a choice, a failure) opens the task so
  // the person sees the same review or failure they would have seen before.
  const onEnable = async (recipeId: string, previous?: NimiMachineLoadout) => {
    if (!visibleCapability) return;
    setBusy(true);
    setError(null);
    try {
      const task = await createSetupTask();
      const created = await createRuntimeSetupCandidate(store, task.taskId, ports, {
        recipeId,
        ...(previous ? { axes: previous.modelAxes, options: previous.options, displayName: previous.displayName } : {}),
      });
      if (created.status !== 'ok') {
        noticeUnlessShownByTask(task.taskId, created.failure);
        openSetupTask(task.taskId);
        return;
      }
      const resolved = await resolveRuntimeSetupPreparation(store, task.taskId, ports);
      if (resolved.status !== 'ok' || !setupPlanAllowsDirectUse(resolved.value, store.getTask(task.taskId)?.draft?.options)) {
        openSetupTask(task.taskId);
        return;
      }
      const used = await runRuntimeSetupPreparation(store, task.taskId, ports, {
        mode: 'prepare-and-use',
        reviewedPlan: resolved.value,
        choices: {},
      });
      // Read the actual selection even when a later consumer save fails.
      await inventory.refetch();
      if (used.status !== 'ok') {
        openSetupTask(task.taskId);
        return;
      }
      emitFeedbackToast({ kind: 'success', message: t('runtimeConfig.product.modelPicker.selected') });
    } catch (caught) {
      setError({ message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(false);
    }
  };
  // A recipe with no downloadable offer starts as a draft with that recipe
  // chosen, so files already on this device are picked in Advanced settings
  // choices and validated by Runtime; no candidate is saved beforehand.
  const onChooseImportedFiles = async (recipeId: string) => {
    if (!visibleCapability) return;
    setBusy(true);
    setError(null);
    try {
      const task = await createSetupTask();
      store.updateTask(task.taskId, (current) => ({ draft: { ...(current.draft ?? {}), route: 'local', recipeId } }));
      openSetupTask(task.taskId);
    } catch (caught) {
      setError({ message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(false);
    }
  };
  const onApplyCustomization = async (draft: RuntimeSetupTaskDraft, previous?: NimiMachineLoadout) => {
    if (!visibleCapability || busy || props.runtimeWritesDisabled) throw new Error(t('runtimeConfig.product.settings.applyUnavailable'));
    const recipe = recipes.find(item => item.recipeId === draft.recipeId);
    if (!recipe || (previous && (previous.recipeId !== recipe.recipeId || previous.capabilityContract !== visibleCapability))) {
      throw new Error(t('runtimeConfig.product.customization.unavailable'));
    }
    setBusy(true);
    setError(null);
    try {
      const task = await createSetupTask();
      store.updateTask(task.taskId, () => ({ draft }));
      const created = await createRuntimeSetupCandidate(store, task.taskId, ports, {
        recipeId: recipe.recipeId,
        displayName: previous?.displayName,
        axes: draft.axes,
        options: draft.options,
      });
      if (created.status !== 'ok') throw new Error(runtimeSetupFailureText(created.failure, t));
      const resolved = await resolveRuntimeSetupPreparation(store, task.taskId, ports);
      if (resolved.status !== 'ok') throw new Error(runtimeSetupFailureText(resolved.failure, t));
      if (!setupPlanAllowsDirectUse(resolved.value, store.getTask(task.taskId)?.draft?.options)) {
        openSetupTask(task.taskId);
        return;
      }
      const used = await runRuntimeSetupPreparation(store, task.taskId, ports, {
        mode: 'prepare-and-use', reviewedPlan: resolved.value, choices: draft.preferredOffers ?? {},
      });
      await inventory.refetch();
      if (used.status !== 'ok') {
        openSetupTask(task.taskId);
        return;
      }
      emitFeedbackToast({ kind: 'success', message: t('runtimeConfig.product.customization.applied') });
    } finally {
      setBusy(false);
    }
  };
  const onHome = () => {
    void navigation.push(homeRuntimeDestination('aiSettings'));
    setError(null); setHomeRevision(value => value + 1); void inventory.refetch();
  };
  const onRetryOverview = () => {
    void inventory.refetch();
    void library.refetch();
  };
  const openCapability = (id: string) => {
    const pending = capabilityPreparationState({ capability: id, inventory: inventory.data, tasks: inventory.tasks, unavailable: inventory.isError }).task;
    void navigation.push(homeRuntimeDestination('aiSettings', { capabilityContract: id,
      ...(pending?.source.kind === 'runtime' && !pending.draft?.profileUseId ? { setupTaskId: pending.taskId } : {}) }));
    setError(null);
  };
  const openModelConfiguration = (configuration: LocalModelConfiguration) => {
    void navigation.push(homeRuntimeDestination('aiSettings', { capabilityContract: configuration.capability, loadoutId: configuration.loadoutId }));
    setError(null);
  };
  const onReturnToSource = () => {
    const target = resolveRuntimeSetupReturnTarget(focusedTask?.source.returnFocus);
    setError(null);
    if (target?.kind === 'destination') {
      void returnFromRuntimeSetup(navigation, target.destination)
        .catch(error => setError({ message: error instanceof Error ? error.message : String(error) }));
    } else if (target?.kind === 'tab' && target.tab === 'apps' && focusedTask?.source.ownerAppId) {
      void navigation.push({ id: 'apps', appId: focusedTask.source.ownerAppId });
    } else if (target?.kind === 'tab') void navigation.push({ id: target.tab });
    else void navigation.push(homeRuntimeDestination('aiSettings'));
    void inventory.refetch();
  };

  return (
    <div
      className="desktop-module-workspace"
      data-testid="ai-capabilities-workspace"
    >
      {!cloudEntryTask ? <DesktopModuleSidebar
        label={t('runtimeConfig.capabilities.title')}
        selectionKey={entryKey}
      >
        <button
          type="button"
          onClick={onHome}
          className="desktop-sidebar__header flex min-w-0 items-center text-left"
          data-testid="ai-capabilities-home"
        >
          <span className="desktop-sidebar__title min-w-0 truncate font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.capabilities.title')}
          </span>
        </button>
        <ScrollArea
          className="min-h-0 flex-1"
          viewportClassName="[&>div]:!block"
          contentClassName="desktop-sidebar__body desktop-sidebar__groups min-w-0"
        >
          <div className="desktop-sidebar__items">
            <button
              type="button"
              aria-current={activeNavigationItem === null ? 'page' : undefined}
              className="desktop-sidebar__row flex w-full items-center text-left"
              data-active={activeNavigationItem === null}
              onClick={onHome}
              data-testid="ai-capabilities-overview"
            >
              <LayoutGrid
                size={16}
                className={`shrink-0 ${activeNavigationItem === null ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-muted)]'}`}
                aria-hidden="true"
              />
              <span className="desktop-sidebar__label min-w-0 flex-1 truncate text-[var(--nimi-text-primary)]">
                {t('runtimeConfig.product.setupsTitle')}
              </span>
            </button>
          </div>
          {groupCapabilities(railEntries.map((entry) => entry.id)).map(({ group, items }) => (
            <div key={group}>
              <p className="desktop-sidebar__section-label">
                {t(`runtimeConfig.capabilities.group.${group}`)}
              </p>
              <div className="desktop-sidebar__items">
                {items.map((id) => {
                  const entry = railEntries.find((item) => item.id === id)!;
                  const Icon = capabilityIcon(id);
                  const state = entry.state.state;
                  const preparingReplacement = entry.state.replacement && (
                    entry.state.task?.status === 'preparing' || entry.state.task?.status === 'committing'
                  );
                  const stateText = state === 'ready' && entry.model ? entry.model : railStateLabel(entry);
                  const stateSuffix =
                    entry.state.replacement && entry.state.task
                      ? ` · ${t('runtimeConfig.quickStart.otherConfiguration')} · ${t(`runtimeConfig.setupTask.status.${entry.state.task.status}`)}`
                      : '';
                  const reason = state === 'attention' && entry.state.reason
                    ? ` · ${t(`runtimeConfig.capabilities.attentionReason.${entry.state.reason}`)}`
                    : '';
                  const markLabel = `${state === 'ready' ? railStateLabel(entry) : stateText}${reason}${stateSuffix}`;
                  const hasStatusDetails = state !== 'unset' || entry.downloaded;
                  return (
                    <Tooltip
                      key={id}
                      content={hasStatusDetails ? (state === 'ready' ? `${stateText} · ${markLabel}` : markLabel) : markLabel}
                      placement="right"
                    >
                      <button
                        type="button"
                        aria-current={activeNavigationItem === id ? 'page' : undefined}
                        className="desktop-sidebar__row flex w-full items-center text-left"
                        data-active={activeNavigationItem === id}
                        onClick={() => openCapability(id)}
                        data-testid={`ai-capability:${id}`}
                      >
                        <Icon
                          size={16}
                          className={`shrink-0 ${state === 'unset' ? 'text-[var(--nimi-text-muted)]' : 'text-[var(--nimi-text-secondary)]'}`}
                          aria-hidden="true"
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="desktop-sidebar__label block text-[var(--nimi-text-primary)]">
                            {label(id)}
                          </span>
                          {hasStatusDetails ? (
                            <span className={`flex min-h-4 min-w-0 items-center gap-1.5 text-xs ${state === 'ready' ? 'text-[var(--nimi-text-secondary)]' : 'text-[var(--nimi-text-muted)]'}`}>
                              <RailStatusMark state={state} label={markLabel} preparingReplacement={preparingReplacement} />
                              <span className="min-w-0 truncate">
                                {stateText}
                              </span>
                            </span>
                          ) : (
                            <span className="sr-only">{markLabel}</span>
                          )}
                        </span>
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          ))}
          {inventory.isPending ? <p className="px-3 text-sm">{t('Common.loading')}</p> : null}
        </ScrollArea>
        <div className="desktop-sidebar__footer border-t border-[var(--nimi-border-subtle)]">
          <button
            type="button"
            className="desktop-sidebar__row flex w-full min-w-0 items-center text-left"
            data-active={activeNavigationItem === 'modelLibrary'}
            aria-current={activeNavigationItem === 'modelLibrary' ? 'page' : undefined}
            data-testid="ai-capabilities-model-files"
            onClick={props.onOpenModelFiles}
          >
            <FolderOpen size={16} className="shrink-0 text-[var(--nimi-text-muted)]" aria-hidden="true" />
            <span className="desktop-sidebar__label min-w-0 flex-1 truncate text-[var(--nimi-text-primary)]">{t('runtimeConfig.capabilities.manageFiles')}</span>
          </button>
          <button
            type="button"
            className="desktop-sidebar__row flex w-full min-w-0 items-center text-left"
            data-active={activeNavigationItem === 'advancedDiagnostics'}
            aria-current={activeNavigationItem === 'advancedDiagnostics' ? 'page' : undefined}
            data-testid="ai-capabilities-advanced-diagnostics"
            onClick={props.onOpenAdvancedDiagnostics}
          >
            <SlidersHorizontal
              size={16}
              className="shrink-0 text-[var(--nimi-text-muted)]"
              aria-hidden="true"
            />
            <span className="desktop-sidebar__label min-w-0 flex-1 truncate text-[var(--nimi-text-primary)]">{t('runtimeConfig.nav.advancedDiagnostics')}</span>
          </button>
        </div>
      </DesktopModuleSidebar> : null}
      <Surface
        as="main"
        data-testid="ai-capabilities-detail-pane"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="desktop-module-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        {modelFilesActive ? props.modelFiles : <ScrollArea viewportRef={contentViewportRef} className="min-h-0 flex-1" viewportClassName="[&>div]:!block" contentClassName="desktop-module-content">
          {props.advancedDiagnostics ? (
            props.advancedDiagnostics.content
          ) : (
            <div className="mx-auto w-full max-w-6xl min-w-0">
              {inventory.isError ? (
                <InlineAlert tone="warning">
                  <p>{t('runtimeConfig.capabilities.readFailed')}</p>
                  <Button
                    size="sm"
                    tone="secondary"
                    onClick={() => {
                      void inventory.refetch();
                    }}
                  >
                    {t('Common.retry')}
                  </Button>
                </InlineAlert>
              ) : null}
              {error ? (
                <InlineAlert tone="danger">
                  <RuntimeSetupFailureMessage failure={error} />
                </InlineAlert>
              ) : null}
              {props.focusedTaskId && !focusedTask ? (
                <InlineAlert tone="warning" data-testid="ai-setup-task-unavailable">
                  <p>{t('runtimeConfig.setupTaskUnavailable')}</p>
                  <Button size="sm" tone="secondary" onClick={onHome} data-testid="ai-setup-task-unavailable-return">
                    {t('runtimeConfig.capabilities.backWorkspace')}
                  </Button>
                </InlineAlert>
              ) : visibleCapability && !inventory.isPending && !inventory.isError && !inventory.capabilities.includes(visibleCapability) ? (
                <InlineAlert tone="warning">
                  <p>{t('runtimeConfig.positionUnavailable')}</p>
                  <Button size="sm" tone="secondary" onClick={() => { void inventory.refetch(); }}>{t('Common.retry')}</Button>
                </InlineAlert>
              ) : focusedTask && !inlineTask ? (
                focusedTask.draft?.profileUseId ? (
                  <RuntimeProfileTaskView
                    key={focusedTask.draft.profileUseId}
                    inventoryEnabled={inventoryEnabled}
                    useId={focusedTask.draft.profileUseId}
                    store={store}
                    ports={ports}
                    detailTaskId={position?.profileTaskDetailId}
                    onOpenDetail={(taskId) => { void navigation.push(homeRuntimeDestination('aiSettings', { ...position, profileTaskDetailId: taskId })); }}
                    onCloseDetail={() => { void navigation.push(homeRuntimeDestination('aiSettings', { ...position, profileTaskDetailId: undefined })); }}
                    onClose={props.onCloseSetupTask}
                    onReturn={onReturnToSource}
                  />
                ) : (
                  <RuntimeConfigSetupTaskView
                    key={focusedTask.taskId}
                    taskId={focusedTask.taskId}
                    sourceOwnerDisplayName={appsColumn && appsColumn !== 'unavailable' ? appsColumn.apps.find(app => app.identity.appId === focusedTask.source.ownerAppId)?.identity.displayName : undefined}
                    sourceOwnerIconUrl={appsColumn && appsColumn !== 'unavailable' ? appsColumn.iconUrls.get(focusedTask.source.ownerAppId ?? '') : undefined}
                    store={store}
                    ports={ports}
                    disabled={props.runtimeWritesDisabled}
                    onImportModelFiles={props.onOpenModelImport}
                    onClose={() => {
                      void navigation.push(homeRuntimeDestination('aiSettings', { capabilityContract: focusedTask.capabilityContract }));
                      setError(null);
                      void inventory.refetch();
                    }}
                    onReturnToSource={onReturnToSource}
                  />
                )
              ) : modelConfiguration ? (
                <SavedConfigsView
                  key={modelConfiguration.loadoutId}
                  contextual
                  capabilityContract={modelConfiguration.capability}
                  initialLoadoutId={modelConfiguration.loadoutId}
                  navigationContext={null}
                  backLabel={t('runtimeConfig.localModels.backToModels')}
                  onBack={onHome}
                  environmentWritesDisabled={props.runtimeWritesDisabled}
                  onPrepareEnvironment={(loadout) => { void onStart(loadout.recipeId, loadout, loadout.capabilityContract); }}
                  onOpenModelMarket={props.onOpenModelMarket}
                />
              ) : !visibleCapability && section === 'saved' ? (
                <SavedConfigsView
                  navigationContext={props.savedConfigsContext}
                  onBack={onHome}
                  environmentWritesDisabled={props.runtimeWritesDisabled}
                  onPrepareEnvironment={(loadout) => { void onStart(loadout.recipeId, loadout, loadout.capabilityContract); }}
                  onOpenModelMarket={props.onOpenModelMarket}
                />
              ) : !visibleCapability ? (
                <div className="desktop-module-stack">
                  <RuntimeConfigAiSettingsProfilesSection
                    key={homeRevision}
                    title={t('runtimeConfig.product.setupsTitle')}
                    overviewPending={inventory.isPending || inventory.preparationPending}
                    overviewUnavailable={inventory.isError}
                    capabilities={railEntries}
                    recipes={inventory.data?.recipes ?? []}
                    catalog={library.data?.catalog ?? []}
                    assets={library.data?.assets ?? []}
                    libraryLoading={library.isPending}
                    libraryError={library.isError}
                    onRetryOverview={onRetryOverview}
                    onOpenCapability={openCapability}
                    onStartRecipe={(capabilityContract, recipeId) => {
                      void onStart(recipeId, undefined, capabilityContract);
                    }}
                    store={store}
                    ports={ports}
                    runtimeWritesDisabled={props.runtimeWritesDisabled}
                    owner={props.profileUseOwner}
                    onCloseOwner={props.onCloseProfileUseOwner}
                    onOpenSetupTask={props.onOpenSetupTask}
                    onOpenSavedConfigs={props.onOpenSavedConfigs}
                    onOpenCloudServices={props.onOpenCloudServices}
                    localModelsSection={
                      <RuntimeLocalModelListSection
                        inventory={inventory.data}
                        inventoryPending={inventory.isPending}
                        inventoryError={inventory.isError}
                        library={library}
                        onRetry={onRetryOverview}
                        tasks={inventory.tasks}
                        onOpenCapability={openCapability}
                        onOpenConfiguration={openModelConfiguration}
                        onOpenTask={openSetupTask}
                        onOpenModelFiles={props.onOpenModelFiles}
                      />
                    }
                  />
                </div>
              ) : (
                <RuntimeCapabilityDetail
                  key={visibleCapability}
                  capability={visibleCapability}
                  selected={selected}
                  downloadedRecipe={downloadedRecipe ?? undefined}
                  loadouts={saved}
                  recipes={recipes}
                  catalog={library.data?.catalog ?? []}
                  assets={library.data?.assets ?? []}
                  libraryLoading={library.isPending}
                  libraryError={library.isError}
                  modelsLoading={inventory.isPending}
                  modelsError={inventory.isError}
                  environment={environment}
                  environmentJobs={configurationEnvironment.data?.jobs}
                  environmentActions={{
                    checking: configurationEnvironment.checking,
                    busy: configurationEnvironment.busy,
                    error: configurationEnvironment.error ?? configurationEnvironment.actionError,
                    reasonCode: configurationEnvironment.reasonCode,
                    onRefresh: () => { void inventory.refetch(); },
                    onCancel: (jobId) => { void configurationEnvironment.cancelJob(jobId).then(() => inventory.refetch()); },
                  }}
                  status={status!}
                  taskModel={taskModel}
                  section={section}
                  onSection={openSection}
                  busy={busy}
                  disabled={props.runtimeWritesDisabled}
                  navigationContext={props.savedConfigsContext}
                  onStart={onStart}
                  onEnable={onEnable}
                  onApplyCustomization={onApplyCustomization}
                  onRetryCustomization={() => { void inventory.refetch(); void library.refetch(); }}
                  onTask={openSetupTask}
                  preparation={inlineTask ? (
                    <RuntimeConfigSetupTaskView
                      key={inlineTask.taskId}
                      taskId={inlineTask.taskId}
                      store={store}
                      ports={ports}
                      embedded
                      disabled={props.runtimeWritesDisabled}
                      onImportModelFiles={props.onOpenModelImport}
                      onClose={() => {
                        void navigation.push(homeRuntimeDestination('aiSettings', { capabilityContract: inlineTask.capabilityContract }));
                        setError(null);
                        void inventory.refetch();
                        void library.refetch();
                      }}
                    />
                  ) : undefined}
                  apps={appsColumn ? <RuntimeCapabilityApps state={appsColumn} /> : undefined}
                  onModelFiles={props.onOpenModelFiles}
                  onImportModelFiles={props.onOpenModelImport}
                  onChooseImportedFiles={(recipeId) => { void onChooseImportedFiles(recipeId); }}
                  onDiagnostics={props.onOpenAdvancedDiagnostics}
                  onModelMarket={props.onOpenModelMarket}
                />
              )}
            </div>
          )}
        </ScrollArea>}
      </Surface>
    </div>
  );
}
