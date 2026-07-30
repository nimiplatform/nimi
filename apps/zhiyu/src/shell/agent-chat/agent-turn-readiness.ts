import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuConversationHomeStatus } from '../agent/conversation-home';

export type ZhiyuRuntimeTurnStatus = ZhiyuEvidence['turn'];

// The admitted local-app conversation surface is the execution boundary.
// Readiness depends only on the current account permission projection and the
// opaque Agent/conversation handles materialized by that surface.
export function probeZhiyuAgentTurnReadiness(
  conversation: ZhiyuConversationHomeStatus,
  inventory: ZhiyuEvidence['inventory'],
): ZhiyuRuntimeTurnStatus {
  if (!inventory.ready) {
    return turnUnavailable({
      reasonCode: inventory.reasonCode,
      actionHint: inventory.actionHint,
      source: inventory.source,
      message: inventory.message,
      ownerUserId: conversation.ownerUserId,
      runtimeSourceRef: conversation.runtimeSourceRef,
      localAgentRef: conversation.localAgentRef,
      conversationAnchorId: conversation.conversationAnchorId,
    });
  }

  const identity = conversationIdentity(conversation);
  if (!identity) {
    return turnUnavailable({
      reasonCode: 'zhiyu-conversation-anchor-required',
      actionHint: 'open_runtime_conversation_anchor',
      source: conversation.source,
      message: 'Zhiyu requires a Runtime-owned conversation anchor before sending a turn.',
      ownerUserId: conversation.ownerUserId,
      runtimeSourceRef: conversation.runtimeSourceRef,
      localAgentRef: conversation.localAgentRef,
      conversationAnchorId: conversation.conversationAnchorId,
    });
  }

  if (!inventory.localAgents.some((agent) => agent.agentHandle === identity.agentHandle)) {
    return turnUnavailable({
      reasonCode: 'zhiyu-agent-handle-not-covered',
      actionHint: 'refresh_agents_interact_permission',
      source: 'runtime',
      message: 'The active Agent handle is no longer covered by the account permission projection.',
      ...identity,
    });
  }

  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'runtime-turn-ready',
    actionHint: 'send_runtime_agent_turn',
    source: 'renderer',
    message: 'Runtime Agent turn channel is ready.',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    ...identity,
    requestId: null,
    runtimeTurnId: null,
    runtimeStreamId: null,
    messageId: null,
  };
}

function conversationIdentity(conversation: ZhiyuConversationHomeStatus): {
  readonly agentHandle: string;
  readonly conversationAnchorId: string;
  readonly threadId: string;
} | null {
  if (!conversation.ready) {
    return null;
  }
  const agentHandle = stringOr(conversation.agentHandle, '');
  const conversationAnchorId = stringOr(conversation.conversationAnchorId, '');
  const threadId = stringOr(conversation.threadId, '');
  if (!agentHandle || !conversationAnchorId || !threadId) {
    return null;
  }
  return {
    agentHandle,
    conversationAnchorId,
    threadId,
  };
}

function turnUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly ownerUserId?: string | null;
  readonly runtimeSourceRef?: string | null;
  readonly localAgentRef?: string | null;
  readonly conversationAnchorId?: string | null;
  readonly requestId?: string | null;
}): ZhiyuRuntimeTurnStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    ownerUserId: input.ownerUserId ?? null,
    runtimeSourceRef: input.runtimeSourceRef ?? null,
    localAgentRef: input.localAgentRef ?? null,
    conversationAnchorId: input.conversationAnchorId ?? null,
    requestId: input.requestId ?? null,
    runtimeTurnId: null,
    runtimeStreamId: null,
    messageId: null,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
