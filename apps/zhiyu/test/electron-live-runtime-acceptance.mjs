import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { _electron as electron } from 'playwright';
import { withRuntimeAgentLiveE2EFixture } from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture.test-helper.ts';
import {
  createZhiyuLiveRuntimeAcceptanceRendererUrl,
  createZhiyuLiveRuntimeFixtureAcceptanceInitScript,
} from './live-runtime-fixture-adapter.mjs';
import {
  assertAvatarPanelProjection,
  assertChatCompletedNarrowComposerUsable,
  assertNoPageProblems,
  assertProductShellPrimaryView,
  assertUniqueStageScreenshots,
  captureLiveRuntimeInteractionEvidence,
  captureLiveRuntimeEvidence,
  escapeRegExp,
  resetAcceptanceInputs,
  resetLiveRuntimeEvidenceRoot,
  trackPageProblems,
} from './electron-live-runtime-acceptance-helpers.mjs';

const root = path.resolve(import.meta.dirname, '..');
const mainEntry = path.join(root, 'dist-electron', 'main.js');
const zhiyuAppId = 'nimi.zhiyu';
const zhiyuRuntimeProtectedScopes = [
  'runtime.agent.read',
  'runtime.agent.write',
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
  'ai.spend.meter',
];

test('zhiyu Electron live Runtime path consumes SDK fixture and streams a Runtime Agent chat turn', { timeout: 180_000 }, async () => {
  await resetLiveRuntimeEvidenceRoot();

  await withRuntimeAgentLiveE2EFixture({
    localChatCompletionStreamDelayMs: 4_000,
    run: async (fixture) => {
      await fixture.admitLocalFirstPartyRuntimeAccountCaller({
        appId: zhiyuAppId,
        appInstanceId: `${zhiyuAppId}.local-first-party`,
        deviceId: 'nimi-zhiyu-local-first-party-device',
        capabilities: zhiyuRuntimeProtectedScopes,
      });

      await withTempDir('live-runtime', async (tmpRoot) => {
        const dataRoot = path.join(tmpRoot, 'data');
        await mkdir(dataRoot, { recursive: true });

        const app = await launchLiveRuntimeZhiyuApp({ fixture, dataRoot });
        let appClosed = false;

        try {
          const page = await app.firstWindow();
          await assertElectronChromeParity(app);
          const pageProblems = trackPageProblems(page);
          await page.waitForLoadState('domcontentloaded');
          await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
          await page.waitForSelector('[data-zhiyu-screen="home"]');

          await waitForEvidence(page, () =>
            globalThis.window.__nimiZhiyuEvidence?.runtime?.ready === true
            && globalThis.window.__nimiZhiyuEvidence?.auth?.ready === true
            && globalThis.window.__nimiZhiyuEvidence?.source?.ready === false
            && globalThis.window.__nimiZhiyuEvidence?.inventory?.ready === true
            && globalThis.window.__nimiZhiyuEvidence?.localAgent?.ready === false,
            'no-partner runtime evidence',
          );
          const noPartnerEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          assert.equal(noPartnerEvidence.source.reasonCode, 'zhiyu-admitted-source-projection-required');
          assert.equal(noPartnerEvidence.localAgent.ready, false);
          assert.equal(noPartnerEvidence.localAgent.localAgentRef, null);
          assert.equal(noPartnerEvidence.localAgent.reasonCode, 'zhiyu-realm-materialized-partner-required');
          await assertNoPartnerProductState(page);
          await captureLiveRuntimeEvidence(page, 'noPartner', pageProblems, {
            noPartnerEvidence,
          });

          await page.addInitScript(createZhiyuLiveRuntimeFixtureAcceptanceInitScript(fixture));
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
          await page.waitForSelector('[data-zhiyu-screen="home"]');

          await waitForEvidence(page, () =>
            globalThis.window.__nimiZhiyuEvidence?.runtime?.ready === true
            && globalThis.window.__nimiZhiyuEvidence?.auth?.ready === true
            && globalThis.window.__nimiZhiyuEvidence?.source?.ready === true
            && globalThis.window.__nimiZhiyuEvidence?.localAgent?.ready === true
            && globalThis.window.__nimiZhiyuEvidence?.conversation?.ready === true
            && globalThis.window.__nimiZhiyuEvidence?.memory?.ready === true,
            'pre-config runtime evidence',
          );

          const preConfigEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          assert.equal(preConfigEvidence.runtime.reasonCode, 'ready');
          assert.equal(preConfigEvidence.auth.accountId, fixture.ownerUserId);
          assert.equal(preConfigEvidence.source.source, 'sdk-fixture');
          assert.equal(preConfigEvidence.source.runtimeSourceRef, fixture.runtimeSourceRef);
          assert.equal(preConfigEvidence.localAgent.localAgentRef, fixture.localAgentRef);
          assert.match(preConfigEvidence.conversation.conversationAnchorId, /^agent_anchor_/);
          assert.equal(preConfigEvidence.memory.ready, true);
          assert.match(preConfigEvidence.memory.state, /^(ready|empty)$/);
          assert.equal(preConfigEvidence.route.reasonCode, 'zhiyu-ai-config-route-selection-required');
          assert.equal(preConfigEvidence.route.executionBinding, null);
          assert.deepEqual(preConfigEvidence.route.enabledCapabilities, [
            'text.generate',
            'audio.synthesize',
            'audio.transcribe',
            'voice_workflow.voice_clone',
            'voice_workflow.voice_design',
            'image.generate',
            'image.edit',
            'video.generate',
            'text.embed',
          ]);
          assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'false');
          await assertPartnerSelectedProductState(page);
          await captureLiveRuntimeEvidence(page, 'partnerSelected', pageProblems, {
            preConfigEvidence,
          });
          await assertModelUnconfiguredProductState(page);

          await page.locator('[data-zhiyu-composer-tool="model"]').click();
          await page.waitForSelector('[data-zhiyu-agent-panel-tab="model"]');
          const modelConfig = page.locator('[data-zhiyu-ai-config-embedded="agent-center"]');
          await modelConfig.waitFor({ timeout: 15_000 });
          assert.equal(await page.locator('[data-zhiyu-ai-config-drawer="open"]').count(), 0);
          await assertModelConfigEmbeddedProductQuality(page);
          const modelUnconfiguredEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          await captureLiveRuntimeEvidence(page, 'modelUnconfigured', pageProblems, {
            modelUnconfiguredEvidence,
          });
          await modelConfig
            .locator('button')
            .filter({ hasText: /Setup required|Select a model|选择.*模型|需要模型目标|未配置/i })
            .first()
            .click();
          const picker = page.locator('[role="dialog"]').filter({ hasText: 'Select Model' }).last();
          await picker.waitFor();
          await picker.getByRole('button', { name: /runtime-agent-live-e2e/i }).first().click();
          await picker.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
          await selectRuntimeModelForCapability(page, modelConfig, {
            section: 'embed',
            capabilityId: 'text.embed',
            modelName: /runtime-agent-live-e2e-embedding/i,
          });
          await selectRuntimeModelForCapability(page, modelConfig, {
            section: 'image',
            capabilityId: 'image.generate',
            modelName: /gpt-image-1\.5/i,
            source: 'cloud',
          });
          await waitForEvidence(page, () =>
            globalThis.window.__nimiZhiyuEvidence?.route?.reasonCode === 'runtime-route-ready'
            && Boolean(globalThis.window.__nimiZhiyuEvidence?.route?.executionBinding)
            && globalThis.window.__nimiZhiyuEvidence?.route?.targetRefKinds?.['text.generate'] === 'local-runtime'
            && globalThis.window.__nimiZhiyuEvidence?.route?.targetRefKinds?.['text.embed'] === 'local-runtime'
            && globalThis.window.__nimiZhiyuEvidence?.route?.targetRefKinds?.['image.generate'] === 'cloud-connector',
            'route ready after model picker selections',
          );
          const modelConfiguredEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          await assertModelConfiguredProductState(page);
          await captureLiveRuntimeEvidence(page, 'modelConfigured', pageProblems, {
            modelConfiguredEvidence,
          });
          await page.locator('[data-zhiyu-agent-center-tab-button="overview"]').click();
          await page.locator('[data-zhiyu-memory-observatory]').waitFor({ timeout: 15_000 });

          let readyEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          assert.equal(readyEvidence.route.reasonCode, 'runtime-route-ready');
          assert.equal(readyEvidence.route.aiConfigScopeOwnerId, zhiyuAppId);
          assert.equal(readyEvidence.route.aiConfigScopeSurfaceId, 'zhiyu-agent-home');
          assert.equal(readyEvidence.route.targetRefKinds['text.generate'], 'local-runtime');
          assert.equal(readyEvidence.route.targetRefKinds['text.embed'], 'local-runtime');
          assert.equal(readyEvidence.route.targetRefKinds['image.generate'], 'cloud-connector');
          assert.equal(readyEvidence.route.targetRefKinds['audio.synthesize'], null);
          assert.equal(readyEvidence.route.targetRefKinds['audio.transcribe'], null);
          assert.equal(readyEvidence.route.targetRefKinds['voice_workflow.voice_clone'], null);
          assert.equal(readyEvidence.route.targetRefKinds['voice_workflow.voice_design'], null);
          assert.equal(readyEvidence.route.targetRefKinds['image.edit'], null);
          assert.equal(readyEvidence.route.targetRefKinds['video.generate'], null);
          assert.equal(readyEvidence.route.executionBinding.route, 'local');
          assert.match(readyEvidence.route.executionBinding.modelId, /runtime-agent-live-e2e/);
          assert.equal(await page.locator('[data-zhiyu-product-stage]').getAttribute('data-zhiyu-product-stage'), 'ready');
          assert.equal(await page.locator('[data-zhiyu-readiness-score]').getAttribute('data-zhiyu-readiness-score'), '8/8');
          assert.equal(await page.locator('[data-zhiyu-memory-observatory]').getAttribute('data-zhiyu-memory-ready'), 'true');
          assert.equal(await page.locator('[data-zhiyu-memory-graph-state]').getAttribute('data-zhiyu-memory-graph-state'), 'not_projected');
          assert.equal(
            await page.locator('[data-zhiyu-memory-graph-state]').getAttribute('data-zhiyu-memory-graph-reason'),
            'runtime-agent-memory-graph-relations-not-admitted',
          );
          assert.equal(
            await page.locator('[data-zhiyu-status-collapsed]').count(),
            0,
            'primary chat must not render the legacy readiness checklist chrome',
          );
          assert.equal(await page.locator('[data-zhiyu-labeled-chip="conversation"]').count(), 1);
          assert.equal(await page.locator('[data-zhiyu-labeled-chip="route"]').count(), 1);
          assert.equal(await page.locator('[data-zhiyu-labeled-chip="chat"]').count(), 1);
          await assertAgentCenterHeaderParity(page, readyEvidence);
          await assertAppearanceConfigParity(page);
          await captureLiveRuntimeEvidence(page, 'appearanceConfig', pageProblems, {
            readyEvidence,
          });
          await assertBehaviorConfigParity(page);
          await captureLiveRuntimeEvidence(page, 'behaviorConfig', pageProblems, {
            readyEvidence,
          });
          await assertCognitionConfigParity(page);
          await captureLiveRuntimeEvidence(page, 'cognitionConfig', pageProblems, {
            readyEvidence,
          });
          await assertAdvancedConfigParity(page);
          await captureLiveRuntimeEvidence(page, 'advancedConfig', pageProblems, {
            readyEvidence,
          });
          await page.locator('[data-zhiyu-agent-center-tab-button="overview"]').click();
          await page.locator('[data-zhiyu-memory-observatory]').waitFor({ timeout: 15_000 });
          await assertDesktopShellTopbarParity(page, pageProblems);
          await assertAgentCenterKeyboardAccessibility(page);
          await closeAgentCenter(page);
          await assertProductShellPrimaryView(page);
          await assertLongTextNarrowChineseAndControls(page);
          await resetAcceptanceInputs(page);
          await captureLiveRuntimeEvidence(page, 'ready', pageProblems, {
            readyEvidence,
          });
          readyEvidence = await assertSubmitTimeStaleRouteFlow(page, pageProblems, readyEvidence);

          await assertStopChatFlow(page, pageProblems, readyEvidence);

          const completedPrompt = '请用一句话确认织羽本地对话可用。';
          await page.locator('[data-chat-composer-textarea="true"]').fill(completedPrompt);
          assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'true');
          await page.locator('[data-chat-composer-send="true"]').click();
          await waitForEvidence(page, () =>
            globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode === 'runtime-agent-turn-completed'
            && globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'completed'
            && Boolean(globalThis.window.__nimiZhiyuEvidence?.chat?.outputText)
            && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('text-delta')
            && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('message-sealed')
            && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('turn-completed'),
            'completed Runtime Agent chat evidence',
          );

          const chatCompletedEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          assert.equal(chatCompletedEvidence.chat.ready, true);
          assert.equal(chatCompletedEvidence.chat.source, 'runtime');
          assert.equal(chatCompletedEvidence.chat.ownerUserId, fixture.ownerUserId);
          assert.equal(chatCompletedEvidence.chat.localAgentRef, fixture.localAgentRef);
          assert.equal(chatCompletedEvidence.chat.conversationAnchorId, readyEvidence.conversation.conversationAnchorId);
          assert.match(chatCompletedEvidence.chat.requestId, /^zhiyu-turn-/);
          assert.equal(
            chatCompletedEvidence.chat.messages.some((message) =>
              message?.role === 'user'
              && message?.text === completedPrompt
              && message?.metadata?.turnId === chatCompletedEvidence.chat.requestId,
            ),
            true,
            'completed chat evidence must retain the submitted user prompt for the same Runtime turn',
          );
          assert.equal(chatCompletedEvidence.chat.messageCount >= 2, true);
          assert.match(chatCompletedEvidence.chat.outputText, /Hello from the Runtime Agent live fixture/);
          assert.equal(chatCompletedEvidence.turn.ready, true);
          assert.equal(chatCompletedEvidence.turn.reasonCode, 'runtime-agent-turn-completed');
          assert.equal(chatCompletedEvidence.composer.submitState, 'accepted');
          assert.equal(await page.locator('[data-zhiyu-agent-chat-state]').getAttribute('data-zhiyu-agent-chat-state'), 'completed');
          assert.equal(await page.locator('[data-zhiyu-agent-chat-ready]').getAttribute('data-zhiyu-agent-chat-ready'), 'true');
          assert.match(
            await page.locator('[data-zhiyu-agent-chat-event-types]').getAttribute('data-zhiyu-agent-chat-event-types'),
            /message-sealed/,
          );
          await page.getByText(/Hello from the Runtime Agent live fixture/).first().waitFor({ timeout: 15_000 });
          const conversationText = await page.locator('[data-zhiyu-region="conversation"]').innerText();
          assert.match(conversationText, /今天/);
          assert.match(conversationText, /Hello from the Runtime Agent live fixture/);
          assert.match(conversationText, /请用一句话确认织羽本地对话可用/);
          assert.doesNotMatch(conversationText, /Today/);
          await assertChatCompletedNarrowComposerUsable(page);
          await captureLiveRuntimeEvidence(page, 'chatCompleted', pageProblems, {
            readyEvidence,
            chatCompletedEvidence,
          });
          const firstRequestId = chatCompletedEvidence.chat.requestId;
          const firstOutputText = chatCompletedEvidence.chat.outputText;

          await assertMidStreamFailureFlow(page, pageProblems, readyEvidence);

          const actionArtifactPrompt = 'Please make an image artifact for Zhiyu action artifact.';
          await page.locator('[data-chat-composer-textarea="true"]').fill(actionArtifactPrompt);
          await page.waitForFunction(() =>
            document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
            && document.querySelector('[data-chat-composer-send="true"]')?.disabled === false
            && document.querySelector('[data-chat-composer-textarea="true"]')?.value.length > 0,
          );
          await page.locator('[data-chat-composer-send="true"]').click();
          await waitForEvidence(page, ({ conversationAnchorId, actionArtifactPrompt }) =>
            globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode === 'runtime-agent-turn-completed'
            && globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'completed'
            && globalThis.window.__nimiZhiyuEvidence?.chat?.conversationAnchorId === conversationAnchorId
            && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) => message?.text === actionArtifactPrompt)
            && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('beat-planned')
            && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('beat-delivery-started')
            && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('artifact-ready')
            && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('beat-delivered'),
            'Runtime action artifact evidence',
            {
              conversationAnchorId: readyEvidence.conversation.conversationAnchorId,
              actionArtifactPrompt,
            },
          );
          const actionArtifactEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          const actionArtifactSummary = page.locator('[data-zhiyu-runtime-action-artifact-summary="true"]').last();
          await actionArtifactSummary.waitFor({ timeout: 15_000 });
          assert.equal(await actionArtifactSummary.getAttribute('data-zhiyu-runtime-action-count'), '3');
          assert.equal(await actionArtifactSummary.getAttribute('data-zhiyu-runtime-artifact-count'), '1');
          assert.equal(await actionArtifactSummary.getAttribute('data-zhiyu-runtime-action-artifact-preview'), 'deferred');
          assert.equal(
            await actionArtifactSummary.getAttribute('data-zhiyu-runtime-action-artifact-preview-reason'),
            'zhiyu-runtime-artifact-preview-uri-not-admitted',
          );
          assert.equal(await actionArtifactSummary.locator('[data-zhiyu-runtime-action-artifact-event="beat-planned"]').count(), 1);
          assert.equal(await actionArtifactSummary.locator('[data-zhiyu-runtime-action-artifact-event="artifact-ready"]').count(), 1);
          assert.equal(await actionArtifactSummary.locator('[data-zhiyu-runtime-action-artifact-id]').count(), 1);
          assert.match(
            await actionArtifactSummary.locator('[data-zhiyu-runtime-action-artifact-mime]').first().getAttribute('data-zhiyu-runtime-action-artifact-mime'),
            /^image\//,
          );
          await captureLiveRuntimeEvidence(page, 'actionArtifact', pageProblems, {
            readyEvidence,
            chatCompletedEvidence,
            actionArtifactEvidence,
          });

          const secondPrompt = '请继续用一句话确认这是同一个对话线程。';
          await page.locator('[data-chat-composer-textarea="true"]').fill(secondPrompt);
          await page.waitForFunction(() =>
            document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
            && document.querySelector('[data-chat-composer-send="true"]')?.disabled === false
            && document.querySelector('[data-chat-composer-textarea="true"]')?.value.length > 0,
          );
          assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'true');
          await page.locator('[data-chat-composer-send="true"]').click();
          await waitForEvidence(page, ({ requestId: firstRequestId, conversationAnchorId, firstOutputText, secondPrompt }) =>
            globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode === 'runtime-agent-turn-completed'
            && globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'completed'
            && globalThis.window.__nimiZhiyuEvidence?.chat?.requestId !== firstRequestId
            && globalThis.window.__nimiZhiyuEvidence?.chat?.conversationAnchorId === conversationAnchorId
            && globalThis.window.__nimiZhiyuEvidence?.chat?.messageCount >= 4
            && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) => message?.text === firstOutputText)
            && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) => message?.text === secondPrompt),
            'multi-turn Runtime Agent chat evidence',
            {
              requestId: firstRequestId,
              conversationAnchorId: readyEvidence.conversation.conversationAnchorId,
              firstOutputText,
              secondPrompt,
            },
          );
          const multiTurnEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          assert.equal(multiTurnEvidence.chat.ready, true);
          assert.equal(multiTurnEvidence.chat.source, 'runtime');
          assert.notEqual(multiTurnEvidence.chat.requestId, firstRequestId);
          assert.equal(multiTurnEvidence.chat.conversationAnchorId, readyEvidence.conversation.conversationAnchorId);
          assert.equal(multiTurnEvidence.chat.messageCount >= 4, true);
          assert.equal(multiTurnEvidence.chat.messages.some((message) => message?.text === firstOutputText), true);
          assert.equal(multiTurnEvidence.chat.messages.some((message) => message?.text === secondPrompt), true);
          const multiTurnConversationText = await page.locator('[data-zhiyu-region="conversation"]').innerText();
          assert.match(multiTurnConversationText, /请用一句话确认织羽本地对话可用/);
          assert.match(multiTurnConversationText, /请继续用一句话确认这是同一个对话线程/);
          assert.match(multiTurnConversationText, /Hello from the Runtime Agent live fixture/);
          await assertChatCompletedNarrowComposerUsable(page);
          await captureLiveRuntimeEvidence(page, 'chatMultiTurn', pageProblems, {
            readyEvidence,
            chatCompletedEvidence,
            multiTurnEvidence,
          });

          await app.close();
          appClosed = true;

          const relaunchedApp = await launchLiveRuntimeZhiyuApp({ fixture, dataRoot });
          try {
            const relaunchedPage = await relaunchedApp.firstWindow();
            const relaunchProblems = trackPageProblems(relaunchedPage);
            await relaunchedPage.waitForLoadState('domcontentloaded');
            await relaunchedPage.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
            await relaunchedPage.waitForSelector('[data-zhiyu-screen="home"]');
            await relaunchedPage.addInitScript(createZhiyuLiveRuntimeFixtureAcceptanceInitScript(fixture));
            await relaunchedPage.reload({ waitUntil: 'domcontentloaded' });
            await relaunchedPage.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
            await relaunchedPage.waitForSelector('[data-zhiyu-screen="home"]');
            await waitForEvidence(relaunchedPage, ({ conversationAnchorId, firstOutputText, secondPrompt }) =>
              globalThis.window.__nimiZhiyuEvidence?.conversation?.conversationAnchorId === conversationAnchorId
              && globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode === 'runtime-agent-session-snapshot-hydrated'
              && globalThis.window.__nimiZhiyuEvidence?.chat?.conversationAnchorId === conversationAnchorId
              && globalThis.window.__nimiZhiyuEvidence?.chat?.messageCount >= 4
              && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('session-snapshot-hydrated')
              && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) => message?.text === firstOutputText)
              && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) => message?.text === secondPrompt),
              'restart hydrated Runtime Agent chat snapshot',
              {
                conversationAnchorId: readyEvidence.conversation.conversationAnchorId,
                firstOutputText,
                secondPrompt,
              },
            );
            const restartHydratedEvidence = await relaunchedPage.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
            assert.equal(restartHydratedEvidence.conversation.conversationAnchorId, readyEvidence.conversation.conversationAnchorId);
            assert.equal(restartHydratedEvidence.chat.source, 'runtime');
            assert.equal(restartHydratedEvidence.chat.state, 'completed');
            assert.equal(restartHydratedEvidence.chat.ready, true);
            assert.equal(restartHydratedEvidence.chat.messages.some((message) => message?.text === firstOutputText), true);
            assert.equal(restartHydratedEvidence.chat.messages.some((message) => message?.text === secondPrompt), true);
            const restartedConversationText = await relaunchedPage.locator('[data-zhiyu-region="conversation"]').innerText();
            assert.match(restartedConversationText, /Hello from the Runtime Agent live fixture/);
            assert.equal(restartedConversationText.includes(secondPrompt), true);
            await assertChatCompletedNarrowComposerUsable(relaunchedPage);
            await captureLiveRuntimeEvidence(relaunchedPage, 'chatRestartHydrated', relaunchProblems, {
              readyEvidence,
              chatCompletedEvidence,
              multiTurnEvidence,
              restartHydratedEvidence,
            });
            assertNoPageProblems(relaunchProblems);
          } finally {
            await relaunchedApp.close();
          }

          await assertUniqueStageScreenshots();
          assertNoPageProblems(pageProblems);
        } finally {
          if (!appClosed) {
            await app.close();
          }
        }
      });
    },
  });
});

