import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentCanonicalMemoryBankMode,
  AgentEventType,
  AvatarDebugProbeKind,
  AvatarDebugRequestedBy,
  CompanionParticipationStatus,
  CompanionParticipationSurfaceKind,
  CompanionParticipationTriggerSource,
  ConversationAnchorStatus,
  DelegatedApprovalDecision,
  DelegatedProviderKind,
  DelegatedProviderState,
  DelegatedProviderTrustTier,
  DelegatedTransportKind,
  EffectClass,
  HookAdmissionState,
  NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
  SensitivityClass,
  asyncEvents,
  buildNimiRuntimeAgentConsumeContext,
  buildNimiRuntimeAgentResolvedOutputText,
  buildNimiRuntimeAgentSnapshotRecoveryEvents,
  cloneNimiRuntimeAgentResolvedMessageActionEnvelopeWithCommittedMessage,
  collectAsyncIterable,
  consumeContext,
  createNimiHostRuntimeAgentMemorySurface,
  createNimiRuntimeAgentConsumeClient,
  createUnexpectedRuntimeAgentConsumeRuntime,
  decodeNimiRuntimeAgentCompanionParticipationProjection,
  isNimiRuntimeAgentProjectionEvent,
  matchesNimiRuntimeAgentProjectionScope,
  nimiRuntimeAgentSnapshotCompletedTurnHasRecoverableContent,
  nimiRuntimeAgentSnapshotTurnIsCompleted,
  nimiRuntimeAgentSnapshotTurnIsFailed,
  nimiRuntimeAgentSnapshotTurnIsTerminal,
  parseNimiRuntimeAgentResolvedMessageActionEnvelopeFromPayload,
  parseNimiRuntimeAgentStructuredMessageActionEnvelope,
  parseNimiRuntimeAgentTimeline,
  projectNimiRuntimeAgentAppMessageEvent,
  projectNimiRuntimeAgentCanonicalMemoryBankStatus,
  readNimiRuntimeAgentStructuredMessageField,
  recoverNimiRuntimeAgentTerminalSnapshot,
  summarizeNimiRuntimeAgentProjectionEvent,
  summarizeNimiRuntimeAgentTimeline,
  toNimiRuntimeProtoStruct,
  type AppMessageEvent,
  type NimiRuntimeAgentConsumeEvent,
  type NimiRuntimeAgentConsumeRuntime,
  type NimiRuntimeAgentSessionTurnSnapshot,
} from './runtime-agent-consume.test-helper';

test('Runtime Agent consume parses turn app messages and validates timelines', () => {
  const payload = {
    local_agent_ref: 'local-agent:test-owner-1-agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    text: 'hi',
    runtime_timeline: {
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      channel: 'text',
      offset_ms: 12,
      sequence: 1,
      started_at_wall: '2026-06-05T00:00:00.000Z',
      observed_at_wall: '2026-06-05T00:00:00.012Z',
      timebase_owner: 'runtime',
      projection_rule_id: 'K-AGCORE-051',
      clock_basis: 'monotonic_with_wall_anchor',
      provider_neutral: true,
      app_local_authority: false,
    },
  };
  const event: AppMessageEvent = {
    eventType: 0,
    sequence: '1',
    fromAppId: 'runtime.agent',
    toAppId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    messageType: 'runtime.agent.turn.text_delta',
    payload: toNimiRuntimeProtoStruct(payload),
  };

  const projected = projectNimiRuntimeAgentAppMessageEvent(event);

  assert.equal(projected?.eventName, 'runtime.agent.turn.text_delta');
  assert.equal(projected?.detail.text, 'hi');
  assert.equal(projected?.timeline?.projectionRuleId, 'K-AGCORE-051');
  const { runtime_timeline: runtimeTimeline, ...canonicalPayloadBase } = payload;
  const canonicalTimelineProjected = projectNimiRuntimeAgentAppMessageEvent({
    ...event,
    payload: toNimiRuntimeProtoStruct({
      ...canonicalPayloadBase,
      timeline: runtimeTimeline,
    }),
  });
  assert.equal(canonicalTimelineProjected?.timeline?.projectionRuleId, 'K-AGCORE-051');
  assert.throws(
    () => parseNimiRuntimeAgentTimeline({ ...payload.runtime_timeline, channel: 'voice' }, 'runtime.agent.turn.text_delta', 'turn-1', 'stream-1'),
    /timeline channel must be text/u,
  );
});

