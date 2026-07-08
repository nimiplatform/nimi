import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureScenarioEvidence,
  runtimeAgentLiveE2EChatScenarioPrompt,
  sendScenarioPrompt,
  waitForEvidence,
  withZhiyuScenarioApp,
} from './run-context-helpers.mjs';
import { runRepeatedScenario, scenarioTestTimeoutMs } from './repeat-runner-helpers.mjs';

const emotionRows = [
  ['happy', 'a-core-emotion-happy', 'joy', '开心'],
  ['sad', 'a-core-emotion-sad', 'concerned', '低落'],
  ['shy', 'a-core-emotion-shy', 'calm', '害羞'],
  ['angry', 'a-core-emotion-angry', 'concerned', '生气'],
  ['surprised', 'a-core-emotion-surprised', 'surprised', '惊讶'],
  ['confused', 'a-core-emotion-confused', 'focus', '困惑'],
  ['excited', 'a-core-emotion-excited', 'playful', '兴奋'],
  ['worried', 'a-core-emotion-worried', 'concerned', '担心'],
  ['embarrassed', 'a-core-emotion-embarrassed', 'calm', '窘迫'],
  ['neutral', 'a-core-emotion-neutral', 'neutral', '平静'],
  ['ext:apologetic', 'a-extended-emotion-apologetic', 'concerned', '歉意'],
  ['ext:proud', 'a-extended-emotion-proud', 'joy', '自豪'],
  ['ext:lonely', 'a-extended-emotion-lonely', 'concerned', '孤单'],
  ['ext:grateful', 'a-extended-emotion-grateful', 'joy', '感激'],
];

test('D-01 full emotion ontology projects cue and Chinese companion copy', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'D',
    id: 'D-01',
    runOnce: async ({ scenarioId, iteration }) => {
      const results = [];
      for (const [emotionId, scenarioKey, expectedCue, expectedLabel] of emotionRows) {
        const valueScenarioId = matrixScenarioId(scenarioId, emotionId);
        const result = await withZhiyuScenarioApp({ scenarioId: valueScenarioId }, async (context) => {
          const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt(scenarioKey)} D-01 ${emotionId}.`;
          const evidence = await sendScenarioPrompt(context, prompt, `D-01 ${emotionId} emotion projection`);
          assert.equal(evidence.companion.currentEmotionId, emotionId);
          assert.equal(evidence.companion.currentEmotionCue, expectedCue);
          assert.equal(evidence.companion.emotionViolation, null);
          const companion = companionEmotionChip(context);
          assert.equal(await companion.getAttribute('data-zhiyu-companion-current-emotion-id'), emotionId);
          assert.equal(await companion.getAttribute('data-zhiyu-companion-current-emotion-cue'), expectedCue);
          assert.equal(await companion.getAttribute('data-zhiyu-companion-current-emotion-label'), expectedLabel);
          assert.match(await companion.innerText(), new RegExp(expectedLabel, 'u'));
          assert.doesNotMatch(await companion.innerText(), new RegExp(escapeRegExp(emotionId), 'u'));
          const capture = await captureScenarioEvidence(context, { scenarioId: valueScenarioId, iteration, extra: { emotionId, expectedCue, expectedLabel, evidence } });
          return { emotionId, expectedCue, expectedLabel, ...capture };
        });
        results.push(result);
      }
      return { results };
    },
  });
});

test('D-02 E2E default intensity renders without strength modifier', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'D',
    id: 'D-02',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('a-core-emotion-happy')} D-02 default intensity.`;
      const evidence = await sendScenarioPrompt(context, prompt, 'D-02 default no-intensity emotion');
      assert.equal(evidence.companion.currentEmotionId, 'happy');
      assert.equal(evidence.companion.currentEmotionIntensity ?? null, null);
      const companion = companionEmotionChip(context);
      assert.equal(await companion.getAttribute('data-zhiyu-companion-current-emotion-intensity'), 'not_projected');
      const text = await companion.innerText();
      assert.match(text, /开心/u);
      assert.doesNotMatch(text, /轻微|明显|强烈/u);
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence, text } });
    }),
  });
});

test('D-03 emotion persists across a later turn without emotion activity', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'D',
    id: 'D-03',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const firstPrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('a-core-emotion-happy')} D-03 seed happy.`;
      const first = await sendScenarioPrompt(context, firstPrompt, 'D-03 seed emotion');
      assert.equal(first.companion.currentEmotionId, 'happy');
      const secondPrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('d-no-emotion-followup')} D-03 no emotion follow-up.`;
      const second = await sendScenarioPrompt(context, secondPrompt, 'D-03 no emotion follow-up');
      assert.equal(second.companion.currentEmotionId, 'happy');
      assert.equal(await context.page.locator('[data-zhiyu-companion-current-emotion-id]').first().getAttribute('data-zhiyu-companion-current-emotion-id'), 'happy');
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { first, second } });
    }),
  });
});

