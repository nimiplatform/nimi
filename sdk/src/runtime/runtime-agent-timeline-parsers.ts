import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import { asRecord, normalizeText } from './helpers.js';
import type {
  RuntimeAgentTimelineChannel,
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

function parseTimelineFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!/^[-+]?(?:\d+|\d+\.\d+|\.\d+)(?:[eE][-+]?\d+)?$/.test(normalized)) {
      return undefined;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function expectTimelineNumber(value: unknown, fieldName: string, messageType: string): number {
  const parsed = parseTimelineFiniteNumber(value);
  if (parsed === undefined) {
    throw createNimiError({
      message: `${messageType} timeline.${fieldName} must be a finite number`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_timeline_projection_shape',
      source: 'sdk',
    });
  }
  return parsed;
}

function expectTimelineBoolean<T extends boolean>(
  value: unknown,
  expected: T,
  fieldName: string,
  messageType: string,
): T {
  if (value !== expected) {
    throw createNimiError({
      message: `${messageType} timeline.${fieldName} must be ${String(expected)}`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_timeline_projection_shape',
      source: 'sdk',
    });
  }
  return expected;
}

function timelineChannelForTurnEvent(messageType: string): RuntimeAgentTimelineChannel {
  switch (messageType) {
    case 'runtime.agent.turn.text_delta':
    case 'runtime.agent.turn.reasoning_delta':
    case 'runtime.agent.turn.structured':
    case 'runtime.agent.turn.message_committed':
      return 'text';
    case 'runtime.agent.turn.accepted':
    case 'runtime.agent.turn.started':
    case 'runtime.agent.turn.post_turn':
    case 'runtime.agent.turn.completed':
    case 'runtime.agent.turn.failed':
    case 'runtime.agent.turn.interrupted':
    case 'runtime.agent.turn.interrupt_ack':
      return 'state';
    default:
      throw createNimiError({
        message: `${messageType} does not admit runtime timeline metadata`,
        reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
        actionHint: 'check_runtime_agent_timeline_projection_shape',
        source: 'sdk',
      });
  }
}

export function parseRuntimeAgentTimeline(
  value: unknown,
  messageType: string,
  expectedTurnId: string,
  expectedStreamId: string,
): RuntimeAgentTimelineEnvelope {
  const payload = asRecord(value);
  const allowedKeys = [
    'app_local_authority',
    'channel',
    'clock_basis',
    'observed_at_wall',
    'offset_ms',
    'projection_rule_id',
    'provider_neutral',
    'sequence',
    'started_at_wall',
    'stream_id',
    'timebase_owner',
    'turn_id',
  ];
  const unknownKeys = Object.keys(payload).sort().filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw createNimiError({
      message: `${messageType} timeline contains unknown fields: ${unknownKeys.join(', ')}`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_timeline_projection_shape',
      source: 'sdk',
    });
  }
  const turnId = expectString(payload.turn_id, 'timeline.turn_id', messageType);
  const streamId = expectString(payload.stream_id, 'timeline.stream_id', messageType);
  if (turnId !== expectedTurnId || streamId !== expectedStreamId) {
    throw createNimiError({
      message: `${messageType} timeline turn_id and stream_id must match the turn envelope`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_timeline_projection_shape',
      source: 'sdk',
    });
  }
  const channel = expectString(payload.channel, 'timeline.channel', messageType);
  const expectedChannel = timelineChannelForTurnEvent(messageType);
  if (channel !== expectedChannel) {
    throw createNimiError({
      message: `${messageType} timeline.channel must be ${expectedChannel}`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_timeline_projection_shape',
      source: 'sdk',
    });
  }
  const offsetMs = expectTimelineNumber(payload.offset_ms, 'offset_ms', messageType);
  if (offsetMs < 0) {
    throw createNimiError({
      message: `${messageType} timeline.offset_ms must be non-negative`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_timeline_projection_shape',
      source: 'sdk',
    });
  }
  const sequence = expectTimelineNumber(payload.sequence, 'sequence', messageType);
  if (sequence <= 0 || !Number.isInteger(sequence)) {
    throw createNimiError({
      message: `${messageType} timeline.sequence must be a positive integer`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_timeline_projection_shape',
      source: 'sdk',
    });
  }
  const timebaseOwner = expectString(payload.timebase_owner, 'timeline.timebase_owner', messageType);
  const projectionRuleId = expectString(payload.projection_rule_id, 'timeline.projection_rule_id', messageType);
  const clockBasis = expectString(payload.clock_basis, 'timeline.clock_basis', messageType);
  if (timebaseOwner !== 'runtime' || projectionRuleId !== 'K-AGCORE-051' || clockBasis !== 'monotonic_with_wall_anchor') {
    throw createNimiError({
      message: `${messageType} timeline authority fields must match runtime K-AGCORE-051`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_timeline_projection_shape',
      source: 'sdk',
    });
  }
  return {
    turnId,
    streamId,
    channel: channel as RuntimeAgentTimelineChannel,
    offsetMs,
    sequence,
    startedAtWall: expectString(payload.started_at_wall, 'timeline.started_at_wall', messageType),
    observedAtWall: expectString(payload.observed_at_wall, 'timeline.observed_at_wall', messageType),
    timebaseOwner,
    projectionRuleId,
    clockBasis,
    providerNeutral: expectTimelineBoolean(payload.provider_neutral, true, 'provider_neutral', messageType),
    appLocalAuthority: expectTimelineBoolean(payload.app_local_authority, false, 'app_local_authority', messageType),
  };
}
