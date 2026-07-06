import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuConversationHomeStatus } from '../agent/conversation-home';
import {
  resolveZhiyuRuntimeAgentBindingDecision,
  resolveZhiyuRuntimeAgentBindingDecisionFromHost,
  type ZhiyuRuntimeAgentBindingDecision,
} from './runtime-agent-binding';

export type ZhiyuRuntimeTurnStatus = ZhiyuEvidence['turn'];

export {
  resolveZhiyuRuntimeAgentBindingDecision,
};

// Turn readiness is projection-only: the conversation anchor plus runtime
// execution readiness plus Runtime binding custody. Route truth stays with
// the runtime execution config (K-AGCORE-147); Zhiyu never re-derives it.
export function probeZhiyuAgentTurnReadiness(
  conversation: ZhiyuConversationHomeStatus,
  route: Pick<ZhiyuEvidence['route'], 'ready' | 'reasonCode' | 'actionHint' | 'source' | 'message'>,
  runtimeBinding: ZhiyuRuntimeAgentBindingDecision = resolveZhiyuRuntimeAgentBindingDecisionFromHost(),
): ZhiyuRuntimeTurnStatus {
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

  if (!route.ready) {
    return turnUnavailable({
      reasonCode: route.reasonCode === 'not-probed'
        ? 'zhiyu-runtime-execution-readiness-required'
        : route.reasonCode,
      actionHint: route.actionHint || 'configure_runtime_agent_execution_model',
      source: route.source,
      message: route.message,
      ...identity,
    });
  }

  if (runtimeBinding.kind === 'missing') {
    return turnUnavailable({
      reasonCode: runtimeBinding.reasonCode,
      actionHint: runtimeBinding.actionHint,
      source: 'runtime',
      message: runtimeBinding.message,
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
    ...identity,
    requestId: null,
    messageId: null,
  };
}

function conversationIdentity(conversation: ZhiyuConversationHomeStatus): {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
} | null {
  if (!conversation.ready) {
    return null;
  }
  const ownerUserId = stringOr(conversation.ownerUserId, '');
  const runtimeSourceRef = stringOr(conversation.runtimeSourceRef, '');
  const localAgentRef = stringOr(conversation.localAgentRef, '');
  const conversationAnchorId = stringOr(conversation.conversationAnchorId, '');
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef || !conversationAnchorId) {
    return null;
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    conversationAnchorId,
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
    messageId: null,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
