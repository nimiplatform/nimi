import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCompletedTurnEvidence,
  captureScenarioEvidence,
  runtimeAgentLiveE2EChatScenarioPrompt,
  sendScenarioPrompt,
  waitForEvidence,
  withZhiyuScenarioApp,
} from './run-context-helpers.mjs';
import { runRepeatedScenario, scenarioTestTimeoutMs } from './repeat-runner-helpers.mjs';

const coreEmotions = ['happy', 'sad', 'shy', 'angry', 'surprised', 'confused', 'excited', 'worried', 'embarrassed', 'neutral'];
const extendedEmotions = [
  ['ext:apologetic', 'a-extended-emotion-apologetic'],
  ['ext:proud', 'a-extended-emotion-proud'],
  ['ext:lonely', 'a-extended-emotion-lonely'],
  ['ext:grateful', 'a-extended-emotion-grateful'],
];
const interactions = ['greet', 'farewell', 'agree', 'disagree', 'listening', 'thinking'];
const states = ['idle', 'celebrating', 'sleeping', 'focused'];

test('A-01 core emotion activity tags project companion emotion truth', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'A',
    id: 'A-01',
    runOnce: async ({ scenarioId, iteration }) => {
      const results = [];
      for (const emotionId of coreEmotions) {
        const valueScenarioId = matrixScenarioId(scenarioId, emotionId);
        const result = await withZhiyuScenarioApp({ scenarioId: valueScenarioId }, async (context) => {
          const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt(`a-core-emotion-${emotionId}`)} A-01 ${emotionId}.`;
          const evidence = await sendScenarioPrompt(context, prompt, `A-01 ${emotionId} Runtime emotion`);
          await assertEmotionProjection(context, evidence, emotionId, 'activity_requested');
          const capture = await captureScenarioEvidence(context, { scenarioId: valueScenarioId, iteration, extra: { emotionId, evidence } });
          return { emotionId, cue: evidence.companion.currentEmotionCue, ...capture };
        });
        results.push(result);
      }
      return { results };
    },
  });
});

test('A-02 extended emotion activity tags project companion emotion truth', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'A',
    id: 'A-02',
    runOnce: async ({ scenarioId, iteration }) => {
      const results = [];
      for (const [emotionId, scenarioKey] of extendedEmotions) {
        const valueScenarioId = matrixScenarioId(scenarioId, emotionId);
        const result = await withZhiyuScenarioApp({ scenarioId: valueScenarioId }, async (context) => {
          const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt(scenarioKey)} A-02 ${emotionId}.`;
          const evidence = await sendScenarioPrompt(context, prompt, `A-02 ${emotionId} Runtime emotion`);
          await assertEmotionProjection(context, evidence, emotionId, 'activity_requested');
          const capture = await captureScenarioEvidence(context, { scenarioId: valueScenarioId, iteration, extra: { emotionId, evidence } });
          return { emotionId, cue: evidence.companion.currentEmotionCue, ...capture };
        });
        results.push(result);
      }
      return { results };
    },
  });
});

test('A-03 interaction activity tags do not overwrite current emotion', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'A',
    id: 'A-03',
    runOnce: async ({ scenarioId, iteration }) => {
      const results = [];
      for (const interaction of interactions) {
        const valueScenarioId = matrixScenarioId(scenarioId, interaction);
        const result = await withZhiyuScenarioApp({ scenarioId: valueScenarioId }, async (context) => {
          const seedPrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('a-core-emotion-happy')} A-03 seed happy.`;
          await sendScenarioPrompt(context, seedPrompt, 'A-03 seed Runtime emotion');
          const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt(`a-interaction-${interaction}`)} A-03 ${interaction}.`;
          const evidence = await sendScenarioPrompt(context, prompt, `A-03 ${interaction} interaction`);
          assert.equal(evidence.companion.currentEmotionId, 'happy');
          assertActivityProjection(evidence, { activityName: interaction, category: 'interaction', executionState: 'activity_requested' });
          assert.equal(await companionAttr(context, 'data-zhiyu-companion-current-emotion-id'), 'happy');
          const capture = await captureScenarioEvidence(context, { scenarioId: valueScenarioId, iteration, extra: { interaction, evidence } });
          return { interaction, currentEmotionId: evidence.companion.currentEmotionId, ...capture };
        });
        results.push(result);
      }
      return { results };
    },
  });
});

