import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
  buildNimiRuntimeAgentConsumeContext,
  buildNimiRuntimeAgentResolvedOutputText,
  buildNimiRuntimeAgentSnapshotRecoveryEvents,
  cloneNimiRuntimeAgentResolvedMessageActionEnvelopeWithCommittedMessage,
  createNimiRuntimeAgentConsumeClient,
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
  projectNimiRuntimeAgentServiceEvent,
  readNimiRuntimeAgentStructuredMessageField,
  recoverNimiRuntimeAgentTerminalSnapshot,
  summarizeNimiRuntimeAgentProjectionEvent,
  summarizeNimiRuntimeAgentTimeline,
  toNimiRuntimeProtoStruct,
  type AgentEvent,
  type AppMessageEvent,
  type NimiRuntimeAgentConsumeEvent,
  type NimiRuntimeAgentConsumeRuntime,
  type NimiRuntimeAgentSessionTurnSnapshot,
} from './index';
import {
  AgentEventType,
  AvatarDebugEventFamily,
  AgentPresentationEventFamily,
  AgentStateEventFamily,
  AvatarDebugProbeKind,
  AvatarDebugProbeStatus,
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
  HookAdmissionState,
} from '../core-generated/runtime-typed-client';
import { toNimiRuntimeTimestamp } from './runtime-agent-values';

const consumeContext = {
  runtimeAppId: 'nimi.avatar',
  ownerUserId: 'owner-1',
  runtimeSourceRef: 'agent-1',
  localAgentRef: 'local-agent:owner-1:agent-1',
};

function createUnexpectedRuntimeAgentConsumeRuntime(
  overrides: Partial<NimiRuntimeAgentConsumeRuntime['agents']>,
): NimiRuntimeAgentConsumeRuntime {
  return {
    agents: {
      async openConversationAnchor() {
        throw new Error('unexpected');
      },
      async getConversationAnchorSnapshot() {
        throw new Error('unexpected');
      },
      async registerAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async resolveAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async getPublicChatSessionSnapshot() {
        throw new Error('unexpected');
      },
      subscribeAgentEvents() {
        throw new Error('unexpected');
      },
      ...overrides,
    },
  };
}

async function* asyncEvents<T>(events: readonly T[]): AsyncIterable<T> {
  for (const event of events) {
    yield event;
  }
}

function trackedPendingStream<T>(hooks: {
  readonly onNext: () => void;
  readonly onReturn: () => void;
}): AsyncIterable<T> {
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: async () => {
          hooks.onNext();
          if (closed) {
            return { done: true, value: undefined };
          }
          return new Promise<IteratorResult<T>>((resolve) => {
            waiters.push(resolve);
          });
        },
        return: async () => {
          closed = true;
          hooks.onReturn();
          while (waiters.length > 0) {
            waiters.shift()?.({ done: true, value: undefined });
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
}

async function collectAsyncIterable<T>(source: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of source) {
    collected.push(event);
  }
  return collected;
}

test('Runtime Agent consume fails closed when turn stream assembly lacks appMessages', async () => {
  const runtime: NimiRuntimeAgentConsumeRuntime = {
    agents: {
      async openConversationAnchor() {
        throw new Error('unexpected');
      },
      async getConversationAnchorSnapshot() {
        throw new Error('unexpected');
      },
      async registerAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async resolveAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async getPublicChatSessionSnapshot() {
        throw new Error('unexpected');
      },
      subscribeAgentEvents() {
        throw new Error('unexpected');
      },
    },
  };
  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });

  await assert.rejects(
    () => client.turns.subscribe({
      ...consumeContext,
      conversationAnchorId: 'anchor-1',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_APP_MESSAGES_REQUIRED');
      return true;
    },
  );
});

