import { queryClient } from '@renderer/infra/query-client/query-client';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import type { AgentLocalMessageRecord, AgentLocalTargetSnapshot, AgentLocalThreadRecord, AgentLocalThreadSummary } from '@renderer/bridge/runtime-bridge/types';
import { randomIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { buildAgentGreetingSeedMessage, createEmptyAgentThreadBundle } from './chat-agent-shell-bundle.js';
import { bundleQueryKey, THREADS_QUERY_KEY, upsertThreadSummary } from './chat-agent-shell-core.js';
import { findAgentConversationThreadByLocalAgentRef } from './chat-agent-thread-model.js';
import type { AppStoreState } from '@renderer/app-shell/providers/store-types';
import type { ConversationMode } from '@nimiplatform/nimi-kit/features/chat/headless';
import type { AgentConversationSelection } from './chat-shell-types.js';

type AgentConversationLauncherInput = {
  target: AgentLocalTargetSnapshot;
  setActiveTab: AppStoreState['setActiveTab'];
  setChatMode: AppStoreState['setChatMode'];
  setSelectedTargetForSource: (source: ConversationMode, targetId: string | null) => void;
  setAgentConversationSelection: (selection: AgentConversationSelection) => void;
};

export type AgentInteractionLaunchKind = 'chat' | 'voice';

export type AgentInteractionLaunchResult = {
  threadId: string;
  createdThread: boolean;
  interaction: AgentInteractionLaunchKind;
  routedSurface: 'agent-conversation';
};

async function resolveExistingAgentThread(
  localAgentRef: string,
): Promise<AgentLocalThreadSummary | null> {
  const cachedThreads = queryClient.getQueryData<readonly AgentLocalThreadSummary[]>(THREADS_QUERY_KEY) || [];
  const cached = findAgentConversationThreadByLocalAgentRef(cachedThreads, localAgentRef);
  if (cached) {
    return cached;
  }
  const listedThreads = await chatAgentStoreClient.listThreads();
  queryClient.setQueryData(THREADS_QUERY_KEY, listedThreads);
  return findAgentConversationThreadByLocalAgentRef(listedThreads, localAgentRef);
}

/**
 * Seed the RealmAgent's first-turn opening message into a freshly-created,
 * empty AgentFriend thread.
 *
 * This is an ordinary, generic thread-open mechanic keyed purely on the
 * ordinary `AgentLocalTargetSnapshot.greeting` field (projected from
 * `AgentProfile.greeting`): any RealmAgent that carries a non-empty greeting
 * gets its greeting rendered as the opening assistant message, uniformly.
 * There is no guide-specific identifier or branch here.
 *
 * The greeting is rendered VERBATIM as a complete assistant message — it is
 * not produced by a runtime turn (the manual specifies an exact first-message
 * floor as product authority). The message is persisted as an ordinary
 * `agent_messages` row so it survives store reload.
 *
 * Returns the seeded message records (empty when the agent has no greeting).
 */
async function seedFirstMessageFromGreeting(
  thread: AgentLocalThreadRecord,
  target: AgentLocalTargetSnapshot,
): Promise<AgentLocalMessageRecord[]> {
  const seedMessage = buildAgentGreetingSeedMessage({
    threadId: thread.id,
    greeting: target.greeting,
    createdAtMs: thread.createdAtMs + 1,
  });
  if (!seedMessage) {
    return [];
  }
  const persisted = await chatAgentStoreClient.createMessage(seedMessage);
  return [persisted];
}

async function createAgentThread(
  target: AgentLocalTargetSnapshot,
): Promise<AgentLocalThreadRecord> {
  const timestampMs = Date.now();
  const thread = await chatAgentStoreClient.createThread({
    id: randomIdV11('agent-thread'),
    ownerUserId: target.ownerUserId,
    realmAgentId: target.realmAgentId,
    localAgentRef: target.localAgentRef,
    title: target.displayName,
    createdAtMs: timestampMs,
    updatedAtMs: timestampMs,
    lastMessageAtMs: null,
    archivedAtMs: null,
    targetSnapshot: target,
  });
  // Ordinary first-message floor: seed the RealmAgent's stored `greeting` as
  // the opening assistant message of the new empty thread.
  const seededMessages = await seedFirstMessageFromGreeting(thread, target);
  queryClient.setQueryData<readonly AgentLocalThreadSummary[]>(THREADS_QUERY_KEY, (current) =>
    upsertThreadSummary(current || [], thread),
  );
  queryClient.setQueryData(bundleQueryKey(thread.id), {
    ...createEmptyAgentThreadBundle(thread),
    messages: seededMessages,
  });
  return thread;
}

export async function launchAgentConversationFromDisplay(
  input: AgentConversationLauncherInput,
): Promise<AgentInteractionLaunchResult> {
  return launchAgentInteractionFromDisplay({
    ...input,
    interaction: 'chat',
  });
}

export async function launchAgentVoiceFromDisplay(
  input: AgentConversationLauncherInput,
): Promise<AgentInteractionLaunchResult> {
  return launchAgentInteractionFromDisplay({
    ...input,
    interaction: 'voice',
  });
}

async function launchAgentInteractionFromDisplay(
  input: AgentConversationLauncherInput & {
    interaction: AgentInteractionLaunchKind;
  },
): Promise<AgentInteractionLaunchResult> {
  const localAgentRef = String(input.target.localAgentRef || '').trim();
  if (!localAgentRef) {
    throw new Error('Agent conversation launch requires localAgentRef');
  }

  let thread = await resolveExistingAgentThread(localAgentRef);
  const createdThread = !thread;
  if (!thread) {
    thread = await createAgentThread(input.target);
  }

  input.setSelectedTargetForSource('agent', localAgentRef);
  input.setAgentConversationSelection({
    threadId: thread.id,
    localAgentRef,
    targetId: localAgentRef,
  });
  input.setChatMode('agent');
  input.setActiveTab('chat');

  return {
    threadId: thread.id,
    createdThread,
    interaction: input.interaction,
    routedSurface: 'agent-conversation',
  };
}
