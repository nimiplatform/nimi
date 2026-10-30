import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, LoadingSkeleton } from '@nimiplatform/kit/ui';
import { useDesktopRendererCommands, useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useRuntimeConfigLocalEnvironmentClient } from '../runtime-config/runtime-config-local-environment-sdk-service.js';
import { createRuntimeSetupTaskRunnerPorts } from '../runtime-config/runtime-setup-task-ports.js';
import { getRuntimeSetupTaskStore, useRuntimeSetupTasks } from '../runtime-config/runtime-setup-task-store.js';
import { reviewCurrentLocalSetup } from '../runtime-config/runtime-setup-current-review.js';
import { SetupTaskPlanReview } from '../runtime-config/runtime-config-setup-task-view.js';
import { runRuntimeProfileTasks } from '../runtime-config/runtime-profile-task-runner.js';
import type { RuntimeSetupPreparationPlan } from '../runtime-config/runtime-setup-task-runner.js';
import { runtimeSetupFailureText } from '../runtime-config/runtime-setup-failure-message.js';
import { displayRuntimeConfigCapabilityLabel } from '../runtime-config/runtime-config-capability-labels.js';
import type { AppsAttentionIssue } from './apps-attention.js';
import { RuntimeConfigurationEnvironment } from '../runtime-config/runtime-configuration-environment.js';

// @nimi-authority: rule.nimi.desktop.ai-consumption.r026
export function AppsLocalPreparation({ issues, onClose, onChanged }: {
  readonly issues: readonly AppsAttentionIssue[];
  readonly onClose: () => void;
  readonly onChanged: () => void;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const commands = useDesktopRendererCommands();
  const environment = useRuntimeConfigLocalEnvironmentClient();
  const ports = useMemo(() => createRuntimeSetupTaskRunnerPorts(sdk, environment), [sdk, environment]);
  const store = getRuntimeSetupTaskStore();
  const snapshot = useRuntimeSetupTasks(store);
  const [review, setReview] = useState<readonly { taskId: string; plan: RuntimeSetupPreparationPlan | null }[]>([]);
  const [checking, setChecking] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const tasks = review.flatMap(item => snapshot.tasks.filter(task => task.taskId === item.taskId));
  const active = running || tasks.some(task => task.status === 'preparing' || task.status === 'committing');
  const check = async () => {
    setChecking(true);
    setError('');
    try {
      const next = await reviewCurrentLocalSetup(store, ports, issues.map(issue => issue.capabilityContract));
      for (const item of next) {
        if (!item.plan) continue;
        store.updateTask(item.taskId, task => ({ draft: { ...task.draft, reviewChoices: Object.fromEntries(item.plan!.awaitingChoice.flatMap(choice => {
          const previous = task.draft?.reviewChoices?.[choice.slotId];
          const offer = choice.options.find(option => option.offerRef === previous)
            ?? choice.options.find(option => option.recommended)
            ?? (choice.options.length === 1 ? choice.options[0] : undefined);
          return offer ? [[choice.slotId, offer.offerRef]] : [];
        })) } }));
      }
      setReview(next);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setChecking(false); }
  };
  useEffect(() => { void check(); }, [ports, issues]);
  const pending = tasks.filter(task => {
    if (task.status !== 'review') return false;
    const plan = review.find(item => item.taskId === task.taskId)?.plan;
    return plan && !plan.environmentUnavailable && !plan.unavailable.length
      && plan.awaitingChoice.every(choice => task.draft?.reviewChoices?.[choice.slotId]);
  });
  const run = async () => {
    setRunning(true);
    try {
      await runRuntimeProfileTasks({ store, ports, taskIds: pending.map(task => task.taskId),
        plans: Object.fromEntries(review.flatMap(item => item.plan ? [[item.taskId, item.plan]] : [])),
        choices: Object.fromEntries(tasks.map(task => [task.taskId, task.draft?.reviewChoices ?? {}])), mode: 'prepare-and-use' });
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setRunning(false); onChanged(); }
  };
  return <div className="space-y-4" data-testid="apps-local-preparation">
    <p className="text-sm text-[var(--nimi-text-secondary)]">{t('Apps.attention.preparationScope')}</p>
    {checking ? <LoadingSkeleton className="h-16" /> : null}
    {error ? <InlineAlert tone="warning">{error}</InlineAlert> : null}
    {tasks.map(task => {
      const plan = review.find(item => item.taskId === task.taskId)?.plan;
      return <section key={task.taskId} className="space-y-2 border-b border-[var(--nimi-border-subtle)] pb-4" data-testid={`apps-prepare:${task.capabilityContract}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{displayRuntimeConfigCapabilityLabel(task.capabilityContract, t)}</h3>
          <span className="text-xs text-[var(--nimi-text-secondary)]" role="status">{t(active && task.status === 'review' ? 'Apps.attention.queued' : `runtimeConfig.setupTask.status.${task.status}`)}</span>
        </div>
        {task.failure ? <InlineAlert tone="warning">{runtimeSetupFailureText(task.failure, t)}</InlineAlert> : null}
        {task.candidateLoadoutId && ['preparing', 'committing', 'failed', 'needs-attention'].includes(task.status) ?
          <RuntimeConfigurationEnvironment capability={task.capabilityContract} loadoutId={task.candidateLoadoutId}
            revision={task.candidateRevisionBaseline} disabled={active} polling={active} candidate /> : null}
        {plan && task.status === 'review' && !active ? <SetupTaskPlanReview plan={plan} choices={task.draft?.reviewChoices ?? {}} disabled={checking}
          choiceGroup={task.taskId} onChoiceChange={(slotId, offerRef) => store.updateTask(task.taskId, current => ({
            draft: { ...current.draft, reviewChoices: { ...current.draft?.reviewChoices, [slotId]: offerRef } },
          }))} /> : null}
        {!active && (task.failure?.reasonCode === 'AI_LOCAL_SELECTION_NOT_FOUND' || plan?.unavailable.length || plan?.environmentUnavailable) ? <Button size="sm" tone="secondary"
          onClick={() => commands.runtimeConfigNavigation.openCapability(task.capabilityContract)}>{t('Apps.attention.chooseLocal')}</Button> : null}
      </section>;
    })}
    <div className="flex flex-wrap items-center gap-2">
      {pending.length > 0 ? <Button tone="primary" disabled={checking || active} onClick={() => { void run(); }} data-testid="apps-confirm-local-preparation">
        {t(active ? 'Apps.attention.preparing' : 'Apps.attention.confirmPreparation', { count: pending.length })}
      </Button> : null}
      {active ? <Button tone="secondary" onClick={() => tasks.forEach(task => store.stopTask(task.taskId))}>{t('runtimeConfig.profileRun.stop')}</Button> : null}
      {!active && tasks.some(task => task.status === 'failed' || task.status === 'needs-attention' || task.status === 'stopped') ?
        <Button tone="secondary" disabled={checking} onClick={() => { void check(); }}>{t('runtimeConfig.setupTask.reverify')}</Button> : null}
      <Button tone="ghost" onClick={onClose}>{t('Common.close')}</Button>
    </div>
    {active ? <p className="text-xs text-[var(--nimi-text-secondary)]" role="status">{t('runtimeConfig.setupTask.closingKeepsRunning')}</p> : null}
  </div>;
}