test('Runtime Agent consume context preserves explicit subject and canonical LocalAgent identity', () => {
  const context = buildNimiRuntimeAgentConsumeContext({
    ...consumeContext,
    runtimeAppId: 'nimi.avatar',
    subjectUserId: 'subject-2',
  });

  assert.equal(context.subjectUserId, 'subject-2');
  assert.equal(context.requestContext.subjectUserId, 'subject-2');
  assert.equal(context.requestContext.localAgentRef, consumeContext.localAgentRef);
  assert.throws(
    () => buildNimiRuntimeAgentConsumeContext({
      ...consumeContext,
      runtimeAppId: '',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_INPUT_INVALID');
      return true;
    },
  );
});

test('Runtime Agent consume subscribe filters app messages and merges generated Agent events', async () => {
  const appMessageCalls: unknown[] = [];
  const agentEventCalls: unknown[] = [];
  const appMessages: AppMessageEvent[] = [
    {
      eventType: 0,
      sequence: '1',
      fromAppId: 'runtime.agent',
      toAppId: 'nimi.avatar',
      subjectUserId: 'owner-1',
      messageType: 'runtime.agent.unrelated',
      payload: toNimiRuntimeProtoStruct({}),
    },
    {
      eventType: 0,
      sequence: '2',
      fromAppId: 'runtime.agent',
      toAppId: 'nimi.avatar',
      subjectUserId: 'owner-1',
      messageType: 'runtime.agent.turn.text_delta',
      payload: toNimiRuntimeProtoStruct({
        local_agent_ref: 'local-agent:owner-1:agent-1',
        conversation_anchor_id: 'anchor-other',
        turn_id: 'turn-other',
        stream_id: 'stream-other',
        text: 'filtered',
      }),
    },
    {
      eventType: 0,
      sequence: '3',
      fromAppId: 'runtime.agent',
      toAppId: 'nimi.avatar',
      subjectUserId: 'owner-1',
      messageType: 'runtime.agent.turn.text_delta',
      payload: toNimiRuntimeProtoStruct({
        local_agent_ref: 'local-agent:owner-1:agent-1',
        conversation_anchor_id: 'anchor-1',
        turn_id: 'turn-1',
        stream_id: 'stream-1',
        text: 'hello',
      }),
    },
  ];
  const agentEvents: AgentEvent[] = [
    {
      eventType: 6,
      sequence: '4',
      agentId: 'local-agent:owner-1:agent-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      detail: {
        oneofKind: 'state',
        state: {
          family: AgentStateEventFamily.STATUS_TEXT_CHANGED,
          conversationAnchorId: 'anchor-other',
          originatingTurnId: 'turn-other',
          originatingStreamId: 'stream-other',
          currentStatusText: 'filtered',
          previousStatusText: '',
          hasPreviousStatusText: false,
          currentExecutionState: 1,
          previousExecutionState: 0,
          currentEmotion: '',
          previousEmotion: '',
          emotionSource: '',
        },
      },
    },
    {
      eventType: 7,
      sequence: '5',
      agentId: 'local-agent:owner-1:agent-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      detail: {
        oneofKind: 'presentation',
        presentation: {
          family: AgentPresentationEventFamily.MOTION_REQUESTED,
          conversationAnchorId: 'anchor-1',
          turnId: 'turn-1',
          streamId: 'stream-1',
          activityName: '',
          activityCategory: '',
          activityIntensity: '',
          activitySource: '',
          motionId: 'motion-wave',
          motionPriority: 'normal',
          motionExpectedDurationMs: '420',
          expressionId: '',
          expressionExpectedDurationMs: '0',
          poseId: '',
          poseExpectedDurationMs: '0',
          previousPoseId: '',
          lookatTargetKind: '',
          lookatX: 0,
          lookatY: 0,
          lookatZ: 0,
          lookatHasX: false,
          lookatHasY: false,
          lookatHasZ: false,
        },
      },
    },
  ];
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    subscribeAgentEvents(request) {
      agentEventCalls.push(request);
      return asyncEvents(agentEvents);
    },
  });
  const runtimeWithMessages: NimiRuntimeAgentConsumeRuntime = {
    ...runtime,
    appMessages: {
      subscribeAppMessages(request) {
        appMessageCalls.push(request);
        return asyncEvents(appMessages);
      },
    },
  };
  const client = createNimiRuntimeAgentConsumeClient({ runtime: runtimeWithMessages, runtimeAppId: 'nimi.avatar' });

  const stream = await client.turns.subscribe({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
    cursor: '4',
  });
  const events = await collectAsyncIterable(stream);

  assert.deepEqual(events.map((event) => event.eventName).sort(), [
    'runtime.agent.presentation.motion_requested',
    'runtime.agent.turn.text_delta',
  ]);
  assert.equal(events.find((event) => event.eventName === 'runtime.agent.turn.text_delta')?.detail.text, 'hello');
  assert.equal(events.find((event) => event.eventName === 'runtime.agent.presentation.motion_requested')?.detail.motionId, 'motion-wave');
  assert.deepEqual(appMessageCalls[0], {
    appId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    cursor: '4',
    fromAppIds: ['runtime.agent'],
  });
  assert.deepEqual((agentEventCalls[0] as { eventFilters?: unknown }).eventFilters, [
    AgentEventType.HOOK,
    AgentEventType.STATE,
    AgentEventType.PRESENTATION,
    AgentEventType.AVATAR_DEBUG,
  ]);
  assert.equal((agentEventCalls[0] as { cursor?: string }).cursor, '4');

  appMessageCalls.length = 0;
  agentEventCalls.length = 0;
  const liveOnlyStream = await client.turns.subscribe({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
  });
  await collectAsyncIterable(liveOnlyStream);
  assert.equal((appMessageCalls[0] as { cursor?: string }).cursor, '');
  assert.equal((agentEventCalls[0] as { cursor?: string }).cursor, '');

  const appOnly = await client.turns.subscribe({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
    includeAgentEvents: false,
  });
  assert.deepEqual((await collectAsyncIterable(appOnly)).map((event) => event.eventName), [
    'runtime.agent.turn.text_delta',
  ]);
  await assert.rejects(
    () => client.turns.subscribe({
      ...consumeContext,
      conversationAnchorId: 'anchor-1',
      cursor: 'cursor-not-runtime',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_INPUT_INVALID');
      return true;
    },
  );
});

test('Runtime Agent consume subscribe without cursor starts generated Agent events at live boundary', async () => {
  const baseMotion = {
    family: AgentPresentationEventFamily.MOTION_REQUESTED,
    conversationAnchorId: 'anchor-1',
    turnId: 'old-turn',
    streamId: 'old-stream',
    activityName: '',
    activityCategory: '',
    activityIntensity: '',
    activitySource: '',
    motionId: 'motion-old',
    motionPriority: 'normal',
    motionExpectedDurationMs: '420',
    expressionId: '',
    expressionExpectedDurationMs: '0',
    poseId: '',
    poseExpectedDurationMs: '0',
    previousPoseId: '',
    lookatTargetKind: '',
    lookatX: 0,
    lookatY: 0,
    lookatZ: 0,
    lookatHasX: false,
    lookatHasY: false,
    lookatHasZ: false,
  };
  const oldMotion = {
    eventType: 7,
    sequence: '1',
    agentId: 'local-agent:owner-1:agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'agent-1',
    timestamp: toNimiRuntimeTimestamp(Date.now() - 60_000),
    detail: {
      oneofKind: 'presentation',
      presentation: baseMotion,
    },
  } as AgentEvent;
  const newMotion = {
    ...oldMotion,
    sequence: '2',
    timestamp: toNimiRuntimeTimestamp(Date.now() + 1_000),
    detail: {
      oneofKind: 'presentation',
      presentation: {
        ...baseMotion,
        turnId: 'new-turn',
        streamId: 'new-stream',
        motionId: 'motion-new',
      },
    },
  } as AgentEvent;
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    subscribeAgentEvents() {
      return asyncEvents([oldMotion, newMotion]);
    },
  });
  const client = createNimiRuntimeAgentConsumeClient({
    runtime: {
      ...runtime,
      appMessages: {
        subscribeAppMessages() {
          return asyncEvents([]);
        },
      },
    },
    runtimeAppId: 'nimi.avatar',
  });

  const events = await collectAsyncIterable(await client.turns.subscribe({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
  }));

  assert.deepEqual(events.map((event) => event.turnId), ['new-turn']);
  assert.equal(events[0]?.eventName, 'runtime.agent.presentation.motion_requested');
  assert.equal(events[0]?.detail.motionId, 'motion-new');
});