test('A-04 state activity tags project execution state without overwriting emotion', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'A',
    id: 'A-04',
    runOnce: async ({ scenarioId, iteration }) => {
      const results = [];
      for (const state of states) {
        const valueScenarioId = matrixScenarioId(scenarioId, state);
        const result = await withZhiyuScenarioApp({ scenarioId: valueScenarioId }, async (context) => {
          const seedPrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('a-core-emotion-happy')} A-04 seed happy.`;
          await sendScenarioPrompt(context, seedPrompt, 'A-04 seed Runtime emotion');
          const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt(`a-state-${state}`)} A-04 ${state}.`;
          const evidence = await sendScenarioPrompt(context, prompt, `A-04 ${state} state`);
          assert.equal(evidence.companion.currentEmotionId, 'happy');
          assertActivityProjection(evidence, { activityName: state, category: 'state', executionState: 'activity_requested' });
          assert.equal(await companionAttr(context, 'data-zhiyu-companion-current-emotion-id'), 'happy');
          const capture = await captureScenarioEvidence(context, { scenarioId: valueScenarioId, iteration, extra: { state, evidence } });
          return { state, currentEmotionId: evidence.companion.currentEmotionId, ...capture };
        });
        results.push(result);
      }
      return { results };
    },
  });
});

test('A-05 image action APML renders Runtime artifact preview', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'A',
    id: 'A-05',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('a-image-action')} A-05 image action.`;
      const evidence = await sendScenarioPrompt(context, prompt, 'A-05 completed image action Runtime chat');
      assert.equal(evidence.chat.eventTypes.includes('artifact-ready'), true);
      const summary = context.page.locator('[data-zhiyu-runtime-action-artifact-summary="true"]').last();
      await summary.waitFor({ timeout: 15_000 });
      assert.equal(await summary.getAttribute('data-zhiyu-runtime-action-artifact-preview'), 'rendered');
      await context.page.locator('[data-zhiyu-region="conversation"] img[src^="data:image/"]').last().waitFor({ timeout: 15_000 });
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence } });
    }),
  });
});

test('A-06 voice action APML reaches Runtime voice truth', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'A',
    id: 'A-06',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({
      scenarioId,
      seedAvatarPresentation: true,
      voiceSpeechStreamDelayMs: 250,
    }, async (context) => {
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('a-voice-action')} A-06 voice action.`;
      await submitPrompt(context.page, prompt);
      await waitForEvidence(context.page, () => {
        const evidence = globalThis.window.__nimiZhiyuEvidence;
        const events = evidence?.chat?.diagnostics?.runtimeProjectionEvents ?? [];
        return evidence?.chat?.state === 'completed'
          && evidence?.companion?.voiceOutputMode === 'native_stream'
          && evidence?.companion?.voicePlaybackState === 'completed'
          && events.some((event) => event?.eventName === 'runtime.agent.presentation.voice_playback_terminal'
            && event?.detail?.voiceOutputMode === 'native_stream'
            && event?.detail?.voicePlaybackState === 'completed');
      }, 'A-06 Runtime voice action truth');
      const evidence = await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(await context.page.locator('[data-zhiyu-composer-tool="hands-free"]').getAttribute('data-zhiyu-chat-voice-output-mode'), 'native_stream');
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence } });
    }),
  });
});

test('A-07 time-hook and event-hook APML project hook lifecycle without console errors', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'A',
    id: 'A-07',
    runOnce: async ({ scenarioId, iteration }) => {
      const timeScenarioId = matrixScenarioId(scenarioId, 'time');
      const timeResult = await withZhiyuScenarioApp({ scenarioId: timeScenarioId }, async (context) => {
        const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('a-time-hook')} A-07 time hook.`;
        const evidence = await sendHookScenarioPrompt(context, prompt, 'A-07 time hook projection');
        assertHookProjection(evidence, 'time');
        return captureScenarioEvidence(context, { scenarioId: timeScenarioId, iteration, extra: { evidence } });
      });
      const eventScenarioId = matrixScenarioId(scenarioId, 'event');
      const eventResult = await withZhiyuScenarioApp({ scenarioId: eventScenarioId }, async (context) => {
        const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('a-event-hook')} A-07 event hook.`;
        const evidence = await sendHookScenarioPrompt(context, prompt, 'A-07 event hook projection');
        assertHookProjection(evidence, 'event');
        return captureScenarioEvidence(context, { scenarioId: eventScenarioId, iteration, extra: { evidence } });
      });
      return { timeResult, eventResult };
    },
  });
});

