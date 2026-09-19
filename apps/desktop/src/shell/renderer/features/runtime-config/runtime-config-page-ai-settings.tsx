// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadouts,
} from '@nimiplatform/sdk/runtime';
import {
  Button,
  EmptyState,
  InlineAlert,
  LoadingSkeleton,
  StatusBadge,
  Surface,
} from '@nimiplatform/kit/ui';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { RuntimePageHeader, RuntimePageShell } from './runtime-config-page-shell.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import {
  getRuntimeSetupTaskStore,
  useRuntimeSetupTasks,
  type RuntimeSetupTask,
} from './runtime-setup-task-store.js';
import {
  createRuntimeSetupTaskRunnerPorts,
  currentDesktopAccountIdForSetup,
} from './runtime-setup-task-ports.js';
import type { RuntimeSetupRunnerPorts } from './runtime-setup-task-runner.js';
import { RuntimeConfigSetupTaskView } from './runtime-config-setup-task-view.js';
import { RuntimeConfigAiSettingsProfilesSection } from './runtime-config-ai-settings-profiles.js';
import { SavedConfigsView } from './runtime-config-page-loadouts.js';
import { resolveRuntimeSetupReturnTarget } from './runtime-setup-task-open.js';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types.js';
import type {
  RuntimeConfigLoadoutNavigationContext,
  RuntimeConfigModelMarketContext,
  RuntimeConfigProfileUseOwner,
} from './runtime-config-panel-types.js';

export type RuntimeSetupCapabilityCardModel = {
  readonly capabilityContract: string;
  readonly selectedLoadoutLabel: string | null;
  readonly activeTaskId: string | null;
  readonly activeTaskStatus: RuntimeSetupTask['status'] | null;
};

export function runtimeSetupTaskIsActive(task: RuntimeSetupTask): boolean {
  return task.status !== 'done' && task.status !== 'failed' && task.status !== 'stopped';
}

/**
 * Failed tasks stay listed until reviewed: a failure the user did not watch
 * happen still needs an entry point back to its recovery action.
 */
export function runtimeSetupTaskNeedsReview(task: RuntimeSetupTask): boolean {
  return task.status === 'failed';
}

export function buildRuntimeSetupCapabilityCards(input: {
  readonly aggregate: NimiMachineLoadouts | null;
  readonly recipes: readonly NimiLoadoutRecipe[];
  readonly tasks: readonly RuntimeSetupTask[];
}): RuntimeSetupCapabilityCardModel[] {
  const contracts: string[] = [];
  const append = (value: string) => {
    if (value && !contracts.includes(value)) contracts.push(value);
  };
  for (const recipe of input.recipes) append(recipe.capabilityContract);
  for (const loadout of input.aggregate?.loadouts ?? []) append(loadout.capabilityContract);
  return contracts.map((capabilityContract) => {
    const selection = input.aggregate?.selections.find(
      (entry) => entry.capabilityContract === capabilityContract,
    );
    const selectedLoadout = input.aggregate?.loadouts.find(
      (loadout) => loadout.loadoutId === selection?.loadoutId,
    );
    const activeTask = input.tasks.find(
      (task) => task.capabilityContract === capabilityContract && runtimeSetupTaskIsActive(task),
    );
    return {
      capabilityContract,
      selectedLoadoutLabel: selectedLoadout?.displayName || selection?.loadoutId || null,
      activeTaskId: activeTask?.taskId ?? null,
      activeTaskStatus: activeTask?.status ?? null,
    };
  });
}

/**
 * Pure view for the AI settings page: the machine-scope capability cards, the
 * in-progress task entry strip, the profile library section slot, and the
 * entry to saved configurations (Model Setups). Testable without SDK bindings.
 */