test('Runtime Agent consume client opens live streams before caller pulls', async () => {
  let agentNextCount = 0;
  let appNextCount = 0;
  let agentReturnCount = 0;
  let appReturnCount = 0;
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    subscribeAgentEvents() {
      return trackedPendingStream<AgentEvent>({
        onNext: () => {
          agentNextCount += 1;
        },
        onReturn: () => {
          agentReturnCount += 1;
        },
      });
    },
  });
  const runtimeWithMessages: NimiRuntimeAgentConsumeRuntime = {
    ...runtime,
    appMessages: {
      subscribeAppMessages() {
        return trackedPendingStream<AppMessageEvent>({
          onNext: () => {
            appNextCount += 1;
          },
          onReturn: () => {
            appReturnCount += 1;
          },
        });
      },
    },
  };
  const client = createNimiRuntimeAgentConsumeClient({ runtime: runtimeWithMessages, runtimeAppId: 'nimi.avatar' });

  const stream = await client.turns.subscribe({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
    includeAgentEvents: true,
  });

  assert.equal(appNextCount, 1);
  assert.equal(agentNextCount, 1);
  await stream[Symbol.asyncIterator]().return?.();
  assert.equal(appReturnCount, 1);
  assert.equal(agentReturnCount, 1);
});

test('Runtime Agent consume projects generated event families and fails closed on unsupported ones', () => {
  const stateCases: Array<readonly [AgentStateEventFamily, string]> = [
    [AgentStateEventFamily.STATUS_TEXT_CHANGED, 'runtime.agent.state.status_text_changed'],
    [AgentStateEventFamily.EXECUTION_STATE_CHANGED, 'runtime.agent.state.execution_state_changed'],
    [AgentStateEventFamily.POSTURE_CHANGED, 'runtime.agent.state.posture_changed'],
  ];
  for (const [family, eventName] of stateCases) {
    const event = projectNimiRuntimeAgentServiceEvent({
      eventType: 6,
      sequence: String(family),
      agentId: 'local-agent:owner-1:agent-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      detail: {
        oneofKind: 'state',
        state: {
          family,
          conversationAnchorId: 'anchor-1',
          originatingTurnId: 'turn-1',
          originatingStreamId: 'stream-1',
          currentStatusText: 'ready',
          previousStatusText: 'idle',
          hasPreviousStatusText: true,
          currentExecutionState: 5,
          previousExecutionState: 4,
          currentEmotion: 'joy',
          previousEmotion: 'neutral',
          emotionSource: 'runtime',
          currentPosture: {
            actionFamily: 'stand',
            interruptMode: 'soft',
          },
          previousPosture: {
            actionFamily: 'idle',
            interruptMode: 'none',
          },
        },
      },
    });
    assert.equal(event.eventName, eventName);
    assert.equal(event.detail.currentStatusText, 'ready');
    assert.equal(event.detail.currentExecutionState, 'suspended');
  }

  const presentationCases: Array<readonly [AgentPresentationEventFamily, string, keyof Record<string, unknown>]> = [
    [AgentPresentationEventFamily.EXPRESSION_REQUESTED, 'runtime.agent.presentation.expression_requested', 'expressionId'],
    [AgentPresentationEventFamily.POSE_REQUESTED, 'runtime.agent.presentation.pose_requested', 'poseId'],
    [AgentPresentationEventFamily.POSE_CLEARED, 'runtime.agent.presentation.pose_cleared', 'previousPoseId'],
    [AgentPresentationEventFamily.LOOKAT_REQUESTED, 'runtime.agent.presentation.lookat_requested', 'lookatTargetKind'],
  ];
  for (const [family, eventName, detailField] of presentationCases) {
    const event = projectNimiRuntimeAgentServiceEvent({
      eventType: 7,
      sequence: String(family),
      agentId: 'local-agent:owner-1:agent-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      detail: {
        oneofKind: 'presentation',
        presentation: {
          family,
          conversationAnchorId: 'anchor-1',
          turnId: 'turn-1',
          streamId: 'stream-1',
          activityName: 'wave',
          activityCategory: 'interaction',
          activityIntensity: '',
          activitySource: 'runtime',
          motionId: 'motion-1',
          motionPriority: 'normal',
          motionExpectedDurationMs: '12',
          expressionId: 'smile',
          expressionExpectedDurationMs: '33',
          poseId: 'pose-1',
          poseExpectedDurationMs: '44',
          previousPoseId: 'pose-0',
          lookatTargetKind: 'point',
          lookatX: 1,
          lookatY: 2,
          lookatZ: 3,
          lookatHasX: true,
          lookatHasY: true,
          lookatHasZ: true,
        },
      },
    });
    assert.equal(event.eventName, eventName);
    assert.notEqual(event.detail[detailField], undefined);
  }

  const avatarDebugEvent = projectNimiRuntimeAgentServiceEvent({
    eventType: AgentEventType.AVATAR_DEBUG,
    sequence: 'avatar-debug-1',
    agentId: 'local-agent:owner-1:agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'agent-1',
    detail: {
      oneofKind: 'avatarDebug',
      avatarDebug: {
        family: AvatarDebugEventFamily.PROBE_REQUESTED,
        request: {
          probeId: 'probe-1',
          agentId: 'local-agent:owner-1:agent-1',
          conversationAnchorId: 'anchor-1',
          probeKind: AvatarDebugProbeKind.BACKEND_LOAD,
          requestedAt: { seconds: 1n, nanos: 0 },
          requestedBy: AvatarDebugRequestedBy.DESKTOP_WORKBENCH,
          turnId: '',
          streamId: '',
          avatarInstanceId: 'avatar-1',
          runtimeReplayRef: 'runtime.replay/probe-1',
          replayRequested: true,
        },
      },
    },
  });
  assert.equal(avatarDebugEvent.eventName, 'runtime.agent.avatar_debug.probe_requested');
  assert.equal(avatarDebugEvent.conversationAnchorId, 'anchor-1');
  assert.equal(avatarDebugEvent.detail.probeId, 'probe-1');
  assert.equal('scopedBinding' in avatarDebugEvent.detail, false);

  const hookCases: Array<readonly [HookAdmissionState, string]> = [
    [HookAdmissionState.PROPOSED, 'runtime.agent.hook.intent_proposed'],
    [HookAdmissionState.PENDING, 'runtime.agent.hook.pending'],
    [HookAdmissionState.REJECTED, 'runtime.agent.hook.rejected'],
    [HookAdmissionState.RUNNING, 'runtime.agent.hook.running'],
    [HookAdmissionState.COMPLETED, 'runtime.agent.hook.completed'],
    [HookAdmissionState.FAILED, 'runtime.agent.hook.failed'],
    [HookAdmissionState.CANCELED, 'runtime.agent.hook.canceled'],
    [HookAdmissionState.RESCHEDULED, 'runtime.agent.hook.rescheduled'],
  ];
  for (const [family, eventName] of hookCases) {
    const event = projectNimiRuntimeAgentServiceEvent({
      eventType: 8,
      sequence: String(family),
      agentId: 'local-agent:owner-1:agent-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      detail: {
        oneofKind: 'hook',
        hook: {
          family,
          intent: 'run-tool',
          reasonCode: 'HOOK_READY',
          message: 'ready',
          reason: 'policy',
        },
      },
    });
    assert.equal(event.eventName, eventName);
    assert.equal(event.detail.intent, 'run-tool');
  }

  assert.throws(
    () => projectNimiRuntimeAgentServiceEvent({
      eventType: 6,
      sequence: 'unsupported',
      agentId: 'local-agent:owner-1:agent-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      detail: {
        oneofKind: 'state',
        state: {
          family: 999 as AgentStateEventFamily,
        },
      },
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_EVENT_UNSUPPORTED');
      return true;
    },
  );
  assert.throws(
    () => projectNimiRuntimeAgentServiceEvent({
      eventType: 0,
      sequence: 'unsupported',
      agentId: 'local-agent:owner-1:agent-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      detail: { oneofKind: undefined },
    } as AgentEvent),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_EVENT_UNSUPPORTED');
      return true;
    },
  );
});

