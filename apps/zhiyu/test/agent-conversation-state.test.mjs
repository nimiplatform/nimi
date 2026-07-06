import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
let buildDir = null;

test.after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test('hydrates Zhiyu chat from Runtime session snapshot without masking committed text', async () => {
  const module = await importConversationStateModule();
  const chat = module.hydrateZhiyuAgentChatFromRuntimeSessionSnapshot({
    current: idleChat(),
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'local-agent:opaque',
    conversationAnchorId: 'conversation-anchor:opaque',
    snapshot: {
      requestId: 'runtime-request-2',
      threadId: 'conversation-anchor:opaque',
      sessionStatus: 'active',
      transcript: [
        transcriptMessage({ id: 'm1', role: 'user', content: '第一轮问题', createdAt: '2026-07-04T01:00:00.000Z' }),
        transcriptMessage({ id: 'm2', role: 'assistant', content: '第一轮回答', createdAt: '2026-07-04T01:00:01.000Z' }),
        transcriptMessage({ id: 'm3', role: 'user', content: '第二轮问题', createdAt: '2026-07-04T01:00:02.000Z' }),
        transcriptMessage({ id: 'm4', role: 'assistant', content: 'Hello from the Runtime Agent live fixture.', createdAt: '2026-07-04T01:00:03.000Z' }),
      ],
    },
  });

  assert.equal(chat.ready, true);
  assert.equal(chat.state, 'completed');
  assert.equal(chat.reasonCode, 'runtime-agent-session-snapshot-hydrated');
  assert.equal(chat.requestId, 'runtime-request-2');
  assert.equal(chat.messageCount, 4);
  assert.equal(chat.latestAssistantText, 'Hello from the Runtime Agent live fixture.');
  assert.deepEqual(chat.messages.map((message) => [message.id, message.role, message.text, message.status]), [
    ['m1', 'user', '第一轮问题', 'complete'],
    ['m2', 'agent', '第一轮回答', 'complete'],
    ['m3', 'user', '第二轮问题', 'complete'],
    ['m4', 'agent', 'Hello from the Runtime Agent live fixture.', 'complete'],
  ]);
});

test('keeps current chat when Runtime snapshot has no transcript replay envelope', async () => {
  const module = await importConversationStateModule();
  const current = {
    ...idleChat(),
    latestAssistantText: 'keep current text',
    messageCount: 1,
  };
  const chat = module.hydrateZhiyuAgentChatFromRuntimeSessionSnapshot({
    current,
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'local-agent:opaque',
    conversationAnchorId: 'conversation-anchor:opaque',
    snapshot: {
      transcript: [
        { role: 'assistant', content: 'missing envelope fields' },
      ],
    },
  });

  assert.equal(chat, current);
});

test('reactively projects Runtime Agent state events into companion evidence', async () => {
  const module = await importConversationStateModule();
  const companion = module.projectZhiyuCompanionFromRuntimeAgentEvent({
    current: blockedCompanion(),
    event: {
      eventName: 'runtime.agent.state.emotion_changed',
      localAgentRef: 'local-agent:opaque',
      conversationAnchorId: 'conversation-anchor:opaque',
      detail: {
        currentStatusText: '正在整理上下文',
        currentExecutionState: 'chat_active',
        currentEmotion: 'focused',
        currentPosture: {
          actionFamily: 'chat',
          interruptMode: 'interruptible',
        },
      },
    },
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    observedAt: '2026-07-04T02:00:00.000Z',
  });

  assert.equal(companion.ready, true);
  assert.equal(companion.state, 'projected');
  assert.equal(companion.reasonCode, 'runtime-agent-state-event-projected');
  assert.equal(companion.statusText, '正在整理上下文');
  assert.equal(companion.executionState, 'chat_active');
  assert.equal(companion.currentEmotion, 'focused');
  assert.equal(companion.observedAt, '2026-07-04T02:00:00.000Z');
  assert.equal(companion.stateUpdatedAt, '2026-07-04T02:00:00.000Z');
  assert.equal(companion.participationMode, 'idle');
  assert.equal(companion.participationSource, 'runtime-agent-event');
  assert.ok(companion.projectedFields.includes('runtimeAgentEventSubscription'));
  assert.ok(companion.projectedFields.includes('currentPosture'));
});

