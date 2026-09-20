import { Button, InlineAlert, LoadingSkeleton } from '@nimiplatform/kit/ui';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useCapabilityInventory } from './runtime-capability-inventory.js';
import { capabilityIcon, modelDisplayTitle, setupPlanNeedsPreparation } from './runtime-capability-presentation.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { RuntimeSetupTaskCloudPanel } from './runtime-config-setup-task-cloud.js';
import { RuntimeConfigSetupTaskView, SetupTaskPlanReview } from './runtime-config-setup-task-view.js';
import {
  isRuntimeProfileRunning,
  runRuntimeProfileTasks,
  subscribeRuntimeProfileRuns,
} from './runtime-profile-task-runner.js';
import {
  reopenRuntimeSetupTask,
  resolveRuntimeSetupPreparation,
  type RuntimeSetupPreparationPlan,
  type RuntimeSetupRunnerPorts,
} from './runtime-setup-task-runner.js';
import { useRuntimeSetupTasks, type RuntimeSetupTaskStore } from './runtime-setup-task-store.js';

// @nimi-authority: rule.nimi.desktop.ai-consumption.r026
export function RuntimeProfileTaskView(props: {
  readonly useId: string;
  readonly store: RuntimeSetupTaskStore;
  readonly ports: RuntimeSetupRunnerPorts;
  readonly onClose: () => void;
  readonly onReturn: () => void;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const inventory = useCapabilityInventory();
  const ownerLabel = (appId?: string) =>
    appId === sdk.appId() ? 'Nimi Chat' : (appId ?? t('runtimeConfig.setupTask.sourceLocalAgent'));
  const snapshot = useRuntimeSetupTasks(props.store);
  const tasks = snapshot.tasks.filter((task) => task.draft?.profileUseId === props.useId);
  const taskKey = tasks.map((task) => task.taskId).join('|');
  const [plans, setPlans] = useState<Record<string, RuntimeSetupPreparationPlan>>({});
  const [choices, setChoices] = useState<Record<string, Record<string, string>>>({});
  const [checking, setChecking] = useState(false);
  const running = useSyncExternalStore(
    subscribeRuntimeProfileRuns,
    () => isRuntimeProfileRunning(props.useId),
    () => false,
  );
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const active = running || tasks.some((task) => task.status === 'preparing' || task.status === 'committing');
  const finished =
    tasks.length > 0 && tasks.every((task) => task.status === 'done' || task.status === 'stopped');
  const review = async (retry = false) => {
    if (active) return;
    setChecking(true);
    setError('');
    const next: Record<string, RuntimeSetupPreparationPlan> = {};
    try {
      for (const task of tasks) {
        if (task.status === 'done' || (task.status === 'stopped' && !retry) || task.failure?.machineSelected)
          continue;
        if (task.status === 'stopped' && retry) {
          props.store.updateTask(task.taskId, () => ({
            status: 'draft',
            failure: undefined,
            authorization: undefined,
            nextAction: 'review-preparation',
          }));
        }
        if (task.status === 'failed' || task.status === 'needs-attention') {
          if (!retry) continue;
          reopenRuntimeSetupTask(props.store, task.taskId);
        }
        if (task.draft?.route === 'cloud') continue;
        const result = await resolveRuntimeSetupPreparation(props.store, task.taskId, props.ports, {
          acceptExternalCandidateState: retry,
        });
        if (result.status === 'ok') next[task.taskId] = result.value;
        else if (result.status === 'blocked') setError(result.failure.message);
      }
      setPlans(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    if (!active) void review();
  }, [props.useId, taskKey]);
  const pending = tasks.filter(
    (task) => !['done', 'stopped', 'failed', 'needs-attention'].includes(task.status),
  );
  const canUse =
    pending.length > 0 &&
    pending.every((task) =>
      task.draft?.route === 'cloud'
        ? !!task.draft.cloudTargetKey
        : task.status === 'review' &&
        !!plans[task.taskId] &&
        !plans[task.taskId]!.unavailable.length &&
        plans[task.taskId]!.awaitingChoice.every((choice) => choices[task.taskId]?.[choice.slotId]),
    );
  const canPrepare =
    pending.some((task) => task.draft?.route !== 'cloud') &&
    pending
      .filter((task) => task.draft?.route !== 'cloud')
      .every(
        (task) =>
          task.status === 'review' &&
          !!plans[task.taskId] &&
          !plans[task.taskId]!.unavailable.length &&
          plans[task.taskId]!.awaitingChoice.every((choice) => choices[task.taskId]?.[choice.slotId]),
      );
  const run = (mode: 'prepare-only' | 'prepare-and-use') => {
    setError('');
    void runRuntimeProfileTasks({
      store: props.store,
      taskIds: tasks.map((task) => task.taskId),
      ports: props.ports,
      plans,
      choices,
      mode,
    }).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  };
  if (detail)
    return (
      <div className="space-y-4">
        <Button
          tone="ghost"
          onClick={() => {
            setDetail(null);
            void review();
          }}
        >
          {t('runtimeConfig.profileRun.back')}
        </Button>
        <RuntimeConfigSetupTaskView
          key={detail}
          taskId={detail}
          store={props.store}
          ports={props.ports}
          onClose={() => {
            setDetail(null);
            void review();
          }}
          onReturnToSource={props.onReturn}
        />
      </div>
    );
  return (
    <div className="space-y-5" data-testid="ai-profile-use-review">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {tasks[0]?.draft?.profileTitle ?? t('runtimeConfig.profileRun.title')}
          </h1>
          <p className="mt-1.5 text-sm text-[var(--nimi-text-secondary)]">
            {tasks[0]?.source.kind !== 'runtime'
              ? t('runtimeConfig.profileRun.scopeOwner', { owner: ownerLabel(tasks[0]?.source.ownerAppId) })
              : t('runtimeConfig.profileRun.scope')}
          </p>
        </div>
        <Button tone="ghost" size="sm" onClick={props.onClose}>
          {t('Common.close')}
        </Button>
      </header>
      {checking ? <LoadingSkeleton className="h-20" /> : null}
      {error ? <InlineAlert tone="warning">{error}</InlineAlert> : null}
      {tasks.map((task) => {
        const CapabilityIcon = capabilityIcon(task.capabilityContract);
        const recipeTitle = inventory.data?.recipes.find(recipe => recipe.recipeId === task.draft?.recipeId)?.title;
        const terminal = task.status === 'done' || task.status === 'stopped' || task.status === 'failed' || task.status === 'needs-attention';
        return (
        <section
          key={task.taskId}
          className="space-y-3 border-b border-[var(--nimi-border-subtle)] pb-5"
          data-testid={`ai-profile-task:${task.capabilityContract}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-surface-active)] text-[var(--nimi-text-secondary)]">
                <CapabilityIcon size={17} strokeWidth={1.7} aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-semibold">
                  {displayRuntimeConfigCapabilityLabel(task.capabilityContract, t)}
                </h2>
                {recipeTitle ? (
                  <p className="mt-0.5 text-sm text-[var(--nimi-text-secondary)]">{modelDisplayTitle(recipeTitle)}</p>
                ) : null}
              </div>
            </div>
            {tasks.length > 1 || terminal ? (
              <span className="text-xs text-[var(--nimi-text-secondary)]">
                {t(`runtimeConfig.setupTask.status.${task.status}`)}
              </span>
            ) : null}
          </div>
          {task.failure ? (
            <InlineAlert tone="warning">
              {task.failure.machineSelected ? t('runtimeConfig.setupTask.machineSelectionCompleted') : null}{' '}
              {task.failure.message}
            </InlineAlert>
          ) : null}
          {!active && !['done', 'stopped'].includes(task.status) && task.draft?.route === 'cloud' ? (
            <RuntimeSetupTaskCloudPanel
              task={task}
              store={props.store}
              ports={props.ports}
              onBusyChange={() => { }}
              selectionOnly
            />
          ) : null}
          {!active && task.status === 'review' && plans[task.taskId] ? (
            <SetupTaskPlanReview
              choiceGroup={task.taskId}
              plan={plans[task.taskId]!}
              choices={choices[task.taskId] ?? {}}
              onChoiceChange={(slot, ref) =>
                setChoices((prev) => ({ ...prev, [task.taskId]: { ...prev[task.taskId], [slot]: ref } }))
              }
              ownerLabel={task.source.kind === 'runtime' ? null : ownerLabel(task.source.ownerAppId)}
            />
          ) : null}
          <Button tone="ghost" size="sm" disabled={active} onClick={() => setDetail(task.taskId)}>
            {t('runtimeConfig.profileRun.inspect')}
          </Button>
        </section>
        );
      })}
      {(() => {
        const nothingToPrepare = canUse && pending.every(task => task.draft?.route === 'cloud' || !setupPlanNeedsPreparation(plans[task.taskId]!, choices[task.taskId] ?? {}));
        return (
          <div className="flex flex-wrap items-center gap-2">
            {finished ? (
              <>
                <Button tone="primary" onClick={props.onReturn}>
                  {t(
                    tasks[0]?.source.kind === 'runtime'
                      ? 'runtimeConfig.capabilities.backWorkspace'
                      : 'runtimeConfig.profileRun.return',
                  )}
                </Button>
                {tasks.some((task) => task.status === 'stopped') ? (
                  <Button
                    tone="secondary"
                    disabled={active || checking}
                    onClick={() => {
                      void review(true);
                    }}
                  >
                    {t('runtimeConfig.profileRun.resumeRemaining')}
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <Button
                  tone="primary"
                  disabled={active || checking || !canUse}
                  onClick={() => run('prepare-and-use')}
                  data-testid="ai-profile-confirm-use"
                >
                  {active ? <LoaderCircle size={15} className="animate-spin" /> : null}
                  {t(nothingToPrepare ? 'runtimeConfig.product.useTheseSettings' : 'runtimeConfig.profileRun.confirm')}
                </Button>
                {!nothingToPrepare && canPrepare ? (
                  <Button
                    tone="secondary"
                    disabled={active || checking}
                    onClick={() => run('prepare-only')}
                  >
                    {t('runtimeConfig.setupTask.prepareOnly')}
                  </Button>
                ) : null}
                <Button
                  tone="ghost"
                  size="sm"
                  disabled={active || checking}
                  onClick={() => {
                    void review(true);
                  }}
                >
                  {t('runtimeConfig.setupTask.reverify')}
                </Button>
                <Button
                  tone="ghost"
                  size="sm"
                  onClick={() => tasks.forEach((task) => props.store.stopTask(task.taskId))}
                  data-testid="ai-profile-stop"
                >
                  {t('runtimeConfig.profileRun.stop')}
                </Button>
              </>
            )}
            {!finished ? (
              <span className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.setupTask.closingKeepsRunning')}</span>
            ) : null}
          </div>
        );
      })()}
    </div>
  );
}
