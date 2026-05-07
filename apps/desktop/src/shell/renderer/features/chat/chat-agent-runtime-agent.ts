import { getPlatformClient } from '@nimiplatform/sdk';
import { asNimiError } from '@nimiplatform/sdk/runtime';
import { randomIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  resolveSourceAndModel,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import type {
  AgentLocalChatRuntimeRequest,
  AgentLocalChatTurnStreamPart,
} from './chat-agent-orchestration-types';
import { normalizeText } from './chat-agent-orchestration-shared';
import { resolveRouteInput } from './chat-agent-runtime-text';
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
  request: AgentLocalChatRuntimeRequest,
): Promise<{ stream: AsyncIterable<AgentLocalChatTurnStreamPart> }> {
  const runtime = getPlatformClient().runtime;
  const requestId = randomIdV11('runtime-agent-turn-request');
  const routeResolveStartedAt = nowMs();
  safeLogRuntimeAgentEvent({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:start',
    details: {
      agentId: request.agentId,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
    },
  });
  const routeInput = await resolveRouteInput({
    agentId: request.agentId,
    prompt: request.prompt,
    messages: request.messages,
    systemPrompt: request.systemPrompt,
    maxOutputTokensRequested: request.maxOutputTokensRequested,
    threadId: request.threadId,
    reasoningPreference: request.reasoningPreference,
    agentResolution: request.agentResolution,
    executionSnapshot: request.textExecutionSnapshot,
    runtimeConfigState: request.runtimeConfigState,
    runtimeFields: request.runtimeFields,
    signal: request.signal,
  });
  const resolved = resolveSourceAndModel(routeInput);
  safeLogRuntimeAgentTiming({
    stage: 'desktop.runtime_agent.route_resolve_ms',
    startedAt: routeResolveStartedAt,
    details: {
      agentId: request.agentId,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
      route: resolved.source,
      modelId: resolved.modelId,
      provider: resolved.provider,
      connectorId: normalizeText(routeInput.connectorId) || null,
    },
  });
  safeLogRuntimeAgentEvent({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:route-resolved',
    details: {
      agentId: request.agentId,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
      route: resolved.source,
      modelId: resolved.modelId,
      provider: resolved.provider,
      connectorId: normalizeText(routeInput.connectorId) || null,
    },
  });
  safeLogRuntimeAgentEvent({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:local-warm-skipped',
    details: {
      agentId: request.agentId,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
      route: resolved.source,
      modelId: resolved.modelId,
      reason: 'runtime_local_model_lease_authoritative',
    },
  });
  const route = resolved.source;
  const modelId = normalizeText(resolved.modelId);
  const connectorId = normalizeText(routeInput.connectorId) || undefined;
  const subscribeStartedAt = nowMs();
  const subscribed = await runtime.agent.turns.subscribe({
    agentId: request.agentId,
    conversationAnchorId: request.conversationAnchorId,
    includeAgentEvents: false,
  });
  safeLogRuntimeAgentTiming({
    stage: 'desktop.runtime_agent.subscribe_ms',
    startedAt: subscribeStartedAt,
    details: {
      agentId: request.agentId,
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
      agentId: request.agentId,
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
      agentId: request.agentId,
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
    agentId: request.agentId,
    conversationAnchorId: request.conversationAnchorId,
    threadId: request.threadId,
    systemPrompt: normalizeText(request.systemPrompt) || undefined,
    maxOutputTokens: Number.isFinite(Number(request.maxOutputTokensRequested))
      && Number(request.maxOutputTokensRequested) > 0
      ? Math.floor(Number(request.maxOutputTokensRequested))
      : undefined,
    messages: Array.isArray(request.messages)
      ? request.messages.map((message) => ({
        role: message.role,
        content: typeof message.content === 'string'
          ? message.content
          : typeof message.text === 'string'
            ? message.text
            : '',
        ...(normalizeText(message.name) ? { name: normalizeText(message.name) } : {}),
      }))
      : [],
    executionBinding: {
      route,
      modelId,
      ...(connectorId ? { connectorId } : {}),
    },
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
      agentId: request.agentId,
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
      agentId: request.agentId,
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
      agentId: request.agentId,
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