async function launchLiveRuntimeZhiyuApp({ fixture, dataRoot }) {
  return electron.launch({
    args: [mainEntry],
    env: {
      ...process.env,
      NIMI_RUNTIME_GRPC_ADDR: '',
      NIMI_ZHIYU_ELECTRON_RENDERER_URL: createZhiyuLiveRuntimeAcceptanceRendererUrl(root),
      NIMI_ZHIYU_ELECTRON_RUNTIME_ENDPOINT: fixture.endpoint,
      NIMI_ZHIYU_ELECTRON_STANDARD_DATA_ROOT: dataRoot,
    },
  });
}

async function assertElectronChromeParity(app) {
  const chrome = await app.evaluate(({ BrowserWindow, Menu }) => {
    const window = BrowserWindow.getAllWindows()[0] ?? null;
    return {
      applicationMenuPresent: Boolean(Menu.getApplicationMenu()),
      menuBarVisible: window && typeof window.isMenuBarVisible === 'function'
        ? window.isMenuBarVisible()
        : null,
      menuBarAutoHide: window && typeof window.isMenuBarAutoHide === 'function'
        ? window.isMenuBarAutoHide()
        : null,
    };
  });
  assert.equal(chrome.applicationMenuPresent, false, 'Zhiyu must not show the default Electron application menu');
  assert.notEqual(chrome.menuBarVisible, true, 'Zhiyu must hide the native menu bar to match Desktop agent chat chrome');
  assert.notEqual(chrome.menuBarAutoHide, false, 'Zhiyu native menu bar must remain auto-hidden when the platform reports the state');
}

