import {
  commitRuntimeSetupCloudUse,
  runRuntimeSetupPreparation,
  type RuntimeSetupPreparationPlan,
  type RuntimeSetupRunnerPorts,
  type RuntimeSetupRunnerResult,
} from './runtime-setup-task-runner.js';
import type { RuntimeSetupTaskStore } from './runtime-setup-task-store.js';

// Shell-lifetime liveness only; authorization remains on the existing tasks.
const runningUses = new Set<string>();
const runListeners = new Set<() => void>();
export const isRuntimeProfileRunning = (useId: string) => runningUses.has(useId);
export function subscribeRuntimeProfileRuns(listener: () => void) {
  runListeners.add(listener);
  return () => {
    runListeners.delete(listener);
  };
}
function publishRuns() {
  for (const listener of runListeners) listener();
}

// @nimi-authority: rule.nimi.desktop.ai-consumption.r026
export async function runRuntimeProfileTasks(input: {
  store: RuntimeSetupTaskStore;
  taskIds: readonly string[];
  ports: RuntimeSetupRunnerPorts;
  plans: Readonly<Record<string, RuntimeSetupPreparationPlan>>;
  choices: Readonly<Record<string, Readonly<Record<string, string>>>>;
  mode: 'prepare-only' | 'prepare-and-use';
}): Promise<void> {
  const useId = input.store.getTask(input.taskIds[0] ?? '')?.draft?.profileUseId ?? input.taskIds.join('|');
  if (runningUses.has(useId)) return;
  runningUses.add(useId);
  publishRuns();
  try {
    // This promise belongs to the task store's lifetime, not its React view.
    // Each task retains its own conditions, effects and recovery state.
    for (const taskId of input.taskIds) {
      const task = input.store.getTask(taskId);
      if (!task || ['done', 'stopped', 'failed', 'needs-attention'].includes(task.status)) continue;
      let result: RuntimeSetupRunnerResult<unknown>;
      try {
        if (task.draft?.route === 'cloud') {
          if (input.mode === 'prepare-only') continue;
          const key: unknown = task.draft.cloudTargetKey ? JSON.parse(task.draft.cloudTargetKey) : null;
          if (
            !Array.isArray(key) ||
            key.length !== 5 ||
            !key.slice(0, 4).every((value) => typeof value === 'string')
          )
            throw new Error('Choose a cloud connection and model before using this setup.');
          result = await commitRuntimeSetupCloudUse(input.store, taskId, input.ports, {
            connectorRef: key[0],
            implementation: { implementationId: key[1], driverId: key[2], driverDialect: key[3] },
            providerModelTarget: key[4],
            targetLabel: task.draft.cloudTargetLabel,
          });
        } else {
          const plan = input.plans[taskId];
          if (!plan) throw new Error('Review the preparation details before continuing.');
          result = await runRuntimeSetupPreparation(input.store, taskId, input.ports, {
            mode: input.mode,
            reviewedPlan: plan,
            choices: input.choices[taskId] ?? {},
          });
        }
      } catch (error) {
        result = {
          status: 'failed',
          failure: {
            stage: 'resolve-preparation',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
      if (result.status !== 'ok') {
        const current = input.store.getTask(taskId);
        if (current && !['done', 'stopped', 'failed', 'needs-attention'].includes(current.status)) {
          input.store.updateTask(taskId, () => ({
            status: 'needs-attention',
            failure: result.failure,
            nextAction: 'review-changes',
          }));
        }
      }
    }
  } finally {
    runningUses.delete(useId);
    publishRuns();
  }
}
