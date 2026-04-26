import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import { asRecord, normalizeText, parseCount } from './helpers.js';
import {
  parseRuntimeAgentLipsyncFrameBatchDetail,
  parseRuntimeAgentVoicePlaybackDetail,
} from './runtime-agent-voice-lipsync-parsers.js';
import type {
  RuntimeAgentConsumeEvent,
  RuntimeAgentTimelineEnvelope,
} from './types-runtime-modules.js';

function expectString(value: unknown, fieldName: string, messageType: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `${messageType} requires ${fieldName}`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_projection_shape',
      source: 'sdk',
    });
  }
  return normalized;
}

function expectActivityCategory(
  value: unknown,
  fieldName: string,
  messageType: string,
): 'emotion' | 'interaction' | 'state' {
  const normalized = expectString(value, fieldName, messageType);
  if (normalized === 'emotion' || normalized === 'interaction' || normalized === 'state') {
    return normalized;
  }
  throw createNimiError({
    message: `${messageType} ${fieldName} must be emotion, interaction, or state`,
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'check_runtime_agent_activity_projection_shape',
    source: 'sdk',
  });
}

function optionalActivityIntensity(
  value: unknown,
  fieldName: string,
  messageType: string,
): 'weak' | 'moderate' | 'strong' | undefined {
  const normalized = optionalString(value);
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'weak' || normalized === 'moderate' || normalized === 'strong') {
    return normalized;
  }
  throw createNimiError({
    message: `${messageType} ${fieldName} must be weak, moderate, or strong`,
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'check_runtime_agent_activity_projection_shape',
    source: 'sdk',
  });
}

function optionalString(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return parseCount(value);
}

export function parseRuntimeAgentPresentationConsumeEvent(
  messageType: string,
  payload: Record<string, unknown>,
  agentId: string,
  conversationAnchorId: string,
  parseTimeline: (turnId: string, streamId: string) => RuntimeAgentTimelineEnvelope,
): RuntimeAgentConsumeEvent | undefined {
  const detail = asRecord(payload.detail);
  switch (messageType) {
    case 'runtime.agent.presentation.activity_requested':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          activityName: expectString(detail.activity_name, 'detail.activity_name', messageType),
          category: expectActivityCategory(detail.category, 'detail.category', messageType),
          ...(optionalActivityIntensity(detail.intensity, 'detail.intensity', messageType)
            ? { intensity: optionalActivityIntensity(detail.intensity, 'detail.intensity', messageType) }
            : {}),
          source: expectString(detail.source, 'detail.source', messageType),
        },
      };
    case 'runtime.agent.presentation.motion_requested':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          motionId: expectString(detail.motion_id, 'detail.motion_id', messageType),
          ...(optionalString(detail.priority) ? { priority: optionalString(detail.priority) } : {}),
          ...(optionalNumber(detail.expected_duration_ms) !== undefined
            ? { expectedDurationMs: optionalNumber(detail.expected_duration_ms) }
            : {}),
        },
      };
    case 'runtime.agent.presentation.expression_requested':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          expressionId: expectString(detail.expression_id, 'detail.expression_id', messageType),
          ...(optionalNumber(detail.expected_duration_ms) !== undefined
            ? { expectedDurationMs: optionalNumber(detail.expected_duration_ms) }
            : {}),
        },
      };
    case 'runtime.agent.presentation.pose_requested':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          poseId: expectString(detail.pose_id, 'detail.pose_id', messageType),
          ...(optionalNumber(detail.expected_duration_ms) !== undefined
            ? { expectedDurationMs: optionalNumber(detail.expected_duration_ms) }
            : {}),
        },
      };
    case 'runtime.agent.presentation.pose_cleared':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          ...(optionalString(detail.previous_pose_id) ? { previousPoseId: optionalString(detail.previous_pose_id) } : {}),
        },
      };
    case 'runtime.agent.presentation.lookat_requested':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          targetKind: expectString(detail.target_kind, 'detail.target_kind', messageType),
          ...(typeof detail.x === 'number' ? { x: detail.x } : {}),
          ...(typeof detail.y === 'number' ? { y: detail.y } : {}),
          ...(typeof detail.z === 'number' ? { z: detail.z } : {}),
        },
      };
    case 'runtime.agent.presentation.voice_playback_requested': {
      const turnId = expectString(payload.turn_id, 'turn_id', messageType);
      const streamId = expectString(payload.stream_id, 'stream_id', messageType);
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId,
        streamId,
        timeline: parseTimeline(turnId, streamId),
        detail: parseRuntimeAgentVoicePlaybackDetail(detail, messageType),
      };
    }
    case 'runtime.agent.presentation.lipsync_frame_batch': {
      const turnId = expectString(payload.turn_id, 'turn_id', messageType);
      const streamId = expectString(payload.stream_id, 'stream_id', messageType);
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId,
        streamId,
        timeline: parseTimeline(turnId, streamId),
        detail: parseRuntimeAgentLipsyncFrameBatchDetail(detail, messageType),
      };
    }
    default:
      return undefined;
  }
}