async function withTempDir(prefix, run) {
  const dir = await mkdtemp(path.join(tmpdir(), `nimi-zhiyu-electron-${prefix}-`));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function waitForEvidence(page, predicate, label, argument) {
  try {
    await page.waitForFunction(predicate, argument, { timeout: 45_000 });
  } catch (error) {
    const evidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence).catch((evalError) => ({
      evaluationError: evalError instanceof Error ? evalError.message : String(evalError),
    }));
    throw new Error(`${label} timed out: ${JSON.stringify({ evidence })}`, { cause: error });
  }
}

async function assertNoPartnerProductState(page) {
  assert.equal(await page.locator('[data-zhiyu-product-stage]').getAttribute('data-zhiyu-product-stage'), 'source-required');
  const candidateCount = await page.locator('[data-zhiyu-local-agent-candidate="true"]').count();
  assert.equal(await page.locator('[data-zhiyu-relationship-rail-state]').getAttribute('data-zhiyu-relationship-rail-state'), candidateCount > 0 ? 'available' : 'empty');
  assert.equal(await page.locator('[data-zhiyu-region="relationship-rail"]').count(), 1);
  assert.equal(await page.locator('[data-zhiyu-primary-action]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-capability-setup-action="select-partner"]').count(), 0, 'primary chat must not expose backstage partner setup actions');
  assert.equal(await page.locator('[data-zhiyu-image-studio-setup-action="select-partner"]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-region="image-studio"]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-capability-studio-run]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-image-generate-run]').count(), 0);
  assert.equal(
    await page.locator('[data-zhiyu-status-collapsed]').count(),
    0,
    'primary chat must not render the legacy readiness/status checklist',
  );
  const shellText = await page.locator('[data-zhiyu-product-shell="workspace"]').innerText();
  assert.match(shellText, /选择本地伙伴/);
  assert.match(shellText, /选择本地伙伴开始对话/);
  assert.doesNotMatch(shellText, /8 项 checklist|checklist dashboard/i);
  assert.doesNotMatch(shellText, /本地伙伴工作台|character\/persona|文字能力|图片创作/);
  assertPrimaryWorkspaceHasNoEngineeringCopy(shellText);
}

