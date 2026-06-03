import { asNimiError } from '../core/errors.js';
import { normalizeText } from './helpers.js';
import type { RuntimeAgentTurnRequest } from './types-runtime-agent.js';
import {
  buildSubscribeRequest,
  contextDetails,
  createRuntimeAgentEventQueue,
  createRuntimeAgentTurnStream,
  defaultNowMs,
  localIdentityFromRequest,
} from './runtime-agent-turn-runner-stream.js';
import type {
  RuntimeAgentTurnRunnerOptions,
  RuntimeAgentTurnRunnerPart,
} from './runtime-agent-turn-runner-types.js';
export type {
  RuntimeAgentTurnRunnerCommittedMessage,
  RuntimeAgentTurnRunnerContext,
  RuntimeAgentTurnRunnerDiagnosticsInput,
  RuntimeAgentTurnRunnerLogEvent,
  RuntimeAgentTurnRunnerMetadataInput,
  RuntimeAgentTurnRunnerOptions,
  RuntimeAgentTurnRunnerPart,
  RuntimeAgentTurnRunnerTimingStage,
  RuntimeAgentTurnRunnerTrace,
} from './runtime-agent-turn-runner-types.js';

export async function runRuntimeAgentTurn(
  options: RuntimeAgentTurnRunnerOptions,
): Promise<{ stream: AsyncIterable<RuntimeAgentTurnRunnerPart> }> {
  const requestId = normalizeText(options.request.requestId);
  if (!requestId) {
    throw new Error('Runtime Agent turn runner requires request.requestId');
  }
  const nowMs = options.nowMs || defaultNowMs;
  const route = normalizeText(options.route) || 'runtime-owned';
  const modelId = normalizeText(options.modelId) || 'runtime-owned';
  const connectorId = normalizeText(options.connectorId) || undefined;
  const logEvent = options.logEvent;
  const logTiming = options.logTiming;
  const subscribeStartedAt = nowMs();
  const subscribed = await options.turns.subscribe(buildSubscribeRequest(options.request, options.subscribe));
  logTiming?.({
    stage: 'subscribe',
    startedAt: subscribeStartedAt,
    details: contextDetails({ request: options.request, requestId, route, modelId, connectorId }),
  });
  logEvent?.({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:subscribed',
    details: contextDetails({ request: options.request, requestId, route, modelId, connectorId }),
  });

  let requestSubmitted = false;
  let interruptRequested = false;
  const runtimeTurnRef = { turnId: '', streamId: '' };
  const acceptedRequestIds = new Set<string>([requestId]);
  const eventQueue = createRuntimeAgentEventQueue(subscribed);
  const localIdentity = localIdentityFromRequest(options.request);
  const requestInterrupt = () => {
    if (interruptRequested || !requestSubmitted) {
      return;
    }
    interruptRequested = true;
    void options.turns.interrupt({
      ...localIdentity,
      conversationAnchorId: options.request.conversationAnchorId,
      ...(normalizeText(runtimeTurnRef.turnId) ? { turnId: runtimeTurnRef.turnId } : {}),
      reason: normalizeText(options.interruptReason) || 'runtime_agent_turn_abort',
      ...(options.request.scopedBinding ? { scopedBinding: options.request.scopedBinding } : {}),
      ...(normalizeText(options.request.worldId) ? { worldId: options.request.worldId } : {}),
    }).catch(() => undefined);
  };
  const cleanupSubscription = () => {
    options.signal?.removeEventListener('abort', requestInterrupt);
    eventQueue.stop();
  };

  options.signal?.addEventListener('abort', requestInterrupt, { once: true });

  let requestResponse: { messageId?: string } | void;
  const requestStartedAt = nowMs();
  try {
    requestResponse = await options.turns.request(options.request);
  } catch (error) {
    cleanupSubscription();
    throw asNimiError(error, { source: 'runtime' });
  }
  const requestMessageId = normalizeText(requestResponse && typeof requestResponse === 'object' ? requestResponse.messageId : '');
  if (requestMessageId) {
    acceptedRequestIds.add(requestMessageId);
  }
  requestSubmitted = true;
  logTiming?.({
    stage: 'request_ack',
    startedAt: requestStartedAt,
    details: contextDetails({ request: options.request, requestId, requestMessageId, route, modelId, connectorId }),
  });
  logEvent?.({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:request-acked',
    details: contextDetails({ request: options.request, requestId, requestMessageId, route, modelId, connectorId }),
  });

  return {
    stream: createRuntimeAgentTurnStream({
      acceptedRequestIds,
      cleanupSubscription,
      connectorId,
      eventQueue,
      logEvent,
      logTiming,
      modelId,
      nowMs,
      querySnapshot: () => options.turns.getSessionSnapshot({
        ...localIdentity,
        conversationAnchorId: options.request.conversationAnchorId,
        requestId,
        scopedBinding: options.request.scopedBinding,
        ...(normalizeText(options.request.worldId) ? { worldId: options.request.worldId } : {}),
      }),
      request: options.request,
      requestId,
      requestMessageId,
      resolveTrace: options.resolveTrace,
      route,
      runtimeTurnRef,
      stallRecoveryIntervalMs: options.stallRecoveryIntervalMs,
      buildMetadata: options.buildMetadata,
      buildDiagnostics: options.buildDiagnostics,
    }),
  };
}
