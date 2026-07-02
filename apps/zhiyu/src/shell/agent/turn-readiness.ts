import type { NimiRuntimeAgentExecutionBinding } from '@nimiplatform/sdk/runtime';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuConversationHomeStatus } from './conversation-home';

export type ZhiyuRuntimeTurnStatus = ZhiyuEvidence['turn'];

export type ZhiyuRuntimeTurnExecutionBinding = NimiRuntimeAgentExecutionBinding;

export function probeZhiyuRuntimeTurnReadiness(
  conversation: ZhiyuConversationHomeStatus,
  executionBinding?: ZhiyuRuntimeTurnExecutionBinding | null,
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

  const binding = normalizeExecutionBinding(executionBinding);
  if (!binding) {
    return turnUnavailable({
      reasonCode: 'zhiyu-runtime-route-required',
      actionHint: 'select_runtime_agent_route',
      source: 'renderer',
      message: 'Zhiyu requires an admitted Runtime execution binding before sending a turn.',
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

function normalizeExecutionBinding(
  value: ZhiyuRuntimeTurnExecutionBinding | null | undefined,
): ZhiyuRuntimeTurnExecutionBinding | null {
  if (!value) {
    return null;
  }
  const route = value.route;
  const model = stringOr(value.modelId, '');
  if ((route !== 'local' && route !== 'cloud') || !model) {
    return null;
  }
  return {
    route,
    ['modelId']: model,
    ...(stringOr(value.connectorId, '') ? { connectorId: stringOr(value.connectorId, '') } : {}),
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

function stringOr(value: unknown, fallback: string): string;
function stringOr(value: unknown, fallback: null): string | null;
function stringOr(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