async function assertPartnerSelectedProductState(page) {
  assert.equal(await page.locator('[data-zhiyu-product-stage]').getAttribute('data-zhiyu-product-stage'), 'route-required');
  assert.equal(await page.locator('[data-zhiyu-primary-action]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-relationship-rail-state]').getAttribute('data-zhiyu-relationship-rail-state'), 'available');
  assert.equal(await page.locator('[data-zhiyu-region="relationship-rail"]').count(), 1);
  assert.equal(await page.locator('[data-zhiyu-side-panel-state]').getAttribute('data-zhiyu-side-panel-state'), 'closed');
  assert.equal(await page.locator('[data-zhiyu-region="agent-panel"]').count(), 0);
  const shellText = await page.locator('[data-zhiyu-product-shell="workspace"]').innerText();
  assert.match(shellText, /开始一段对话|当前伙伴/);
  assert.match(shellText, /未绑定模型|请先完成模型配置/);
  assert.match(shellText, /模型|本地对话模型已绑定/);
  assert.doesNotMatch(shellText, /Runtime Live Source/);
  assertPrimaryWorkspaceHasNoEngineeringCopy(shellText);
}

async function assertModelUnconfiguredProductState(page) {
  assert.equal(await page.locator('[data-zhiyu-composer-tool="model"]').count(), 1);
  assert.equal(await page.locator('[data-zhiyu-capability-setup-action="configure-model"]').count(), 0, 'primary chat must not expose backstage model setup actions');
  assert.equal(await page.locator('[data-zhiyu-image-studio-setup-action="configure-model"]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-region="image-studio"]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-capability-studio-run]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-image-generate-run]').count(), 0);
  const shellText = await page.locator('[data-zhiyu-product-shell="workspace"]').innerText();
  assert.match(shellText, /未绑定模型|请先完成模型配置/);
  assertPrimaryWorkspaceHasNoEngineeringCopy(shellText);
}

async function assertModelConfiguredProductState(page) {
  await waitForEvidence(page, () =>
    globalThis.window.__nimiZhiyuEvidence?.route?.reasonCode === 'runtime-route-ready'
    && Boolean(globalThis.window.__nimiZhiyuEvidence?.route?.executionBinding),
    'model configured product state',
  );
  const evidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  assert.equal(evidence.route.targetRefKinds['text.generate'], 'local-runtime');
  assert.equal(evidence.route.targetRefKinds['text.embed'], 'local-runtime');
  assert.equal(evidence.route.targetRefKinds['image.generate'], 'cloud-connector');
  assert.match(evidence.route.executionBinding.modelId, /runtime-agent-live-e2e/i);
  const modelConfig = page.locator('[data-zhiyu-ai-config-embedded="agent-center"]');
  await modelConfig.waitFor({ timeout: 15_000 });
  const modelConfigText = await modelConfig.innerText();
  assert.match(modelConfigText, /模型目标已绑定|已绑定|已就绪/);
  assert.doesNotMatch(modelConfigText, /等待上游投影|not_projected|sourceRef|localAgentRef|回显通路|身份地板|graph-lite/);
  await assertVoiceControlsDeferred(page);
}

function assertPrimaryWorkspaceHasNoEngineeringCopy(text) {
  assert.doesNotMatch(
    text,
    /上游投影|准入来源|等待投影|not_projected|Runtime\b|SDK\b|sourceRef|localAgentRef|回显通路|身份地板|graph-lite|Runtime Agent|LocalAgent|Runtime Live Source|Capability Studio|Image Studio|Avatar Presence/,
  );
}

async function assertVoiceControlsDeferred(page) {
  const captureTool = page.locator('[data-zhiyu-composer-tool="voice-capture"]').first();
  await captureTool.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await captureTool.getAttribute('data-zhiyu-chat-voice-capture-state'), 'deferred');
  assert.equal(
    await captureTool.getAttribute('data-zhiyu-chat-voice-capture-reason'),
    'zhiyu-chat-voice-capture-runtime-surface-deferred',
  );
  assert.equal(await captureTool.isDisabled(), true);

  const voiceTool = page.locator('[data-zhiyu-composer-tool="hands-free"]').first();
  await voiceTool.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-state'), 'deferred');
  assert.equal(
    await voiceTool.getAttribute('data-zhiyu-chat-voice-reason'),
    'zhiyu-chat-voice-runtime-surface-deferred',
  );
  assert.equal(await voiceTool.isDisabled(), true);
}

async function selectRuntimeModelForCapability(page, drawer, input) {
  await openModelConfigSection(drawer, input.section);
  const capability = drawer.locator(`[data-nimi-model-config-capability="${input.capabilityId}"]`).first();
  await capability.waitFor({ timeout: 15_000 });
  await capability
    .locator('button')
    .filter({ hasText: /Setup required|Select a model|选择.*模型|需要模型目标|未配置|待完成设置/i })
    .first()
    .click();
  const picker = page.locator('[role="dialog"]').filter({ hasText: /Select Model/i }).last();
  await picker.waitFor({ timeout: 15_000 });
  if (input.source === 'cloud') {
    await picker.getByRole('button', { name: /^Cloud$/i }).click();
  }
  const modelButton = picker.getByRole('button', { name: input.modelName }).first();
  try {
    await modelButton.click({ timeout: 15_000 });
  } catch (error) {
    const pickerText = await picker.innerText().catch(() => '');
    throw new Error(`Model picker did not expose ${String(input.modelName)} for ${input.capabilityId}: ${pickerText}`, { cause: error });
  }
  await picker.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
}

async function openModelConfigSection(drawer, section) {
  const detail = drawer.locator('[data-nimi-model-config-detail-section]').last();
  if (await detail.count()) {
    const activeSection = await detail.getAttribute('data-nimi-model-config-detail-section');
    if (activeSection === section) {
      return;
    }
    const back = drawer.locator('[data-nimi-model-config-back="true"]').first();
    await back.waitFor({ timeout: 15_000 });
    await back.click();
  }
  const sectionButton = drawer.locator(`[data-nimi-model-config-section="${section}"]`).first();
  await sectionButton.waitFor({ timeout: 15_000 });
  await sectionButton.click();
  await drawer.locator(`[data-nimi-model-config-detail-section="${section}"]`).waitFor({ timeout: 15_000 });
}

async function assertModelConfigEmbeddedProductQuality(page) {
  const modelConfig = page.locator('[data-zhiyu-ai-config-embedded="agent-center"]');
  await modelConfig.waitFor({ timeout: 15_000 });
  await page.locator('[data-zhiyu-agent-model-route-card="true"]').waitFor({ timeout: 15_000 });
  await modelConfig.locator('.zhiyu-ai-config-embedded__model-hub').waitFor({ timeout: 15_000 });
  await assertAgentCenterModelPanelLayout(page, 'live Runtime model configured panel');

  const unlabeledOrTinyButtons = await modelConfig.locator('button').evaluateAll((buttons) => buttons
    .map((button, index) => {
      const label = `${button.getAttribute('aria-label') || button.textContent || ''}`.replace(/\s+/g, ' ').trim();
      const rect = button.getBoundingClientRect();
      if (label && rect.width >= 28 && rect.height >= 28) {
        return null;
      }
      return { index, label, width: rect.width, height: rect.height };
    })
    .filter(Boolean));
  assert.deepEqual(unlabeledOrTinyButtons, []);

  const chatSection = modelConfig.locator('[data-nimi-model-config-section="chat"]').first();
  await chatSection.waitFor({ timeout: 15_000 });
  for (const section of ['chat', 'embed', 'tts', 'stt', 'image', 'video']) {
    await modelConfig.locator(`[data-nimi-model-config-section="${section}"]`).first().waitFor({ timeout: 15_000 });
  }
  assert.ok(
    await modelConfig.getByRole('button', { name: /导入 AI 预设/ }).first().isVisible(),
    'embedded ModelConfig hub must use the Desktop import profile label instead of falling back to "import"',
  );
  await chatSection.click();
  await modelConfig.locator('[data-nimi-model-config-detail-section="chat"]').waitFor({ timeout: 15_000 });
  const back = modelConfig.locator('[data-nimi-model-config-back="true"]').first();
  await back.waitFor({ timeout: 15_000 });
  const backBox = await back.boundingBox();
  assert.ok(backBox && backBox.width >= 60 && backBox.height >= 28, `model config back control is too small: ${JSON.stringify(backBox)}`);
  assert.match(await back.evaluate((button) => `${button.getAttribute('aria-label') || button.textContent || ''}`), /返回|Back/i);

  const capabilityButton = modelConfig.locator('[data-nimi-model-config-capability] > button').first();
  await capabilityButton.waitFor({ timeout: 15_000 });
  const capabilityStyle = await capabilityButton.evaluate((button) => {
    const style = globalThis.getComputedStyle(button);
    return {
      borderStyle: style.borderStyle,
      borderRadius: style.borderRadius,
      backgroundColor: style.backgroundColor,
      minHeight: style.minHeight,
    };
  });
  assert.notEqual(capabilityStyle.borderStyle, 'none');
  assert.notEqual(capabilityStyle.backgroundColor, 'rgba(0, 0, 0, 0)');
  assert.notEqual(capabilityStyle.borderRadius, '0px');

  const embeddedStyle = await modelConfig.evaluate((panel) => {
    const style = globalThis.getComputedStyle(panel);
    return {
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
      borderStyle: style.borderStyle,
      padding: style.padding,
    };
  });
  assert.equal(embeddedStyle.backgroundColor, 'rgba(0, 0, 0, 0)');
  assert.equal(embeddedStyle.boxShadow, 'none');
  assert.equal(embeddedStyle.borderStyle, 'none');
  assert.equal(embeddedStyle.padding, '0px');
}

