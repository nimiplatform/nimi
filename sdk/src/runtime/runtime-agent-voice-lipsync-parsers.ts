import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import { asRecord, normalizeText, parseCount } from './helpers.js';
import type {
  RuntimeAgentLipsyncFrame,
  RuntimeAgentPresentationLipsyncFrameBatchEvent,
  RuntimeAgentPresentationVoicePlaybackRequestedEvent,
  RuntimeAgentVoicePlaybackState,
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

function optionalString(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return parseCount(value);
}

function expectNonNegativeNumber(value: unknown, fieldName: string, messageType: string): number {
  const parsed = parseCount(value);
  if (parsed === undefined) {
    throw createNimiError({
      message: `${messageType} ${fieldName} must be a non-negative number`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_projection_shape',
      source: 'sdk',
    });
  }
  return parsed;
}

function expectPositiveInteger(value: unknown, fieldName: string, messageType: string): number {
  const parsed = parseCount(value);
  if (parsed === undefined || parsed <= 0 || !Number.isInteger(parsed)) {
    throw createNimiError({
      message: `${messageType} ${fieldName} must be a positive integer`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_projection_shape',
      source: 'sdk',
    });
  }
  return parsed;
}

function expectUnitNumber(value: unknown, fieldName: string, messageType: string): number {
  const parsed = parseCount(value);
  if (parsed === undefined || parsed < 0 || parsed > 1) {
    throw createNimiError({
      message: `${messageType} ${fieldName} must be between 0 and 1`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_projection_shape',
      source: 'sdk',
    });
  }
  return parsed;
}

function expectVoicePlaybackState(
  value: unknown,
  fieldName: string,
  messageType: string,
): RuntimeAgentVoicePlaybackState {
  const normalized = expectString(value, fieldName, messageType);
  if (
    normalized === 'requested'
    || normalized === 'started'
    || normalized === 'completed'
    || normalized === 'interrupted'
    || normalized === 'canceled'
    || normalized === 'failed'
  ) {
    return normalized;
  }
  throw createNimiError({
    message: `${messageType} ${fieldName} is not an admitted playback state`,
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'check_runtime_agent_projection_shape',
    source: 'sdk',
  });
}

export function parseRuntimeAgentVoicePlaybackDetail(
  detail: Record<string, unknown>,
  messageType: string,
): RuntimeAgentPresentationVoicePlaybackRequestedEvent['detail'] {
  return {
    audioArtifactId: expectString(detail.audio_artifact_id, 'detail.audio_artifact_id', messageType),
    audioMimeType: expectString(detail.audio_mime_type, 'detail.audio_mime_type', messageType),
    playbackState: expectVoicePlaybackState(detail.playback_state, 'detail.playback_state', messageType),
    ...(optionalNumber(detail.duration_ms) !== undefined ? { durationMs: optionalNumber(detail.duration_ms) } : {}),
    ...(optionalNumber(detail.deadline_offset_ms) !== undefined ? { deadlineOffsetMs: optionalNumber(detail.deadline_offset_ms) } : {}),
    ...(optionalString(detail.reason) ? { reason: optionalString(detail.reason) } : {}),
  };
}

export function parseRuntimeAgentLipsyncFrameBatchDetail(
  detail: Record<string, unknown>,
  messageType: string,
): RuntimeAgentPresentationLipsyncFrameBatchEvent['detail'] {
  if (!Array.isArray(detail.frames) || detail.frames.length === 0) {
    throw createNimiError({
      message: `${messageType} detail.frames must be a non-empty array`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_projection_shape',
      source: 'sdk',
    });
  }
  let previousSequence = 0;
  let previousOffset = -1;
  return {
    audioArtifactId: expectString(detail.audio_artifact_id, 'detail.audio_artifact_id', messageType),
    frames: detail.frames.map((item): RuntimeAgentLipsyncFrame => {
      const frame = asRecord(item);
      const frameSequence = expectPositiveInteger(frame.frame_sequence, 'detail.frames[].frame_sequence', messageType);
      const offsetMs = expectNonNegativeNumber(frame.offset_ms, 'detail.frames[].offset_ms', messageType);
      if (frameSequence <= previousSequence) {
        throw createNimiError({
          message: `${messageType} detail.frames[].frame_sequence must be monotonic`,
          reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
          actionHint: 'check_runtime_agent_projection_shape',
          source: 'sdk',
        });
      }
      if (offsetMs < previousOffset) {
        throw createNimiError({
          message: `${messageType} detail.frames[].offset_ms must be monotonic`,
          reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
          actionHint: 'check_runtime_agent_projection_shape',
          source: 'sdk',
        });
      }
      previousSequence = frameSequence;
      previousOffset = offsetMs;
      return {
        frameSequence,
        offsetMs,
        durationMs: expectPositiveInteger(frame.duration_ms, 'detail.frames[].duration_ms', messageType),
        mouthOpenY: expectUnitNumber(frame.mouth_open_y, 'detail.frames[].mouth_open_y', messageType),
        audioLevel: expectUnitNumber(frame.audio_level, 'detail.frames[].audio_level', messageType),
      };
    }),
  };
}
