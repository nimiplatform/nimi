import {
  commitRuntimeSetupCloudUse,
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
  const maxWaitMs = input.rateLimitRetry?.maxWaitMs ?? DEFAULT_RATE_LIMIT_MAX_WAIT_MS;
  const nowMs = input.rateLimitRetry?.nowMs ?? (() => Date.now());
  const sleep = input.rateLimitRetry?.sleep ?? waitWithAbort;
  const runPass = async (passTaskIds: readonly string[]) => {
    const limited: { taskId: string; waitMs: number }[] = [];
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
        if (result.status === 'failed' && current?.status === 'failed'
          && current.draft?.route !== 'cloud' && (result.failure.stage === 'install' || result.failure.stage === 'resolve-preparation')
          && result.failure.reasonCode === RATE_LIMIT_REASON_CODE) {
          const waitMs = result.failure.retryAfterSeconds === undefined ? defaultWaitMs : result.failure.retryAfterSeconds * 1000;
          if (waitMs <= maxWaitMs) limited.push({ taskId, waitMs });
        }
        if (current && !['done', 'stopped', 'failed', 'needs-attention'].includes(current.status)) {
          input.store.updateTask(taskId, () => ({
            status: 'needs-attention',
            failure: result.failure,
            nextAction: 'review-changes',
          }));
        }
      }
    }
    return limited;
  };

  try {
    // This promise belongs to the task store's lifetime, not its React view.
    // Each task retains its own conditions, effects and recovery state.
    let limited = await runPass(input.taskIds);

    for (let attempt = 1; attempt <= maxAttempts && !controller.signal.aborted; attempt += 1) {
      if (limited.length === 0) break;
      const waitMs = Math.max(...limited.map(item => item.waitMs));
      waitingUses.set(useId, { resumeAtMs: nowMs() + waitMs, attempt, maxAttempts });
      publishRuns();
      await sleep(waitMs, controller.signal);
      waitingUses.delete(useId);
      publishRuns();
      if (controller.signal.aborted) break;

      const retryableIds: string[] = [];
      for (const { taskId } of limited) {
        const latest = input.store.getTask(taskId);
        if (!latest || latest.status !== 'failed' || latest.failure?.reasonCode !== RATE_LIMIT_REASON_CODE) continue;
        // Preparation revalidates the original review and its revision baselines before writing.
        input.store.updateTask(taskId, () => ({ status: 'review', failure: undefined, nextAction: 'confirm-preparation' }));
        retryableIds.push(taskId);
      }
      if (retryableIds.length === 0 || controller.signal.aborted) break;
      limited = await runPass(retryableIds);
    }
  } finally {
    waitingUses.delete(useId);
    runningUses.delete(useId);
    publishRuns();
  }
}