async function assertAgentCenterModelPanelLayout(page, label) {
  await page.setViewportSize({ width: 1900, height: 1280 });
  const metrics = await page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!element) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      };
    };
    const embedded = document.querySelector('[data-zhiyu-ai-config-embedded="agent-center"]');
    const embeddedStyle = embedded ? getComputedStyle(embedded) : null;
    const modelCard = document.querySelector('.zhiyu-agent-center__model-config-card');
    const modelCardStyle = modelCard ? getComputedStyle(modelCard) : null;
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      panel: box('[data-zhiyu-region="agent-panel"]'),
      header: box('[data-zhiyu-agent-center-header="true"]'),
      tabs: box('.zhiyu-agent-center__tabs'),
      modelCard: box('.zhiyu-agent-center__model-config-card'),
      embedded: box('[data-zhiyu-ai-config-embedded="agent-center"]'),
      routeCard: box('[data-zhiyu-agent-model-route-card="true"]'),
      composer: box('.zhiyu-chat-canvas__composer [data-canonical-composer-width]'),
      textarea: box('[data-chat-composer-textarea="true"]'),
      embeddedOverflowY: embeddedStyle?.overflowY ?? null,
      embeddedBackgroundColor: embeddedStyle?.backgroundColor ?? null,
      embeddedBoxShadow: embeddedStyle?.boxShadow ?? null,
      embeddedBorderStyle: embeddedStyle?.borderStyle ?? null,
      embeddedPadding: embeddedStyle?.padding ?? null,
      modelCardBackgroundColor: modelCardStyle?.backgroundColor ?? null,
      modelCardBorderStyle: modelCardStyle?.borderStyle ?? null,
      modelCardBorderRadius: modelCardStyle?.borderRadius ?? null,
      visibleSections: [...document.querySelectorAll('[data-zhiyu-ai-config-embedded="agent-center"] [data-nimi-model-config-section]')]
        .map((element) => element.getAttribute('data-nimi-model-config-section')),
    };
  });
  assert.ok(metrics.panel, `${label}: Agent Center panel must render on wide desktop`);
  assert.ok(metrics.header, `${label}: Agent Center header must render`);
  assert.ok(metrics.tabs, `${label}: Agent Center tabs must render`);
  assert.ok(metrics.routeCard, `${label}: model route card must render before embedded config`);
  assert.ok(metrics.modelCard, `${label}: model config card must render`);
  assert.ok(metrics.embedded, `${label}: embedded model config must render`);
  assert.ok(metrics.composer, `${label}: composer must render`);
  assert.ok(metrics.textarea, `${label}: composer textarea must render`);
  assert.ok(metrics.panel.y <= 64, `${label}: Agent Center is vertically detached from desktop side-sheet rhythm: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.panel.height >= metrics.viewport.height - 112, `${label}: Agent Center should use the available desktop side-sheet height: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.tabs.y - metrics.header.bottom <= 80, `${label}: Agent Center tabs are detached from the header: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.routeCard.y - metrics.tabs.bottom <= 100, `${label}: Agent Center model content is detached from the tabs: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.modelCard.height <= 760, `${label}: embedded model config is stretching beyond the Desktop Agent Center model card: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.embedded.height <= metrics.modelCard.height + 2, `${label}: embedded model config must stay inside its card: ${JSON.stringify(metrics)}`);
  assert.equal(metrics.embeddedOverflowY, 'visible', `${label}: embedded ModelConfig must not create a second scroll/card surface: ${JSON.stringify(metrics)}`);
  assert.equal(metrics.embeddedBackgroundColor, 'rgba(0, 0, 0, 0)', `${label}: embedded ModelConfig must be transparent inside the Desktop card: ${JSON.stringify(metrics)}`);
  assert.equal(metrics.embeddedBoxShadow, 'none', `${label}: embedded ModelConfig must not add a second shadow: ${JSON.stringify(metrics)}`);
  assert.equal(metrics.embeddedBorderStyle, 'none', `${label}: embedded ModelConfig must not add a second border: ${JSON.stringify(metrics)}`);
  assert.equal(metrics.embeddedPadding, '0px', `${label}: embedded ModelConfig must not add a second padding layer: ${JSON.stringify(metrics)}`);
  assert.notEqual(metrics.modelCardBackgroundColor, 'rgba(0, 0, 0, 0)', `${label}: Desktop model card must own the visible background: ${JSON.stringify(metrics)}`);
  assert.equal(metrics.modelCardBorderStyle, 'solid', `${label}: Desktop model card must own the visible border: ${JSON.stringify(metrics)}`);
  assert.match(metrics.modelCardBorderRadius || '', /^14px\b/, `${label}: Desktop model card must use the Agent Center 14px radius: ${JSON.stringify(metrics)}`);
  for (const section of ['chat', 'embed', 'tts', 'stt', 'image', 'video']) {
    assert.ok(metrics.visibleSections.includes(section), `${label}: Desktop ModelConfig section ${section} is missing: ${JSON.stringify(metrics)}`);
  }
  assert.ok(metrics.textarea.height <= 80, `${label}: composer textarea should keep Kit compact auto-height when empty: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.composer.height <= 190, `${label}: composer surface is too tall for desktop agent chat: ${JSON.stringify(metrics)}`);
  const checkpoint = process.env.NIMI_ZHIYU_EVIDENCE_CHECKPOINT?.trim() || 'live-runtime';
  const evidenceRoot = path.resolve(root, '..', '..', '.nimi', 'local', 'evidence', 'zhiyu', checkpoint);
  await mkdir(evidenceRoot, { recursive: true });
  await page.screenshot({
    path: path.join(evidenceRoot, 'live-runtime-model-configured-wide.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function assertStopChatFlow(page, pageProblems, readyEvidence) {
  await page.locator('[data-chat-composer-textarea="true"]').fill('请开始一段可以被我停止的回复。');
  assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'true');
  await page.locator('[data-chat-composer-send="true"]').click();
  const stopButton = page.locator('[data-zhiyu-chat-stop-action="true"]');
  await stopButton.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await stopButton.getAttribute('aria-label'), '停止当前回复');
  assert.equal(
    await stopButton.getAttribute('data-zhiyu-agent-chat-stop-state'),
    'available',
  );
  await waitForEvidence(page, () =>
    globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'streaming'
    && document.querySelector('[data-zhiyu-chat-stop-action="true"]') !== null,
    'streaming Runtime Agent chat evidence before product stop',
  );
  const streamingEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  assert.equal(streamingEvidence.chat.state, 'streaming');
  assert.equal(streamingEvidence.chat.ready, false);
  assert.equal(
    await page.locator('[data-zhiyu-agent-chat-state]').getAttribute('data-zhiyu-agent-chat-state'),
    'streaming',
  );
  const streamingConversationText = await page.locator('[data-zhiyu-region="conversation"]').innerText();
  assert.doesNotMatch(
    streamingConversationText,
    /Streaming/i,
    'Zhiyu must mirror Desktop Agent Chat and hide the generic Kit streaming placeholder from the primary transcript',
  );
  await captureLiveRuntimeEvidence(page, 'chatStreaming', pageProblems, {
    readyEvidence,
    streamingEvidence,
  });
  await stopButton.waitFor({ state: 'visible', timeout: 15_000 });
  await stopButton.click();
  await waitForEvidence(page, () =>
    globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'canceled'
    && globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode === 'runtime-agent-chat-user-canceled',
    'canceled Runtime Agent chat evidence after product stop',
  );
  const canceledEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  assert.equal(canceledEvidence.chat.ready, false);
  assert.equal(canceledEvidence.chat.state, 'canceled');
  assert.equal(canceledEvidence.chat.reasonCode, 'runtime-agent-chat-user-canceled');
  assert.equal(
    canceledEvidence.chat.messages.some((message) =>
      message?.status === 'streaming' || message?.kind === 'streaming',
    ),
    false,
    'canceled chat must not leave a visual Streaming bubble in the transcript',
  );
  assert.equal(await page.locator('[data-zhiyu-agent-chat-state]').getAttribute('data-zhiyu-agent-chat-state'), 'canceled');
  assert.equal(await page.locator('[data-zhiyu-chat-stop-action="true"]').count(), 0);
  await captureLiveRuntimeEvidence(page, 'chatCanceled', pageProblems, {
    readyEvidence,
    canceledEvidence,
  });
  await page.locator('[data-chat-composer-textarea="true"]').fill('');
}