test('Runtime Agent consume app-message projection covers state hook presentation and fail-closed details', () => {
  const state = projectNimiRuntimeAgentAppMessageEvent({
    eventType: 0,
    sequence: '1',
    fromAppId: 'runtime.agent',
    toAppId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    messageType: 'runtime.agent.state.status_text_changed',
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: 'local-agent:owner-1:agent-1',
      conversation_anchor_id: 'anchor-1',
      originating_turn_id: 'turn-1',
      current_status_text: 'Ready',
      previous_status_text: 'Idle',
    }),
  });
  const hook = projectNimiRuntimeAgentAppMessageEvent({
    eventType: 0,
    sequence: '2',
    fromAppId: 'runtime.agent',
    toAppId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    messageType: 'runtime.agent.hook.pending',
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: 'local-agent:owner-1:agent-1',
      intent_id: 'intent-1',
      trigger_family: 'tool',
      trigger_detail: { tool: 'search' },
      effect: 'external_call',
      admission_state: 'pending',
      reason_code: 'APPROVAL_REQUIRED',
      message: 'Needs approval',
    }),
  });
  const voice = projectNimiRuntimeAgentAppMessageEvent({
    eventType: 0,
    sequence: '3',
    fromAppId: 'runtime.agent',
    toAppId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    messageType: 'runtime.agent.presentation.voice_playback_requested',
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: 'local-agent:owner-1:agent-1',
      conversation_anchor_id: 'anchor-1',
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      message_id: 'message-1',
      audio_artifact_id: 'artifact-1',
      audio_mime_type: 'audio/wav',
      playback_state: 'queued',
      voice_output_mode: 'batch_final_artifact',
      voice_playback_state: 'active',
      playback_target: 'avatar_autoplay',
      final_artifact: true,
      default_voice_reference: 'preset_voice_id:zh_narrator',
      voice_route_binding: {
        capability: 'audio.synthesize',
        default_voice_reference: 'preset_voice_id:zh_narrator',
        voice_reference_kind: 'preset_voice_id',
        voice_reference_value: 'zh_narrator',
        model_id: 'speech/qwen3tts',
        model_resolved: 'speech/qwen3tts-ready',
        scenario_job_id: 'job-voice-1',
        bound_audio_artifact_id: 'artifact-voice-provider-1',
        bound_audio_mime_type: 'audio/wav',
        synthesis_mode: 'provider_audio_with_synthetic_lipsync',
        status: 'bound',
        reason: 'tts_provider_route_bound',
      },
      duration_ms: '1200',
      deadline_offset_ms: 300,
      runtime_timeline: {
        turn_id: 'turn-1',
        stream_id: 'stream-1',
        channel: 'voice',
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
    }),
  });

  assert.equal(state?.eventName, 'runtime.agent.state.status_text_changed');
  assert.equal(state?.detail.currentStatusText, 'Ready');
  assert.equal(hook?.eventName, 'runtime.agent.hook.pending');
  assert.deepEqual(hook?.detail.triggerDetail, { tool: 'search' });
  assert.equal(voice?.detail.audioArtifactId, 'artifact-1');
  assert.equal(voice?.detail.messageId, 'message-1');
  assert.equal(voice?.detail.voiceOutputMode, 'batch_final_artifact');
  assert.equal(voice?.detail.voicePlaybackState, 'active');
  assert.equal(voice?.detail.playbackTarget, 'avatar_autoplay');
  assert.equal(voice?.detail.finalArtifact, true);
  assert.deepEqual(voice?.detail.voiceRouteBinding, {
    capability: 'audio.synthesize',
    defaultVoiceReference: 'preset_voice_id:zh_narrator',
    voiceReferenceKind: 'preset_voice_id',
    voiceReferenceValue: 'zh_narrator',
    modelId: 'speech/qwen3tts',
    modelResolved: 'speech/qwen3tts-ready',
    scenarioJobId: 'job-voice-1',
    boundAudioArtifactId: 'artifact-voice-provider-1',
    boundAudioMimeType: 'audio/wav',
    synthesisMode: 'provider_audio_with_synthetic_lipsync',
    status: 'bound',
    reason: 'tts_provider_route_bound',
  });
  assert.equal(voice?.timeline?.channel, 'voice');
  const voiceChunk = projectNimiRuntimeAgentAppMessageEvent({
    eventType: 0,
    sequence: '4',
    fromAppId: 'runtime.agent',
    toAppId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    messageType: 'runtime.agent.presentation.voice_stream_chunk_available',
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: 'local-agent:owner-1:agent-1',
      conversation_anchor_id: 'anchor-1',
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      message_id: 'message-1',
      audio_artifact_id: 'artifact-1',
      audio_mime_type: 'audio/wav',
      chunk_sequence: 1,
      final_chunk: true,
      voice_output_mode: 'batch_final_artifact',
      voice_playback_state: 'active',
      duration_ms: 1200,
      reason: 'final_artifact_available',
      playback_target: 'avatar_autoplay',
      runtime_timeline: {
        turn_id: 'turn-1',
        stream_id: 'stream-1',
        channel: 'voice',
        offset_ms: 13,
        sequence: 2,
        started_at_wall: '2026-06-05T00:00:00.000Z',
        observed_at_wall: '2026-06-05T00:00:00.013Z',
        timebase_owner: 'runtime',
        projection_rule_id: 'K-AGCORE-133',
        clock_basis: 'monotonic_with_wall_anchor',
        provider_neutral: true,
        app_local_authority: false,
      },
    }),
  });
  assert.equal(voiceChunk?.eventName, 'runtime.agent.presentation.voice_stream_chunk_available');
  assert.equal(voiceChunk?.detail.audioArtifactId, 'artifact-1');
  assert.equal(voiceChunk?.detail.messageId, 'message-1');
  assert.equal(voiceChunk?.detail.chunkSequence, 1);
  assert.equal(voiceChunk?.detail.finalChunk, true);
  assert.equal(voiceChunk?.detail.voiceOutputMode, 'batch_final_artifact');
  assert.equal(voiceChunk?.detail.voicePlaybackState, 'active');
  assert.equal(voiceChunk?.detail.playbackTarget, 'avatar_autoplay');
  assert.equal(voiceChunk?.timeline?.projectionRuleId, 'K-AGCORE-133');
  const nativeVoiceChunk = projectNimiRuntimeAgentAppMessageEvent({
    eventType: 0,
    sequence: '5',
    fromAppId: 'runtime.agent',
    toAppId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    messageType: 'runtime.agent.presentation.voice_stream_chunk_available',
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: 'local-agent:owner-1:agent-1',
      conversation_anchor_id: 'anchor-1',
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      message_id: 'message-1',
      audio_mime_type: 'audio/wav',
      voice_stream_id: 'voice-stream-1',
      chunk_transport_ref: 'runtime-agent-voice-stream://voice-stream-1/chunks/000001',
      chunk_sequence: 1,
      final_chunk: false,
      voice_output_mode: 'native_stream',
      voice_playback_state: 'active',
      reason: 'native_stream_chunk_available',
      playback_target: 'avatar_autoplay',
      runtime_timeline: {
        turn_id: 'turn-1',
        stream_id: 'stream-1',
        channel: 'voice',
        offset_ms: 14,
        sequence: 3,
        started_at_wall: '2026-06-05T00:00:00.000Z',
        observed_at_wall: '2026-06-05T00:00:00.014Z',
        timebase_owner: 'runtime',
        projection_rule_id: 'K-AGCORE-133',
        clock_basis: 'monotonic_with_wall_anchor',
        provider_neutral: true,
        app_local_authority: false,
      },
    }),
  });
  assert.equal(nativeVoiceChunk?.detail.audioArtifactId, undefined);
  assert.equal(nativeVoiceChunk?.detail.voiceStreamId, 'voice-stream-1');
  assert.equal(nativeVoiceChunk?.detail.chunkTransportRef, 'runtime-agent-voice-stream://voice-stream-1/chunks/000001');
  assert.equal(nativeVoiceChunk?.detail.finalChunk, false);
  assert.equal(nativeVoiceChunk?.detail.voiceOutputMode, 'native_stream');
  const voiceTerminal = projectNimiRuntimeAgentAppMessageEvent({
    eventType: 0,
    sequence: '6',
    fromAppId: 'runtime.agent',
    toAppId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    messageType: 'runtime.agent.presentation.voice_playback_terminal',
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: 'local-agent:owner-1:agent-1',
      conversation_anchor_id: 'anchor-1',
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      detail: {},
      voice_stream_id: 'voice-stream-1',
      final_artifact_id: 'artifact-final-1',
      audio_mime_type: 'audio/wav',
      message_id: 'message-1',
      voice_output_mode: 'native_stream',
      voice_playback_state: 'completed',
      terminal_reason: 'native_stream_completed',
      playback_target: 'avatar_autoplay',
      runtime_timeline: {
        turn_id: 'turn-1',
        stream_id: 'stream-1',
        channel: 'voice',
        offset_ms: 15,
        sequence: 4,
        started_at_wall: '2026-06-05T00:00:00.000Z',
        observed_at_wall: '2026-06-05T00:00:00.015Z',
        timebase_owner: 'runtime',
        projection_rule_id: 'K-AGCORE-133',
        clock_basis: 'monotonic_with_wall_anchor',
        provider_neutral: true,
        app_local_authority: false,
      },
    }),
  });
  assert.equal(voiceTerminal?.eventName, 'runtime.agent.presentation.voice_playback_terminal');
  assert.equal(voiceTerminal?.detail.voiceStreamId, 'voice-stream-1');
  assert.equal(voiceTerminal?.detail.finalArtifactId, 'artifact-final-1');
  assert.equal(voiceTerminal?.detail.voiceOutputMode, 'native_stream');
  assert.equal(voiceTerminal?.detail.voicePlaybackState, 'completed');
  assert.equal(voiceTerminal?.detail.terminalReason, 'native_stream_completed');
  assert.equal(projectNimiRuntimeAgentAppMessageEvent({
    eventType: 0,
    sequence: '7',
    fromAppId: 'runtime.agent',
    toAppId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    messageType: 'runtime.agent.unsupported',
    payload: toNimiRuntimeProtoStruct({}),
  }), null);
  assert.throws(
    () => projectNimiRuntimeAgentAppMessageEvent({
      eventType: 0,
      sequence: '6',
      fromAppId: 'runtime.agent',
      toAppId: 'nimi.avatar',
      subjectUserId: 'owner-1',
      messageType: 'runtime.agent.turn.completed',
      payload: toNimiRuntimeProtoStruct({
        turn_id: 'turn-1',
        stream_id: 'stream-1',
      }),
    }, 'local-agent:owner-1:agent-1'),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_INPUT_INVALID');
      return true;
    },
  );
  assert.throws(
    () => parseNimiRuntimeAgentTimeline({
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      channel: 'text',
      offset_ms: -1,
      sequence: 0,
      timebase_owner: 'runtime',
      projection_rule_id: 'K-AGCORE-051',
      clock_basis: 'monotonic_with_wall_anchor',
      provider_neutral: true,
      app_local_authority: false,
    }, 'runtime.agent.turn.text_delta', 'turn-1', 'stream-1'),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_TIMELINE_INVALID');
      return true;
    },
  );
});

