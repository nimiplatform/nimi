import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..', '..');
let buildDir = null;

const EMOTION_CASES = [
  ['happy', 'joy'],
  ['sad', 'concerned'],
  ['shy', 'calm'],
  ['angry', 'concerned'],
  ['surprised', 'surprised'],
  ['confused', 'focus'],
  ['excited', 'playful'],
  ['worried', 'concerned'],
  ['embarrassed', 'calm'],
  ['neutral', 'neutral'],
  ['ext:apologetic', 'concerned'],
  ['ext:proud', 'joy'],
  ['ext:lonely', 'concerned'],
  ['ext:grateful', 'joy'],
];
const NON_NEUTRAL_EMOTION_CASES = EMOTION_CASES.filter(([id]) => id !== 'neutral');
const INTENSITIES = ['weak', 'moderate', 'strong'];
const INTERACTION_IDS = ['greet', 'farewell', 'agree', 'disagree', 'listening', 'thinking'];
const STATE_IDS = ['idle', 'celebrating', 'sleeping', 'focused'];

test.after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test('A-L1 projects the full Runtime Agent emotion activity matrix through the reducer', async () => {
  const module = await importConversationStateModule();
  for (const [emotionId, expectedCue] of NON_NEUTRAL_EMOTION_CASES) {
    for (const intensity of INTENSITIES) {
      const companion = projectActivity(module, blockedCompanion(), {
        activityName: emotionId,
        category: 'emotion',
        intensity,
        source: 'apml',
      });

      assert.equal(companion.executionState, 'activity_requested', `A-L1 ${emotionId}/${intensity} execution`);
      assert.equal(companion.statusText, emotionId, `A-L1 ${emotionId}/${intensity} status`);
      assert.equal(companion.currentEmotionId, emotionId, `A-L1 ${emotionId}/${intensity} id`);
      assert.equal(companion.currentEmotionCue, expectedCue, `A-L1 ${emotionId}/${intensity} cue`);
      assert.equal(companion.currentEmotionIntensity, intensity, `A-L1 ${emotionId}/${intensity} intensity`);
      assert.equal(companion.emotionViolation, null, `A-L1 ${emotionId}/${intensity} no violation`);
    }
  }

  const neutral = projectActivity(module, blockedCompanion(), {
    activityName: 'neutral',
    category: 'emotion',
    source: 'apml',
  });
  assert.equal(neutral.currentEmotionId, 'neutral', 'A-L1 neutral id');
  assert.equal(neutral.currentEmotionCue, 'neutral', 'A-L1 neutral cue');
  assert.equal(neutral.currentEmotionIntensity, null, 'A-L1 neutral default intensity');
  assert.equal(neutral.emotionViolation, null, 'A-L1 neutral no violation');
});

test('A-L1 preserves current emotion for interaction and state activities, including unreachable intensity noise', async () => {
  const module = await importConversationStateModule();
  const seeded = projectActivity(module, blockedCompanion(), {
    activityName: 'happy',
    category: 'emotion',
    source: 'apml',
  });

  for (const interaction of INTERACTION_IDS) {
    const companion = projectActivity(module, seeded, {
      activityName: interaction,
      category: 'interaction',
      source: 'apml',
    });
    assert.equal(companion.executionState, 'activity_requested', `A-L1 interaction ${interaction} execution`);
    assert.equal(companion.statusText, interaction, `A-L1 interaction ${interaction} status`);
    assert.equal(companion.currentEmotionId, 'happy', `A-L1 interaction ${interaction} preserves emotion`);
    assert.equal(companion.currentEmotionIntensity, null, `A-L1 interaction ${interaction} preserves default intensity`);
    assert.equal(companion.emotionViolation, null, `A-L1 interaction ${interaction} no app emotion violation`);
  }

  for (const state of STATE_IDS) {
    const companion = projectActivity(module, seeded, {
      activityName: state,
      category: 'state',
      source: 'apml',
    });
    assert.equal(companion.executionState, 'activity_requested', `A-L1 state ${state} execution`);
    assert.equal(companion.statusText, state, `A-L1 state ${state} status`);
    assert.equal(companion.currentEmotionId, 'happy', `A-L1 state ${state} preserves emotion`);
    assert.equal(companion.emotionViolation, null, `A-L1 state ${state} no app emotion violation`);
  }

  const interactionWithIntensity = projectActivity(module, seeded, {
    activityName: 'greet',
    category: 'interaction',
    intensity: 'strong',
    source: 'apml',
  });
  assert.equal(interactionWithIntensity.currentEmotionId, 'happy', 'A-L1 interaction x intensity preserves current emotion');
  assert.equal(interactionWithIntensity.emotionViolation, null, 'A-L1 interaction x intensity is runtime-layer rejected before Zhiyu emotion parsing');
});

test('A-L1 rejects defensive emotion violations without projecting inadmissible values', async () => {
  const module = await importConversationStateModule();

  const unknown = projectActivity(module, blockedCompanion(), {
    activityName: 'focused',
    category: 'emotion',
    source: 'apml',
  });
  assert.equal(unknown.currentEmotionId, null, 'A-L1 unknown emotion id is not projected');
  assert.equal(unknown.currentEmotionCue, null, 'A-L1 unknown emotion cue is not projected');
  assert.equal(unknown.currentEmotionIntensity, null, 'A-L1 unknown emotion intensity is not projected');
  assert.equal(unknown.emotionViolation?.rawValue, 'focused', 'A-L1 unknown emotion raw value captured diagnostically');
  assert.equal(unknown.emotionViolation?.reasonCode, 'runtime-agent-emotion-id-not-admitted', 'A-L1 unknown emotion reason');

  const neutralWithIntensity = projectActivity(module, blockedCompanion(), {
    activityName: 'neutral',
    category: 'emotion',
    intensity: 'weak',
    source: 'apml',
  });
  assert.equal(neutralWithIntensity.currentEmotionId, null, 'A-L1 neutral x intensity is not projected');
  assert.equal(neutralWithIntensity.currentEmotionCue, null, 'A-L1 neutral x intensity cue is not projected');
  assert.equal(neutralWithIntensity.emotionViolation?.rawValue, 'neutral', 'A-L1 neutral x intensity diagnostic raw value');
  assert.equal(
    neutralWithIntensity.emotionViolation?.reasonCode,
    'runtime-agent-neutral-emotion-intensity-not-admitted',
    'A-L1 neutral x intensity reason',
  );
});

function projectActivity(module, current, detail) {
  return module.projectZhiyuCompanionFromRuntimeAgentEvent({
    current,
    event: {
      eventName: 'runtime.agent.presentation.activity_requested',
      localAgentRef: 'local-agent:opaque',
      conversationAnchorId: 'conversation-anchor:opaque',
      detail,
    },
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    observedAt: '2026-07-08T04:00:00.000Z',
  });
}

async function importConversationStateModule() {
  const outputPath = path.join(await buildConversationStateModule(), 'agent-conversation-state.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildConversationStateModule() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-apml-projection-matrix-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/agent-chat/agent-conversation-state.ts')],
    outfile: path.join(buildDir, 'agent-conversation-state.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
    alias: {
      '@nimiplatform/kit/features/avatar/headless': path.join(repoRoot, 'kit/features/avatar/src/headless.ts'),
    },
  });
  return buildDir;
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
    currentEmotionId: null,
    currentEmotionCue: null,
    currentEmotionIntensity: null,
    emotionViolation: null,
    participationMode: 'not_projected',
    participationSource: null,
    projectedFields: [],
    unsupportedExplainabilityFields: [],
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
