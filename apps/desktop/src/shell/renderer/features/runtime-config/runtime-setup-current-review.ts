import type { RuntimeSetupTaskStore } from './runtime-setup-task-store.js';
import type { NimiJsonObject } from '@nimiplatform/sdk/contracts';
import { resolveRuntimeSetupPreparation, type RuntimeSetupPreparationPlan, type RuntimeSetupRunnerPorts } from './runtime-setup-task-runner.js';

// @nimi-authority: rule.nimi.desktop.ai-consumption.r026
/** Review exactly the selected configurations. No new model, route or resource is chosen. */
export async function reviewCurrentLocalSetup(
  store: RuntimeSetupTaskStore,
  ports: RuntimeSetupRunnerPorts,
  capabilities: readonly string[],
): Promise<readonly { taskId: string; plan: RuntimeSetupPreparationPlan | null }[]> {
  const accountId = await ports.account.currentAccountId();
  const aggregate = await ports.loadouts.get();
  const result: { taskId: string; plan: RuntimeSetupPreparationPlan | null }[] = [];
  for (const capabilityContract of new Set(capabilities)) {
    const selectedId = aggregate.selections.find(item => item.capabilityContract === capabilityContract)?.loadoutId;
    const candidate = aggregate.loadouts.find(item => item.loadoutId === selectedId);
    const existing = store.getSnapshot().tasks.find(task => task.source.kind === 'runtime'
      && task.source.accountId === accountId && task.capabilityContract === capabilityContract
      && task.candidateLoadoutId === selectedId && !task.supersededBy
      && (['preparing', 'committing'].includes(task.status)
        || (task.source.returnFocus === 'apps' && !task.draft?.profileUseId && ['draft', 'review'].includes(task.status))));
    const task = existing ?? store.createTask({ capabilityContract, source: { kind: 'runtime', accountId, returnFocus: 'apps' } });
    if (task.status === 'preparing' || task.status === 'committing') {
      result.push({ taskId: task.taskId, plan: null });
      continue;
    }
    if (!candidate) {
      store.updateTask(task.taskId, () => ({ status: 'needs-attention', nextAction: 'choose-model',
        failure: { stage: 'reuse-check', reasonCode: 'AI_LOCAL_SELECTION_NOT_FOUND', message: 'Choose a local model before preparing this capability.' } }));
      result.push({ taskId: task.taskId, plan: null });
      continue;
    }
    if (!existing) store.updateTask(task.taskId, () => ({
      candidateLoadoutId: candidate.loadoutId,
      candidateRevisionBaseline: candidate.revision,
      draft: { route: 'local', recipeId: candidate.recipeId, options: candidate.options as NimiJsonObject },
    }));
    const reviewed = await resolveRuntimeSetupPreparation(store, task.taskId, ports);
    result.push({ taskId: task.taskId, plan: reviewed.status === 'ok' ? reviewed.value : null });
  }
  return result;
}