test('Runtime Agent consumer helpers summarize projection scope and recover terminal snapshots', async () => {
  const projectionEvent: NimiRuntimeAgentConsumeEvent = {
    eventName: 'runtime.agent.presentation.expression_requested',
    localAgentRef: 'local-agent:owner-1:agent-1',
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    streamId: 'stream-1',
    timeline: {
      turnId: 'turn-1',
      streamId: 'stream-1',
      channel: 'state',
      offsetMs: 4,
      sequence: 2,
      startedAtWall: '2026-06-05T00:00:00.000Z',
      observedAtWall: '2026-06-05T00:00:00.004Z',
      timebaseOwner: 'runtime',
      projectionRuleId: 'K-AGCORE-051',
      clockBasis: 'monotonic_with_wall_anchor',
      providerNeutral: true,
      appLocalAuthority: false,
    },
    detail: { expressionId: 'smile' },
  };
  assert.equal(isNimiRuntimeAgentProjectionEvent(projectionEvent), true);
  assert.equal(matchesNimiRuntimeAgentProjectionScope({
    event: projectionEvent,
    conversationAnchorId: 'anchor-1',
    currentTurnAccepted: true,
    currentRuntimeTurnId: 'turn-1',
  }), true);
  assert.equal(matchesNimiRuntimeAgentProjectionScope({
    event: projectionEvent,
    conversationAnchorId: 'anchor-1',
    currentTurnAccepted: false,
    currentRuntimeTurnId: 'turn-1',
  }), false);
  assert.deepEqual(summarizeNimiRuntimeAgentProjectionEvent(projectionEvent), {
    eventName: 'runtime.agent.presentation.expression_requested',
    localAgentRef: 'local-agent:owner-1:agent-1',
    conversationAnchorId: 'anchor-1',
    runtimeTurnId: 'turn-1',
    runtimeStreamId: 'stream-1',
    detail: { expressionId: 'smile' },
  });
  assert.deepEqual(summarizeNimiRuntimeAgentTimeline(projectionEvent), {
    turnId: 'turn-1',
    streamId: 'stream-1',
    channel: 'state',
    offsetMs: 4,
    sequence: 2,
    startedAtWall: '2026-06-05T00:00:00.000Z',
    observedAtWall: '2026-06-05T00:00:00.004Z',
    timebaseOwner: 'runtime',
    projectionRuleId: 'K-AGCORE-051',
    clockBasis: 'monotonic_with_wall_anchor',
    providerNeutral: true,
    appLocalAuthority: false,
  });
  assert.equal(summarizeNimiRuntimeAgentTimeline({
    ...projectionEvent,
    timeline: undefined,
  }), null);

  const completedTurn: NimiRuntimeAgentSessionTurnSnapshot = {
    turnId: 'turn-1',
    status: 'completed',
    streamId: 'stream-1',
    messageId: 'message-1',
    text: '',
    structured: {
      schema_id: 'agent_resolved_message_action_envelope',
      message: {
        message_id: 'message-structured',
        text: 'Recovered text',
      },
    },
    finishReason: 'stop',
    updatedAt: '2026-06-05T00:00:03.000Z',
  };
  assert.equal(readNimiRuntimeAgentStructuredMessageField(completedTurn.structured, 'text'), 'Recovered text');
  assert.equal(nimiRuntimeAgentSnapshotTurnIsCompleted(completedTurn), true);
  assert.equal(nimiRuntimeAgentSnapshotTurnIsFailed({ turnId: 'turn-failed', reasonCode: 'MODEL_ERROR' }), true);
  assert.equal(nimiRuntimeAgentSnapshotTurnIsTerminal(completedTurn), true);
  assert.equal(nimiRuntimeAgentSnapshotCompletedTurnHasRecoverableContent({
    turnId: 'turn-empty',
    status: 'completed',
    finishReason: 'stop',
  }), false);

  const recoveryEvents = buildNimiRuntimeAgentSnapshotRecoveryEvents({
    turn: completedTurn,
    localAgentRef: 'local-agent:owner-1:agent-1',
    conversationAnchorId: 'anchor-1',
    requestId: 'request-1',
    currentTurnAccepted: false,
    currentRuntimeTurnId: '',
    currentRuntimeStreamId: '',
    hasStructuredEnvelope: false,
    hasCommittedMessage: false,
    allowSnapshotStreamId: true,
  });
  assert.deepEqual(recoveryEvents.map((event) => event.eventName), [
    'runtime.agent.turn.accepted',
    'runtime.agent.turn.structured',
    'runtime.agent.turn.message_committed',
    'runtime.agent.turn.completed',
  ]);

  const actionFailureRecoveryEvents = buildNimiRuntimeAgentSnapshotRecoveryEvents({
    turn: {
      ...completedTurn,
      reasonCode: 'AI_LOCAL_EXECUTION_PROCESS_CRASHED',
      message: 'Image generation failed.',
      structured: {
        schema_id: 'nimi.agent.chat.message-action.v1',
        message: { message_id: 'message-structured', text: 'Recovered text' },
        actions: [{
          action_id: 'action-0',
          action_index: 0,
          action_count: 1,
          modality: 'image',
          operation: 'image.generate',
          prompt_payload: { kind: 'image-prompt', prompt_text: 'draw a fox' },
          source_message_id: 'message-structured',
          delivery_coupling: 'after-message',
        }],
      },
    },
    localAgentRef: 'local-agent:owner-1:agent-1',
    conversationAnchorId: 'anchor-1',
    requestId: 'request-1',
    currentTurnAccepted: true,
    currentRuntimeTurnId: 'turn-1',
    currentRuntimeStreamId: 'stream-1',
    hasStructuredEnvelope: true,
    hasCommittedMessage: true,
  });
  assert.deepEqual(actionFailureRecoveryEvents.map((event) => event.eventName), [
    'runtime.agent.turn.action_failed',
    'runtime.agent.turn.completed',
  ]);
  assert.deepEqual(actionFailureRecoveryEvents[0]?.detail, {
    actionId: 'action-0',
    modality: 'image',
    operation: 'image.generate',
    projectionMessageId: 'turn-1:message:1',
    reasonCode: 'AI_LOCAL_EXECUTION_PROCESS_CRASHED',
    reason: 'image_execution_failed',
    message: 'Image generation failed.',
  });

  const enqueued: NimiRuntimeAgentConsumeEvent[] = [];
  const logs: unknown[] = [];
  assert.equal(await recoverNimiRuntimeAgentTerminalSnapshot({
    reason: 'stall',
    request: {
      ...consumeContext,
      conversationAnchorId: 'anchor-1',
      threadId: 'thread-1',
    },
    requestId: 'request-1',
    requestMessageId: 'message-request',
    requestStartedAtMs: Date.parse('2026-06-05T00:00:02.000Z'),
    currentTurnAccepted: false,
    currentRuntimeTurnId: '',
    currentRuntimeStreamId: '',
    hasStructuredEnvelope: false,
    hasCommittedMessage: false,
    querySnapshot: async () => ({
      requestId: 'request-1',
      activeTurn: { turnId: 'turn-active' },
    }),
    enqueue: (event) => enqueued.push(event),
    logEvent: (event) => logs.push(event),
  }), 'bound');
  assert.equal(enqueued[0]?.streamId, 'snapshot:turn-active');
  assert.equal(logs.length, 1);

  enqueued.length = 0;
  assert.equal(await recoverNimiRuntimeAgentTerminalSnapshot({
    reason: 'stall',
    request: {
      ...consumeContext,
      conversationAnchorId: 'anchor-1',
    },
    requestId: 'request-1',
    requestMessageId: 'message-request',
    requestStartedAtMs: Date.parse('2026-06-05T00:00:02.000Z'),
    currentTurnAccepted: false,
    currentRuntimeTurnId: '',
    currentRuntimeStreamId: '',
    hasStructuredEnvelope: false,
    hasCommittedMessage: false,
    querySnapshot: async () => ({
      requestId: 'request-1',
      lastTurn: completedTurn,
    }),
    enqueue: (event) => enqueued.push(event),
    logEvent: (event) => logs.push(event),
  }), 'terminal');
  assert.equal(enqueued.at(-1)?.eventName, 'runtime.agent.turn.completed');

  assert.equal(await recoverNimiRuntimeAgentTerminalSnapshot({
    reason: 'stall',
    request: {
      ...consumeContext,
      conversationAnchorId: 'anchor-1',
    },
    requestId: 'request-1',
    requestMessageId: 'message-request',
    requestStartedAtMs: Date.parse('2026-06-05T00:00:02.000Z'),
    currentTurnAccepted: true,
    currentRuntimeTurnId: 'turn-other',
    currentRuntimeStreamId: 'stream-other',
    hasStructuredEnvelope: true,
    hasCommittedMessage: true,
    querySnapshot: async () => ({
      requestId: 'request-1',
      lastTurn: completedTurn,
    }),
    enqueue: (event) => enqueued.push(event),
    logEvent: (event) => logs.push(event),
  }), 'none');

  assert.equal(await recoverNimiRuntimeAgentTerminalSnapshot({
    reason: 'stall',
    request: {
      ...consumeContext,
      conversationAnchorId: 'anchor-1',
    },
    requestId: 'request-1',
    requestMessageId: 'message-request',
    requestStartedAtMs: Date.parse('2026-06-05T00:00:02.000Z'),
    currentTurnAccepted: false,
    currentRuntimeTurnId: '',
    currentRuntimeStreamId: '',
    hasStructuredEnvelope: false,
    hasCommittedMessage: false,
    querySnapshot: async () => {
      throw new Error('Runtime unavailable');
    },
    enqueue: (event) => enqueued.push(event),
    logEvent: (event) => logs.push(event),
  }), 'none');
});

