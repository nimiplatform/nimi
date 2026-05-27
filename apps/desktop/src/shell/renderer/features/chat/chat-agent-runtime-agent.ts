import { getPlatformClient } from '@nimiplatform/sdk';
import { asNimiError } from '@nimiplatform/sdk/runtime';
import { randomIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type {
  AgentRuntimeChatTurnRequest,
  AgentRuntimeChatTurnStreamPart,
} from './chat-agent-runtime-turn-types';
import { normalizeText } from './chat-agent-runtime-normalize';
import {
  resolveChatThinkingConfig,
  resolveTextExecutionSnapshotThinkingSupport,
} from './chat-shared-thinking';
import { createRuntimeAgentEventQueue } from './chat-agent-runtime-agent-stream';
import {
  nowMs,
  safeLogRuntimeAgentEvent,
  safeLogRuntimeAgentTiming,
} from './chat-agent-runtime-agent-utils';
import { createRuntimeAgentTurnStream } from './chat-agent-runtime-agent-stream-consumer';

export async function streamChatAgentRuntimeAgentTurn(
  request: AgentRuntimeChatTurnRequest,
): Promise<{ stream: AsyncIterable<AgentRuntimeChatTurnStreamPart> }> {
  const runtime = getPlatformClient().runtime;
  const requestId = randomIdV11('runtime-agent-turn-request');
  safeLogRuntimeAgentEvent({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:start',
    details: {
      localAgentRef: request.localAgentRef,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
    },
  });
  const route = 'runtime-owned';
  const modelId = 'runtime-owned';
  const connectorId = undefined;
  const localIdentity = {
    ownerUserId: request.ownerUserId,
    realmAgentId: request.realmAgentId,
    localAgentRef: request.localAgentRef,
  };
  const subscribeStartedAt = nowMs();
  const subscribed = await runtime.agent.turns.subscribe({
    ...localIdentity,
    conversationAnchorId: request.conversationAnchorId,
    includeAgentEvents: false,
  });
  safeLogRuntimeAgentTiming({
    stage: 'desktop.runtime_agent.subscribe_ms',
    startedAt: subscribeStartedAt,
    details: {
      localAgentRef: request.localAgentRef,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
    },
  });
  safeLogRuntimeAgentEvent({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:subscribed',
    details: {
      localAgentRef: request.localAgentRef,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
    },
  });

  let requestSubmitted = false;
  let interruptRequested = false;
  const runtimeTurnRef = { turnId: '', streamId: '' };
  const acceptedRequestIds = new Set<string>([requestId]);
  const eventQueue = createRuntimeAgentEventQueue(subscribed);

  const requestInterrupt = () => {
    if (interruptRequested || !requestSubmitted) {
      return;
    }
    interruptRequested = true;
    void runtime.agent.turns.interrupt({
      ...localIdentity,
      conversationAnchorId: request.conversationAnchorId,
      ...(normalizeText(runtimeTurnRef.turnId) ? { turnId: runtimeTurnRef.turnId } : {}),
      reason: 'desktop_agent_chat_abort',
    }).catch(() => undefined);
  };
  const cleanupSubscription = () => {
    request.signal?.removeEventListener('abort', requestInterrupt);
    eventQueue.stop();
  };

  request.signal?.addEventListener('abort', requestInterrupt, { once: true });

  const requestPayloadBase = {
    ...localIdentity,
    conversationAnchorId: request.conversationAnchorId,
    threadId: request.threadId,
    systemPrompt: undefined,
    maxOutputTokens: Number.isFinite(Number(request.maxOutputTokensRequested))
      && Number(request.maxOutputTokensRequested) > 0
      ? Math.floor(Number(request.maxOutputTokensRequested))
      : undefined,
    messages: [{
      role: 'user' as const,
      content: normalizeText(request.userText),
    }],
    reasoning: (() => {
      const resolved = resolveChatThinkingConfig(
        request.reasoningPreference,
        resolveTextExecutionSnapshotThinkingSupport(
          request.textExecutionSnapshot?.conversationCapabilitySlice as Parameters<typeof resolveTextExecutionSnapshotThinkingSupport>[0],
        ),
      );
      if (!resolved) {
        return undefined;
      }
      return {
        ...(normalizeText(resolved.mode) ? { mode: normalizeText(resolved.mode) as typeof resolved.mode } : {}),
        ...(normalizeText(resolved.traceMode) ? { traceMode: normalizeText(resolved.traceMode) as typeof resolved.traceMode } : {}),
        ...(Number.isFinite(Number(resolved.budgetTokens))
          ? { budgetTokens: Math.floor(Number(resolved.budgetTokens)) }
          : {}),
      };
    })(),
  };

  let requestResponse: { messageId?: string } | void;
  const requestStartedAt = nowMs();
  try {
    requestResponse = await runtime.agent.turns.request({
      ...requestPayloadBase,
      requestId,
    });
  } catch (error) {
    cleanupSubscription();
    throw asNimiError(error, { source: 'runtime' });
  }
  const requestMessageId = normalizeText(requestResponse && typeof requestResponse === 'object' ? requestResponse.messageId : '');
  if (requestMessageId) {
    acceptedRequestIds.add(requestMessageId);
  }
  requestSubmitted = true;
  safeLogRuntimeAgentTiming({
    stage: 'desktop.runtime_agent.request_ack_ms',
    startedAt: requestStartedAt,
    details: {
      localAgentRef: request.localAgentRef,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
      requestMessageId,
      route,
      modelId,
      connectorId: connectorId || null,
    },
  });
  safeLogRuntimeAgentEvent({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:request-acked',
    details: {
      localAgentRef: request.localAgentRef,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
      requestMessageId,
      route,
      modelId,
      connectorId: connectorId || null,
    },
  });

  return createRuntimeAgentTurnStream({
    acceptedRequestIds,
    cleanupSubscription,
    connectorId,
    eventQueue,
    modelId,
    querySnapshot: () => runtime.agent.turns.getSessionSnapshot({
      ...localIdentity,
      conversationAnchorId: request.conversationAnchorId,
      requestId,
    }),
    request,
    requestId,
    requestMessageId,
    route,
    runtimeTurnRef,
  });

}