async function assertSubmitTimeStaleRouteFlow(page, pageProblems, readyEvidence) {
  const scopeRef = 'app:nimi.zhiyu:zhiyu-agent-home';
  const stalePrompt = 'Please verify Zhiyu stale route submit blocking.';
  const original = await page.evaluate(async ({ scopeRef }) =>
    globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke('nimi.shell.aiConfig.get', { scopeRef }),
    { scopeRef },
  );
  assert.equal(original.scopeRef, scopeRef);
  assert.ok(original.config?.capabilities?.targetRefs?.['text.generate'], 'stale-route guard requires an initially configured text route');

  await page.locator('[data-chat-composer-textarea="true"]').fill(stalePrompt);
  await page.waitForFunction(() =>
    document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
    && document.querySelector('[data-chat-composer-send="true"]')?.disabled === false
    && document.querySelector('[data-chat-composer-textarea="true"]')?.value.length > 0,
  );
  assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'true');

  try {
    await page.evaluate(async ({ scopeRef, original }) => {
      const staleConfig = {
        ...original.config,
        capabilities: {
          ...original.config.capabilities,
          targetRefs: {},
        },
      };
      await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke('nimi.shell.aiConfig.set', {
        scopeRef,
        config: staleConfig,
      });
    }, { scopeRef, original });
    await page.locator('[data-chat-composer-send="true"]').click();
    await waitForEvidence(page, () =>
      globalThis.window.__nimiZhiyuEvidence?.route?.ready === false
      && globalThis.window.__nimiZhiyuEvidence?.route?.reasonCode === 'zhiyu-ai-config-route-selection-required'
      && globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'failed'
      && globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode === 'zhiyu-submit-route-refresh-stale'
      && globalThis.window.__nimiZhiyuEvidence?.chat?.messageCount === 0
      && globalThis.window.__nimiZhiyuEvidence?.composer?.submitState === 'failed',
      'submit-time stale route block evidence',
    );
    const staleRouteEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
    assert.equal(staleRouteEvidence.chat.requestId, null);
    assert.equal(staleRouteEvidence.chat.eventTypes.length, 0);
    assert.equal(await page.locator('[data-zhiyu-agent-chat-state]').getAttribute('data-zhiyu-agent-chat-state'), 'failed');
    const failureNotice = page.locator('[data-zhiyu-agent-chat-failure="true"]').last();
    await failureNotice.waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal(await failureNotice.getAttribute('data-zhiyu-agent-chat-failure-reason'), 'zhiyu-submit-route-refresh-stale');
    assert.match(await failureNotice.innerText(), /zhiyu-submit-route-refresh-stale/);
    await captureLiveRuntimeEvidence(page, 'staleRoute', pageProblems, {
      readyEvidence,
      staleRouteEvidence,
    });
  } finally {
    await page.evaluate(async ({ scopeRef, original }) =>
      globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke('nimi.shell.aiConfig.set', {
        scopeRef,
        config: original.config,
      }),
      { scopeRef, original },
    ).catch(() => undefined);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
  await page.waitForSelector('[data-zhiyu-screen="home"]');
  await waitForEvidence(page, ({ conversationAnchorId }) =>
    globalThis.window.__nimiZhiyuEvidence?.conversation?.conversationAnchorId === conversationAnchorId
    && globalThis.window.__nimiZhiyuEvidence?.route?.reasonCode === 'runtime-route-ready'
    && Boolean(globalThis.window.__nimiZhiyuEvidence?.route?.executionBinding)
    && globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'idle',
    'ready evidence after restoring stale route config',
    { conversationAnchorId: readyEvidence.conversation.conversationAnchorId },
  );
  await resetAcceptanceInputs(page);
  return await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
}

async function assertMidStreamFailureFlow(page, pageProblems, readyEvidence) {
  const failurePrompt = 'Please trigger Zhiyu mid-stream failure after committed text.';
  const expectedPartialText = 'Committed before induced action failure.';
  await page.locator('[data-chat-composer-textarea="true"]').fill(failurePrompt);
  await page.waitForFunction(() =>
    document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
    && document.querySelector('[data-chat-composer-send="true"]')?.disabled === false
    && document.querySelector('[data-chat-composer-textarea="true"]')?.value.length > 0,
  );
  await page.locator('[data-chat-composer-send="true"]').click();
  await waitForEvidence(page, ({ expectedPartialText, failurePrompt }) =>
    globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'failed'
    && globalThis.window.__nimiZhiyuEvidence?.chat?.ready === false
    && globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode !== 'runtime-agent-turn-completed'
    && globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode !== 'runtime-turn-request-accepted'
    && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('text-delta')
    && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('turn-failed')
    && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) => message?.text === failurePrompt)
    && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) =>
      message?.text === expectedPartialText
      && message?.status === 'error'
      && typeof message?.error === 'string'
      && message.error.length > 0
    ),
    'mid-stream failed Runtime Agent chat evidence',
    {
      expectedPartialText,
      failurePrompt,
    },
  );
  const failedEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  assert.equal(failedEvidence.chat.ready, false);
  assert.equal(failedEvidence.chat.state, 'failed');
  assert.notEqual(failedEvidence.chat.reasonCode, 'runtime-agent-turn-completed');
  assert.notEqual(failedEvidence.chat.reasonCode, 'runtime-turn-request-accepted');
  assert.equal(failedEvidence.chat.eventTypes.includes('text-delta'), true);
  assert.equal(failedEvidence.chat.eventTypes.includes('turn-failed'), true);
  assert.equal(
    failedEvidence.chat.messages.some((message) =>
      message?.text === expectedPartialText
      && message?.status === 'error'
      && typeof message?.error === 'string'
      && message.error.length > 0
    ),
    true,
  );
  assert.equal(await page.locator('[data-zhiyu-agent-chat-state]').getAttribute('data-zhiyu-agent-chat-state'), 'failed');
  assert.equal(await page.locator('[data-zhiyu-agent-chat-ready]').getAttribute('data-zhiyu-agent-chat-ready'), 'false');
  const failureNotice = page.locator('[data-zhiyu-agent-chat-failure="true"]').last();
  await failureNotice.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await failureNotice.getAttribute('data-zhiyu-agent-chat-failure-reason'), failedEvidence.chat.reasonCode);
  assert.equal(await failureNotice.getAttribute('data-zhiyu-agent-chat-failure-action'), failedEvidence.chat.actionHint);
  assert.match(await failureNotice.innerText(), new RegExp(escapeRegExp(failedEvidence.chat.reasonCode)));
  assert.match(await failureNotice.innerText(), /failed|failure|失败|处理/i);
  const failedConversationText = await page.locator('[data-zhiyu-region="conversation"]').innerText();
  assert.match(failedConversationText, new RegExp(escapeRegExp(expectedPartialText)));
  assert.doesNotMatch(failedConversationText, /runtime-agent-turn-completed|runtime-turn-request-accepted/);
  await page.locator('[data-chat-composer-textarea="true"]').fill('follow up after failure');
  await page.waitForFunction(() =>
    document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
    && document.querySelector('[data-chat-composer-send="true"]')?.disabled === false,
  );
  await captureLiveRuntimeEvidence(page, 'chatFailed', pageProblems, {
    readyEvidence,
    failedEvidence,
  });
  await page.locator('[data-chat-composer-textarea="true"]').fill('');
}

async function assertAgentCenterHeaderParity(page, evidence) {
  await page.setViewportSize({ width: 1280, height: 900 });
  const header = page.locator('[data-zhiyu-agent-center-header="true"]').first();
  await header.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await header.locator('[data-zhiyu-agent-center-eyebrow]').innerText(), 'AGENT CENTER');
  const localAgentRef = evidence.localAgent.localAgentRef;
  assert.ok(localAgentRef, 'ready evidence must include a Runtime LocalAgent ref');
  const refLine = header.locator('[data-zhiyu-agent-center-local-agent-ref]').first();
  await refLine.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await refLine.getAttribute('title'), localAgentRef);
  assert.equal(await refLine.innerText(), localAgentRef);
  const currentAgent = evidence.inventory.localAgents.find((agent) => agent.localAgentRef === localAgentRef);
  if (currentAgent?.sourceKind === 'worldCharacter') {
    const chip = header.locator('[data-zhiyu-agent-center-world-chip]').first();
    await chip.waitFor({ state: 'visible', timeout: 15_000 });
    assert.match(await chip.innerText(), /世界|World|唐代/);
  }
}

async function closeAgentCenter(page) {
  const closeButton = page.locator('[data-zhiyu-agent-panel-close="true"]').first();
  if (await closeButton.count() === 0) {
    await page.locator('[data-zhiyu-side-panel-state="closed"]').waitFor({ state: 'attached', timeout: 15_000 });
    return;
  }
  await closeButton.click();
  await page.locator('[data-zhiyu-region="agent-panel"]').waitFor({ state: 'detached', timeout: 15_000 });
  assert.equal(
    await page.locator('[data-zhiyu-side-panel-state]').getAttribute('data-zhiyu-side-panel-state'),
    'closed',
    'Agent Center must collapse back to the closed primary chat layout',
  );
}

