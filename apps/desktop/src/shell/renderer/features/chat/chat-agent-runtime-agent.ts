import { createNimiClientId } from '@nimiplatform/sdk';
import {
  createNimiRuntimeAgentTurnsModule,
  runNimiRuntimeAgentTurn,
} from '@nimiplatform/sdk/runtime';
import {
  getDesktopRuntimeAgentTurnsRuntime,
  withDesktopRuntimeProtectedScopes,
} from '../../infra/sdk/desktop-nimi-client-session';
import type {
  AgentRuntimeChatTurnRequest,
  AgentRuntimeChatTurnStreamPart,
} from './chat-agent-runtime-turn-types';
import { normalizeText } from './chat-agent-runtime-normalize';
import {
  resolveChatThinkingConfig,
} from './chat-shared-thinking';
import {
  buildRuntimeAgentDiagnostics,
  resolveRuntimeTrace,
  safeLogRuntimeAgentEvent,
  safeLogRuntimeAgentTiming,
  toDebugMetadata,
} from './chat-agent-runtime-agent-utils';

export async function streamChatAgentRuntimeAgentTurn(
  request: AgentRuntimeChatTurnRequest,
): Promise<{ stream: AsyncIterable<AgentRuntimeChatTurnStreamPart> }> {
  const runtime = getDesktopRuntimeAgentTurnsRuntime();
  const turns = createNimiRuntimeAgentTurnsModule({
    runtime,
    getSubjectUserId: () => request.ownerUserId,
    withScopes: withDesktopRuntimeProtectedScopes,
  });
  const requestId = createNimiClientId('runtime-agent-turn-request');
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
  const localIdentity = {
    ownerUserId: request.ownerUserId,
    runtimeSourceRef: request.runtimeSourceRef,
    localAgentRef: request.localAgentRef,
  };

  const requestPayloadBase = {
    ...localIdentity,
    conversationAnchorId: request.conversationAnchorId,
    threadId: request.threadId,
    maxOutputTokens: Number.isFinite(Number(request.maxOutputTokensRequested))
      && Number(request.maxOutputTokensRequested) > 0
      ? Math.floor(Number(request.maxOutputTokensRequested))
      : undefined,
    messages: [{
      role: 'user' as const,
      content: normalizeText(request.userText),
    }] as const,
    reasoning: (() => {
      const resolved = resolveChatThinkingConfig(
        request.reasoningPreference,
        { supported: false, reason: 'agent_route_unsupported' },
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

  return runNimiRuntimeAgentTurn({
    turns,
    subscribe: {
      ...localIdentity,
      conversationAnchorId: request.conversationAnchorId,
      includeAgentEvents: false,
    },
    request: {
      ...requestPayloadBase,
      requestId,
    },
    signal: request.signal,
    interruptReason: 'user_cancel',
    logEvent: safeLogRuntimeAgentEvent,
    logTiming: (event) => {
      const stageByRunnerStage = {
        subscribe: 'desktop.runtime_agent.subscribe_ms',
        request_ack: 'desktop.runtime_agent.request_ack_ms',
        accepted_to_started: 'desktop.runtime_agent.accepted_to_started_ms',
        started_to_first_delta: 'desktop.runtime_agent.started_to_first_delta_ms',
        message_committed_to_message_sealed: 'desktop.runtime_agent.message_committed_to_message_sealed_ms',
        completed_to_ui_done: 'desktop.runtime_agent.completed_to_ui_done_ms',
      } as const;
      safeLogRuntimeAgentTiming({
        stage: stageByRunnerStage[event.stage],
        startedAt: event.startedAt,
        details: event.details,
      });
    },
    resolveTrace: resolveRuntimeTrace,
    buildMetadata: (input) => toDebugMetadata({
      prompt: normalizeText(request.userText),
      systemPrompt: null,
      conversationAnchorId: request.conversationAnchorId,
      runtimeTurnId: input.runtimeTurnId,
      runtimeStreamId: input.runtimeStreamId,
      trace: input.trace,
      envelope: input.envelope,
      latestTimeline: input.latestTimeline || null,
    }),
    buildDiagnostics: (input) => buildRuntimeAgentDiagnostics({
      conversationAnchorId: request.conversationAnchorId,
      runtimeTurnId: input.runtimeTurnId,
      runtimeStreamId: input.runtimeStreamId,
      trace: input.trace,
      extra: {
        ...(input.runtimeTurnTimelines.length > 0 ? { runtimeTurnTimelines: [...input.runtimeTurnTimelines] } : {}),
        ...(input.runtimeProjectionEvents.length > 0 ? { runtimeProjectionEvents: [...input.runtimeProjectionEvents] } : {}),
        ...(input.extra || {}),
      },
    }),
  });
}
