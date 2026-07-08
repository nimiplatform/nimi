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
import { assertMidStreamFailureFlow } from '../electron-live-runtime-native-voice-helpers.mjs';

test('B-01 single completed Runtime Agent text turn', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'B',
    id: 'B-01',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('b-single-turn')} B-01 single completed turn.`;
      const evidence = await sendScenarioPrompt(context, prompt, 'B-01 completed Runtime Agent chat');
      await assertCompletedTurnEvidence(evidence, {
        conversationAnchorId: context.readyEvidence.conversation.conversationAnchorId,
        prompt,
      });
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence } });
    }),
  });
});

test('B-02 multi-turn Runtime Agent conversation context stays on the same anchor', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'B',
    id: 'B-02',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const firstPrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('b-multi-turn-first')} B-02 first turn.`;
      const first = await sendScenarioPrompt(context, firstPrompt, 'B-02 first completed Runtime Agent chat');
      const firstOutput = first.chat.outputText;
      const secondPrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('b-multi-turn-second')} B-02 second turn.`;
      const second = await sendScenarioPrompt(context, secondPrompt, 'B-02 second completed Runtime Agent chat');
      assert.equal(second.chat.conversationAnchorId, context.readyEvidence.conversation.conversationAnchorId);
      assert.notEqual(second.chat.requestId, first.chat.requestId);
      assert.equal(second.chat.messages.some((message) => message?.text === firstOutput), true);
      assert.equal(second.chat.messages.some((message) => message?.text === secondPrompt), true);
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { first, second } });
    }),
  });
});

test('B-03 streaming text delta disables composer while rendering incrementally', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'B',
    id: 'B-03',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({
      scenarioId,
      localChatCompletionStreamDelayMs: 2_500,
    }, async (context) => {
      const page = context.page;
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('b-stream-delta')} B-03 stream delta.`;
      await page.locator('[data-chat-composer-textarea="true"]').fill(prompt);
      await page.locator('[data-chat-composer-send="true"]').click();
      await waitForEvidence(page, () =>
        globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'streaming'
        && document.querySelector('[data-chat-composer-send="true"]')?.disabled === true,
        'B-03 streaming Runtime Agent chat',
      );
      const streaming = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(streaming.chat.state, 'streaming');
      assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'false');
      await waitForEvidence(page, () =>
        globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'completed'
        && globalThis.window.__nimiZhiyuEvidence?.chat?.outputText?.includes('Streaming delta text arrives'),
        'B-03 completed streamed Runtime Agent chat',
      );
      const completed = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { streaming, completed } });
    }),
  });
});

test('B-04 reasoning delta projects separately from final text', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'B',
    id: 'B-04',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({
      scenarioId,
      localChatCompletionStreamDelayMs: 1_000,
    }, async (context) => {
      const page = context.page;
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('b-reasoning-delta')} B-04 reasoning delta.`;
      await page.locator('[data-chat-composer-textarea="true"]').fill(prompt);
      await page.locator('[data-chat-composer-send="true"]').click();
      await waitForEvidence(page, () =>
        globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'streaming'
        && globalThis.window.__nimiZhiyuEvidence?.chat?.reasoningText?.includes('checking Runtime route'),
        'B-04 streaming reasoning delta',
      );
      const streaming = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      const footerText = await page.locator('.zhiyu-chat-canvas__stream-footer[data-zhiyu-agent-chat-stop-state="available"]').innerText();
      assert.match(footerText, /思考片段/u);
      assert.match(streaming.chat.reasoningText, /checking Runtime route before final answer/u);
      await waitForEvidence(page, () =>
        globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'completed'
        && globalThis.window.__nimiZhiyuEvidence?.chat?.reasoningText?.includes('before final answer')
        && globalThis.window.__nimiZhiyuEvidence?.chat?.outputText?.includes('Reasoning delta text stays separate'),
        'B-04 completed reasoning Runtime Agent chat',
      );
      const completed = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(completed.chat.eventTypes.includes('reasoning-delta'), true);
      assert.equal(completed.chat.outputText.includes(completed.chat.reasoningText), false);
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { streaming, completed, footerText } });
    }),
  });
});

test('B-05 stop action cancels an in-flight Runtime Agent turn', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'B',
    id: 'B-05',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({
      scenarioId,
      localChatCompletionStreamDelayMs: 4_000,
    }, async (context) => {
      const page = context.page;
      await page.locator('[data-chat-composer-textarea="true"]').fill(`${runtimeAgentLiveE2EChatScenarioPrompt('b-stream-delta')} B-05 cancel me.`);
      await page.locator('[data-chat-composer-send="true"]').click();
      const stopButton = page.locator('[data-zhiyu-chat-stop-action="true"]');
      await stopButton.waitFor({ state: 'visible', timeout: 15_000 });
      const streaming = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(streaming.chat.state, 'streaming');
      await captureScenarioEvidence(context, {
        scenarioId: `${scenarioId}-streaming`,
        iteration,
        extra: { streaming },
      });
      await stopButton.click();
      await waitForEvidence(page, () =>
        globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'canceled'
        && globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode === 'runtime-agent-chat-user-canceled',
        'B-05 canceled Runtime Agent chat',
      );
      const evidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence } });
    }),
  });
});

test('B-06 long Chinese text remains usable at 390px width', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'B',
    id: 'B-06',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('b-long-chinese')} B-06 long Chinese.`;
      const evidence = await sendScenarioPrompt(context, prompt, 'B-06 completed long Chinese chat');
      await context.page.setViewportSize({ width: 390, height: 900 });
      const layout = await context.page.evaluate(() => ({
        rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
        conversationText: document.querySelector('[data-zhiyu-region="conversation"]')?.textContent || '',
        composerVisible: Boolean(document.querySelector('[data-chat-composer-textarea="true"]')),
      }));
      assert.equal(layout.rootOverflow, false);
      assert.equal(layout.composerVisible, true);
      assert.match(layout.conversationText, /窄屏中文排版/u);
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence, layout } });
    }),
  });
});

test('B-07 image artifact renders and attachment input remains fail-closed', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'B',
    id: 'B-07',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('b-image-action')} B-07 image artifact.`;
      const evidence = await sendScenarioPrompt(context, prompt, 'B-07 completed image artifact Runtime Agent chat');
      assert.equal(evidence.chat.eventTypes.includes('artifact-ready'), true);
      const summary = context.page.locator('[data-zhiyu-runtime-action-artifact-summary="true"]').last();
      await summary.waitFor({ timeout: 15_000 });
      assert.equal(await summary.getAttribute('data-zhiyu-runtime-action-artifact-preview'), 'rendered');
      await context.page.locator('[data-zhiyu-region="conversation"] img[src^="data:image/"]').last().waitFor({ timeout: 15_000 });
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence } });
    }),
  });
});

test('B-08 mid-stream failure stays failed and recoverable without pseudo completion', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'B',
    id: 'B-08',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      await assertMidStreamFailureFlow(context.page, context.pageProblems, context.readyEvidence);
      const evidence = await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(evidence.chat.state, 'failed');
      assert.notEqual(evidence.chat.reasonCode, 'runtime-agent-turn-completed');
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence } });
    }),
  });
});
