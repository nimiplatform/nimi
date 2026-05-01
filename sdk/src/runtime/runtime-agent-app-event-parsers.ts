import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import { asRecord } from './helpers.js';
import { parseRuntimeAgentPresentationConsumeEvent } from './runtime-agent-presentation-parsers.js';
import { parseRuntimeAgentTimeline } from './runtime-agent-timeline-parsers.js';
import type { RuntimeAgentConsumeEvent } from './types-runtime-agent.js';
import { expectString, optionalContentString, optionalString } from './runtime-agent-surface-parser-common.js';

export function parseAppConsumeEvent(messageType: string, payload: Record<string, unknown>): RuntimeAgentConsumeEvent {
  const agentId = expectString(payload.agent_id, 'agent_id', messageType);
  const conversationAnchorId = expectString(payload.conversation_anchor_id, 'conversation_anchor_id', messageType);
  const detail = asRecord(payload.detail);
  const parseTimeline = (turnId: string, streamId: string) => parseRuntimeAgentTimeline(
    payload.timeline,
    messageType,
    turnId,
    streamId,
  );
  const presentationEvent = parseRuntimeAgentPresentationConsumeEvent(
    messageType,
    payload,
    agentId,
    conversationAnchorId,
    parseTimeline,
  );
  if (presentationEvent) {
    return presentationEvent;
  }
  switch (messageType) {
    case 'runtime.agent.turn.accepted': {
      const turnId = expectString(payload.turn_id, 'turn_id', messageType);
      const streamId = expectString(payload.stream_id, 'stream_id', messageType);
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId,
        streamId,
        timeline: parseTimeline(turnId, streamId),
        detail: {
          requestId: expectString(detail.request_id, 'detail.request_id', messageType),
        },
      };
    }
    case 'runtime.agent.turn.started': {
      const turnId = expectString(payload.turn_id, 'turn_id', messageType);
      const streamId = expectString(payload.stream_id, 'stream_id', messageType);
      const track = expectString(detail.track, 'detail.track', messageType);
      if (track !== 'chat' && track !== 'life') {
        throw createNimiError({
          message: `${messageType} detail.track must be chat or life`,
          reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
          actionHint: 'check_runtime_agent_projection_shape',
          source: 'sdk',
        });
      }
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId,
        streamId,
        timeline: parseTimeline(turnId, streamId),
        detail: { track },
      };
    }
    case 'runtime.agent.turn.reasoning_delta':
    case 'runtime.agent.turn.text_delta': {
      const turnId = expectString(payload.turn_id, 'turn_id', messageType);
      const streamId = expectString(payload.stream_id, 'stream_id', messageType);
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId,
        streamId,
        timeline: parseTimeline(turnId, streamId),
        detail: {
          text: optionalContentString(detail.text) ?? '',
        },
      } as RuntimeAgentConsumeEvent;
    }
    case 'runtime.agent.turn.structured': {
      const turnId = expectString(payload.turn_id, 'turn_id', messageType);
      const streamId = expectString(payload.stream_id, 'stream_id', messageType);
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId,
        streamId,
        timeline: parseTimeline(turnId, streamId),
        detail: {
          kind: expectString(detail.kind, 'detail.kind', messageType),
          payload: asRecord(detail.payload),
        },
      };
    }
    case 'runtime.agent.turn.message_committed': {
      const turnId = expectString(payload.turn_id, 'turn_id', messageType);
      const streamId = expectString(payload.stream_id, 'stream_id', messageType);
      const messageId = expectString(payload.message_id || detail.message_id, 'message_id', messageType);
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId,
        streamId,
        timeline: parseTimeline(turnId, streamId),
        messageId,
        detail: {
          messageId,
          text: optionalContentString(detail.text) ?? '',
        },
      };
    }
    case 'runtime.agent.turn.post_turn': {
      const turnId = expectString(payload.turn_id, 'turn_id', messageType);
      const streamId = expectString(payload.stream_id, 'stream_id', messageType);
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId,
        streamId,
        timeline: parseTimeline(turnId, streamId),
        detail: {
          ...(Object.keys(asRecord(detail.action)).length > 0 ? { action: asRecord(detail.action) } : {}),
          ...(Object.keys(asRecord(detail.hook_intent)).length > 0 ? { hookIntent: asRecord(detail.hook_intent) } : {}),
        },
      };
    }
    case 'runtime.agent.turn.completed': {
      const turnId = expectString(payload.turn_id, 'turn_id', messageType);
      const streamId = expectString(payload.stream_id, 'stream_id', messageType);
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId,
        streamId,
        timeline: parseTimeline(turnId, streamId),
        detail: {
          ...(optionalString(detail.terminal_reason) ? { terminalReason: optionalString(detail.terminal_reason) } : {}),
        },
      };
    }
    case 'runtime.agent.turn.failed': {
      const turnId = expectString(payload.turn_id, 'turn_id', messageType);
      const streamId = expectString(payload.stream_id, 'stream_id', messageType);
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId,
        streamId,
        timeline: parseTimeline(turnId, streamId),
        detail: {
          reasonCode: expectString(detail.reason_code, 'detail.reason_code', messageType),
          ...(optionalString(detail.message) ? { message: optionalString(detail.message) } : {}),
        },
      };
    }
    case 'runtime.agent.turn.interrupted': {
      const turnId = expectString(payload.turn_id, 'turn_id', messageType);
      const streamId = expectString(payload.stream_id, 'stream_id', messageType);
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId,
        streamId,
        timeline: parseTimeline(turnId, streamId),
        detail: {
          reason: expectString(detail.reason, 'detail.reason', messageType),
        },
      };
    }
    case 'runtime.agent.turn.interrupt_ack': {
      const turnId = expectString(payload.turn_id, 'turn_id', messageType);
      const streamId = expectString(payload.stream_id, 'stream_id', messageType);
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId,
        streamId,
        timeline: parseTimeline(turnId, streamId),
        detail: {
          interruptedTurnId: expectString(detail.interrupted_turn_id, 'detail.interrupted_turn_id', messageType),
        },
      };
    }
    default:
      throw createNimiError({
        message: `unsupported runtime agent consume family: ${messageType}`,
        reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
        actionHint: 'check_runtime_agent_projection_shape',
        source: 'sdk',
      });
  }
}