test('A-08 APML tags split across chunks still assemble into emotion projection', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'A',
    id: 'A-08',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({
      scenarioId,
      localChatCompletionStreamDelayMs: 250,
    }, async (context) => {
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('a-chunk-split-emotion')} A-08 split APML.`;
      const evidence = await sendScenarioPrompt(context, prompt, 'A-08 chunk split APML emotion');
      await assertEmotionProjection(context, evidence, 'happy', 'activity_requested');
      assert.equal(evidence.chat.eventTypes.includes('text-delta'), true);
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence } });
    }),
  });
});

test('A-09 malformed APML fails after one provider call without repair or commit', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'A',
    id: 'A-09',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('a-malformed-apml')} A-09 malformed APML.`;
      const providerCallsBefore = context.fixture.realmRequests.filter((request) =>
        request.method === 'POST' && request.path === '/v1/chat/completions'
      ).length;
      const failed = await sendFailingScenarioPrompt(context, prompt, 'A-09 malformed APML fail-closed');
      assert.equal(failed.chat.state, 'failed');
      assert.equal(failed.chat.reasonCode, 'AI_OUTPUT_INVALID');
      assert.equal(failed.chat.eventTypes.includes('turn-failed'), true);
      assert.equal(failed.chat.eventTypes.includes('message-sealed'), false);
      assert.equal(failed.chat.eventTypes.includes('text-delta'), false);
      assert.equal(failed.chat.eventTypes.some((eventType) => eventType.startsWith('beat-') || eventType === 'artifact-ready'), false);
      assert.equal(failed.chat.eventTypes.includes('turn-completed'), false);
      const providerCallsAfter = context.fixture.realmRequests.filter((request) =>
        request.method === 'POST' && request.path === '/v1/chat/completions'
      ).length;
      const malformedProviderCallCount = providerCallsAfter - providerCallsBefore;
      assert.equal(malformedProviderCallCount, 1, 'malformed APML must not trigger semantic repair');
      const failureNotice = context.page.locator('[data-zhiyu-agent-chat-failure="true"]').last();
      await failureNotice.waitFor({ state: 'visible', timeout: 15_000 });
      const retryPrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('b-single-turn')} A-09 recovery turn.`;
      const recovered = await sendScenarioPrompt(context, retryPrompt, 'A-09 recovery Runtime turn');
      await assertCompletedTurnEvidence(recovered, {
        conversationAnchorId: context.readyEvidence.conversation.conversationAnchorId,
        prompt: retryPrompt,
      });
      return captureScenarioEvidence(context, {
        scenarioId,
        iteration,
        extra: { failed, recovered, malformedProviderCallCount },
      });
    }),
  });
});

test('A-10 APML negative values fail closed before projection', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'A',
    id: 'A-10',
    runOnce: async ({ scenarioId, iteration }) => {
      const negatives = [
        'a-negative-unknown-activity',
        'a-negative-apml-intensity',
        'a-negative-neutral-intensity',
      ];
      const results = [];
      for (const key of negatives) {
        const valueScenarioId = matrixScenarioId(scenarioId, key);
        const result = await withZhiyuScenarioApp({ scenarioId: valueScenarioId }, async (context) => {
          const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt(key)} A-10 ${key}.`;
          const evidence = await sendFailingScenarioPrompt(context, prompt, `A-10 ${key} fail-closed`);
          assert.equal(evidence.chat.state, 'failed');
          assert.equal(evidence.chat.eventTypes.includes('turn-failed'), true);
          assert.equal(evidence.chat.eventTypes.includes('message-sealed'), false);
          assert.equal(evidence.chat.eventTypes.includes('turn-completed'), false);
          const capture = await captureScenarioEvidence(context, { scenarioId: valueScenarioId, iteration, extra: { key, evidence } });
          return { key, reasonCode: evidence.chat.reasonCode, message: evidence.chat.message, ...capture };
        });
        results.push(result);
      }
      return { results };
    },
  });
});

