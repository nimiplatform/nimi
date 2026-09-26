import {
  Button,
  InlineAlert,
  ScrollArea,
  SelectField,
  SidebarAffordanceStatusDot,
  SidebarShell,
  StatusBadge,
  Surface,
  type StatusTone,
} from '@nimiplatform/kit/ui';
import type { NimiMachineLoadout } from '@nimiplatform/sdk/runtime';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleDashed, LoaderCircle, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';
import { desktopNimiAppAIConfigQueryKey } from '../chat/chat-nimi-app-ai-config.js';
import { RuntimeCapabilityApps, useCapabilityAppsColumn } from './runtime-capability-apps.js';
import { RuntimeCapabilityDetail } from './runtime-capability-detail.js';
import {
  type CapabilityPreparationState,
  capabilityPreparationState,
  useCapabilityInventory,
} from './runtime-capability-inventory.js';
import {
  capabilityIcon,
  capabilityModelIdentity,
  capabilityRecommendedFilesOnDevice,
  capabilityRecommendedRecipeOnDevice,
  distinctSavedLoadouts,
  groupCapabilities,
  setupPlanAllowsDirectUse,
  setupTaskModelTitle,
} from './runtime-capability-presentation.js';
import { RuntimeConfigAiSettingsProfilesSection } from './runtime-config-ai-settings-profiles.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import type {
  RuntimeConfigLoadoutNavigationContext,
  RuntimeConfigModelMarketContext,
  RuntimeConfigProfileUseOwner,
} from './runtime-config-panel-types.js';
import { RuntimeConfigSetupTaskView } from './runtime-config-setup-task-view.js';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types.js';
import { RuntimeLocalModelListSection } from './runtime-local-model-list-section.js';
import {
  CONVERSATION_CAPABILITY,
  type RuntimeProfileQuickStartConversation,
} from './runtime-profile-quick-start.js';
import { RuntimeProfileTaskView } from './runtime-profile-task-view.js';
import {
  RuntimeSetupFailureMessage,
  runtimeSetupFailureText,
  type RuntimeSetupFailureNotice,
} from './runtime-setup-failure-message.js';
import { resolveRuntimeSetupReturnTarget } from './runtime-setup-task-open.js';
import {
  createRuntimeSetupTaskRunnerPorts,
  currentDesktopAccountIdForSetup,
} from './runtime-setup-task-ports.js';
import {
  createRuntimeSetupCandidate,
  resolveRuntimeSetupPreparation,
  reuseRuntimeSetupCurrent,
  runRuntimeSetupPreparation,
} from './runtime-setup-task-runner.js';
import { getRuntimeSetupTaskStore, type RuntimeSetupTaskDraft } from './runtime-setup-task-store.js';
import { useRuntimeModelLibrary } from './use-runtime-model-library.js';

