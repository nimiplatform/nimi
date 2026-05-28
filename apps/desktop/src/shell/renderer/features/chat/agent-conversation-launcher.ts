import { queryClient } from '@renderer/infra/query-client/query-client';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import type { AgentLocalTargetSnapshot, AgentLocalThreadRecord, AgentLocalThreadSummary } from '@renderer/bridge/runtime-bridge/types';
import { randomIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { createEmptyAgentThreadBundle } from './chat-agent-shell-bundle.js';
import { bundleQueryKey, THREADS_QUERY_KEY, upsertThreadSummary } from './chat-agent-shell-core.js';
import { findAgentConversationThreadByLocalAgentRef } from './chat-agent-thread-model.js';
import type { AppStoreState } from '@renderer/app-shell/providers/store-types';
import type { ConversationMode } from '@nimiplatform/kit/features/chat/headless';
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
  queryClient.setQueryData<readonly AgentLocalThreadSummary[]>(THREADS_QUERY_KEY, (current) =>
    upsertThreadSummary(current || [], thread),
  );
  queryClient.setQueryData(bundleQueryKey(thread.id), createEmptyAgentThreadBundle(thread));
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
