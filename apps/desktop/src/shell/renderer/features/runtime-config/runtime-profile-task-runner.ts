import {
  commitRuntimeSetupCloudUse,
  reopenRuntimeSetupTask,
  resolveRuntimeSetupPreparation,
  runRuntimeSetupPreparation,
  type RuntimeSetupPreparationPlan,
  type RuntimeSetupRunnerPorts,
  type RuntimeSetupRunnerResult,
} from './runtime-setup-task-runner.js';
import type { RuntimeSetupTaskStore } from './runtime-setup-task-store.js';

export type RuntimeProfileRateLimitWait = {
  readonly resumeAtMs: number;
  readonly attempt: number;
  readonly maxAttempts: number;
};

export type RuntimeProfileRateLimitRetryPolicy = {
  readonly maxAttempts?: number;
  readonly defaultWaitMs?: number;
  readonly maxWaitMs?: number;
  readonly nowMs?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

const DEFAULT_RATE_LIMIT_MAX_ATTEMPTS = 2;
const DEFAULT_RATE_LIMIT_WAIT_MS = 30_000;
const DEFAULT_RATE_LIMIT_MAX_WAIT_MS = 300_000;
const RATE_LIMIT_REASON_CODE = 'AI_PROVIDER_RATE_LIMITED';

// Shell-lifetime liveness only; authorization remains on the existing tasks.
const runningUses = new Map<string, AbortController>();
const waitingUses = new Map<string, RuntimeProfileRateLimitWait>();
const runListeners = new Set<() => void>();
export const isRuntimeProfileRunning = (useId: string) => runningUses.has(useId);
export const getRuntimeProfileRateLimitWait = (useId: string): RuntimeProfileRateLimitWait | undefined => waitingUses.get(useId);
export function stopRuntimeProfileRun(useId: string) {
  const controller = runningUses.get(useId);
  if (controller) controller.abort();
  if (waitingUses.delete(useId)) publishRuns();
}
export function subscribeRuntimeProfileRuns(listener: () => void) {
  runListeners.add(listener);
  return () => {
    runListeners.delete(listener);
  };
}
function publishRuns() {
  for (const listener of runListeners) listener();
}

function waitWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// @nimi-authority: rule.nimi.desktop.ai-consumption.r026
export async function runRuntimeProfileTasks(input: {
  store: RuntimeSetupTaskStore;
  taskIds: readonly string[];
  ports: RuntimeSetupRunnerPorts;
  plans: Readonly<Record<string, RuntimeSetupPreparationPlan>>;
  choices: Readonly<Record<string, Readonly<Record<string, string>>>>;
  mode: 'prepare-only' | 'prepare-and-use';
  rateLimitRetry?: RuntimeProfileRateLimitRetryPolicy;
}): Promise<void> {
  const useId = input.store.getTask(input.taskIds[0] ?? '')?.draft?.profileUseId ?? input.taskIds.join('|');
  if (runningUses.has(useId)) return;
  const controller = new AbortController();
  runningUses.set(useId, controller);
  publishRuns();
  const maxAttempts = Math.max(0, input.rateLimitRetry?.maxAttempts ?? DEFAULT_RATE_LIMIT_MAX_ATTEMPTS);
  const defaultWaitMs = Math.max(0, input.rateLimitRetry?.defaultWaitMs ?? DEFAULT_RATE_LIMIT_WAIT_MS);
  const maxWaitMs = Math.max(defaultWaitMs, input.rateLimitRetry?.maxWaitMs ?? DEFAULT_RATE_LIMIT_MAX_WAIT_MS);
  const nowMs = input.rateLimitRetry?.nowMs ?? (() => Date.now());
  const sleep = input.rateLimitRetry?.sleep ?? waitWithAbort;
  const activePlans: Record<string, RuntimeSetupPreparationPlan> = { ...input.plans };

  const runPass = async (passTaskIds: readonly string[]) => {
    for (const taskId of passTaskIds) {
      if (controller.signal.aborted) break;
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
          const plan = activePlans[taskId];
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
  };

  try {
    // This promise belongs to the task store's lifetime, not its React view.
    // Each task retains its own conditions, effects and recovery state.
    await runPass(input.taskIds);

    for (let attempt = 1; attempt <= maxAttempts && !controller.signal.aborted; attempt += 1) {
      const rateLimitedTasks = input.taskIds
        .map((taskId) => input.store.getTask(taskId))
        .filter((task): task is NonNullable<typeof task> => Boolean(
          task
          && task.status === 'failed'
          && task.draft?.route !== 'cloud'
          && task.failure?.reasonCode === RATE_LIMIT_REASON_CODE,
        ));
      if (rateLimitedTasks.length === 0) break;

      const requestedWaitMs = rateLimitedTasks.reduce((max, task) => {
        const seconds = task.failure?.retryAfterSeconds;
        return seconds && seconds > 0 ? Math.max(max, seconds * 1000) : max;
      }, 0);
      const waitMs = Math.min(maxWaitMs, requestedWaitMs > 0 ? requestedWaitMs : defaultWaitMs);
      waitingUses.set(useId, { resumeAtMs: nowMs() + waitMs, attempt, maxAttempts });
      publishRuns();
      await sleep(waitMs, controller.signal);
      waitingUses.delete(useId);
      publishRuns();
      if (controller.signal.aborted) break;

      const retryableIds: string[] = [];
      for (const task of rateLimitedTasks) {
        if (controller.signal.aborted) break;
        const latest = input.store.getTask(task.taskId);
        if (!latest || latest.status !== 'failed' || latest.failure?.reasonCode !== RATE_LIMIT_REASON_CODE) continue;
        reopenRuntimeSetupTask(input.store, task.taskId);
        const refreshed = await resolveRuntimeSetupPreparation(input.store, task.taskId, input.ports, {
          acceptExternalCandidateState: true,
        });
        if (refreshed.status !== 'ok') continue;
        const taskChoices = input.choices[task.taskId] ?? {};
        if (refreshed.value.unavailable.length > 0
          || !refreshed.value.awaitingChoice.every((choice) => Boolean(taskChoices[choice.slotId]))) {
          continue;
        }
        activePlans[task.taskId] = refreshed.value;
        retryableIds.push(task.taskId);
      }
      if (retryableIds.length === 0 || controller.signal.aborted) break;
      await runPass(retryableIds);
    }
  } finally {
    waitingUses.delete(useId);
    runningUses.delete(useId);
    publishRuns();
  }
}
