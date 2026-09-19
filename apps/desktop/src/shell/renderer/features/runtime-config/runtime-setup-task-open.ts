import type {
  RuntimeSetupTask,
  RuntimeSetupTaskStore,
} from './runtime-setup-task-store.js';

/**
 * Consumer entry helper: Apps/Chat open (or reuse) one setup task per exact
 * owner + capability and navigate to it. Task reuse keeps an in-flight task
 * from being duplicated when the same consumer entry is invoked twice.
 */
// @nimi-authority: rule.nimi.desktop.ai-consumption.r026

export type RuntimeSetupTaskOpenSource = {
  readonly kind: 'app' | 'local-agent';
  readonly ownerAppId?: string;
  readonly accountId: string;
  readonly returnFocus?: string;
};

function taskIsOpenable(task: RuntimeSetupTask): boolean {
  return task.status !== 'done' && task.status !== 'failed' && task.status !== 'stopped';
}

function sameOpenSource(task: RuntimeSetupTask, source: RuntimeSetupTaskOpenSource): boolean {
  return task.source.kind === source.kind
    && (task.source.ownerAppId ?? '') === (source.ownerAppId ?? '')
    && task.source.accountId === source.accountId;
}

/** Finds a live task for the exact same capability + owner + account snapshot. */
export function findReusableRuntimeSetupTask(
  store: RuntimeSetupTaskStore,
  input: {
    readonly capabilityContract: string;
    readonly source: RuntimeSetupTaskOpenSource;
  },
): RuntimeSetupTask | null {
  const candidates = store.getSnapshot().tasks.filter((task) => (
    task.capabilityContract === input.capabilityContract
    && taskIsOpenable(task)
    && !task.supersededBy
    && sameOpenSource(task, input.source)
  ));
  if (candidates.length === 0) return null;
  // Newest first: the latest task for the same owner wins the reuse.
  return candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

/**
 * Reuses a live task or creates a new one, then hands the task id to the
 * caller's navigation. Returns the task id and whether it was reused.
 */
export function openOrCreateRuntimeSetupTask(
  store: RuntimeSetupTaskStore,
  input: {
    readonly capabilityContract: string;
    readonly source: RuntimeSetupTaskOpenSource;
    readonly openTask: (taskId: string) => void;
  },
): { readonly taskId: string; readonly reused: boolean } {
  const existing = findReusableRuntimeSetupTask(store, input);
  if (existing) {
    input.openTask(existing.taskId);
    return { taskId: existing.taskId, reused: true };
  }
  const task = store.createTask({
    capabilityContract: input.capabilityContract,
    source: {
      kind: input.source.kind,
      ...(input.source.ownerAppId ? { ownerAppId: input.source.ownerAppId } : {}),
      accountId: input.source.accountId,
      ...(input.source.returnFocus ? { returnFocus: input.source.returnFocus } : {}),
    },
  });
  input.openTask(task.taskId);
  return { taskId: task.taskId, reused: false };
}

export type RuntimeSetupReturnTarget =
  | { readonly kind: 'tab'; readonly tab: 'apps' | 'chat' }
  | { readonly kind: 'runtime' }
  | null;

/**
 * Resolves the navigation-only return handle recorded on the task source to
 * an existing tab/focus mechanism. The handle grants no authority; unknown
 * handles resolve to staying on the Runtime surface.
 */
export function resolveRuntimeSetupReturnTarget(returnFocus: string | undefined): RuntimeSetupReturnTarget {
  const value = (returnFocus ?? '').trim();
  if (!value) return null;
  if (value === 'apps' || value.startsWith('app:') || value.startsWith('apps:')) {
    return { kind: 'tab', tab: 'apps' };
  }
  if (value === 'chat' || value.startsWith('chat:')) {
    return { kind: 'tab', tab: 'chat' };
  }
  if (value.startsWith('runtime')) {
    return { kind: 'runtime' };
  }
  return null;
}
