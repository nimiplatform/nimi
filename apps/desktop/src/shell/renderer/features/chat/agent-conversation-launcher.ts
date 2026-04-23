import { queryClient } from '@renderer/infra/query-client/query-client';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import type { AgentLocalTargetSnapshot, AgentLocalThreadRecord, AgentLocalThreadSummary } from '@renderer/bridge/runtime-bridge/types';
import { randomIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { createEmptyAgentThreadBundle } from './chat-agent-shell-bundle.js';
import { bundleQueryKey, THREADS_QUERY_KEY, upsertThreadSummary } from './chat-agent-shell-core.js';
import { findAgentConversationThreadByAgentId } from './chat-agent-thread-model.js';
import type { AppStoreState, RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import type { ConversationMode } from '@nimiplatform/nimi-kit/features/chat/headless';
import type { AgentConversationSelection } from './chat-shell-types.js';

type AgentConversationLauncherInput = {
  target: AgentLocalTargetSnapshot;
  setActiveTab: AppStoreState['setActiveTab'];
  setChatMode: AppStoreState['setChatMode'];
  setSelectedTargetForSource: (source: ConversationMode, targetId: string | null) => void;
  setAgentConversationSelection: (selection: AgentConversationSelection) => void;
  setRuntimeFields: (updates: Partial<RuntimeFieldMap>) => void;
};

export type AgentInteractionLaunchKind = 'chat' | 'voice';

export type AgentInteractionLaunchResult = {
  threadId: string;
  createdThread: boolean;
  interaction: AgentInteractionLaunchKind;
  routedSurface: 'agent-conversation';
};

async function resolveExistingAgentThread(
  agentId: string,
): Promise<AgentLocalThreadSummary | null> {
  const cachedThreads = queryClient.getQueryData<readonly AgentLocalThreadSummary[]>(THREADS_QUERY_KEY) || [];
  const cached = findAgentConversationThreadByAgentId(cachedThreads, agentId);
  if (cached) {
    return cached;
  }
  const listedThreads = await chatAgentStoreClient.listThreads();
  queryClient.setQueryData(THREADS_QUERY_KEY, listedThreads);
  return findAgentConversationThreadByAgentId(listedThreads, agentId);
}

async function createAgentThread(
  target: AgentLocalTargetSnapshot,
): Promise<AgentLocalThreadRecord> {
  const timestampMs = Date.now();
  const thread = await chatAgentStoreClient.createThread({
    id: randomIdV11('agent-thread'),
    agentId: target.agentId,
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
  const agentId = String(input.target.agentId || '').trim();
  if (!agentId) {
    throw new Error('Agent conversation launch requires agentId');
  }

  let thread = await resolveExistingAgentThread(agentId);
  const createdThread = !thread;
  if (!thread) {
    thread = await createAgentThread(input.target);
  }

  input.setSelectedTargetForSource('agent', agentId);
  input.setAgentConversationSelection({
    threadId: thread.id,
    agentId,
    targetId: agentId,
  });
  input.setRuntimeFields({
    targetType: 'AGENT',
    targetAccountId: agentId,
    agentId,
    targetId: agentId,
    worldId: input.target.worldId || '',
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