export function RuntimeConfigAiSettingsView(props: {
  readonly cards: readonly RuntimeSetupCapabilityCardModel[];
  readonly tasks: readonly RuntimeSetupTask[];
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly runtimeWritesDisabled: boolean;
  readonly busyCapability: string | null;
  readonly onStartTask: (capabilityContract: string) => void;
  readonly onContinueTask: (taskId: string) => void;
  readonly onOpenSavedConfigs: () => void;
  /** The in-page profile library (recommended/use/import/create/export). */
  readonly profilesSection?: ReactNode;
}) {
  const { t } = useTranslation();
  const activeTasks = props.tasks.filter(runtimeSetupTaskIsActive);
  const failedTasks = props.tasks.filter(runtimeSetupTaskNeedsReview);
  const listedTasks = [...activeTasks, ...failedTasks];
  return (
    <RuntimePageShell>
      <RuntimePageHeader
        title={t('runtimeConfig.aiSettings.title', { defaultValue: 'AI Settings' })}
        description={t('runtimeConfig.aiSettings.machineScope', {
          defaultValue: 'This machine · shared by apps that use local AI',
        })}
        actions={(
          <Button
            tone="secondary"
            size="sm"
            data-testid="runtime-ai-settings-saved-configs"
            onClick={props.onOpenSavedConfigs}
          >
            {t('runtimeConfig.aiSettings.savedConfigs', { defaultValue: 'Saved configurations' })}
          </Button>
        )}
      />
      {props.runtimeWritesDisabled ? (
        <InlineAlert tone="warning" data-testid="runtime-ai-settings-readonly">
          <div className="font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.aiSettings.readOnlyTitle', { defaultValue: 'Read-only mode' })}
          </div>
          <div>
            {t('runtimeConfig.aiSettings.readOnlyDescription', {
              defaultValue: 'Runtime is unavailable. Local model changes are disabled until it reconnects.',
            })}
          </div>
        </InlineAlert>
      ) : null}
      {listedTasks.length > 0 ? (
        <Surface tone="card" material="glass-thin" padding="md" className="min-w-0" data-testid="runtime-ai-settings-active-tasks">
          <div className="flex flex-col gap-2">
            <div className="text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.aiSettings.activeTasks', { defaultValue: 'In-progress setup tasks' })}
            </div>
            {listedTasks.map((task) => (
              <div key={task.taskId} className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-primary)]">
                    {displayRuntimeConfigCapabilityLabel(task.capabilityContract, t)}
                  </div>
                  <div className="text-xs text-[var(--nimi-text-muted)]">
                    {t(`runtimeConfig.setupTask.status.${task.status}`, { defaultValue: task.status })}
                  </div>
                  {task.status === 'failed' && task.failure ? (
                    <div className="truncate text-xs text-[var(--nimi-status-danger)]" title={task.failure.message}>
                      {task.failure.message}
                    </div>
                  ) : null}
                </div>
                <Button tone="secondary" size="sm" onClick={() => props.onContinueTask(task.taskId)}>
                  {task.status === 'failed'
                    ? t('runtimeConfig.aiSettings.reviewTask', { defaultValue: 'Review' })
                    : t('runtimeConfig.aiSettings.continueTask', { defaultValue: 'Continue' })}
                </Button>
              </div>
            ))}
          </div>
        </Surface>
      ) : null}
      {props.loadError ? (
        <InlineAlert tone="danger" data-testid="runtime-ai-settings-load-error">
          <div className="font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.aiSettings.loadErrorTitle', { defaultValue: 'Could not load AI settings' })}
          </div>
          <div>{props.loadError}</div>
        </InlineAlert>
      ) : null}
      {props.loading ? <LoadingSkeleton className="h-40 w-full" /> : null}
      {!props.loading && !props.loadError && props.cards.length === 0 ? (
        <EmptyState
          title={t('runtimeConfig.aiSettings.emptyTitle', { defaultValue: 'No local AI capabilities reported yet' })}
          description={t('runtimeConfig.aiSettings.emptyDescription', {
            defaultValue: 'When Runtime reports local capabilities, you can set them up here.',
          })}
        />
      ) : null}
      {!props.loading && props.cards.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {props.cards.map((card) => {
            const busy = props.busyCapability === card.capabilityContract;
            return (
              <Surface
                key={card.capabilityContract}
                tone="card"
                material="glass-thin"
                padding="md"
                className="min-w-0"
                data-testid={`runtime-ai-settings-capability:${card.capabilityContract}`}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
                      {displayRuntimeConfigCapabilityLabel(card.capabilityContract, t)}
                    </div>
                    <div className="mt-1 truncate text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                      {card.selectedLoadoutLabel
                        ?? t('runtimeConfig.aiSettings.notConfigured', { defaultValue: 'Not set up' })}
                    </div>
                  </div>
                  <StatusBadge tone={card.selectedLoadoutLabel ? 'success' : 'neutral'} shape="soft">
                    {card.selectedLoadoutLabel
                      ? t('runtimeConfig.aiSettings.stateConfigured', { defaultValue: 'Configured' })
                      : t('runtimeConfig.aiSettings.stateUnset', { defaultValue: 'Not set up' })}
                  </StatusBadge>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {card.activeTaskId ? (
                    <Button
                      tone="primary"
                      size="sm"
                      disabled={busy}
                      data-testid={`runtime-ai-settings-continue:${card.capabilityContract}`}
                      onClick={() => props.onContinueTask(card.activeTaskId!)}
                    >
                      {t('runtimeConfig.aiSettings.continuePreparation', { defaultValue: 'Continue preparation' })}
                    </Button>
                  ) : (
                    <Button
                      tone={card.selectedLoadoutLabel ? 'secondary' : 'primary'}
                      size="sm"
                      disabled={busy || props.runtimeWritesDisabled}
                      data-testid={`runtime-ai-settings-start:${card.capabilityContract}`}
                      onClick={() => props.onStartTask(card.capabilityContract)}
                    >
                      {card.selectedLoadoutLabel
                        ? t('runtimeConfig.aiSettings.change', { defaultValue: 'Change' })
                        : t('runtimeConfig.aiSettings.setup', { defaultValue: 'Set up' })}
                    </Button>
                  )}
                </div>
              </Surface>
            );
          })}
        </div>
      ) : null}
      {props.profilesSection}
    </RuntimePageShell>
  );
}