test('Runtime Agent companion participation and avatar debug clients cover request envelopes', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown; readonly options?: unknown }> = [];
  const callOptions = { timeoutMs: 9000 };
  const projection = {
    projectionId: 'projection-1',
    agentId: 'local-agent:owner-1:agent-1',
    surfaceKind: CompanionParticipationSurfaceKind.DESKTOP_COMPANION_PANEL,
    profileRef: 'runtime.agent.profile/local-agent:owner-1:agent-1',
    triggerSource: CompanionParticipationTriggerSource.SCHEDULED_PROACTIVE,
    status: CompanionParticipationStatus.CANDIDATE_READY,
    candidateRef: 'candidate-1',
    commitRef: '',
    refusalReason: '',
    presentationRef: 'presentation-1',
    auditRef: 'runtime.audit.companion_participation/projection-1',
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    streamId: 'stream-1',
  };
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async requestCompanionParticipation(request, options) {
      calls.push({ method: 'request', request, options });
      return { projection };
    },
    async cancelCompanionParticipation(request, options) {
      calls.push({ method: 'cancel', request, options });
      return {
        projection: {
          ...projection,
          status: CompanionParticipationStatus.CANCELED,
          candidateRef: '',
          presentationRef: '',
        },
      };
    },
    async openCompanionParticipationReplay(request, options) {
      calls.push({ method: 'openReplay', request, options });
      return {
        replayRef: 'runtime.replay/projection-1',
        projection,
      };
    },
    async getAvatarDebugSnapshot(request, options) {
      calls.push({ method: 'debugSnapshot', request, options });
      return { snapshot: { ok: true } } as never;
    },
    async listAvatarDebugProbeResults(request, options) {
      calls.push({ method: 'listProbeResults', request, options });
      return { results: [] } as never;
    },
    async getAvatarDebugReplay(request, options) {
      calls.push({ method: 'getReplay', request, options });
      return { replay: { probeId: 'probe-1' } } as never;
    },
    async submitAvatarDebugProbeResult(request, options) {
      calls.push({ method: 'submitProbeResult', request, options });
      return { result: request.result } as never;
    },
  });
  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });

  assert.equal((await client.companionParticipation.request({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
    surfaceKind: 'desktop_companion_panel',
    triggerSource: 'scheduled_proactive',
    text: 'Join the conversation',
    threadId: 'thread-1',
    worldId: 'world-1',
    maxOutputTokens: 128,
  }, callOptions)).status, 'candidate_ready');
  assert.equal((await client.companionParticipation.cancel({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
    projectionId: 'projection-1',
    reason: 'owner dismissed',
  }, callOptions)).status, 'canceled');
  assert.equal((await client.companionParticipation.openReplay({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
    projectionId: 'projection-1',
  }, callOptions)).replayRef, 'runtime.replay/projection-1');
  await client.avatarDebug.snapshot({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
  }, callOptions);
  await client.avatarDebug.listProbeResults({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
  }, callOptions);
  await client.avatarDebug.getReplay({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
    probeId: 'probe-1',
  }, callOptions);
  await client.avatarDebug.submitProbeResult({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
    result: {
      probeId: 'probe-1',
      agentId: 'local-agent:owner-1:agent-1',
      conversationAnchorId: 'anchor-1',
      probeKind: AvatarDebugProbeKind.BACKEND_LOAD,
      status: AvatarDebugProbeStatus.PASSED,
      observedAt: { seconds: 1n, nanos: 0 },
      evidenceRefs: ['avatar.debug.session/session-1'],
      reasonCode: '',
      resultId: 'result-1',
    },
  }, callOptions);

  assert.deepEqual(calls.map((call) => call.method), [
    'request',
    'cancel',
    'openReplay',
    'debugSnapshot',
    'listProbeResults',
    'getReplay',
    'submitProbeResult',
  ]);
  assert.equal((calls[0]?.request as { maxOutputTokens?: number }).maxOutputTokens, 128);
  assert.equal((calls[1]?.request as { reason?: string }).reason, 'owner dismissed');
  assert.equal((calls[2]?.request as { projectionId?: string }).projectionId, 'projection-1');
  assert.equal((calls[4]?.request as { probeKind?: AvatarDebugProbeKind }).probeKind, AvatarDebugProbeKind.UNSPECIFIED);
  assert.equal((calls[5]?.request as { probeId?: string }).probeId, 'probe-1');
  assert.equal((calls[6]?.request as { result?: { resultId?: string } }).result?.resultId, 'result-1');

  await assert.rejects(
    () => client.companionParticipation.request({
      ...consumeContext,
      conversationAnchorId: 'anchor-1',
      surfaceKind: 'unsupported' as 'avatar_companion',
      text: 'hello',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_INPUT_INVALID');
      return true;
    },
  );
});