async function assertAppearanceConfigParity(page) {
  await page.locator('[data-zhiyu-agent-center-tab-button="overview"]').click();
  await page.locator('[data-zhiyu-agent-panel-tab="overview"]').waitFor({ timeout: 15_000 });
  await page.locator('[data-zhiyu-agent-panel-tab="overview"] [data-zhiyu-panel-row="形象"]').click();
  await page.locator('[data-zhiyu-agent-panel-tab="appearance"]').waitFor({ timeout: 15_000 });
  const panel = page.locator('[data-zhiyu-agent-appearance-panel="true"]');
  await panel.waitFor({ timeout: 15_000 });
  const layout = await page.evaluate(() => {
    const sideSheet = document.querySelector('[data-zhiyu-region="agent-panel"]');
    const tabButtons = Array.from(document.querySelectorAll('[data-zhiyu-agent-center-tab-button]'));
    const activeTab = document.querySelector('[data-zhiyu-agent-center-tab-button="appearance"]');
    const inactiveTab = document.querySelector('[data-zhiyu-agent-center-tab-button="overview"]');
    const presenceRail = document.querySelector('[data-zhiyu-region="presence"]');
    const relationshipRail = document.querySelector('[data-zhiyu-region="relationship-rail"]');
    const appearancePanel = document.querySelector('[data-zhiyu-agent-appearance-panel="true"]');
    const sideRect = sideSheet?.getBoundingClientRect();
    const activeRect = activeTab?.getBoundingClientRect();
    const inactiveRect = inactiveTab?.getBoundingClientRect();
    const presenceRect = presenceRail?.getBoundingClientRect();
    const railRect = relationshipRail?.getBoundingClientRect();
    const appearanceRect = appearancePanel?.getBoundingClientRect();
    return {
      sideWidth: sideRect?.width ?? 0,
      sideLeft: sideRect?.left ?? 0,
      sideRight: sideRect?.right ?? 0,
      presenceLeft: presenceRect?.left ?? 0,
      presenceRight: presenceRect?.right ?? 0,
      tabCount: tabButtons.length,
      activeTabAria: activeTab?.getAttribute('aria-current') ?? null,
      activeTabWidth: activeRect?.width ?? 0,
      inactiveTabWidth: inactiveRect?.width ?? 0,
      contactsRailVisible: Boolean(railRect && railRect.width > 0 && railRect.height > 0),
      contactsRailLeft: railRect?.left ?? 0,
      contactsRailRight: railRect?.right ?? 0,
      appearanceTop: appearanceRect?.top ?? 0,
      appearanceBottom: appearanceRect?.bottom ?? 0,
      viewportHeight: globalThis.innerHeight,
    };
  });
  assert.equal(layout.tabCount, 6, `Agent Center must expose the six Desktop tabs: ${JSON.stringify(layout)}`);
  assert.equal(layout.activeTabAria, 'page', `Appearance tab must be the active Desktop section: ${JSON.stringify(layout)}`);
  assert.ok(layout.activeTabWidth > layout.inactiveTabWidth, `active Appearance tab must expand beyond icon-only tabs: ${JSON.stringify(layout)}`);
  assert.ok(layout.sideWidth >= 440, `Agent Center side sheet is too narrow for Desktop parity: ${JSON.stringify(layout)}`);
  assert.equal(layout.contactsRailVisible, true, `Desktop contacts rail must remain visible with Appearance open: ${JSON.stringify(layout)}`);
  assert.ok(layout.contactsRailLeft >= layout.presenceLeft - 2 && layout.contactsRailRight <= layout.presenceRight + 2, `contacts rail must stay inside the left presence rail: ${JSON.stringify(layout)}`);
  assert.ok(layout.presenceRight <= layout.sideLeft - 2, `left contacts rail must not sit to the right of the Agent Center: ${JSON.stringify(layout)}`);
  assert.ok(layout.appearanceTop >= 0 && layout.appearanceTop < layout.viewportHeight, `Appearance panel must be visible in the viewport: ${JSON.stringify(layout)}`);

  const panelText = await panel.innerText();
  for (const label of ['Avatar 设置', '导入来源', '证据', 'Live2D 工作台', '背景', '动效', '高级诊断']) {
    assert.match(panelText, new RegExp(label), `Appearance panel must include Desktop ${label} structure`);
  }

  for (const action of ['live2d', 'vrm']) {
    const control = panel.locator(`[data-zhiyu-avatar-import-action="${action}"]`).first();
    await control.waitFor({ timeout: 15_000 });
    assert.equal(await control.getAttribute('data-zhiyu-avatar-import-state'), 'available');
    assert.equal(await control.isDisabled(), false, `${action} import control must use Zhiyu Electron local config bridge`);
  }
  for (const action of ['live2d-adapter', 'clear']) {
    const control = panel.locator(`[data-zhiyu-avatar-import-action="${action}"]`).first();
    await control.waitFor({ timeout: 15_000 });
    assert.equal(await control.getAttribute('data-zhiyu-avatar-import-state'), 'blocked');
    assert.ok(await control.getAttribute('data-zhiyu-avatar-import-reason'), `${action} blocked import control must expose a concrete reason`);
    assert.equal(await control.isDisabled(), true, `${action} import control must stay blocked until an Avatar asset is selected`);
  }

  await panel.locator('[data-zhiyu-avatar-evidence="true"]').waitFor({ timeout: 15_000 });
  assert.equal(await panel.locator('[data-zhiyu-avatar-evidence-row]').count(), 4);
  await panel.locator('[data-zhiyu-live2d-workbench="true"]').waitFor({ timeout: 15_000 });
  assert.equal(await panel.locator('[data-zhiyu-live2d-review-item]').count(), 5);
  assert.equal(await panel.locator('[data-zhiyu-live2d-review-item="adapter_manifest"]').count(), 1);
  await panel.locator('[data-zhiyu-avatar-launch-card]').waitFor({ timeout: 15_000 });
  await panel.locator('[data-zhiyu-agent-background-card="electron-local-config"]').waitFor({ timeout: 15_000 });
  assert.equal(await panel.locator('[data-zhiyu-background-import-action]').count(), 2);
  const backgroundImport = panel.locator('[data-zhiyu-background-import-action="import"]').first();
  assert.equal(await backgroundImport.getAttribute('data-zhiyu-background-import-state'), 'available');
  assert.equal(await backgroundImport.isDisabled(), false);
  const backgroundClear = panel.locator('[data-zhiyu-background-import-action="clear"]').first();
  assert.equal(await backgroundClear.getAttribute('data-zhiyu-background-import-state'), 'blocked');
  assert.ok(await backgroundClear.getAttribute('data-zhiyu-background-import-reason'), 'clear background control must expose a concrete blocked reason');
  assert.equal(await backgroundClear.isDisabled(), true);
  await panel.locator('[data-zhiyu-agent-motion-card="read-only"]').waitFor({ timeout: 15_000 });
  assert.equal(await panel.locator('[data-zhiyu-avatar-policy-row]').count(), 4);
  assert.equal(await panel.locator('[data-zhiyu-avatar-debug-shortcut]').count(), 7);
  await panel.locator('[data-zhiyu-avatar-advanced-diagnostics="deferred"]').waitFor({ timeout: 15_000 });
}

async function assertBehaviorConfigParity(page) {
  await page.locator('[data-zhiyu-agent-center-tab-button="behavior"]').click();
  await page.locator('[data-zhiyu-agent-panel-tab="behavior"]').waitFor({ timeout: 15_000 });
  const panel = page.locator('[data-zhiyu-agent-behavior-panel="true"]');
  await panel.waitFor({ timeout: 15_000 });

  const panelText = await panel.innerText();
  assert.match(panelText, /聊天行为/);
  assert.match(panelText, /行为模式/);
  assert.match(panelText, /主动沟通/);
  assert.match(panelText, /Avatar/);

  assert.equal(await panel.locator('[data-zhiyu-agent-behavior-mode-option]').count(), 4);
  assert.equal(await panel.locator('[data-zhiyu-agent-behavior-mode-option][data-zhiyu-agent-behavior-mode-selected="true"]').count(), 1);
  assert.equal(await panel.locator('[data-zhiyu-agent-behavior-control]').count(), 3);
  const disabledControls = await panel.locator('[data-zhiyu-agent-behavior-control-disabled="true"]').evaluateAll((buttons) =>
    buttons.every((button) => button instanceof HTMLButtonElement && button.disabled),
  );
  assert.equal(disabledControls, true, 'behavior controls must fail closed until a Runtime/SDK mutation surface is admitted');
  await panel.locator('[data-zhiyu-agent-behavior-service="runtime-managed"]').waitFor({ timeout: 15_000 });
}

async function assertCognitionConfigParity(page) {
  await page.locator('[data-zhiyu-agent-center-tab-button="cognition"]').click();
  await page.locator('[data-zhiyu-agent-panel-tab="cognition"]').waitFor({ timeout: 15_000 });
  const panel = page.locator('[data-zhiyu-agent-cognition-panel="true"]');
  await panel.waitFor({ timeout: 15_000 });

  const panelText = await panel.innerText();
  assert.match(panelText, /来源详情/);
  assert.match(panelText, /认知状态/);
  assert.match(panelText, /Memory/);
  await panel.locator('[data-zhiyu-agent-cognition-source="true"]').waitFor({ timeout: 15_000 });
  await panel.locator('[data-zhiyu-agent-cognition-status="true"]').waitFor({ timeout: 15_000 });
  await panel.locator('[data-zhiyu-agent-cognition-projections="true"]').waitFor({ timeout: 15_000 });
  assert.equal(await page.locator('[data-zhiyu-memory-observatory]').count(), 1);
}