export function AiSettingsPage(props: {
  readonly runtimeWritesDisabled: boolean;
  readonly focusedTaskId: string | null;
  readonly actionFocus: RuntimeConfigStateV11['actionFocus'];
  readonly savedConfigsContext: RuntimeConfigLoadoutNavigationContext | null;
  readonly profileUseOwner: RuntimeConfigProfileUseOwner | null;
  readonly onOpenSetupTask: (taskId: string) => void;
  readonly onCloseSetupTask: () => void;
  readonly onOpenSavedConfigs: (context?: RuntimeConfigLoadoutNavigationContext) => void;
  readonly onOpenModelMarket: (context: RuntimeConfigModelMarketContext) => void;
  readonly onOpenAdvancedDiagnostics: () => void;
  readonly onOpenCloudServices: () => void;
  readonly onClearActionFocus: () => void;
  readonly onCloseProfileUseOwner: () => void;
  readonly onCloseSavedConfigs: () => void;
}) {
  const sdk = useDesktopRendererSdk();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const store = getRuntimeSetupTaskStore();
  const snapshot = useRuntimeSetupTasks(store);
  const ports: RuntimeSetupRunnerPorts = useMemo(
    () => createRuntimeSetupTaskRunnerPorts(sdk),
    [sdk],
  );
  const [aggregate, setAggregate] = useState<NimiMachineLoadouts | null>(null);
  const [recipes, setRecipes] = useState<readonly NimiLoadoutRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyCapability, setBusyCapability] = useState<string | null>(null);
  const [savedConfigsOpen, setSavedConfigsOpen] = useState(false);

  // A new app's "Use profile" navigation must reveal the profile library,
  // even when the prior Runtime visit left the saved-configurations subview open.
  useEffect(() => {
    if (props.profileUseOwner) setSavedConfigsOpen(false);
  }, [props.profileUseOwner]);

  // External deep links (menu, profiles, install toast) arrive through the
  // persisted action focus; the saved-configs view consumes it once.
  const { actionFocus, onClearActionFocus } = props;
  useEffect(() => {
    if (actionFocus?.focus !== 'runtime-config-action-focus.saved-configs') return;
    setSavedConfigsOpen(true);
    onClearActionFocus();
  }, [actionFocus, onClearActionFocus]);

  const [reloadToken, setReloadToken] = useState(0);
  const initialLoadRef = useRef(true);

  useEffect(() => {
    let active = true;
    // Only the first load shows the skeleton; reloads keep existing cards
    // visible and report failures through the load-error alert instead.
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      setLoading(true);
    }
    setLoadError(null);
    const loadouts = sdk.machineProduct().local.loadouts;
    void Promise.all([loadouts.get(), loadouts.listRecipes()])
      .then(([nextAggregate, nextRecipes]) => {
        if (!active) return;
        setAggregate(nextAggregate);
        setRecipes(nextRecipes);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : String(error || ''));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sdk, reloadToken]);

  // A focused setup task or the saved-configurations view can commit machine
  // writes (selection changes, candidate edits); re-read the aggregate when
  // returning so the cards do not keep showing the pre-task snapshot.
  const subViewWasOpenRef = useRef(false);
  useEffect(() => {
    const subViewOpen = props.focusedTaskId !== null || savedConfigsOpen;
    const wasOpen = subViewWasOpenRef.current;
    subViewWasOpenRef.current = subViewOpen;
    if (wasOpen && !subViewOpen) setReloadToken((token) => token + 1);
  }, [props.focusedTaskId, savedConfigsOpen]);

  const cards = useMemo(() => buildRuntimeSetupCapabilityCards({
    aggregate,
    recipes,
    tasks: snapshot.tasks,
  }), [aggregate, recipes, snapshot.tasks]);

  const onStartTask = useCallback((capabilityContract: string) => {
    setBusyCapability(capabilityContract);
    void currentDesktopAccountIdForSetup()
      .then((accountId) => {
        const task = store.createTask({
          capabilityContract,
          source: { kind: 'runtime', accountId, returnFocus: 'runtime.aiSettings' },
        });
        props.onOpenSetupTask(task.taskId);
      })
      .finally(() => setBusyCapability(null));
  }, [props, store]);

  const onReturnToSource = useCallback(() => {
    const focusedTask = props.focusedTaskId ? store.getTask(props.focusedTaskId) : undefined;
    const target = resolveRuntimeSetupReturnTarget(focusedTask?.source.returnFocus);
    props.onCloseSetupTask();
    // The return handle is navigation-only: it names the existing tab to go
    // back to; it never re-sends input or forces a chat open.
    if (target?.kind === 'tab') {
      setActiveTab(target.tab);
    }
  }, [props, setActiveTab, store]);

  if (props.focusedTaskId) {
    return (
      <RuntimePageShell>
        <RuntimeConfigSetupTaskView
          taskId={props.focusedTaskId}
          store={store}
          ports={ports}
          onClose={props.onCloseSetupTask}
          onReturnToSource={onReturnToSource}
        />
      </RuntimePageShell>
    );
  }

  if (savedConfigsOpen) {
    return (
      <SavedConfigsView
        navigationContext={props.savedConfigsContext}
        onBack={() => {
          setSavedConfigsOpen(false);
          props.onCloseSavedConfigs();
        }}
        onOpenAdvancedDiagnostics={props.onOpenAdvancedDiagnostics}
        onOpenModelMarket={props.onOpenModelMarket}
      />
    );
  }

  return (
    <RuntimeConfigAiSettingsView
      cards={cards}
      tasks={snapshot.tasks}
      loading={loading}
      loadError={loadError}
      runtimeWritesDisabled={props.runtimeWritesDisabled}
      busyCapability={busyCapability}
      onStartTask={onStartTask}
      onContinueTask={props.onOpenSetupTask}
      onOpenSavedConfigs={() => setSavedConfigsOpen(true)}
      profilesSection={(
        <RuntimeConfigAiSettingsProfilesSection
          store={store}
          ports={ports}
          runtimeWritesDisabled={props.runtimeWritesDisabled}
          owner={props.profileUseOwner}
          onCloseOwner={props.onCloseProfileUseOwner}
          onOpenSetupTask={props.onOpenSetupTask}
          onOpenSavedConfigs={props.onOpenSavedConfigs}
          onOpenCloudServices={props.onOpenCloudServices}
        />
      )}
    />
  );
}
