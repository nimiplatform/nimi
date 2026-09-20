import { Button, InlineAlert, ScrollArea, SelectField, SidebarShell, Surface } from '@nimiplatform/kit/ui';
import type { NimiMachineLoadout } from '@nimiplatform/sdk/runtime';
import { Circle, CircleAlert, LoaderCircle, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { RuntimeCapabilityDetail } from './runtime-capability-detail.js';
import { capabilityPreparationState, useCapabilityInventory } from './runtime-capability-inventory.js';
import { capabilityIcon, capabilityModelIdentity, groupCapabilities } from './runtime-capability-presentation.js';
import { RuntimeConfigAiSettingsProfilesSection } from './runtime-config-ai-settings-profiles.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import type {
  RuntimeConfigLoadoutNavigationContext,
  RuntimeConfigModelMarketContext,
  RuntimeConfigProfileUseOwner,
} from './runtime-config-panel-types.js';
import { RuntimeConfigSetupTaskView } from './runtime-config-setup-task-view.js';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types.js';
import { RuntimeProfileTaskView } from './runtime-profile-task-view.js';
import { resolveRuntimeSetupReturnTarget } from './runtime-setup-task-open.js';
import {
  createRuntimeSetupTaskRunnerPorts,
  currentDesktopAccountIdForSetup,
} from './runtime-setup-task-ports.js';
import { createRuntimeSetupCandidate, resolveRuntimeSetupPreparation } from './runtime-setup-task-runner.js';
import { getRuntimeSetupTaskStore } from './runtime-setup-task-store.js';
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
  readonly onOpenSavedConfigs: (context?: RuntimeConfigLoadoutNavigationContext) => void;
  readonly onOpenModelMarket: (context: RuntimeConfigModelMarketContext) => void;
  readonly onOpenAdvancedDiagnostics: () => void;
  readonly onOpenCloudServices: () => void;
  readonly onClearActionFocus: () => void;
  readonly onCloseProfileUseOwner: () => void;
  readonly onCloseSavedConfigs: () => void;
};

// Only exceptions get a glyph in the rail: a prepared capability shows its
// model name and nothing else, so the list reads as an inventory, not a
// column of check marks.
const EXCEPTION_ICON = {
  unset: Circle,
  preparing: LoaderCircle,
  attention: CircleAlert,
  unknown: Circle,
} as const;
const EXCEPTION_COLOR = {
  unset: 'text-[var(--nimi-text-muted)]',
  preparing: 'text-[var(--nimi-status-info)]',
  attention: 'text-[var(--nimi-status-warning)]',
  unknown: 'text-[var(--nimi-text-muted)]',
} as const;

// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace
export function AiSettingsPage(props: AiSettingsPageProps) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setAppsDetailAppId = useAppStore((state) => state.setAppsDetailAppId);
  const inventory = useCapabilityInventory();
  const library = useRuntimeModelLibrary();
  const store = getRuntimeSetupTaskStore();
  const ports = useMemo(() => createRuntimeSetupTaskRunnerPorts(sdk), [sdk]);
  const [capability, setCapability] = useState<string | null>(null);
  const [section, setSection] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [customizingTaskId, setCustomizingTaskId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [homeRevision, setHomeRevision] = useState(0);
  const focusedTask = props.focusedTaskId ? store.getTask(props.focusedTaskId) : undefined;
  const visibleCapability = focusedTask?.capabilityContract ?? capability;
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
        return { id, state, model: identity.shortTitle };
      }),
    [inventory.capabilities, inventory.data, inventory.tasks, inventory.isError],
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
  const environment = visibleCapability ? inventory.data?.environments[visibleCapability] : undefined;
  const saved =
    inventory.data?.aggregate.loadouts.filter(
      (item) => item.capabilityContract === visibleCapability && item.validationState === 'configured',
    ) ?? [];
  const onStart = async (recipeId?: string, previous?: NimiMachineLoadout, customize = false) => {
    if (!visibleCapability) return;
    setBusy(true);
    setError('');
    try {
      const owner = props.profileUseOwner;
      const task = store.createTask({
        capabilityContract: visibleCapability,
        source: {
          ...(owner ?? { kind: 'runtime' as const }),
          accountId: await currentDesktopAccountIdForSetup(),
          returnFocus: owner?.returnFocus ?? 'runtime.aiSettings',
        },
      });
      if (recipeId) {
        const result = await createRuntimeSetupCandidate(store, task.taskId, ports, {
          recipeId,
          ...(previous
            ? { axes: previous.modelAxes, options: previous.options, displayName: previous.displayName }
            : {}),
        });
        if (result.status !== 'ok') setError(result.failure.message);
        else if (!customize) await resolveRuntimeSetupPreparation(store, task.taskId, ports);
      }
      setCustomizingTaskId(customize ? task.taskId : null);
      props.onOpenSetupTask(task.taskId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  const onHome = () => {
    props.onCloseSetupTask();
    props.onCloseSavedConfigs();
    setCapability(null);
    setSection('overview');
    setHomeRevision((value) => value + 1);
    void inventory.refetch();
  };
  const openCapability = (id: string) => {
    props.onCloseSetupTask();
    props.onCloseSavedConfigs();
    setCapability(id);
    setSection('overview');
    setError('');
  };
  const onReturnToSource = () => {
    const target = resolveRuntimeSetupReturnTarget(focusedTask?.source.returnFocus);
    props.onCloseSetupTask();
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
                  : `${label(entry.id)} · ${t(`runtimeConfig.capabilities.state.${entry.state.state}`)}`,
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
        <ScrollArea className="min-h-0 flex-1" contentClassName="space-y-3 px-2 pb-3">
          {groupCapabilities(railEntries.map((entry) => entry.id)).map(({ group, items }) => (
            <div key={group} className="space-y-0.5">
              <p className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-[var(--nimi-text-muted)]">
                {t(`runtimeConfig.capabilities.group.${group}`)}
              </p>
              {items.map((id) => {
                const entry = railEntries.find((item) => item.id === id)!;
                const Icon = capabilityIcon(id);
                const state = entry.state.state;
                const exception = state !== 'ready';
                const ExceptionIcon = state === 'ready' ? null : EXCEPTION_ICON[state];
                const exceptionColor = state === 'ready' ? '' : EXCEPTION_COLOR[state];
                const secondary =
                  state === 'ready'
                    ? entry.model
                    : state === 'preparing' || state === 'attention'
                      ? t(`runtimeConfig.capabilities.state.${state}`)
                      : state === 'unset'
                        ? t('runtimeConfig.capabilities.state.unset')
                        : '';
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
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--nimi-text-primary)]">
                        {label(id)}
                      </span>
                      {secondary ? (
                        <span
                          className={`block truncate text-xs ${exception ? exceptionColor : 'text-[var(--nimi-text-secondary)]'}`}
                        >
                          {secondary}
                          {entry.state.replacement && entry.state.task
                            ? ` · ${t(`runtimeConfig.setupTask.status.${entry.state.task.status}`)}`
                            : ''}
                        </span>
                      ) : (
                        <span className="sr-only">{t(`runtimeConfig.capabilities.state.${state}`)}</span>
                      )}
                    </span>
                    {ExceptionIcon ? (
                      <ExceptionIcon
                        size={13}
                        className={`shrink-0 ${exceptionColor} ${state === 'preparing' ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                    ) : null}
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
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          {focusedTask ? (
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
                initialAdvancedOpen={focusedTask.taskId === customizingTaskId}
                store={store}
                ports={ports}
                onClose={() => {
                  setCapability(focusedTask.capabilityContract);
                  props.onCloseSetupTask();
                  void inventory.refetch();
                }}
                onReturnToSource={onReturnToSource}
              />
            )
          ) : !visibleCapability ? (
            <div className="space-y-6">
              <header>
                <h1 className="text-2xl font-semibold tracking-tight">{t('runtimeConfig.product.setupsTitle')}</h1>
                <p className="mt-1.5 max-w-2xl text-sm text-[var(--nimi-text-secondary)]">
                  {inventory.isPending ? t('runtimeConfig.product.setupsLead') : railSummary}
                </p>
              </header>
              <RuntimeConfigAiSettingsProfilesSection
                key={homeRevision}
                store={store}
                ports={ports}
                runtimeWritesDisabled={props.runtimeWritesDisabled}
                owner={props.profileUseOwner}
                onCloseOwner={props.onCloseProfileUseOwner}
                onOpenSetupTask={props.onOpenSetupTask}
                onOpenSavedConfigs={props.onOpenSavedConfigs}
                onOpenCloudServices={props.onOpenCloudServices}
              />
            </div>
          ) : (
            <RuntimeCapabilityDetail
              key={visibleCapability}
              capability={visibleCapability}
              selected={selected}
              loadouts={saved}
              recipes={recipes}
              catalog={library.data?.catalog ?? []}
              assets={library.data?.assets ?? []}
              libraryLoading={library.isPending}
              libraryError={library.isError}
              environment={environment}
              status={status!}
              section={section}
              onSection={setSection}
              busy={busy}
              disabled={props.runtimeWritesDisabled}
              navigationContext={props.savedConfigsContext}
              onHome={onHome}
              onStart={onStart}
              onTask={props.onOpenSetupTask}
              onModelFiles={props.onOpenModelFiles}
              onDiagnostics={props.onOpenAdvancedDiagnostics}
              onModelMarket={props.onOpenModelMarket}
            />
          )}
        </ScrollArea>
      </Surface>
    </div>
  );
}