async function assertEmotionProjection(context, evidence, emotionId, executionState) {
  assert.equal(evidence.companion.currentEmotionId, emotionId);
  assert.ok(evidence.companion.currentEmotionCue);
  assert.equal(evidence.companion.currentEmotionIntensity ?? null, null);
  assertActivityProjection(evidence, { activityName: emotionId, category: 'emotion', executionState });
  assert.equal(evidence.companion.emotionViolation, null);
  assert.equal(await companionAttr(context, 'data-zhiyu-companion-current-emotion-id'), emotionId);
  assert.equal(await companionAttr(context, 'data-zhiyu-companion-current-emotion-cue'), evidence.companion.currentEmotionCue);
  assert.equal(await companionAttr(context, 'data-zhiyu-companion-current-emotion-intensity'), 'not_projected');
  assert.equal(await companionAttr(context, 'data-zhiyu-companion-emotion-violation'), 'false');
}

function assertActivityProjection(evidence, input) {
  const events = runtimeProjectionEvents(evidence);
  assert.equal(events.some((event) =>
    event?.eventName === 'runtime.agent.presentation.activity_requested'
    && detailText(event.detail, 'activityName', 'activity_name') === input.activityName
    && detailText(event.detail, 'category') === input.category
  ), true);
}

function assertHookProjection(evidence, triggerFamily) {
  const events = runtimeProjectionEvents(evidence);
  assert.equal(events.some((event) =>
    String(event?.eventName || '').startsWith('runtime.agent.hook.')
    && hookTriggerFamily(event) === triggerFamily
  ), true);
  assert.equal(evidence.companion.projectedFields.includes('hookIntent'), true);
}

function hookTriggerFamily(event) {
  const detail = event?.detail;
  const direct = detailText(detail, 'triggerFamily', 'trigger_family');
  if (direct) {
    return normalizeHookTriggerFamily(direct);
  }
  const intent = detail && typeof detail === 'object'
    ? (detail.intent ?? detail.hookIntent)
    : null;
  if (!intent || typeof intent !== 'object') {
    return null;
  }
  return normalizeHookTriggerFamily(intent.triggerFamily ?? intent.trigger_family);
}

function normalizeHookTriggerFamily(value) {
  if (value === 1 || value === '1') return 'time';
  if (value === 2 || value === '2') return 'event';
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'time' || normalized === 'hook_trigger_family_time') return 'time';
  if (normalized === 'event' || normalized === 'hook_trigger_family_event') return 'event';
  return null;
}

function runtimeProjectionEvents(evidence) {
  return [
    ...(evidence.chat?.diagnostics?.runtimeProjectionEvents ?? []),
    ...(evidence.companion?.diagnostics?.runtimeProjectionEvents ?? []),
  ];
}

function detailText(detail, ...names) {
  if (!detail || typeof detail !== 'object') {
    return null;
  }
  for (const name of names) {
    const value = detail[name];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function matrixScenarioId(scenarioId, value) {
  return `${scenarioId}-${String(value).replace(/[^a-zA-Z0-9._-]/gu, '-')}`;
}

async function submitPrompt(page, prompt) {
  await page.locator('[data-chat-composer-textarea="true"]').fill(prompt);
  await page.waitForFunction(() =>
    document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
    && document.querySelector('[data-chat-composer-send="true"]')?.disabled === false
    && document.querySelector('[data-chat-composer-textarea="true"]')?.value.length > 0,
  );
  await page.locator('[data-chat-composer-send="true"]').click();
}

async function companionAttr(context, name) {
  return context.page.locator('[data-zhiyu-companion-current-emotion-id]').first().getAttribute(name);
}

async function sendFailingScenarioPrompt(context, prompt, label) {
  await submitPrompt(context.page, prompt);
  await waitForEvidence(context.page, ({ prompt: submittedPrompt }) =>
    globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'failed'
    && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) => message?.text === submittedPrompt)
    && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('turn-failed'),
    label,
    { prompt },
  );
  return context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
}

async function sendHookScenarioPrompt(context, prompt, label) {
  await submitPrompt(context.page, prompt);
  await waitForEvidence(context.page, () => {
    const evidence = globalThis.window.__nimiZhiyuEvidence;
    const events = [
      ...(evidence?.chat?.diagnostics?.runtimeProjectionEvents ?? []),
      ...(evidence?.companion?.diagnostics?.runtimeProjectionEvents ?? []),
    ];
    return evidence?.companion?.projectedFields?.includes('hookIntent')
      && events.some((event) => String(event?.eventName || '').startsWith('runtime.agent.hook.'));
  }, label);
  return context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
}
