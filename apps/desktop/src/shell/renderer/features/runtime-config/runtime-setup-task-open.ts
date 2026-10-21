import type {
  RuntimeSetupTask,
  RuntimeSetupTaskStore,
} from './runtime-setup-task-store.js';
import { validateHomeDestination, type HomeDestination, type HomeNavigation } from '../../app-shell/providers/home-navigation.js';
import type { DesktopAgentSessionRebindClients } from '../chat/chat-agent-session-rebind.js';

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
    if (existing.source.returnFocus !== input.source.returnFocus) {
      store.updateTask(existing.taskId, task => ({ source: { ...task.source, returnFocus: input.source.returnFocus } }));
    }
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
  | { readonly kind: 'destination'; readonly destination: HomeDestination }
  | { readonly kind: 'tab'; readonly tab: 'apps' | 'chat' }
  | { readonly kind: 'runtime' }
  | null;

/** Prepare an entry's source without letting its late result take navigation. */
export async function openRuntimeSetupTaskFromEntry(store: RuntimeSetupTaskStore, input: {
  navigation: HomeNavigation;
  capabilityContract: string;
  loadSource: (destination: HomeDestination) => Promise<RuntimeSetupTaskOpenSource>;
  openTask: (taskId: string) => void;
}) {
  const origin = input.navigation.getSnapshot();
  let left = false;
  const current = () => {
    const next = input.navigation.getSnapshot();
    return !left && next.generation === origin.generation && next.current === origin.current;
  };
  // Back may restore the same history entry. Remember that this operation
  // already lost its page, without adding a second navigation generation.
  const unsubscribe = input.navigation.subscribe(() => { if (!current()) left = true; });
  try {
    const source = await input.loadSource(origin.current.destination);
    if (!current()) return null;
    return openOrCreateRuntimeSetupTask(store, { ...input, source });
  } catch (error) { if (current()) throw error; return null; }
  finally { unsubscribe(); }
}

/**
 * Resolves the navigation-only return handle recorded on the task source to
 * an existing tab/focus mechanism. The handle grants no authority; unknown
 * handles resolve to staying on the Runtime surface.
 */
export function resolveRuntimeSetupReturnTarget(returnFocus: string | undefined): RuntimeSetupReturnTarget {
  const value = (returnFocus ?? '').trim();
  if (!value) return null;
  if (value.startsWith('home:')) {
    try {
      const destination = validateHomeDestination(JSON.parse(decodeURIComponent(value.slice(5))));
      // A persisted selector is not a current-session capability. Without a
      // stable binding the supported destination is the partner list.
      if (destination.id === 'agent-center') return { kind: 'destination', destination: { id: 'agent-center', chat: {
        mode: 'agent', ...(destination.chat?.agentBinding ? { agentBinding: destination.chat.agentBinding,
          ...(destination.chat.conversationAnchorId ? { conversationAnchorId: destination.chat.conversationAnchorId } : {}) } : {}),
      } } };
      return { kind: 'destination', destination };
    }
    catch { return null; }
  }
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

export async function resolveRuntimeSetupAgentDestination(destination: HomeDestination, clients: DesktopAgentSessionRebindClients): Promise<HomeDestination> {
  if (destination.id !== 'agent-center' || !destination.chat?.agentBinding) return destination;
  const matches = (await clients.agents.listReferences()).filter(item => item.agentBinding === destination.chat!.agentBinding);
  if (matches.length !== 1) return { id: 'agent-center' };
  const reference = matches[0]!;
  const anchor = destination.chat.conversationAnchorId;
  if (anchor) {
    const snapshot = await clients.conversation.snapshot({ agentHandle: reference.agentHandle, conversationAnchorId: anchor });
    if (snapshot.conversationAnchorId !== anchor) throw new Error('Conversation reference could not be restored.');
  }
  return { id: 'agent-center', chat: { mode: 'agent', agentHandle: reference.agentHandle,
    ...(anchor ? { conversationAnchorId: anchor } : {}) } };
}

/** Finish this setup detour through the existing navigation owner. */
export async function returnFromRuntimeSetup(navigation: HomeNavigation, destination: HomeDestination) {
  while (navigation.getSnapshot().current.destination.id === 'runtime' && navigation.getSnapshot().canGoBack) {
    const result = await navigation.back();
    if (result.status !== 'committed') return result;
  }
  return navigation.getSnapshot().current.destination.id === destination.id
    ? navigation.replace(destination) : navigation.push(destination);
}