export type AiSettingsPageProps = {
  readonly runtimeWritesDisabled: boolean;
  readonly focusedTaskId: string | null;
  readonly actionFocus: RuntimeConfigStateV11['actionFocus'];
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

// Each rail row is a single line: icon + name on the left, a status mark plus
// state text on the right. Only preparing and needs-attention earn a badge;
// every other state is a quiet status dot so a dozen unset capabilities do
// not read as a dozen problems. A prepared capability shows its default model
// name beside the dot (selection), never a running or in-use claim.
const RAIL_BADGE_TONE: Partial<Record<CapabilityPreparationState, StatusTone>> = {
  preparing: 'info',
  attention: 'warning',
};

function RailStatusMark(props: { readonly state: CapabilityPreparationState }) {
  if (props.state === 'ready') {
    return <SidebarAffordanceStatusDot className="text-[var(--nimi-status-success)]" />;
  }
  if (props.state === 'unknown') {
    return <CircleDashed size={10} className="shrink-0 text-[var(--nimi-text-muted)]" aria-hidden="true" />;
  }
  return (
    <span
      className="inline-flex h-2 w-2 shrink-0 rounded-full border border-current opacity-60"
      aria-hidden="true"
    />
  );
}

// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace
export function AiSettingsPage(props: AiSettingsPageProps) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const queryClient = useQueryClient();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setAppsDetailAppId = useAppStore((state) => state.setAppsDetailAppId);
  const inventory = useCapabilityInventory();
  const library = useRuntimeModelLibrary();
  const store = getRuntimeSetupTaskStore();
  const localEnvironment = useRuntimeConfigLocalEnvironmentClient();
  const ports = useMemo(() => createRuntimeSetupTaskRunnerPorts(sdk, localEnvironment), [sdk, localEnvironment]);
  const [capability, setCapability] = useState<string | null>(null);
  const [section, setSection] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RuntimeSetupFailureNotice | null>(null);
  const [homeRevision, setHomeRevision] = useState(0);
  const focusedTask = props.focusedTaskId ? store.getTask(props.focusedTaskId) : undefined;
  const visibleCapability = focusedTask?.capabilityContract ?? capability;
  const appsColumn = useCapabilityAppsColumn(visibleCapability);
  const label = (id: string) => displayRuntimeConfigCapabilityLabel(id, t);
  useEffect(() => {
    if (props.profileUseOwner) {
      setCapability(null);
      setSection('overview');
    }
  }, [props.profileUseOwner]);
  useEffect(() => {
    if (props.actionFocus?.focus !== 'runtime-config-action-focus.saved-configs') return;
    const target = props.savedConfigsContext?.capabilityContract ?? inventory.capabilities[0];
    if (!target) return;
    setCapability(target);
    setSection('saved');
    props.onClearActionFocus();
  }, [props.actionFocus, props.savedConfigsContext, inventory.capabilities, props.onClearActionFocus]);

  useEffect(() => {
    const target = props.savedConfigsContext?.capabilityContract;
    if (target && !props.actionFocus) {
      setCapability(target);
      setSection('overview');
      // Returning from acquisition refreshes files and choices without selecting a model.
      void inventory.refetch();
      void library.refetch();
    }
  }, [props.savedConfigsContext]);

  const railEntries = useMemo(
    () =>
      inventory.capabilities.map((id) => {
        const state = capabilityPreparationState({
          capability: id,
          inventory: inventory.data,
          tasks: inventory.tasks,
          unavailable: inventory.isError,
        });
        const selection = inventory.data?.aggregate.selections.find((item) => item.capabilityContract === id);
        const selected = inventory.data?.aggregate.loadouts.find((item) => item.loadoutId === selection?.loadoutId);
        const identity = capabilityModelIdentity(selected, inventory.data?.recipes ?? []);
        // "Downloaded · not enabled" closes the gap between the installed
        // recommended offers and the rail (no selection). It is only a reading
        // aid on the unset state and never counts toward the ready total.
        const downloaded =
          state.state === 'unset' &&
          capabilityRecommendedFilesOnDevice(id, inventory.data?.recipes ?? []);
        return { id, state, model: identity.shortTitle, downloaded };
      }),
    [inventory.capabilities, inventory.data, inventory.tasks, inventory.isError],
  );
  const railStateLabel = (entry: { state: { state: CapabilityPreparationState }; downloaded: boolean }) =>
    t(
      entry.downloaded
        ? 'runtimeConfig.capabilities.state.downloaded'
        : `runtimeConfig.capabilities.state.${entry.state.state}`,
    );
  const readyCount = railEntries.filter((entry) => entry.state.state === 'ready').length;
  const attentionCount = railEntries.filter((entry) => entry.state.state === 'attention').length;
  const preparingCount = railEntries.filter((entry) => entry.state.state === 'preparing').length;
  const railSummary = inventory.isPending
    ? t('Common.loading')
    : [
        t('runtimeConfig.capabilities.readyCount', { count: readyCount }),
        preparingCount ? t('runtimeConfig.capabilities.preparingCount', { count: preparingCount }) : '',
        attentionCount ? t('runtimeConfig.capabilities.attentionCount', { count: attentionCount }) : '',
      ]
        .filter(Boolean)
        .join(' · ');

  const selection = inventory.data?.aggregate.selections.find(
    (item) => item.capabilityContract === visibleCapability,
  );
  const selected = inventory.data?.aggregate.loadouts.find((item) => item.loadoutId === selection?.loadoutId);
  const recipes =
    inventory.data?.recipes.filter((item) => item.capabilityContract === visibleCapability) ?? [];
  const status = visibleCapability
    ? capabilityPreparationState({
        capability: visibleCapability,
        inventory: inventory.data,
        tasks: inventory.tasks,
        unavailable: inventory.isError,
      })
    : null;
  const inlineTask = focusedTask?.source.kind === 'runtime' && !focusedTask.draft?.profileUseId
    ? focusedTask : undefined;
  const openSetupTask = (taskId: string) => {
    setSection('overview');
    props.onOpenSetupTask(taskId);
  };
  const taskModel = status?.task
    ? setupTaskModelTitle(status.task, inventory.data?.aggregate.loadouts ?? [], recipes)
    : '';
  const environment = visibleCapability ? inventory.data?.environments[visibleCapability] : undefined;
  // Exact equivalents share a presentation entry here; every saved Loadout
  // remains available in the model inventory and sharing flow.
  const saved = distinctSavedLoadouts(
    inventory.data?.aggregate.loadouts.filter(
      (item) => item.capabilityContract === visibleCapability && item.validationState === 'configured',
    ) ?? [],
    selection?.loadoutId,
  );
  // The overview names the downloaded recipe only while nothing is selected;
  // it mirrors the rail's "downloaded · not enabled" reading aid.
  const downloadedRecipe =
    visibleCapability && status?.state === 'unset'
      ? capabilityRecommendedRecipeOnDevice(visibleCapability, recipes)
      : null;
  const createSetupTask = async () => {
    const owner = props.profileUseOwner;
    return store.createTask({
      capabilityContract: visibleCapability!,
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
  const onStart = async (recipeId?: string, previous?: NimiMachineLoadout) => {
    if (!visibleCapability) return;
    setBusy(true);
    setError(null);
    try {
      const task = await createSetupTask();
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
      if (resolved.status !== 'ok' || !setupPlanAllowsDirectUse(resolved.value)) {
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
      setSection('overview');
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
  const onApplyCustomization = async (draft: RuntimeSetupTaskDraft) => {
    if (!selected || !visibleCapability || busy || props.runtimeWritesDisabled) return;
    setBusy(true);
    setError(null);
    try {
      const task = await createSetupTask();
      store.updateTask(task.taskId, () => ({ draft }));
      const created = await createRuntimeSetupCandidate(store, task.taskId, ports, {
        recipeId: selected.recipeId,
        displayName: selected.displayName,
        axes: draft.axes,
        options: draft.options,
      });
      if (created.status !== 'ok') throw new Error(runtimeSetupFailureText(created.failure, t));
      const resolved = await resolveRuntimeSetupPreparation(store, task.taskId, ports);
      if (resolved.status !== 'ok') throw new Error(runtimeSetupFailureText(resolved.failure, t));
      if (!setupPlanAllowsDirectUse(resolved.value)) {
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
  // The conversation quick start reads the same preparation facts as the rail
  // and, separately, whether Nimi Chat already routes to Local (read inside
  // the card). Reusing the current machine configuration never creates or
  // selects a Loadout and never installs; its only possible write is the
  // Nimi Chat route.
  const conversationEntry = railEntries.find((entry) => entry.id === CONVERSATION_CAPABILITY);
  const conversation: RuntimeProfileQuickStartConversation = {
    pending: inventory.isPending,
    preparation:
      conversationEntry?.state ??
      capabilityPreparationState({
        capability: CONVERSATION_CAPABILITY,
        inventory: inventory.data,
        tasks: inventory.tasks,
        unavailable: inventory.isError,
      }),
    model: conversationEntry?.model ?? '',
    onOpenChat: () => {
      setChatMode('ai');
      setActiveTab('chat');
    },
    onUseInChat: async () => {
      const task = store.createTask({
        capabilityContract: CONVERSATION_CAPABILITY,
        source: {
          kind: 'app',
          ownerAppId: sdk.appId(),
          accountId: await currentDesktopAccountIdForSetup(),
          returnFocus: 'chat',
        },
      });
      const result = await reuseRuntimeSetupCurrent(store, task.taskId, ports);
      if (result.status !== 'ok') {
        openSetupTask(task.taskId);
        return { ok: false, message: runtimeSetupFailureText(result.failure, t) };
      }
      await queryClient.invalidateQueries({ queryKey: desktopNimiAppAIConfigQueryKey(sdk.appId()) });
      return { ok: true };
    },
    onOpenDetail: () => openCapability(CONVERSATION_CAPABILITY),
    onOpenTask: props.onOpenSetupTask,
    onRetry: () => {
      void inventory.refetch();
    },
  };
  const onHome = () => {
    props.onCloseSetupTask();
    props.onCloseSavedConfigs();
    setCapability(null);
    setSection('overview');
    setError(null);
    setHomeRevision((value) => value + 1);
    void inventory.refetch();
  };
  const openCapability = (id: string) => {
    props.onCloseSetupTask();
    props.onCloseSavedConfigs();
    setCapability(id);
    setSection('overview');
    setError(null);
    const pending = capabilityPreparationState({
      capability: id, inventory: inventory.data, tasks: inventory.tasks, unavailable: inventory.isError,
    }).task;
    if (pending?.source.kind === 'runtime' && !pending.draft?.profileUseId) openSetupTask(pending.taskId);
  };
  const onReturnToSource = () => {
    const target = resolveRuntimeSetupReturnTarget(focusedTask?.source.returnFocus);
    props.onCloseSetupTask();
    setError(null);
    if (target?.kind === 'tab') setActiveTab(target.tab);
    if (target?.kind === 'tab' && target.tab === 'apps' && focusedTask?.source.ownerAppId) {
      setAppsDetailAppId(focusedTask.source.ownerAppId);
      setActiveTab('apps');
    }
    void inventory.refetch();
  };

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 md:flex-row"
      data-testid="ai-capabilities-workspace"
    >
      <div className="space-y-2 md:hidden">
        <SelectField
          aria-label={t('runtimeConfig.capabilities.title')}
          value={visibleCapability ?? '__home__'}
          options={[
            { value: '__home__', label: t('runtimeConfig.product.setupsTitle') },
            ...railEntries.map((entry) => ({
              value: entry.id,
              label:
                entry.state.state === 'ready' && entry.model
                  ? `${label(entry.id)} · ${entry.model}`
                  : `${label(entry.id)} · ${railStateLabel(entry)}`,
            })),
          ]}
          onValueChange={(id) => {
            if (id === '__home__') onHome();
            else openCapability(id);
          }}
        />
        <div className="flex flex-wrap gap-1">
          <Button tone="ghost" size="sm" onClick={props.onOpenModelFiles}>
            {t('runtimeConfig.capabilities.manageFiles')}
          </Button>
          <Button tone="ghost" size="sm" onClick={props.onOpenAdvancedDiagnostics}>
            {t('runtimeConfig.nav.advancedDiagnostics')}
          </Button>
        </div>
      </div>
      <SidebarShell
        className="hidden w-48 min-w-40 md:flex lg:w-64"
        aria-label={t('runtimeConfig.capabilities.title')}
      >
        <button
          type="button"
          onClick={onHome}
          className="px-4 pb-3 pt-5 text-left"
          data-testid="ai-capabilities-home"
        >
          <span className="block text-lg font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.capabilities.title')}
          </span>
          <span className="mt-1 block text-xs text-[var(--nimi-text-secondary)]">{railSummary}</span>
        </button>
        <ScrollArea
          className="min-h-0 flex-1"
          viewportClassName="[&>div]:!block"
          contentClassName="min-w-0 space-y-3 px-2 pb-3"
        >
          {groupCapabilities(railEntries.map((entry) => entry.id)).map(({ group, items }) => (
            <div key={group} className="space-y-0.5">
              <p className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-[var(--nimi-text-muted)]">
                {t(`runtimeConfig.capabilities.group.${group}`)}
              </p>
              {items.map((id) => {
                const entry = railEntries.find((item) => item.id === id)!;
                const Icon = capabilityIcon(id);
                const state = entry.state.state;
                const stateText = state === 'ready' && entry.model ? entry.model : railStateLabel(entry);
                const stateSuffix =
                  entry.state.replacement && entry.state.task
                    ? ` · ${t(`runtimeConfig.setupTask.status.${entry.state.task.status}`)}`
                    : '';
                const badgeTone = RAIL_BADGE_TONE[state];
                const hideStateText = state === 'unset' && !entry.downloaded;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-current={visibleCapability === id ? 'page' : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-[var(--nimi-radius-md)] px-3 py-2 text-left ${visibleCapability === id ? 'bg-[var(--nimi-surface-active)] ring-1 ring-inset ring-[var(--nimi-border-strong)]' : 'hover:bg-[color-mix(in_srgb,var(--nimi-surface-active)_60%,transparent)]'}`}
                    onClick={() => openCapability(id)}
                    data-testid={`ai-capability:${id}`}
                  >
                    <Icon
                      size={16}
                      className={`shrink-0 ${state === 'unset' ? 'text-[var(--nimi-text-muted)]' : 'text-[var(--nimi-text-secondary)]'}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--nimi-text-primary)]">
                      {label(id)}
                    </span>
                    {badgeTone ? (
                      <StatusBadge
                        tone={badgeTone}
                        className="min-w-0 max-w-[min(9rem,50%)] shrink-0 whitespace-nowrap px-2 py-0"
                        title={`${stateText}${stateSuffix}`}
                        data-rail-state={state}
                      >
                        {state === 'preparing' ? (
                          <LoaderCircle size={11} className="shrink-0 animate-spin" aria-hidden="true" />
                        ) : (
                          <CircleAlert size={11} className="shrink-0" aria-hidden="true" />
                        )}
                        <span className="min-w-0 truncate">
                          {stateText}
                          {stateSuffix}
                        </span>
                      </StatusBadge>
                    ) : (
                      <span
                        className={`flex min-w-0 max-w-[min(9rem,50%)] shrink-0 items-center gap-1.5 whitespace-nowrap text-xs ${state === 'ready' ? 'text-[var(--nimi-text-secondary)]' : 'text-[var(--nimi-text-muted)]'}`}
                        title={`${stateText}${stateSuffix}`}
                        data-rail-state={state}
                      >
                        <RailStatusMark state={state} />
                        {!hideStateText ? (
                          <span className="min-w-0 truncate">
                            {stateText}
                            {stateSuffix}
                          </span>
                        ) : null}
                        {entry.state.replacement ? (
                          <LoaderCircle size={11} className="shrink-0 animate-spin" aria-hidden="true" />
                        ) : null}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {inventory.isPending ? <p className="px-3 text-sm">{t('Common.loading')}</p> : null}
        </ScrollArea>
        <div className="flex flex-wrap gap-1 border-t border-[var(--nimi-border-subtle)] p-2">
          <Button tone="ghost" size="sm" onClick={props.onOpenModelFiles}>
            {t('runtimeConfig.capabilities.manageFiles')}
          </Button>
          <Button tone="ghost" size="sm" onClick={props.onOpenAdvancedDiagnostics}>
            <SlidersHorizontal size={14} />
            {t('runtimeConfig.nav.advancedDiagnostics')}
          </Button>
        </div>
      </SidebarShell>
      <Surface
        tone="panel"
        material="glass-regular"
        padding="none"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <ScrollArea className="min-h-0 flex-1" contentClassName="min-w-0 p-5 lg:px-8 lg:py-7">
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
          {focusedTask && !inlineTask ? (
            focusedTask.draft?.profileUseId ? (
              <RuntimeProfileTaskView
                key={focusedTask.draft.profileUseId}
                useId={focusedTask.draft.profileUseId}
                store={store}
                ports={ports}
                onClose={props.onCloseSetupTask}
                onReturn={onReturnToSource}
              />
            ) : (
              <RuntimeConfigSetupTaskView
                key={focusedTask.taskId}
                taskId={focusedTask.taskId}
                store={store}
                ports={ports}
                disabled={props.runtimeWritesDisabled}
                onImportModelFiles={props.onOpenModelImport}
                onClose={() => {
                  setCapability(focusedTask.capabilityContract);
                  props.onCloseSetupTask();
                  setError(null);
                  void inventory.refetch();
                }}
                onReturnToSource={onReturnToSource}
              />
            )
          ) : !visibleCapability ? (
            <div className="space-y-6">
              <RuntimeConfigAiSettingsProfilesSection
                key={homeRevision}
                title={t('runtimeConfig.product.setupsTitle')}
                lead={inventory.isPending ? '' : railSummary}
                conversation={conversation}
                store={store}
                ports={ports}
                runtimeWritesDisabled={props.runtimeWritesDisabled}
                owner={props.profileUseOwner}
                onCloseOwner={props.onCloseProfileUseOwner}
                onOpenSetupTask={props.onOpenSetupTask}
                onOpenSavedConfigs={props.onOpenSavedConfigs}
                onOpenCloudServices={props.onOpenCloudServices}
                belowEntryPoints={
                  <RuntimeLocalModelListSection
                    inventory={inventory.data}
                    inventoryPending={inventory.isPending}
                    inventoryError={inventory.isError}
                    library={library}
                    onRetry={() => {
                      void inventory.refetch();
                      void library.refetch();
                    }}
                    tasks={inventory.tasks}
                    onOpenCapability={openCapability}
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
              status={status!}
              taskModel={taskModel}
              section={section}
              onSection={setSection}
              busy={busy}
              disabled={props.runtimeWritesDisabled}
              navigationContext={props.savedConfigsContext}
              onHome={onHome}
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
                    setCapability(inlineTask.capabilityContract);
                    props.onCloseSetupTask();
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
        </ScrollArea>
      </Surface>
    </div>
  );
}