test('reactively projects Runtime Agent action, activity, voice, lipsync, and hook events into companion evidence', async () => {
  const module = await importConversationStateModule();
  let companion = blockedCompanion();
  const base = {
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    observedAt: '2026-07-04T02:01:00.000Z',
  };
  const event = (eventName, detail) => ({
    eventName,
    localAgentRef: 'local-agent:opaque',
    conversationAnchorId: 'conversation-anchor:opaque',
    detail,
  });

  companion = module.projectZhiyuCompanionFromRuntimeAgentEvent({
    ...base,
    current: companion,
    event: event('runtime.agent.turn.action_started', {
      actionId: 'action-image-1',
      modality: 'image',
      operation: 'image.generate',
    }),
  });
  assert.equal(companion.executionState, 'image_action_started');
  assert.equal(companion.statusText, 'image.generate');
  assert.ok(companion.projectedFields.includes('turnActionEvent'));
  assert.ok(companion.projectedFields.includes('actionOperation'));

  companion = module.projectZhiyuCompanionFromRuntimeAgentEvent({
    ...base,
    current: companion,
    event: event('runtime.agent.presentation.activity_requested', {
      activityName: 'happy',
      category: 'emotion',
      intensity: 'medium',
      source: 'apml',
    }),
  });
  assert.equal(companion.executionState, 'activity_requested');
  assert.equal(companion.statusText, 'happy');
  assert.equal(companion.currentEmotion, 'happy');
  assert.ok(companion.projectedFields.includes('presentationActivity'));

  companion = module.projectZhiyuCompanionFromRuntimeAgentEvent({
    ...base,
    current: companion,
    event: event('runtime.agent.presentation.voice_playback_requested', {
      audioArtifactId: 'artifact-audio-1',
      audioMimeType: 'audio/wav',
      playbackState: 'requested',
      playbackTarget: 'avatar_autoplay',
    }),
  });
  assert.equal(companion.executionState, 'voice_requested');
  assert.equal(companion.statusText, 'avatar_autoplay');
  assert.ok(companion.projectedFields.includes('voicePlayback'));
  assert.ok(companion.projectedFields.includes('audioArtifactId'));

  companion = module.projectZhiyuCompanionFromRuntimeAgentEvent({
    ...base,
    current: companion,
    event: event('runtime.agent.presentation.lipsync_frame_batch', {
      audioArtifactId: 'artifact-audio-1',
      frames: [{ frameSequence: 1, mouthOpenY: 0.5 }],
    }),
  });
  assert.equal(companion.executionState, 'lipsync_frame_batch');
  assert.ok(companion.projectedFields.includes('lipsyncFrameBatch'));

  companion = module.projectZhiyuCompanionFromRuntimeAgentEvent({
    ...base,
    current: companion,
    event: event('runtime.agent.hook.intent_proposed', {
      intentId: 'hook-1',
      triggerFamily: 'time',
      effect: 'follow_up',
      admissionState: 'proposed',
    }),
  });
  assert.equal(companion.executionState, 'hook_intent_proposed');
  assert.equal(companion.statusText, 'follow_up');
  assert.ok(companion.projectedFields.includes('hookIntent'));
});

async function importConversationStateModule() {
  const outputPath = path.join(await buildConversationStateModule(), 'agent-conversation-state.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildConversationStateModule() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-agent-conversation-state-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/agent-chat/agent-conversation-state.ts')],
    outfile: path.join(buildDir, 'agent-conversation-state.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
  });
  return buildDir;
}

function transcriptMessage(overrides = {}) {
  return {
    id: 'message-id',
    role: 'assistant',
    content: 'message text',
    status: 'complete',
    kind: 'text',
    createdAt: '2026-07-04T00:00:00.000Z',
    updatedAt: overrides.createdAt ?? '2026-07-04T00:00:00.000Z',
    ...overrides,
  };
}

function idleChat() {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'idle',
    reasonCode: 'runtime-agent-chat-idle',
    actionHint: 'send_runtime_agent_turn',
    source: 'renderer',
    message: 'Runtime Agent chat has not started.',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    conversationAnchorId: null,
    requestId: null,
    eventTypes: [],
    messageCount: 0,
    messages: [],
    latestAssistantText: null,
    reasoningText: null,
    outputText: null,
    diagnostics: null,
  };
}

function blockedCompanion() {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'blocked',
    reasonCode: 'not-probed',
    actionHint: 'probe_runtime_agent_state_projection',
    source: 'renderer',
    message: 'Runtime Agent companion state has not been probed.',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    observedAt: null,
    stateUpdatedAt: null,
    executionState: null,
    statusText: null,
    activeWorldId: null,
    activeUserId: null,
    currentEmotion: null,
    participationMode: 'not_projected',
    participationSource: null,
    projectedFields: [],
    unsupportedExplainabilityFields: [
      'posture',
      'postureSource',
      'stateConfidence',
      'whyThisState',
      'relationshipContext',
      'diaryReflection',
      'stateChangeHistory',
    ],
    proactiveInterruptibility: {
      transport: 'electron-ipc',
      ready: false,
      deliveryReady: false,
      state: 'blocked',
      reasonCode: 'not-probed',
      actionHint: 'probe_runtime_agent_proactive_interruptibility',
      source: 'renderer',
      message: 'Runtime Agent proactive interruptibility has not been probed.',
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
      observedAt: null,
      projectionId: null,
      projectionKind: null,
      mode: null,
      optInState: null,
      deliveryChannel: null,
      quietHoursState: null,
      frequencyCapState: null,
      suggestedReasonCode: null,
      lastDeliveredReasonCode: null,
      lastSuppressedReasonCode: null,
      lastSuppressionReason: null,
      sourceHookId: null,
      sourceCadenceId: null,
      auditRefs: [],
      unsupportedFields: ['proactive_interruptibility'],
    },
  };
}