test('D-04 interaction and state activities do not overwrite current emotion', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'D',
    id: 'D-04',
    runOnce: async ({ scenarioId, iteration }) => {
      const interactionScenarioId = matrixScenarioId(scenarioId, 'interaction');
      const interactionResult = await withZhiyuScenarioApp({ scenarioId: interactionScenarioId }, async (context) => {
        const firstPrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('a-core-emotion-happy')} D-04 seed happy.`;
        await sendScenarioPrompt(context, firstPrompt, 'D-04 interaction seed emotion');
        const interactionPrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('a-interaction-listening')} D-04 interaction.`;
        const interaction = await sendScenarioPrompt(context, interactionPrompt, 'D-04 interaction activity');
        assert.equal(interaction.companion.currentEmotionId, 'happy');
        assertActivityProjection(interaction, { activityName: 'listening', category: 'interaction' });
        assert.equal(await companionEmotionChip(context).getAttribute('data-zhiyu-companion-current-emotion-id'), 'happy');
        return captureScenarioEvidence(context, { scenarioId: interactionScenarioId, iteration, extra: { interaction } });
      });
      const stateScenarioId = matrixScenarioId(scenarioId, 'state');
      const stateResult = await withZhiyuScenarioApp({ scenarioId: stateScenarioId }, async (context) => {
        const firstPrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('a-core-emotion-happy')} D-04 seed happy.`;
        await sendScenarioPrompt(context, firstPrompt, 'D-04 state seed emotion');
        const statePrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('a-state-focused')} D-04 state.`;
        const state = await sendScenarioPrompt(context, statePrompt, 'D-04 state activity');
        assert.equal(state.companion.currentEmotionId, 'happy');
        assertActivityProjection(state, { activityName: 'focused', category: 'state' });
        assert.equal(await companionEmotionChip(context).getAttribute('data-zhiyu-companion-current-emotion-id'), 'happy');
        return captureScenarioEvidence(context, { scenarioId: stateScenarioId, iteration, extra: { state } });
      });
      return { interactionResult, stateResult };
    },
  });
});

test('D-06 hook and lipsync projections are carried into companion execution state', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'D',
    id: 'D-06',
    runOnce: async ({ scenarioId, iteration }) => {
      const hookScenarioId = matrixScenarioId(scenarioId, 'hook');
      const hookResult = await withZhiyuScenarioApp({ scenarioId: hookScenarioId }, async (context) => {
        const hookPrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('a-time-hook')} D-06 hook.`;
        const hookEvidence = await sendHookScenarioPrompt(context, hookPrompt, 'D-06 hook projection');
        assertHookProjection(hookEvidence, 'time');
        assert.equal(hookEvidence.companion.projectedFields.includes('hookIntent'), true);
        return captureScenarioEvidence(context, { scenarioId: hookScenarioId, iteration, extra: { hookEvidence } });
      });
      const lipsyncScenarioId = matrixScenarioId(scenarioId, 'lipsync');
      const lipsyncResult = await withZhiyuScenarioApp({
        scenarioId: lipsyncScenarioId,
        seedAvatarPresentation: true,
        voiceSpeechStreamDelayMs: 250,
      }, async (context) => {
        const lipsyncPrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('d-lipsync')} D-06 lipsync.`;
        await submitPrompt(context.page, lipsyncPrompt);
        await waitForEvidence(context.page, () => {
          const evidence = globalThis.window.__nimiZhiyuEvidence;
          const events = [
            ...(evidence?.chat?.diagnostics?.runtimeProjectionEvents ?? []),
            ...(evidence?.companion?.diagnostics?.runtimeProjectionEvents ?? []),
          ];
          return events.some((event) =>
            event?.eventName === 'runtime.agent.presentation.lipsync_frame_batch'
            && event?.projectedExecutionState === 'lipsync_frame_batch'
            && /^lipsync_frames:\d+$/u.test(event?.projectedStatusText || '')
            && event?.projectedFields?.includes('lipsyncFrameBatch')
            && Array.isArray(event?.detail?.frames)
            && event.detail.frames.length > 0
          );
        }, 'D-06 lipsync frame batch companion projection');
        const lipsyncEvidence = await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
        const lipsyncEvent = lipsyncFrameBatchProjection(lipsyncEvidence);
        assert.ok(lipsyncEvent);
        assert.equal(lipsyncEvent.projectedExecutionState, 'lipsync_frame_batch');
        assert.match(lipsyncEvent.projectedStatusText, /^lipsync_frames:\d+$/u);
        assert.equal(lipsyncEvent.projectedFields.includes('lipsyncFrameBatch'), true);
        assert.ok(lipsyncEvent.detail.frames.length > 0);
        assert.equal(lipsyncEvidence.companion.projectedFields.includes('lipsyncFrameBatch'), true);
        await waitForEvidence(context.page, () =>
          globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'completed',
          'D-06 lipsync turn completed after projection',
        );
        return captureScenarioEvidence(context, { scenarioId: lipsyncScenarioId, iteration, extra: { lipsyncEvidence } });
      });
      return { hookResult, lipsyncResult };
    },
  });
});

async function submitPrompt(page, prompt) {
  await page.locator('[data-chat-composer-textarea="true"]').fill(prompt);
  await page.waitForFunction(() =>
    document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
    && document.querySelector('[data-chat-composer-send="true"]')?.disabled === false
    && document.querySelector('[data-chat-composer-textarea="true"]')?.value.length > 0,
  );
  await page.locator('[data-chat-composer-send="true"]').click();
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

function lipsyncFrameBatchProjection(evidence) {
  return runtimeProjectionEvents(evidence).find((event) =>
    event?.eventName === 'runtime.agent.presentation.lipsync_frame_batch'
    && event?.projectedExecutionState === 'lipsync_frame_batch'
    && Array.isArray(event?.detail?.frames)
    && event.detail.frames.length > 0
  );
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function companionEmotionChip(context) {
  return context.page
    .locator('.zhiyu-chat-canvas__labeled-chip[data-zhiyu-region="companion"][data-zhiyu-companion-current-emotion-id]')
    .first();
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
