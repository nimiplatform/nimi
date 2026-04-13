import type {
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import {
  peekDesktopAISchedulingForEvidence,
  recordDesktopAISnapshot,
  resolveAIConfigSchedulingTargetForCapability,
} from '@renderer/app-shell/providers/desktop-ai-config-service';
import {
  AGENT_VOICE_WORKFLOW_CAPABILITIES,
  createAISnapshot,
  type AISnapshot,
  type AgentVoiceWorkflowCapability,
} from './conversation-capability';
import {
  createEmptyAgentThreadBundle,
} from './chat-agent-shell-bundle';
import {
  upsertThreadSummary,
} from './chat-agent-shell-core';
import type {
  UseAgentConversationHostActionsInput,
} from './chat-agent-shell-host-actions-types';

export function toFallbackThreadRecord(
  thread: AgentLocalThreadSummary | AgentLocalThreadRecord,
): AgentLocalThreadRecord {
  if ('createdAtMs' in thread && typeof thread.createdAtMs === 'number') {
    return {
      ...thread,
      createdAtMs: thread.createdAtMs,
    };
  }
  return {
    ...thread,
    createdAtMs: Date.now(),
  };
}

export async function buildVoiceWorkflowExecutionSnapshots(input: {
  hostInput: UseAgentConversationHostActionsInput;
  agentResolution: Parameters<UseAgentConversationHostActionsInput['runAgentTurn']>[0]['agentResolution'];
}): Promise<Partial<Record<AgentVoiceWorkflowCapability, AISnapshot | null>>> {
  const snapshots: Partial<Record<AgentVoiceWorkflowCapability, AISnapshot | null>> = {};
  for (const workflowCapability of AGENT_VOICE_WORKFLOW_CAPABILITIES) {
    const workflowProjection = input.agentResolution.voiceWorkflowProjections[workflowCapability] || null;
    if (!workflowProjection?.supported || !workflowProjection.resolvedBinding) {
      continue;
    }
    const workflowExecutionSnapshot = createAISnapshot({
      config: input.hostInput.aiConfig,
      capability: workflowCapability,
      projection: workflowProjection,
      agentResolution: input.agentResolution,
      runtimeEvidence: await peekDesktopAISchedulingForEvidence({
        scopeRef: input.hostInput.aiConfig.scopeRef,
        target: resolveAIConfigSchedulingTargetForCapability(input.hostInput.aiConfig, workflowCapability),
      }),
    });
    snapshots[workflowCapability] = workflowExecutionSnapshot;
    recordDesktopAISnapshot(workflowExecutionSnapshot);
  }
  return snapshots;
}

export async function rollbackOptimisticUserProjection(input: {
  hostInput: UseAgentConversationHostActionsInput;
  optimisticThreadId: string | null;
  optimisticBaseThread: AgentLocalThreadRecord | null;
  optimisticUserMessageIds: readonly string[];
  submittedTextForRecovery: string;
}): Promise<void> {
  if (
    !input.optimisticThreadId
    || !input.optimisticBaseThread
    || !input.submittedTextForRecovery
  ) {
    return;
  }
  const rollbackThreadId = input.optimisticThreadId;
  const rollbackThread = input.optimisticBaseThread;
  const fallbackDraftUpdatedAtMs = Date.now();
  const recoveredDraft = await chatAgentStoreClient.putDraft({
    threadId: rollbackThreadId,
    text: input.submittedTextForRecovery,
    updatedAtMs: fallbackDraftUpdatedAtMs,
  }).catch(() => null);
  input.hostInput.currentDraftTextRef.current = input.submittedTextForRecovery;
  input.hostInput.setThreadsCache((current) => upsertThreadSummary(current, rollbackThread));
  input.hostInput.setBundleCache(rollbackThreadId, (current) => {
    const base = current || createEmptyAgentThreadBundle(rollbackThread);
    return {
      ...base,
      thread: rollbackThread,
      messages: base.messages.filter((message) => !input.optimisticUserMessageIds.includes(message.id)),
      draft: recoveredDraft || {
        threadId: rollbackThreadId,
        text: input.submittedTextForRecovery,
        updatedAtMs: fallbackDraftUpdatedAtMs,
      },
    };
  });
}