test('Runtime Agent consume preserves reasoning delta text as a typed text-channel event', () => {
  const payload = {
    local_agent_ref: 'local-agent:test-owner-1-agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    detail: {
      text: 'checking Runtime route',
    },
    runtime_timeline: {
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      channel: 'text',
      offset_ms: 8,
      sequence: 1,
      started_at_wall: '2026-06-05T00:00:00.000Z',
      observed_at_wall: '2026-06-05T00:00:00.008Z',
      timebase_owner: 'runtime',
      projection_rule_id: 'K-AGCORE-051',
      clock_basis: 'monotonic_with_wall_anchor',
      provider_neutral: true,
      app_local_authority: false,
    },
  };
  const event: AppMessageEvent = {
    eventType: 0,
    sequence: '1',
    fromAppId: 'runtime.agent',
    toAppId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    messageType: 'runtime.agent.turn.reasoning_delta',
    payload: toNimiRuntimeProtoStruct(payload),
  };

  const projected = projectNimiRuntimeAgentAppMessageEvent(event);

  assert.equal(projected?.eventName, 'runtime.agent.turn.reasoning_delta');
  assert.equal(projected?.detail.text, 'checking Runtime route');
  assert.equal(projected?.timeline?.channel, 'text');
});

test('Runtime Agent consume preserves lipsync frame batch app-message detail', () => {
  const payload = {
    local_agent_ref: 'local-agent:test-owner-1-agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    detail: {
      audio_artifact_id: 'runtime-agent-voice:final:turn-1:message-1:artifact-1',
      frames: [
        {
          frame_sequence: 1,
          offset_ms: 0,
          duration_ms: 80,
          mouth_open_y: 0.42,
          audio_level: 0.77,
        },
      ],
    },
    runtime_timeline: {
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      channel: 'lipsync',
      offset_ms: 16,
      sequence: 1,
      started_at_wall: '2026-06-05T00:00:00.000Z',
      observed_at_wall: '2026-06-05T00:00:00.016Z',
      timebase_owner: 'runtime',
      projection_rule_id: 'K-AGCORE-051',
      clock_basis: 'monotonic_with_wall_anchor',
      provider_neutral: true,
      app_local_authority: false,
    },
  };
  const event: AppMessageEvent = {
    eventType: 0,
    sequence: '2',
    fromAppId: 'runtime.agent',
    toAppId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    messageType: 'runtime.agent.presentation.lipsync_frame_batch',
    payload: toNimiRuntimeProtoStruct(payload),
  };

  const projected = projectNimiRuntimeAgentAppMessageEvent(event);

  assert.equal(projected?.eventName, 'runtime.agent.presentation.lipsync_frame_batch');
  assert.equal(projected?.detail.audioArtifactId, 'runtime-agent-voice:final:turn-1:message-1:artifact-1');
  assert.deepEqual(projected?.detail.frames, [
    {
      frameSequence: 1,
      offsetMs: 0,
      durationMs: 80,
      mouthOpenY: 0.42,
      audioLevel: 0.77,
    },
  ]);
  assert.equal(projected?.timeline?.channel, 'lipsync');
});

test('Runtime Agent consume preserves structured app message payload for the turn runner', () => {
  const structured = {
    message: {
      message_id: 'assistant-1',
      text: 'structured hello',
    },
    actions: [],
  };
  const payload = {
    local_agent_ref: 'local-agent:test-owner-1-agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    detail: {
      kind: 'nimi.agent.chat.message-action.v1',
      payload: structured,
    },
  };
  const event: AppMessageEvent = {
    eventType: 0,
    sequence: '2',
    messageId: 'runtime-event-structured',
    fromAppId: 'runtime.agent',
    toAppId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    messageType: 'runtime.agent.turn.structured',
    payload: toNimiRuntimeProtoStruct(payload),
    reasonCode: 0,
    traceId: '',
  };

  const projected = projectNimiRuntimeAgentAppMessageEvent(event);

  assert.equal(projected?.eventName, 'runtime.agent.turn.structured');
  assert.equal((projected?.detail.payload as { message?: { text?: string } })?.message?.text, 'structured hello');
  assert.equal((projected?.detail.structured as { message?: { text?: string } })?.message?.text, 'structured hello');
  assert.equal(
    parseNimiRuntimeAgentStructuredMessageActionEnvelope(projected?.detail.payload).message.text,
    'structured hello',
  );

  const legacyProjected = projectNimiRuntimeAgentAppMessageEvent({
    ...event,
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: 'local-agent:test-owner-1-agent-1',
      conversation_anchor_id: 'anchor-1',
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      structured,
    }),
  });
  assert.equal((legacyProjected?.detail.payload as { message?: { text?: string } })?.message?.text, 'structured hello');
});

test('Runtime Agent consume preserves accepted request id for backlog filtering', () => {
  const payload = {
    local_agent_ref: 'local-agent:test-owner-1-agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    detail: {
      request_id: 'request-1',
    },
  };
  const event: AppMessageEvent = {
    eventType: 0,
    sequence: '3',
    messageId: 'runtime-event-accepted',
    fromAppId: 'runtime.agent',
    toAppId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    messageType: 'runtime.agent.turn.accepted',
    payload: toNimiRuntimeProtoStruct(payload),
    reasonCode: 0,
    traceId: '',
  };

  const projected = projectNimiRuntimeAgentAppMessageEvent(event);

  assert.equal(projected?.eventName, 'runtime.agent.turn.accepted');
  assert.equal(projected?.detail.requestId, 'request-1');
});
