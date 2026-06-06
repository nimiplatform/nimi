import { asNimiError, createNimiError, ReasonCode } from '../types';
import {
  buildNimiRuntimeAgentSubscribeRequest,
  createNimiRuntimeAgentEventQueue,
  createNimiRuntimeAgentTurnStream,
  defaultNimiRuntimeAgentNowMs,
  nimiRuntimeAgentContextDetails,
  nimiRuntimeAgentLocalIdentityFromRequest,
} from './runtime-agent-turn-runner-stream';
import { normalizeNimiRuntimeAgentText } from './runtime-agent-values';
import type {
  NimiRuntimeAgentTurnRunnerOptions,
  NimiRuntimeAgentTurnRunnerPart,
} from './runtime-agent-turn-runner-types';

export type {
  NimiRuntimeAgentConsumeRequest,
  NimiRuntimeAgentExecutionBinding,
  NimiRuntimeAgentMessage,
  NimiRuntimeAgentProjectionSummary,
  NimiRuntimeAgentReasoningRequest,
  NimiRuntimeAgentSessionSnapshotRequest,
  NimiRuntimeAgentTimelineSummary,
  NimiRuntimeAgentTranscriptMessage,
  NimiRuntimeAgentTurnInterruptRequest,
  NimiRuntimeAgentTurnRequest,
  NimiRuntimeAgentTurnRunnerCommittedMessage,
  NimiRuntimeAgentTurnRunnerContext,
  NimiRuntimeAgentTurnRunnerDiagnosticsInput,
  NimiRuntimeAgentTurnRunnerLogEvent,
  NimiRuntimeAgentTurnRunnerMetadataInput,
  NimiRuntimeAgentTurnRunnerOptions,
  NimiRuntimeAgentTurnRunnerPart,
  NimiRuntimeAgentTurnRunnerTimingStage,
  NimiRuntimeAgentTurnRunnerTrace,
  NimiRuntimeAgentTurnsModule,
} from './runtime-agent-turn-runner-types';

export async function runNimiRuntimeAgentTurn(
  options: NimiRuntimeAgentTurnRunnerOptions,
): Promise<{ stream: AsyncIterable<NimiRuntimeAgentTurnRunnerPart> }> {
  const requestId = normalizeNimiRuntimeAgentText(options.request.requestId);
  if (!requestId) {
    throw createNimiError({
      message: 'Runtime Agent turn runner requires request.requestId.',
      reasonCode: 'SDK_RUNTIME_AGENT_REQUEST_ID_REQUIRED',
      actionHint: 'provide_runtime_agent_turn_request_id',
      source: 'sdk',
    });
  }
  const nowMs = options.nowMs || defaultNimiRuntimeAgentNowMs;
  const route = normalizeNimiRuntimeAgentText(options.route) || 'runtime-owned';
  const modelId = normalizeNimiRuntimeAgentText(options.modelId) || 'runtime-owned';
  const connectorId = normalizeNimiRuntimeAgentText(options.connectorId) || undefined;
  const subscribeStartedAt = nowMs();
  const subscribed = await options.turns.subscribe(buildNimiRuntimeAgentSubscribeRequest(options.request, options.subscribe));
  options.logTiming?.({
    stage: 'subscribe',
    startedAt: subscribeStartedAt,
    details: nimiRuntimeAgentContextDetails({ request: options.request, requestId, route, modelId, connectorId }),
  });
  options.logEvent?.({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:subscribed',
    details: nimiRuntimeAgentContextDetails({ request: options.request, requestId, route, modelId, connectorId }),
  });

  let requestSubmitted = false;
  let interruptRequested = false;
  const runtimeTurnRef = { turnId: '', streamId: '' };
  const acceptedRequestIds = new Set<string>([requestId]);
  const eventQueue = createNimiRuntimeAgentEventQueue(subscribed);
  const localIdentity = nimiRuntimeAgentLocalIdentityFromRequest(options.request);
  const requestInterrupt = () => {
    if (interruptRequested || !requestSubmitted) {
      return;
    }
    interruptRequested = true;
    void options.turns.interrupt({
      ...localIdentity,
      conversationAnchorId: options.request.conversationAnchorId,
      ...(normalizeNimiRuntimeAgentText(runtimeTurnRef.turnId) ? { turnId: runtimeTurnRef.turnId } : {}),
      reason: normalizeNimiRuntimeAgentText(options.interruptReason) || 'runtime_agent_turn_abort',
      ...(options.request.scopedBinding ? { scopedBinding: options.request.scopedBinding } : {}),
      ...(normalizeNimiRuntimeAgentText(options.request.worldId) ? { worldId: options.request.worldId } : {}),
    }).catch(() => undefined);
  };
  const cleanupSubscription = () => {
    options.signal?.removeEventListener('abort', requestInterrupt);
    eventQueue.stop();
  };

  options.signal?.addEventListener('abort', requestInterrupt, { once: true });

  let requestResponse: { readonly messageId?: string } | void;
  const requestStartedAt = nowMs();
  try {
    requestResponse = await options.turns.request(options.request);
  } catch (error) {
    cleanupSubscription();
    throw asNimiError(error, {
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'request_runtime_agent_turn',
      source: 'runtime',
    });
  }
  const requestMessageId = normalizeNimiRuntimeAgentText(
    requestResponse && typeof requestResponse === 'object' ? requestResponse.messageId : '',
  );
  if (requestMessageId) {
    acceptedRequestIds.add(requestMessageId);
  }
  requestSubmitted = true;
  options.logTiming?.({
    stage: 'request_ack',
    startedAt: requestStartedAt,
    details: nimiRuntimeAgentContextDetails({ request: options.request, requestId, requestMessageId, route, modelId, connectorId }),
  });
  options.logEvent?.({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:request-acked',
    details: nimiRuntimeAgentContextDetails({ request: options.request, requestId, requestMessageId, route, modelId, connectorId }),
  });

  return {
    stream: createNimiRuntimeAgentTurnStream({
      acceptedRequestIds,
      cleanupSubscription,
      connectorId,
      eventQueue,
      logEvent: options.logEvent,
      logTiming: options.logTiming,
      modelId,
      nowMs,
      querySnapshot: () => options.turns.getSessionSnapshot({
        ...localIdentity,
        conversationAnchorId: options.request.conversationAnchorId,
        requestId,
        ...(options.request.scopedBinding ? { scopedBinding: options.request.scopedBinding } : {}),
        ...(normalizeNimiRuntimeAgentText(options.request.worldId) ? { worldId: options.request.worldId } : {}),
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