async function assertAdvancedConfigParity(page) {
  await page.locator('[data-zhiyu-agent-center-tab-button="advanced"]').click();
  await page.locator('[data-zhiyu-agent-panel-tab="advanced"]').waitFor({ timeout: 15_000 });
  const panel = page.locator('[data-zhiyu-agent-advanced-panel="true"]');
  await panel.waitFor({ timeout: 15_000 });

  const panelText = await panel.innerText();
  assert.match(panelText, /诊断/);
  assert.match(panelText, /Runtime|SDK/);
  await panel.locator('[data-zhiyu-agent-advanced-warning="true"]').waitFor({ timeout: 15_000 });
  await panel.locator('[data-zhiyu-agent-advanced-technical-surfaces="true"]').waitFor({ timeout: 15_000 });
  await panel.locator('[data-zhiyu-diagnostic-mode]').waitFor({ timeout: 15_000 });
}

async function assertAgentCenterKeyboardAccessibility(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  const tabs = [
    ['overview', '概览', '[data-zhiyu-memory-observatory]'],
    ['appearance', '外观', '[data-zhiyu-agent-appearance-panel="true"]'],
    ['model', '模型', '[data-zhiyu-agent-panel-tab="model"]'],
    ['cognition', '认知', '[data-zhiyu-agent-cognition-panel="true"]'],
  ];

  for (const [tab, name, targetSelector] of tabs) {
    const button = page.locator(`[data-zhiyu-agent-center-tab-button="${tab}"]`).first();
    await button.waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal((await button.innerText()).includes(name), true, `${name} tab must have readable accessible name source`);
    await button.focus();
    assert.equal(
      await button.evaluate((element) => element === globalThis.document.activeElement),
      true,
      `${name} tab must be keyboard focusable`,
    );
    await page.keyboard.press('Enter');
    await page.locator(targetSelector).first().waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal(
      await button.getAttribute('aria-current'),
      'page',
      `${name} tab must expose active page semantics after keyboard activation`,
    );
  }

  const composer = page.getByRole('textbox', { name: /和这个伙伴聊点什么/ }).first();
  await composer.waitFor({ state: 'visible', timeout: 15_000 });
  await composer.focus();
  assert.equal(
    await composer.evaluate((element) => element === globalThis.document.activeElement),
    true,
    'composer textarea must be keyboard focusable by accessible textbox role/name',
  );
  assert.equal(await composer.isEditable(), true);

  const sendButton = page.getByRole('button', { name: /Send|发送/ }).first();
  await sendButton.waitFor({ state: 'visible', timeout: 15_000 });
  await composer.fill('键盘可达性检查');
  await page.waitForFunction(() => document.querySelector('[data-chat-composer-send="true"]')?.disabled === false);
  await sendButton.focus();
  assert.equal(
    await sendButton.evaluate((element) => element === globalThis.document.activeElement),
    true,
    'send button must be keyboard focusable by accessible button role/name',
  );
  await composer.fill('');

  const voiceCapture = page.getByRole('button', { name: '语音输入暂未接入' }).first();
  await voiceCapture.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await voiceCapture.isDisabled(), true);
  const handsFree = page.getByRole('button', { name: '语音模式暂未接入' }).first();
  await handsFree.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await handsFree.isDisabled(), true);

  await page.locator('[data-zhiyu-agent-center-tab-button="overview"]').click();
  await page.locator('[data-zhiyu-memory-observatory]').waitFor({ timeout: 15_000 });
}

async function assertDesktopShellTopbarParity(page, pageProblems) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const viewport = page.viewportSize();
  assert.ok(viewport, 'viewport must be available for topbar clipping checks');
  assert.equal(await page.locator('[data-zhiyu-topbar-chrome="true"]').count(), 0, 'Zhiyu must not render migrated Desktop topbar chrome');
  assert.equal(await page.locator('[data-zhiyu-topbar-notifications="true"]').count(), 0, 'Zhiyu must not render the removed notification chrome');
  assert.equal(await page.locator('[data-zhiyu-topbar-account="true"]').count(), 0, 'Zhiyu must not render the removed account chrome');
  assert.equal(await page.locator('[data-zhiyu-primary-action]').count(), 0, 'Zhiyu must not render the removed add-partner action chrome');
  const railSettings = page.locator('[data-zhiyu-settings-entry="presence-rail"]').first();
  await railSettings.waitFor({ state: 'visible', timeout: 15_000 });
  await assertControlInsideViewport(railSettings, viewport, 'Desktop rail settings action');
  await railSettings.click();
  await page.locator('[data-zhiyu-agent-panel-mode="agent"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('[data-zhiyu-agent-center-tab-button="advanced"][aria-current="page"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('[data-zhiyu-agent-panel-tab="advanced"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('[data-zhiyu-agent-center-capability-probe="open"]').waitFor({ state: 'visible', timeout: 15_000 });
  await assertOpenAgentPanelChatTrackCentering(page);
  assert.equal(
    await page.locator('[data-zhiyu-settings-panel="right"]').count(),
    0,
    'Desktop rail settings action must route to the merged Agent Center advanced tab, not a second settings panel',
  );
  await captureLiveRuntimeInteractionEvidence(page, 'rail-settings-advanced', pageProblems, {
    route: 'presence-rail-settings',
  });
  await page.locator('[data-zhiyu-agent-center-tab-button="overview"]').click();
  await page.locator('[data-zhiyu-memory-observatory]').waitFor({ timeout: 15_000 });
  await page.locator('[data-zhiyu-composer-tool="agent"]').click();
  await page.locator('[data-zhiyu-agent-center-tab-button="overview"]').click();
  await page.locator('[data-zhiyu-memory-observatory]').waitFor({ timeout: 15_000 });
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function assertControlInsideViewport(locator, viewport, label) {
  const box = await locator.boundingBox();
  assert.ok(box, `${label} must have a rendered bounding box`);
  assert.ok(box.x >= 0, `${label} is clipped on the left: ${JSON.stringify(box)}`);
  assert.ok(box.y >= 0, `${label} is clipped on the top: ${JSON.stringify(box)}`);
  assert.ok(box.x + box.width <= viewport.width, `${label} is clipped on the right: ${JSON.stringify({ box, viewport })}`);
  assert.ok(box.y + box.height <= viewport.height, `${label} is clipped on the bottom: ${JSON.stringify({ box, viewport })}`);
}

async function assertOpenAgentPanelChatTrackCentering(page) {
  const conversation = await page.locator('[data-zhiyu-region="conversation"]').first().boundingBox();
  const composer = await page.locator('[data-zhiyu-region="conversation"] [data-canonical-composer-width]').first().boundingBox();
  const transcript = await page.locator('[data-zhiyu-region="conversation"] [data-canonical-transcript-width]').first().boundingBox();
  assert.ok(conversation, 'open Agent Center conversation track must be visible');
  assert.ok(composer, 'open Agent Center composer width track must be visible');
  assert.ok(transcript, 'open Agent Center transcript width track must be visible');

  const conversationCenter = conversation.x + conversation.width / 2;
  for (const [label, box] of [
    ['composer', composer],
    ['transcript', transcript],
  ]) {
    const delta = Math.abs((box.x + box.width / 2) - conversationCenter);
    assert.ok(
      delta <= 32,
      `open Agent Center ${label} is not centered in the conversation track: ${JSON.stringify({ delta, box, conversation })}`,
    );
  }
}

async function assertLongTextNarrowChineseAndControls(page) {
  await page.setViewportSize({ width: 390, height: 900 });
  const shell = page.locator('[data-zhiyu-product-shell="workspace"]');
  await shell.waitFor({ timeout: 15_000 });
  const shellText = await shell.innerText();
  assert.match(shellText, /开始一段对话|当前伙伴|选择本地伙伴/);
  assert.match(shellText, /模型|本地对话模型已绑定/);
  assert.doesNotMatch(shellText, /文字能力|图片创作|本地伙伴工作台/);
  assert.doesNotMatch(shellText, /缁囩窘|缂佸洨|绐|�/);

  const longChineseText = '这是一段用于窄屏验收的长中文输入，包含连续描述、标点和产品语义，目标是确认输入框不会溢出，按钮仍可点击，布局不会互相遮挡。'.repeat(2);
  await page.locator('[data-chat-composer-textarea="true"]').fill(longChineseText);

  assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'true');

  const controls = [
    page.locator('[data-zhiyu-composer-tool="model"]'),
    page.locator('[data-chat-composer-send="true"]'),
    page.locator('[data-zhiyu-settings-entry="presence-rail"]'),
  ];
  for (const control of controls) {
    const box = await control.first().boundingBox();
    assert.ok(box && box.width >= 34 && box.height >= 30, `control is not usable on narrow viewport: ${JSON.stringify(box)}`);
  }

  const horizontalOverflow = await page.evaluate(() =>
    globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth,
  );
  assert.ok(horizontalOverflow <= 2, `narrow layout overflows horizontally by ${horizontalOverflow}px`);
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function runCapabilityStudio(page, pageProblems, input) {
  const prompt = page.locator('textarea[aria-label="文字能力输入"]');
  await prompt.fill(input.prompt);
  const action = page.locator(`[data-zhiyu-capability-studio-run="${input.capabilityId}"]`);
  assert.equal(await action.isDisabled(), false);
  await action.click();
  await waitForEvidence(page, input.predicate, input.label);
  const evidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  await captureLiveRuntimeEvidence(page, input.stage, pageProblems, {
    capabilityStudioEvidence: evidence,
  });
  return evidence;
}
