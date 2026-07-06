import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { _electron as electron } from 'playwright';
import {
  VoiceOutputMode,
  VoicePlaybackState,
} from '../../../sdks/typescript/core-generated/runtime-typed-client.ts';
import {
  assertAvatarLaunchLiveHandoff,
  avatarAppId,
  avatarRuntimeProtectedScopes,
  importLiveRuntimeAvatarFixtureAsset,
  seedLiveRuntimeAvatarPresentationProfile,
  waitForAvatarNativeVoiceChunkPlaybackEvidence,
} from './electron-live-runtime-avatar-launch-helpers.mjs';
import {
  assertPreConfigRuntimeEvidence,
} from './electron-live-runtime-delegation-helpers.mjs';
import {
  assertAdvancedConfigParity,
  assertAgentCenterHeaderParity,
  assertAgentCenterKeyboardAccessibility,
  assertAppearanceConfigParity,
  assertBehaviorConfigParity,
  assertCognitionConfigParity,
  assertDesktopShellTopbarParity,
  assertLongTextNarrowChineseAndControls,
  closeAgentCenter,
} from './electron-live-runtime-agent-center-helpers.mjs';
import { withRuntimeAgentLiveE2EFixture } from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture.test-helper.ts';
import {
  createFixtureRuntimeAgentClient,
  createRuntimeForEndpoint,
} from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-runtime.test-helper.ts';
import { createNimiRuntimeAppSessionMetadataProvider } from '../../../sdks/typescript/runtime/app-session.ts';
import { createNimiRuntimeAgentClient } from '../../../sdks/typescript/runtime/runtime-agent-client.ts';
import { withNimiRuntimeAgentScopes } from '../../../sdks/typescript/runtime/runtime-agent-protected.ts';
import { createNimiRuntimeAgentVoiceModule } from '../../../sdks/typescript/runtime/runtime-agent-voice.ts';
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
  captureLiveRuntimeEvidence,
  escapeRegExp,
  resetAcceptanceInputs,
  resetLiveRuntimeEvidenceRoot,
  trackPageProblems,
} from './electron-live-runtime-acceptance-helpers.mjs';

const root = path.resolve(import.meta.dirname, '..');
const mainEntry = path.join(root, 'dist-electron', 'main.js');
const desktopAppId = 'nimi.desktop';
const zhiyuAppId = 'nimi.zhiyu';
const zhiyuRuntimeVoiceObserverAppId = desktopAppId;
const zhiyuRuntimeVoiceObserverAppInstanceId = `${zhiyuRuntimeVoiceObserverAppId}.live-runtime-voice-observer`;
const zhiyuRuntimeProtectedScopes = [
  'runtime.agent.read',
  'runtime.agent.write',
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
  'runtime.agent.delegation.read',
  'runtime.agent.delegation.write',
  'runtime.agent.execution_config.read',
  'runtime.agent.execution_config.write',
  'ai.spend.meter',
];

test('zhiyu Electron live Runtime path consumes SDK fixture and streams a Runtime Agent chat turn', { timeout: 180_000 }, async () => {
  await resetLiveRuntimeEvidenceRoot();

  await withRuntimeAgentLiveE2EFixture({
    localChatCompletionStreamDelayMs: 4_000,
    voiceSpeechStreamDelayMs: 3_000,
    run: async (fixture) => {
      await fixture.admitLocalFirstPartyRuntimeAccountCaller({
        appId: zhiyuAppId,
        appInstanceId: `${zhiyuAppId}.local-first-party`,
        deviceId: 'nimi-zhiyu-local-first-party-device',
        capabilities: zhiyuRuntimeProtectedScopes,
      });
      await fixture.admitLocalFirstPartyRuntimeAccountCaller({
        appId: zhiyuRuntimeVoiceObserverAppId,
        appInstanceId: zhiyuRuntimeVoiceObserverAppInstanceId,
        deviceId: 'nimi-zhiyu-live-runtime-voice-observer-device',
        capabilities: zhiyuRuntimeProtectedScopes,
      });
      await fixture.admitLocalFirstPartyRuntimeAccountCaller({
        appId: avatarAppId,
        appInstanceId: `${avatarAppId}.local-first-party`,
        deviceId: 'nimi-avatar-local-first-party-device',
        capabilities: avatarRuntimeProtectedScopes,
      });
      await seedLiveRuntimeAvatarPresentationProfile(fixture);
      // Node-side view of the runtime-owned execution config: used to drive
      // an honest external config mutation (second admitted writer) for the
      // unavailable-readiness stage. Never used to fake Zhiyu UI state.
      const runtimeExecutionConfig = createFixtureRuntimeAgentClient(fixture.runtime).executionConfig;

      await withTempDir('live-runtime', async (tmpRoot) => {
        const dataRoot = path.join(tmpRoot, 'data');
        await mkdir(dataRoot, { recursive: true });

        const app = await launchLiveRuntimeZhiyuApp({ fixture, dataRoot });
        let appClosed = false;
        let avatarLaunchEvidence = null;

        try {
          const page = await app.firstWindow({ timeout: 60_000 });
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
            && globalThis.window.__nimiZhiyuEvidence?.memory?.ready === true
            && globalThis.window.__nimiZhiyuEvidence?.delegation?.ready === true
            && globalThis.window.__nimiZhiyuEvidence?.delegation?.reasonCode === 'runtime-delegation-control-surface-ready'
            && globalThis.window.__nimiZhiyuEvidence?.route?.reasonCode === 'runtime-execution-config-ready'
            && globalThis.window.__nimiZhiyuEvidence?.turn?.ready === true,
            'pre-config runtime evidence',
          );

          const {
            preConfigEvidence,
            preConfigScopedBinding,
            renewedScopedBinding,
          } = await assertPreConfigRuntimeEvidence(page, fixture, zhiyuAppId);
          const seededConfigRevision = preConfigEvidence.route.configRevision;
          assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'false');
          await assertPartnerSelectedProductState(page);
          // K-AGCORE-150: the runtime seeds text.generate=local/default, so a
          // fresh daemon is send-ready before any Zhiyu model configuration.
          await page.locator('[data-chat-composer-textarea="true"]').fill('先确认种子默认配置可以直接发送。');
          await waitForEvidence(page, () =>
            document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
            && document.querySelector('[data-chat-composer-textarea="true"]')?.value.length > 0,
            'seeded default config send-ready composer',
          );
          await captureLiveRuntimeEvidence(page, 'partnerSelected', pageProblems, {
            preConfigEvidence,
            preConfigScopedBinding,
            renewedScopedBinding,
          });
          await resetAcceptanceInputs(page);
          await assertSeededDefaultConfigProductState(page, preConfigEvidence);

          await page.locator('[data-zhiyu-composer-tool="model"]').click();
          await page.waitForSelector('[data-zhiyu-agent-panel-tab="model"]');
          const modelConfig = page.locator('[data-zhiyu-ai-config-embedded="agent-center"]');
          await modelConfig.waitFor({ timeout: 15_000 });
          assert.equal(await page.locator('[data-zhiyu-ai-config-drawer="open"]').count(), 0);
          await assertModelConfigEmbeddedProductQuality(page);
          const seededDefaultConfigEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          await captureLiveRuntimeEvidence(page, 'seededDefaultConfig', pageProblems, {
            seededDefaultConfigEvidence,
          });
          // Model tab commits text.generate / image.generate through
          // runtime.agent.executionConfig.upsert; wait for the committed
          // banner (revision advance) after each managed pick.
          await modelConfig
            .locator('button')
            .filter({ hasText: /Setup required|Select a model|选择.*模型|需要模型目标|未配置/i })
            .first()
            .click();
          const picker = page.locator('[role="dialog"]').filter({ hasText: 'Select Model' }).last();
          await picker.waitFor();
          await picker.getByRole('button', { name: /runtime-agent-live-e2e/i }).first().click();
          await picker.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
          const textCommitRevision = await waitForExecutionCommitCommitted(page, seededConfigRevision);
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
            connectorId: fixture.imageRoute.executionBinding.connectorId,
          });
          const imageCommitRevision = await waitForExecutionCommitCommitted(page, textCommitRevision);
          const imageCommittedConfig = await runtimeExecutionConfig.get();
          assert.equal(imageCommittedConfig.revision, imageCommitRevision);
          const voiceCommittedConfig = await runtimeExecutionConfig.upsert({
            expectedRevision: imageCommittedConfig.revision,
            bindings: {
              ...imageCommittedConfig.bindings,
              'audio.synthesize': {
                route: 'cloud',
                modelId: fixture.voiceRoute.executionBinding.modelId,
                ...(fixture.voiceRoute.executionBinding.connectorId
                  ? { connectorId: fixture.voiceRoute.executionBinding.connectorId }
                  : {}),
                targetRef: fixture.voiceRoute.targetRef,
              },
            },
          });
          const voiceCommitRevision = voiceCommittedConfig.revision;
          await waitForEvidence(page, ({ voiceCommitRevision }) =>
            globalThis.window.__nimiZhiyuEvidence?.route?.reasonCode === 'runtime-execution-config-ready'
            && globalThis.window.__nimiZhiyuEvidence?.route?.configRevision === voiceCommitRevision
            && /runtime-agent-live-e2e/.test(globalThis.window.__nimiZhiyuEvidence?.route?.executionBinding?.modelId || '')
            && globalThis.window.__nimiZhiyuEvidence?.route?.capabilities?.['image.generate']?.state !== 'not_configured'
            && globalThis.window.__nimiZhiyuEvidence?.route?.capabilities?.['image.generate']?.binding?.route === 'cloud'
            && globalThis.window.__nimiZhiyuEvidence?.route?.capabilities?.['audio.synthesize']?.state !== 'not_configured'
            && globalThis.window.__nimiZhiyuEvidence?.route?.capabilities?.['audio.synthesize']?.binding?.route === 'cloud',
            'route ready after execution config commits',
            { voiceCommitRevision },
          );
          const modelConfiguredEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          assert.equal(modelConfiguredEvidence.route.configRevision, voiceCommitRevision);
          assert.equal(modelConfiguredEvidence.route.updatedByAppId, desktopAppId);
          await assertModelConfiguredProductState(page);
          await captureLiveRuntimeEvidence(page, 'modelConfigured', pageProblems, {
            modelConfiguredEvidence,
          });
          await page.locator('[data-zhiyu-agent-center-tab-button="overview"]').click();
          await page.locator('[data-zhiyu-memory-observatory]').waitFor({ timeout: 15_000 });

          let readyEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          assert.equal(readyEvidence.route.ready, true);
          assert.equal(readyEvidence.route.reasonCode, 'runtime-execution-config-ready');
          assert.equal(readyEvidence.route.capability, 'text.generate');
          assert.equal(readyEvidence.route.configRevision, voiceCommitRevision);
          assert.equal(readyEvidence.route.readinessRevision, voiceCommitRevision);
          assert.equal(readyEvidence.route.updatedByAppId, desktopAppId);
          assert.deepEqual(
            Object.keys(readyEvidence.route.capabilities).sort(),
            ['audio.synthesize', 'image.generate', 'text.generate'],
            'runtime execution readiness projects exactly the admitted capabilities',
          );
          assert.equal(readyEvidence.route.capabilities['text.generate'].state, 'ready');
          assert.equal(readyEvidence.route.capabilities['text.generate'].binding.route, 'local');
          assert.match(readyEvidence.route.capabilities['text.generate'].binding.modelId, /runtime-agent-live-e2e/);
          assert.notEqual(readyEvidence.route.capabilities['image.generate'].state, 'not_configured');
          assert.equal(readyEvidence.route.capabilities['image.generate'].binding.route, 'cloud');
          assert.match(readyEvidence.route.capabilities['image.generate'].binding.modelId, /gpt-image/);
          assert.ok(readyEvidence.route.capabilities['image.generate'].binding.connectorId, 'committed image binding must carry its cloud connector');
          assert.notEqual(readyEvidence.route.capabilities['audio.synthesize'].state, 'not_configured');
          assert.equal(readyEvidence.route.capabilities['audio.synthesize'].binding.route, 'cloud');
          assert.equal(readyEvidence.route.capabilities['audio.synthesize'].binding.modelId, fixture.voiceRoute.executionBinding.modelId);
          assert.ok(readyEvidence.route.capabilities['audio.synthesize'].binding.connectorId, 'committed voice binding must carry its cloud connector');
          assert.equal(readyEvidence.route.executionBinding.route, 'local');
          assert.match(readyEvidence.route.executionBinding.modelId, /runtime-agent-live-e2e/);
          assert.equal(await page.locator('[data-zhiyu-product-stage]').getAttribute('data-zhiyu-product-stage'), 'ready');
          assert.equal(await page.locator('[data-zhiyu-readiness-score]').getAttribute('data-zhiyu-readiness-score'), '8/8');
          await page.waitForFunction(() =>
            document.querySelector('[data-zhiyu-memory-observatory]')?.getAttribute('data-zhiyu-memory-ready') === 'true',
            undefined,
            { timeout: 15_000 },
          );
          assert.equal(
            await page.locator('[data-zhiyu-memory-observatory]').getAttribute('data-zhiyu-memory-ready'),
            'true',
            'memory observatory DOM projection must reach ready before route-ready acceptance continues',
          );
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
          const importedAvatarAsset = await importLiveRuntimeAvatarFixtureAsset(page, readyEvidence);
          await assertAgentCenterHeaderParity(page, readyEvidence);
          await assertAppearanceConfigParity(page, importedAvatarAsset);
          await captureLiveRuntimeEvidence(page, 'appearanceConfig', pageProblems, {
            readyEvidence,
            importedAvatarAsset,
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
          avatarLaunchEvidence = await assertAvatarLaunchLiveHandoff(
            page,
            fixture,
            dataRoot,
            pageProblems,
            readyEvidence,
            importedAvatarAsset,
            { keepRunning: true },
          );
          readyEvidence = await assertRouteUnavailableFlow(page, pageProblems, readyEvidence, runtimeExecutionConfig);

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
          await waitForEvidence(page, () => {
            const evidence = globalThis.window.__nimiZhiyuEvidence;
            const companion = evidence?.companion ?? {};
            const projectedFields = companion.projectedFields ?? [];
            const projectionEvents = evidence?.chat?.diagnostics?.runtimeProjectionEvents ?? [];
            const nativeChunks = projectionEvents.filter((event) =>
              event?.eventName === 'runtime.agent.presentation.voice_stream_chunk_available'
              && event?.detail?.voiceOutputMode === 'native_stream'
              && event?.detail?.voicePlaybackState === 'active'
              && event?.detail?.playbackTarget === 'avatar_autoplay'
              && event?.detail?.finalChunk === false
              && Boolean(event?.detail?.voiceStreamId || event?.detail?.voice_stream_id)
              && Boolean(event?.detail?.chunkTransportRef || event?.detail?.chunk_transport_ref)
              && !Boolean(event?.detail?.audioArtifactId || event?.detail?.audio_artifact_id)
            );
            const voiceStreamId = nativeChunks[0]?.detail?.voiceStreamId || nativeChunks[0]?.detail?.voice_stream_id || '';
            return companion.voiceOutputMode === 'native_stream'
              && companion.voicePlaybackState === 'completed'
              && companion.voiceStreamId === voiceStreamId
              && Boolean(companion.voiceAudioArtifactId)
              && companion.voiceAudioMimeType === 'audio/wav'
              && companion.voicePlaybackTarget === 'avatar_autoplay'
              && projectedFields.includes('voiceStreamChunk')
              && projectedFields.includes('voicePlayback')
              && projectedFields.includes('voicePlaybackTerminal')
              && projectedFields.includes('voiceStreamId')
              && nativeChunks.length > 0
              && projectionEvents.some((event) =>
                event?.eventName === 'runtime.agent.presentation.voice_playback_requested'
                && event?.detail?.voiceOutputMode === 'native_stream'
                && event?.detail?.voicePlaybackState === 'active'
                && event?.detail?.finalArtifact === true
                && event?.detail?.voiceStreamId === voiceStreamId
              )
              && projectionEvents.some((event) =>
                event?.eventName === 'runtime.agent.presentation.voice_playback_terminal'
                && event?.detail?.voiceOutputMode === 'native_stream'
                && event?.detail?.voicePlaybackState === 'completed'
                && event?.detail?.terminalReason === 'native_stream_completed'
                && event?.detail?.voiceStreamId === voiceStreamId
                && Boolean(event?.detail?.finalArtifactId || event?.detail?.final_artifact_id)
              );
          }, 'native Runtime voice projection');
          const voiceProjectedEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          const voiceProjectionEvents = voiceProjectedEvidence.chat.diagnostics.runtimeProjectionEvents;
          const voiceChunkEvents = voiceProjectionEvents.filter((event) =>
            event?.eventName === 'runtime.agent.presentation.voice_stream_chunk_available'
            && event?.detail?.voiceOutputMode === 'native_stream'
            && event?.detail?.finalChunk === false
          );
          assert.equal(voiceChunkEvents.length > 0, true, 'native voice stream must project at least one non-final chunk');
          const voiceStreamId = voiceChunkEvents[0]?.detail?.voiceStreamId || voiceChunkEvents[0]?.detail?.voice_stream_id;
          assert.ok(voiceStreamId, 'native voice chunk must carry voice_stream_id');
          for (const event of voiceChunkEvents) {
            assert.equal(event?.detail?.voiceStreamId || event?.detail?.voice_stream_id, voiceStreamId);
            assert.equal(event?.detail?.audioArtifactId || event?.detail?.audio_artifact_id || null, null);
            assert.match(
              String(event?.detail?.chunkTransportRef || event?.detail?.chunk_transport_ref || ''),
              new RegExp(escapeRegExp(String(voiceStreamId))),
              'native non-final chunks must point at transient stream transport, not durable chunk artifacts',
            );
          }
          assert.match(fixture.voiceAsset.voiceAssetId, /^[0-9A-HJKMNP-TV-Z]{26}$/u);
          assert.equal(fixture.voiceAsset.defaultVoiceReference, `voice_asset_id:${fixture.voiceAsset.voiceAssetId}`);
          const voicePlaybackEvent = voiceProjectedEvidence.chat.diagnostics.runtimeProjectionEvents.find((event) =>
            event?.eventName === 'runtime.agent.presentation.voice_playback_requested'
            && event?.detail?.voiceOutputMode === 'native_stream'
          );
          const voiceTerminalEvent = voiceProjectedEvidence.chat.diagnostics.runtimeProjectionEvents.find((event) =>
            event?.eventName === 'runtime.agent.presentation.voice_playback_terminal'
            && event?.detail?.voiceOutputMode === 'native_stream'
          );
          assert.ok(voicePlaybackEvent, 'native voice must project final playback request');
          assert.ok(voiceTerminalEvent, 'native voice must project terminal playback truth');
          assert.equal(voicePlaybackEvent?.detail?.voiceStreamId, voiceStreamId);
          assert.equal(voiceTerminalEvent?.detail?.voiceStreamId, voiceStreamId);
          assert.equal(voiceTerminalEvent?.detail?.voicePlaybackState, 'completed');
          assert.equal(voiceTerminalEvent?.detail?.terminalReason, 'native_stream_completed');
          assert.equal(voicePlaybackEvent?.detail?.voiceRouteBinding?.defaultVoiceReference, fixture.voiceAsset.defaultVoiceReference);
          assert.equal(voicePlaybackEvent?.detail?.voiceRouteBinding?.voiceReferenceKind, 'voice_asset_id');
          assert.equal(voicePlaybackEvent?.detail?.voiceRouteBinding?.voiceReferenceValue, fixture.voiceAsset.voiceAssetId);
          assert.notEqual(voicePlaybackEvent?.detail?.voiceRouteBinding?.voiceReferenceValue, fixture.voiceAsset.providerVoiceRef);
          const finalVoiceArtifactId = String(
            voiceTerminalEvent?.detail?.finalArtifactId
              || voiceTerminalEvent?.detail?.final_artifact_id
              || voicePlaybackEvent?.detail?.audioArtifactId
              || '',
          );
          assert.equal(finalVoiceArtifactId.length > 0, true, 'native voice terminal must carry final replay artifact id');
          const finalVoiceArtifact = await readLiveRuntimeFixtureArtifactBytes(fixture, finalVoiceArtifactId);
          assert.match(finalVoiceArtifact.mimeType, /^audio\//);
          assert.equal((finalVoiceArtifact.bytes?.byteLength ?? 0) > 0, true, 'final voice replay artifact must have readable audio bytes');
          assert.ok(avatarLaunchEvidence?.resolvedAvatarBinding?.avatarInstanceId, 'Avatar must be running before native voice playback is accepted');
          const avatarNativeVoicePlaybackEvidence = await waitForAvatarNativeVoiceChunkPlaybackEvidence({
            dataRoot,
            avatarInstanceId: avatarLaunchEvidence.resolvedAvatarBinding.avatarInstanceId,
            voiceStreamId,
          });
          assert.equal(avatarNativeVoicePlaybackEvidence.detail?.voice_stream_id, voiceStreamId);
          assert.equal(avatarNativeVoicePlaybackEvidence.detail?.playback_state, 'completed');
          assert.equal(Number(avatarNativeVoicePlaybackEvidence.detail?.byte_length ?? 0) > 0, true);
          const voiceTool = page.locator('[data-zhiyu-composer-tool="hands-free"]').first();
          await voiceTool.waitFor({ state: 'visible', timeout: 15_000 });
          assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-output-mode'), 'native_stream');
          assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-playback-state'), 'completed');
          assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-stream-id'), voiceStreamId);
          assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-playback-target'), 'avatar_autoplay');
          assert.notEqual(await voiceTool.getAttribute('data-zhiyu-chat-voice-state'), 'deferred');
          assert.equal(await voiceTool.isDisabled(), true, 'voice projection must not become a fake local playback control');
          const speechRequests = fixture.realmRequests.filter((request) => request.path === '/v1/audio/speech');
          assert.equal(
            speechRequests.some((request) =>
              request?.body?.stream === true
              && request?.body?.model === fixture.voiceRoute.executionBinding.modelId
              && request?.body?.voice === 'runtime-live-voice'
            ),
            true,
            'native voice fixture must be invoked through audio.synthesize stream=true',
          );
          // K-AGCORE-147: the turn request carries no execution bindings and
          // the completed turn must not move the committed config revision.
          // (Zhiyu chat evidence does not re-project the session snapshot's
          // config_revision, so config truth is asserted via the route
          // projection consistency instead of new app code.)
          assert.equal(chatCompletedEvidence.route.reasonCode, 'runtime-execution-config-ready');
          assert.equal(chatCompletedEvidence.route.configRevision, readyEvidence.route.configRevision);
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
            voiceProjectedEvidence,
            voiceRoute: fixture.voiceRoute,
            finalVoiceArtifact: {
              artifactId: finalVoiceArtifactId,
              mimeType: finalVoiceArtifact.mimeType,
              byteLength: finalVoiceArtifact.bytes?.byteLength ?? 0,
            },
            avatarNativeVoicePlaybackEvidence,
          });
          const firstRequestId = chatCompletedEvidence.chat.requestId;
          const firstOutputText = chatCompletedEvidence.chat.outputText;

          await assertMidStreamFailureFlow(page, pageProblems, readyEvidence);
          await assertRuntimeNativeVoiceInterruptFlow(page, pageProblems, fixture, readyEvidence);

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
            && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('beat-delivered')
            && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) =>
              message?.kind === 'image'
              && message?.metadata?.artifactProjection === 'runtime.agent.turn.artifact_ready'
              && String(message?.metadata?.mediaUrl || '').startsWith('data:image/')),
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
          assert.equal(await actionArtifactSummary.getAttribute('data-zhiyu-runtime-action-artifact-preview'), 'rendered');
          assert.equal(
            await actionArtifactSummary.getAttribute('data-zhiyu-runtime-action-artifact-preview-reason'),
            'runtime-agent-turn-artifact-ready-image-rendered',
          );
          assert.equal(await actionArtifactSummary.locator('[data-zhiyu-runtime-action-artifact-event="beat-planned"]').count(), 1);
          assert.equal(await actionArtifactSummary.locator('[data-zhiyu-runtime-action-artifact-event="artifact-ready"]').count(), 1);
          assert.equal(await actionArtifactSummary.locator('[data-zhiyu-runtime-action-artifact-id]').count(), 1);
          assert.match(
            await actionArtifactSummary.locator('[data-zhiyu-runtime-action-artifact-mime]').first().getAttribute('data-zhiyu-runtime-action-artifact-mime'),
            /^image\//,
          );
          const actionArtifactImageMessage = actionArtifactEvidence.chat.messages.find((message) =>
            message?.kind === 'image'
            && message?.metadata?.artifactProjection === 'runtime.agent.turn.artifact_ready'
          );
          assert.ok(actionArtifactImageMessage, 'Runtime artifact_ready must project a canonical image message');
          assert.match(String(actionArtifactImageMessage.metadata?.mediaUrl || ''), /^data:image\//);
          const renderedArtifactImage = page.locator('[data-zhiyu-region="conversation"] img[src^="data:image/"]').last();
          await renderedArtifactImage.waitFor({ timeout: 15_000 });
          assert.match(await renderedArtifactImage.getAttribute('src'), /^data:image\//);
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

          assert.ok(avatarLaunchEvidence, 'Avatar launch handoff must be captured before native voice acceptance');
          await avatarLaunchEvidence.closeAvatarProcess();

          await app.close();
          appClosed = true;

          const relaunchedApp = await launchLiveRuntimeZhiyuApp({ fixture, dataRoot });
          try {
            const relaunchedPage = await relaunchedApp.firstWindow({ timeout: 60_000 });
            const relaunchProblems = trackPageProblems(relaunchedPage);
            await relaunchedPage.waitForLoadState('domcontentloaded');
            await relaunchedPage.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
            await relaunchedPage.waitForSelector('[data-zhiyu-screen="home"]');
            await relaunchedPage.addInitScript(createZhiyuLiveRuntimeFixtureAcceptanceInitScript(fixture));
            await relaunchedPage.reload({ waitUntil: 'domcontentloaded' });
            await relaunchedPage.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
            await relaunchedPage.waitForSelector('[data-zhiyu-screen="home"]');
            await waitForEvidence(relaunchedPage, ({ conversationAnchorId, firstOutputText, secondPrompt, configRevision }) =>
              globalThis.window.__nimiZhiyuEvidence?.conversation?.conversationAnchorId === conversationAnchorId
              && globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode === 'runtime-agent-session-snapshot-hydrated'
              && globalThis.window.__nimiZhiyuEvidence?.chat?.conversationAnchorId === conversationAnchorId
              && globalThis.window.__nimiZhiyuEvidence?.chat?.messageCount >= 4
              && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('session-snapshot-hydrated')
              && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) => message?.text === firstOutputText)
              && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) => message?.text === secondPrompt)
              && globalThis.window.__nimiZhiyuEvidence?.route?.reasonCode === 'runtime-execution-config-ready'
              && globalThis.window.__nimiZhiyuEvidence?.route?.configRevision === configRevision
              && /runtime-agent-live-e2e/.test(globalThis.window.__nimiZhiyuEvidence?.route?.executionBinding?.modelId || '')
              && globalThis.window.__nimiZhiyuEvidence?.route?.capabilities?.['image.generate']?.binding?.route === 'cloud'
              && globalThis.window.__nimiZhiyuEvidence?.route?.capabilities?.['audio.synthesize']?.binding?.route === 'cloud'
              && globalThis.window.__nimiZhiyuEvidence?.delegation?.ready === true
              && globalThis.window.__nimiZhiyuEvidence?.delegation?.reasonCode === 'runtime-delegation-control-surface-ready',
              'restart hydrated Runtime Agent chat snapshot and route',
              {
                conversationAnchorId: readyEvidence.conversation.conversationAnchorId,
                firstOutputText,
                secondPrompt,
                configRevision: readyEvidence.route.configRevision,
              },
            );
            const restartHydratedEvidence = await relaunchedPage.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
            const restartScopedBinding = await relaunchedPage.evaluate(() =>
              globalThis.window.__nimiZhiyuRuntimeAgentBinding?.getScopedBinding?.()
                ?? globalThis.window.__nimiZhiyuRuntimeAgentBinding?.scopedBinding
                ?? null,
            );
            assert.equal(restartHydratedEvidence.conversation.conversationAnchorId, readyEvidence.conversation.conversationAnchorId);
            assert.equal(restartHydratedEvidence.chat.source, 'runtime');
            assert.equal(restartHydratedEvidence.chat.state, 'completed');
            assert.equal(restartHydratedEvidence.chat.ready, true);
            assert.equal(restartHydratedEvidence.chat.messages.some((message) => message?.text === firstOutputText), true);
            assert.equal(restartHydratedEvidence.chat.messages.some((message) => message?.text === secondPrompt), true);
            assert.equal(restartHydratedEvidence.route.reasonCode, 'runtime-execution-config-ready');
            // The committed execution config is daemon-owned truth: an app
            // restart must re-project the same committed revision + bindings.
            assert.equal(restartHydratedEvidence.route.configRevision, readyEvidence.route.configRevision);
            assert.equal(restartHydratedEvidence.route.capabilities['text.generate'].state, 'ready');
            assert.match(restartHydratedEvidence.route.capabilities['text.generate'].binding.modelId, /runtime-agent-live-e2e/);
            assert.equal(restartHydratedEvidence.route.capabilities['image.generate'].binding.route, 'cloud');
            assert.equal(restartHydratedEvidence.route.capabilities['audio.synthesize'].binding.route, 'cloud');
            assert.ok(restartScopedBinding, 'Relaunched Zhiyu must reacquire a Runtime-issued scoped binding');
            assert.equal(restartScopedBinding.bindingSource, 'runtime-account-service');
            assert.equal(restartScopedBinding.runtimeAppId, zhiyuAppId);
            assert.equal(restartScopedBinding.agentId, fixture.localAgentRef);
            assert.equal(restartScopedBinding.conversationAnchorId, readyEvidence.conversation.conversationAnchorId);
            const restartedConversationText = await relaunchedPage.locator('[data-zhiyu-region="conversation"]').innerText();
            assert.match(restartedConversationText, /Hello from the Runtime Agent live fixture/);
            assert.equal(restartedConversationText.includes(secondPrompt), true);
            await assertModelConfiguredProductState(relaunchedPage, { requireModelPanel: false });
            await assertChatCompletedNarrowComposerUsable(relaunchedPage);
            await captureLiveRuntimeEvidence(relaunchedPage, 'chatRestartHydrated', relaunchProblems, {
              readyEvidence,
              chatCompletedEvidence,
              multiTurnEvidence,
              avatarLaunchEvidence,
              restartHydratedEvidence,
              restartScopedBinding,
            });
            assertNoPageProblems(relaunchProblems);
          } finally {
            await relaunchedApp.close();
          }

          await assertUniqueStageScreenshots();
          assertNoPageProblems(pageProblems);
        } finally {
          await avatarLaunchEvidence?.closeAvatarProcess?.().catch(() => {});
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
      NIMI_ZHIYU_AVATAR_ELECTRON_MAIN_PATH: path.join(root, '..', 'avatar', 'dist-electron', 'main.js'),
    },
  });
}

async function assertElectronChromeParity(app) {
  const chrome = await app.evaluate(({ BrowserWindow, Menu }) => {
    const window = BrowserWindow.getAllWindows()[0] ?? null;
    return {
      platform: process.platform,
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
  if (chrome.platform !== 'darwin') {
    assert.notEqual(chrome.menuBarVisible, true, 'Zhiyu must hide the native menu bar to match Desktop agent chat chrome');
    assert.notEqual(chrome.menuBarAutoHide, false, 'Zhiyu native menu bar must remain auto-hidden when the platform reports the state');
  }
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
  // The K-AGCORE-150 seeded execution config (text.generate=local/default)
  // resolves ready on a fresh daemon, so partner selection lands directly in
  // the conversational-ready product stage — there is no route-required gate.
  assert.equal(await page.locator('[data-zhiyu-product-stage]').getAttribute('data-zhiyu-product-stage'), 'ready');
  assert.equal(await page.locator('[data-zhiyu-primary-action]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-relationship-rail-state]').getAttribute('data-zhiyu-relationship-rail-state'), 'available');
  assert.equal(await page.locator('[data-zhiyu-region="relationship-rail"]').count(), 1);
  assert.equal(await page.locator('[data-zhiyu-side-panel-state]').getAttribute('data-zhiyu-side-panel-state'), 'closed');
  assert.equal(await page.locator('[data-zhiyu-region="agent-panel"]').count(), 0);
  const shellText = await page.locator('[data-zhiyu-product-shell="workspace"]').innerText();
  assert.match(shellText, /开始一段对话|当前伙伴/);
  assert.match(shellText, /本地对话已就绪|对话已就绪/);
  assert.match(shellText, /模型|本地对话模型已绑定|本地对话已就绪/);
  assert.doesNotMatch(shellText, /Runtime Live Source/);
  assertPrimaryWorkspaceHasNoEngineeringCopy(shellText);
}

// Replaces the pre-cutover "model unconfigured blocks send" stage: the
// runtime seeds text.generate=local/default (rev 1) as committed config, so
// the honest stage is "seeded default config visible" — Zhiyu projects the
// runtime-owned config it did not author, while the fixture text model still
// must be committed through the model tab before turns run.
async function assertSeededDefaultConfigProductState(page, preConfigEvidence) {
  assert.equal(await page.locator('[data-zhiyu-composer-tool="model"]').count(), 1);
  assert.equal(await page.locator('[data-zhiyu-capability-setup-action="configure-model"]').count(), 0, 'primary chat must not expose backstage model setup actions');
  assert.equal(await page.locator('[data-zhiyu-image-studio-setup-action="configure-model"]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-region="image-studio"]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-capability-studio-run]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-image-generate-run]').count(), 0);
  const shellText = await page.locator('[data-zhiyu-product-shell="workspace"]').innerText();
  assertPrimaryWorkspaceHasNoEngineeringCopy(shellText);
  assert.equal(preConfigEvidence.route.ready, true);
  assert.equal(preConfigEvidence.route.reasonCode, 'runtime-execution-config-ready');
  assert.equal(preConfigEvidence.route.updatedByAppId, 'runtime');
  assert.equal(preConfigEvidence.route.executionBinding.route, 'local');
  assert.equal(preConfigEvidence.route.executionBinding.modelId, 'local/default');
  assert.equal(preConfigEvidence.route.capabilities['text.generate'].state, 'ready');
  assert.equal(preConfigEvidence.route.capabilities['image.generate'].state, 'not_configured');
  assert.equal(preConfigEvidence.route.capabilities['image.generate'].binding, null);
  assert.equal(preConfigEvidence.route.capabilities['audio.synthesize'].state, 'not_configured');
  assert.equal(preConfigEvidence.route.capabilities['audio.synthesize'].binding, null);
}

async function assertModelConfiguredProductState(page, options = {}) {
  await waitForEvidence(page, () =>
    globalThis.window.__nimiZhiyuEvidence?.route?.reasonCode === 'runtime-execution-config-ready'
    && Boolean(globalThis.window.__nimiZhiyuEvidence?.route?.executionBinding),
    'model configured product state',
  );
  const evidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  assert.equal(evidence.route.capabilities['text.generate'].state, 'ready');
  assert.match(evidence.route.capabilities['text.generate'].binding.modelId, /runtime-agent-live-e2e/i);
  assert.notEqual(evidence.route.capabilities['image.generate'].state, 'not_configured');
  assert.equal(evidence.route.capabilities['image.generate'].binding.route, 'cloud');
  assert.notEqual(evidence.route.capabilities['audio.synthesize'].state, 'not_configured');
  assert.equal(evidence.route.capabilities['audio.synthesize'].binding.route, 'cloud');
  assert.match(evidence.route.executionBinding.modelId, /runtime-agent-live-e2e/i);
  if (options.requireModelPanel === false) {
    return;
  }
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
    if (input.connectorId) {
      await picker.getByLabel('Select connector').selectOption(input.connectorId);
    }
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

// Waits for the model tab's runtime execution config commit banner to reach
// "committed" with a revision advanced past `afterRevision`, and returns the
// committed revision. A conflict/failed banner surfaces in the timeout
// diagnostics instead of being silently retried.
async function waitForExecutionCommitCommitted(page, afterRevision) {
  try {
    await page.waitForFunction((afterRevision) => {
      const banner = document.querySelector('[data-zhiyu-execution-commit-state]');
      if (!banner || banner.getAttribute('data-zhiyu-execution-commit-state') !== 'committed') {
        return false;
      }
      const revision = Number(banner.getAttribute('data-zhiyu-execution-commit-revision'));
      return Number.isFinite(revision) && revision > afterRevision;
    }, afterRevision, { timeout: 30_000 });
  } catch (error) {
    const banner = await page.evaluate(() => {
      const element = document.querySelector('[data-zhiyu-execution-commit-state]');
      return element
        ? {
          state: element.getAttribute('data-zhiyu-execution-commit-state'),
          reason: element.getAttribute('data-zhiyu-execution-commit-reason'),
          revision: element.getAttribute('data-zhiyu-execution-commit-revision'),
          text: element.textContent,
        }
        : null;
    }).catch(() => null);
    throw new Error(`execution config commit did not reach committed past revision ${afterRevision}: ${JSON.stringify(banner)}`, { cause: error });
  }
  const revision = Number(await page
    .locator('[data-zhiyu-execution-commit-state="committed"]')
    .getAttribute('data-zhiyu-execution-commit-revision'));
  assert.ok(Number.isFinite(revision) && revision > afterRevision, `committed revision must advance past ${afterRevision}, got ${revision}`);
  return revision;
}

// Replaces the pre-cutover app-local "stale AIConfig" stage: route truth is
// now the runtime-owned execution config, so the honest blocked state is an
// external admitted writer committing a text.generate binding the runtime
// readiness prober reports as unavailable (cloud route without a connector →
// connector_missing). Zhiyu must project the unavailable readiness fail-closed
// and gate the composer; the submit-time refresh guard
// (zhiyu-submit-route-refresh-stale) is exercised best-effort by racing the
// send click against the readiness subscription refresh.
async function assertRouteUnavailableFlow(page, pageProblems, readyEvidence, runtimeExecutionConfig) {
  const blockedPrompt = 'Please verify Zhiyu blocks send on unavailable execution readiness.';
  const committed = await runtimeExecutionConfig.get();
  assert.match(committed.bindings['text.generate']?.modelId || '', /runtime-agent-live-e2e/);

  await page.locator('[data-chat-composer-textarea="true"]').fill(blockedPrompt);
  await waitForEvidence(page, () =>
    document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
    && document.querySelector('[data-chat-composer-send="true"]')?.disabled === false
    && document.querySelector('[data-chat-composer-textarea="true"]')?.value.length > 0,
    'send-ready composer before external execution config degrade',
  );

  let restoredRevision = null;
  try {
    const degraded = await runtimeExecutionConfig.upsert({
      expectedRevision: committed.revision,
      bindings: {
        ...committed.bindings,
        'text.generate': {
          route: 'cloud',
          modelId: 'zhiyu-live-acceptance-degraded-text-model',
        },
      },
    });
    assert.equal(degraded.revision, committed.revision + 1);
    // Best-effort mid-submit race: if the composer is still enabled the click
    // drives handleSubmit's config+readiness re-read against the already
    // degraded config (deterministic block); if the readiness subscription
    // refresh landed first, the disabled send button makes the click a no-op
    // and only the steady-state gate is asserted.
    const midSubmitClicked = await page.evaluate(() => {
      const send = document.querySelector('[data-chat-composer-send="true"]');
      if (send instanceof HTMLButtonElement && !send.disabled) {
        send.click();
        return true;
      }
      return false;
    });
    await waitForEvidence(page, ({ degradedRevision }) =>
      globalThis.window.__nimiZhiyuEvidence?.route?.ready === false
      && globalThis.window.__nimiZhiyuEvidence?.route?.reasonCode === 'zhiyu-agent-execution-readiness-unavailable'
      && globalThis.window.__nimiZhiyuEvidence?.route?.configRevision === degradedRevision
      && globalThis.window.__nimiZhiyuEvidence?.route?.capabilities?.['text.generate']?.state === 'unavailable',
      'unavailable execution readiness route evidence',
      { degradedRevision: degraded.revision },
    );
    if (midSubmitClicked) {
      await waitForEvidence(page, () =>
        globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'failed'
        && globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode === 'zhiyu-submit-route-refresh-stale'
        && globalThis.window.__nimiZhiyuEvidence?.composer?.submitState === 'failed',
        'submit-time execution readiness refresh block evidence',
      );
    }
    const routeUnavailableEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
    assert.equal(routeUnavailableEvidence.route.ready, false);
    assert.equal(routeUnavailableEvidence.route.reasonCode, 'zhiyu-agent-execution-readiness-unavailable');
    assert.equal(routeUnavailableEvidence.route.capabilities['text.generate'].state, 'unavailable');
    assert.equal(routeUnavailableEvidence.route.capabilities['text.generate'].reasonCode, 'connector_missing');
    assert.equal(routeUnavailableEvidence.route.updatedByAppId, 'nimi.desktop');
    assert.equal(routeUnavailableEvidence.turn.ready, false);
    assert.equal(routeUnavailableEvidence.chat.messageCount, 0, 'blocked submit must not enqueue transcript messages');
    if (midSubmitClicked) {
      assert.equal(routeUnavailableEvidence.chat.state, 'failed');
      assert.equal(routeUnavailableEvidence.chat.reasonCode, 'zhiyu-submit-route-refresh-stale');
      assert.equal(routeUnavailableEvidence.chat.requestId, null);
      assert.equal(routeUnavailableEvidence.chat.eventTypes.length, 0);
      assert.equal(await page.locator('[data-zhiyu-agent-chat-state]').getAttribute('data-zhiyu-agent-chat-state'), 'failed');
      const failureNotice = page.locator('[data-zhiyu-agent-chat-failure="true"]').last();
      await failureNotice.waitFor({ state: 'visible', timeout: 15_000 });
      assert.equal(await failureNotice.getAttribute('data-zhiyu-agent-chat-failure-reason'), 'zhiyu-submit-route-refresh-stale');
      assert.match(await failureNotice.innerText(), /zhiyu-submit-route-refresh-stale/);
    } else {
      assert.equal(routeUnavailableEvidence.chat.state, 'idle');
    }
    // Composer gate on the unavailable readiness. When the mid-submit guard
    // fired, the Kit composer already cleared its textarea on send, so the
    // failed-chat evidence above is the fail-closed proof; otherwise the
    // draft is still visible and the disabled submit is the route readiness
    // gate, not the empty-draft gate.
    if (midSubmitClicked) {
      assert.equal(
        await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'),
        'false',
      );
    } else {
      await waitForEvidence(page, () =>
        document.querySelector('[data-chat-composer-textarea="true"]')?.value.length > 0
        && document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'false',
        'composer gated on unavailable execution readiness',
      );
    }
    assert.equal(
      await page.locator('[data-zhiyu-route-state]').getAttribute('data-zhiyu-route-state'),
      'zhiyu-agent-execution-readiness-unavailable',
    );
    await captureLiveRuntimeEvidence(page, 'routeUnavailable', pageProblems, {
      readyEvidence,
      routeUnavailableEvidence,
      midSubmitGuardObserved: midSubmitClicked,
    });
    const restored = await runtimeExecutionConfig.upsert({
      expectedRevision: degraded.revision,
      bindings: committed.bindings,
    });
    restoredRevision = restored.revision;
  } finally {
    if (restoredRevision === null) {
      // Fail-safe restore so a mid-stage assertion failure does not leave the
      // shared daemon config degraded for unrelated diagnostics.
      await runtimeExecutionConfig.get()
        .then((current) => runtimeExecutionConfig.upsert({
          expectedRevision: current.revision,
          bindings: committed.bindings,
        }))
        .catch(() => undefined);
    }
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
  await page.waitForSelector('[data-zhiyu-screen="home"]');
  await waitForEvidence(page, ({ conversationAnchorId, restoredRevision }) =>
    globalThis.window.__nimiZhiyuEvidence?.conversation?.conversationAnchorId === conversationAnchorId
    && globalThis.window.__nimiZhiyuEvidence?.route?.reasonCode === 'runtime-execution-config-ready'
    && globalThis.window.__nimiZhiyuEvidence?.route?.configRevision === restoredRevision
    && /runtime-agent-live-e2e/.test(globalThis.window.__nimiZhiyuEvidence?.route?.executionBinding?.modelId || '')
    && globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'idle',
    'ready evidence after restoring the committed execution config',
    { conversationAnchorId: readyEvidence.conversation.conversationAnchorId, restoredRevision },
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

async function assertRuntimeNativeVoiceInterruptFlow(page, pageProblems, fixture, readyEvidence) {
  const interruptedPrompt = '请开始一段会被 Runtime 中断的实时语音。';
  const runtimeAuthBinding = await readZhiyuRuntimeAgentAuthBinding(page, readyEvidence);
  const existingVoiceStreamIds = await page.evaluate(() => {
    const events = globalThis.window.__nimiZhiyuEvidence?.chat?.diagnostics?.runtimeProjectionEvents ?? [];
    return events
      .map((event) => String(event?.detail?.voiceStreamId || event?.detail?.voice_stream_id || '').trim())
      .filter(Boolean);
  });
  const observerReady = createDeferred();
  const runtimeInterruptObserver = observeLiveRuntimeNativeVoiceInterrupt({
    fixture,
    conversationAnchorId: readyEvidence.conversation.conversationAnchorId,
    prompt: interruptedPrompt,
    existingVoiceStreamIds,
    runtimeAuthBinding,
    onReady: observerReady.resolve,
  });
  void runtimeInterruptObserver.catch((error) => observerReady.reject(error));
  await promiseWithTimeout(
    observerReady.promise,
    15_000,
    'Runtime native voice interrupt observer did not subscribe before submit',
  );
  await page.locator('[data-chat-composer-textarea="true"]').fill(interruptedPrompt, { timeout: 15_000 });
  await page.waitForFunction(() =>
    document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
    && document.querySelector('[data-chat-composer-send="true"]')?.disabled === false
    && document.querySelector('[data-chat-composer-textarea="true"]')?.value.length > 0,
    undefined,
    { timeout: 15_000 },
  );
  await page.locator('[data-chat-composer-send="true"]').click({ timeout: 15_000 });
  await waitForEvidence(page, ({ interruptedPrompt }) => {
    const evidence = globalThis.window.__nimiZhiyuEvidence;
    return evidence?.chat?.conversationAnchorId
      && evidence?.chat?.messages?.some((message) => message?.text === interruptedPrompt)
      && ['streaming', 'completed', 'failed'].includes(evidence?.chat?.state || '');
  }, 'Runtime voice interrupt turn submitted through Zhiyu', { interruptedPrompt });
  const runtimeInterrupt = await promiseWithTimeout(
    runtimeInterruptObserver,
    60_000,
    'Runtime native voice interrupt observer/capture did not complete',
  );
  const {
    nativeChunkEvent,
    interruptRuntimeTurnId,
    typedFirstChunk,
    typedTerminalEvent,
    interruptResponse,
    voiceStreamId,
  } = runtimeInterrupt;
  assert.match(interruptRuntimeTurnId, /^agent_turn_/u, 'interrupt must target the Runtime public-chat turn id');
  assert.equal(nativeChunkEvent.detail?.audioArtifactId || nativeChunkEvent.detail?.audio_artifact_id || null, null);
  assert.match(
    String(nativeChunkEvent.detail?.chunkTransportRef || nativeChunkEvent.detail?.chunk_transport_ref || ''),
    new RegExp(escapeRegExp(voiceStreamId)),
    'interrupt turn native chunk must point at transient stream transport',
  );
  assert.equal(typedFirstChunk.voiceStreamId, voiceStreamId);
  assert.equal(typedFirstChunk.voiceOutputMode, VoiceOutputMode.NATIVE_STREAM);
  assert.equal(typedFirstChunk.voicePlaybackState, VoicePlaybackState.ACTIVE);
  assert.equal(typedFirstChunk.terminal, false);
  assert.equal((typedFirstChunk.chunk?.byteLength ?? 0) > 0, true, 'typed voice stream must deliver playable non-final bytes before interrupt');
  assert.equal(typedTerminalEvent.voiceStreamId, voiceStreamId);
  assert.equal(typedTerminalEvent.voiceOutputMode, VoiceOutputMode.NATIVE_STREAM);
  assert.equal(typedTerminalEvent.voicePlaybackState, VoicePlaybackState.INTERRUPTED);
  assert.equal(typedTerminalEvent.terminalReason, 'zhiyu_electron_live_voice_interrupt');
  assert.equal(interruptResponse.voiceStreamId, voiceStreamId);
  assert.equal(interruptResponse.voiceOutputMode, VoiceOutputMode.NATIVE_STREAM);
  assert.equal(interruptResponse.voicePlaybackState, VoicePlaybackState.INTERRUPTED);

  await waitForEvidence(page, ({ interruptRuntimeTurnId, voiceStreamId }) => {
    const evidence = globalThis.window.__nimiZhiyuEvidence;
    const events = evidence?.chat?.diagnostics?.runtimeProjectionEvents ?? [];
    const eventTurnId = (event) => String(
      event?.runtimeTurnId
        || event?.turnId
        || event?.detail?.runtimeTurnId
        || event?.detail?.turnId
        || event?.detail?.turn_id
        || '',
    ).trim();
    const terminal = events.find((event) =>
      event?.eventName === 'runtime.agent.presentation.voice_playback_terminal'
      && eventTurnId(event) === interruptRuntimeTurnId
      && (event?.detail?.voiceStreamId || event?.detail?.voice_stream_id) === voiceStreamId
    );
    const finalPlaybackForInterruptedStream = events.some((event) =>
      event?.eventName === 'runtime.agent.presentation.voice_playback_requested'
      && (event?.detail?.voiceStreamId || event?.detail?.voice_stream_id) === voiceStreamId
      && event?.detail?.finalArtifact === true
    );
    return terminal?.detail?.voiceOutputMode === 'native_stream'
      && terminal?.detail?.voicePlaybackState === 'interrupted'
      && terminal?.detail?.terminalReason === 'zhiyu_electron_live_voice_interrupt'
      && !Boolean(terminal?.detail?.finalArtifactId || terminal?.detail?.final_artifact_id)
      && finalPlaybackForInterruptedStream === false
      && evidence?.companion?.voiceOutputMode === 'native_stream'
      && evidence?.companion?.voicePlaybackState === 'interrupted'
      && evidence?.companion?.voiceStreamId === voiceStreamId
      && evidence?.companion?.projectedFields?.includes('voicePlaybackTerminal');
  }, 'interrupted native voice terminal truth', { interruptRuntimeTurnId, voiceStreamId });

  const interruptedEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  const terminalEvent = interruptedEvidence.chat.diagnostics.runtimeProjectionEvents.find((event) =>
    event?.eventName === 'runtime.agent.presentation.voice_playback_terminal'
    && runtimeProjectionEventTurnId(event) === interruptRuntimeTurnId
    && (event?.detail?.voiceStreamId || event?.detail?.voice_stream_id) === voiceStreamId
  );
  assert.ok(terminalEvent, 'Runtime interrupt must project voice_playback_terminal');
  assert.equal(terminalEvent.detail.voiceOutputMode, 'native_stream');
  assert.equal(terminalEvent.detail.voicePlaybackState, 'interrupted');
  assert.equal(terminalEvent.detail.terminalReason, 'zhiyu_electron_live_voice_interrupt');
  assert.equal(terminalEvent.detail.finalArtifactId || terminalEvent.detail.final_artifact_id || null, null);
  const voiceTool = page.locator('[data-zhiyu-composer-tool="hands-free"]').first();
  await voiceTool.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-output-mode'), 'native_stream');
  assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-playback-state'), 'interrupted');
  assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-stream-id'), voiceStreamId);
  assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-playback-target'), 'avatar_autoplay');
  assert.equal(await voiceTool.isDisabled(), true, 'Runtime voice interrupt truth must not turn Zhiyu into a local playback controller');
  const interruptedConversationText = await page.locator('[data-zhiyu-region="conversation"]').innerText();
  assert.match(interruptedConversationText, /请开始一段会被 Runtime 中断的实时语音/);
  await captureLiveRuntimeEvidence(page, 'voiceInterrupted', pageProblems, {
    readyEvidence,
    interruptedEvidence,
    runtimeInterrupt: {
      nativeChunkEvent,
      typedFirstChunk: summarizeTypedVoiceStreamEvent(typedFirstChunk),
      typedTerminalEvent: summarizeTypedVoiceStreamEvent(typedTerminalEvent),
    },
    interruptResponse,
    voiceStreamId,
    interruptRuntimeTurnId,
  });
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

async function readZhiyuRuntimeAgentAuthBinding(page, readyEvidence) {
  const binding = await page.evaluate(() => {
    const host = globalThis.window?.__nimiZhiyuRuntimeAgentBinding
      || globalThis.__nimiZhiyuRuntimeAgentBinding
      || null;
    const scopedBinding = typeof host?.getScopedBinding === 'function'
      ? host.getScopedBinding()
      : host?.scopedBinding;
    const hostEquivalence = host?.hostEquivalence || null;
    return JSON.parse(JSON.stringify({ scopedBinding: scopedBinding || null, hostEquivalence }));
  });
  const scopedBinding = binding?.scopedBinding;
  const scopes = Array.isArray(scopedBinding?.scopes) ? scopedBinding.scopes : [];
  if (
    scopedBinding?.bindingId
    && scopes.includes('runtime.agent.turn.read')
    && scopes.includes('runtime.agent.turn.write')
  ) {
    return { kind: 'scopedBinding', bindingId: scopedBinding.bindingId };
  }
  const issued = await page.evaluate(async ({ readyEvidence }) => {
    const invoke = globalThis.window?.__NIMI_ELECTRON_RUNTIME__?.invoke
      || globalThis.window?.__NIMI_ELECTRON_TEST__?.invoke
      || globalThis.__NIMI_ELECTRON_RUNTIME__?.invoke
      || globalThis.__NIMI_ELECTRON_TEST__?.invoke
      || null;
    if (typeof invoke !== 'function') {
      return { error: 'electron_runtime_invoke_unavailable' };
    }
    return invoke('zhiyu.runtimeAgent.issueScopedBinding', {
      ownerUserId: readyEvidence?.conversation?.ownerUserId,
      runtimeSourceRef: readyEvidence?.conversation?.runtimeSourceRef,
      localAgentRef: readyEvidence?.conversation?.localAgentRef,
      conversationAnchorId: readyEvidence?.conversation?.conversationAnchorId,
      scopes: ['runtime.agent.turn.read', 'runtime.agent.turn.write'],
      issueRequestId: `zhiyu-live-runtime-voice-interrupt:${Date.now()}`,
      forceRenewal: true,
    });
  }, { readyEvidence });
  const issuedScopedBinding = issued?.scopedBinding;
  const issuedScopes = Array.isArray(issuedScopedBinding?.scopes) ? issuedScopedBinding.scopes : [];
  if (
    issuedScopedBinding?.bindingId
    && issuedScopes.includes('runtime.agent.turn.read')
    && issuedScopes.includes('runtime.agent.turn.write')
  ) {
    return { kind: 'scopedBinding', bindingId: issuedScopedBinding.bindingId };
  }
  const evidenceRef = String(binding?.hostEquivalence?.evidenceRef || '').trim();
  if (evidenceRef) {
    return { kind: 'hostEquivalence', evidenceRef };
  }
  assert.fail('Zhiyu live voice interrupt requires renderer Runtime scoped binding or admitted host equivalence');
}

async function observeLiveRuntimeNativeVoiceInterrupt(input) {
  const agentClient = createZhiyuLiveRuntimeAgentClient(input.fixture);
  const stream = await agentClient.subscribeEvents({
    ownerUserId: input.fixture.ownerUserId,
    runtimeSourceRef: input.fixture.runtimeSourceRef,
    localAgentRef: input.fixture.localAgentRef,
    conversationAnchorId: input.conversationAnchorId,
    includeAgentEvents: true,
  });
  const iterator = stream[Symbol.asyncIterator]();
  input.onReady?.();
  const deadlineMs = Date.now() + 75_000;
  const existingVoiceStreamIds = new Set(input.existingVoiceStreamIds || []);
  let targetTurnId = '';
  let targetStreamId = '';
  let observedEvents = 0;
  let observedNativeChunks = 0;
  let skippedExistingNativeChunks = 0;
  try {
    for (;;) {
      const next = await nextAsyncIteratorValue(iterator, deadlineMs, 'Runtime native voice interrupt observer');
      if (next.done) {
        break;
      }
      const event = next.value;
      if (!event || typeof event !== 'object') {
        continue;
      }
      observedEvents += 1;
      if (event.eventName === 'runtime.agent.turn.accepted' && !targetTurnId && runtimeEventObservedAtOrAfter(event, input.notBeforeIso)) {
        targetTurnId = String(event.turnId || '').trim();
        targetStreamId = String(event.streamId || '').trim();
        continue;
      }
      if (targetTurnId && event.turnId !== targetTurnId) {
        continue;
      }
      if (!isRuntimeNativeNonFinalVoiceChunkEvent(event)) {
        continue;
      }
      observedNativeChunks += 1;
      const voiceStreamId = String(event.detail?.voiceStreamId || event.detail?.voice_stream_id || '').trim();
      if (!voiceStreamId || existingVoiceStreamIds.has(voiceStreamId)) {
        skippedExistingNativeChunks += 1;
        continue;
      }
      targetTurnId = targetTurnId || String(event.turnId || '').trim();
      targetStreamId = targetStreamId || String(event.streamId || '').trim();
      if (!targetTurnId) {
        continue;
      }
      const typed = await captureAndInterruptLiveRuntimeVoiceStream({
        fixture: input.fixture,
        conversationAnchorId: input.conversationAnchorId,
        turnId: targetTurnId,
        voiceStreamId,
        runtimeAuthBinding: input.runtimeAuthBinding,
      });
      return {
        nativeChunkEvent: event,
        interruptRuntimeTurnId: targetTurnId,
        interruptRuntimeStreamId: targetStreamId,
        voiceStreamId,
        ...typed,
      };
    }
  } finally {
    await iterator.return?.();
  }
  throw new Error(
    `Runtime native voice interrupt observer ended before seeing a new native stream chunk for prompt ${JSON.stringify(input.prompt)}; `
    + `events=${observedEvents} nativeChunks=${observedNativeChunks} skippedExistingNativeChunks=${skippedExistingNativeChunks} `
    + `targetTurnId=${targetTurnId || '<none>'}`,
  );
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function runtimeEventObservedAtOrAfter(event, notBeforeIso) {
  if (!notBeforeIso) {
    return true;
  }
  const observed = String(
    event?.timeline?.observedAtWall
      || event?.timeline?.observed_at_wall
      || event?.observedAt
      || event?.observed_at
      || '',
  ).trim();
  if (!observed) {
    return false;
  }
  const observedMs = Date.parse(observed);
  const notBeforeMs = Date.parse(notBeforeIso);
  return Number.isFinite(observedMs) && Number.isFinite(notBeforeMs) && observedMs >= notBeforeMs;
}

async function captureAndInterruptLiveRuntimeVoiceStream(input) {
  const voice = createZhiyuLiveRuntimeAgentVoiceModule(input.fixture, input.runtimeAuthBinding);
  const stream = await voice.subscribeStream({
    ownerUserId: input.fixture.ownerUserId,
    runtimeSourceRef: input.fixture.runtimeSourceRef,
    localAgentRef: input.fixture.localAgentRef,
    conversationAnchorId: input.conversationAnchorId,
    turnId: input.turnId,
    voiceStreamId: input.voiceStreamId,
  });
  const iterator = stream[Symbol.asyncIterator]();
  const deadlineMs = Date.now() + 45_000;
  try {
    const first = await nextAsyncIteratorValue(iterator, deadlineMs, 'typed Runtime voice stream first chunk');
    assert.equal(first.done, false, 'typed Runtime voice stream ended before first chunk');
    const typedFirstChunk = first.value;
    assert.equal(typedFirstChunk?.voiceStreamId, input.voiceStreamId);
    assert.equal(typedFirstChunk?.terminal, false);
    assert.equal((typedFirstChunk?.chunk?.byteLength ?? 0) > 0, true, 'typed Runtime voice stream must carry bytes in the non-final chunk');

    const interruptResponse = await promiseWithTimeout(
      interruptLiveRuntimeFixtureVoicePlayback(input.fixture, {
        ownerUserId: input.fixture.ownerUserId,
        runtimeSourceRef: input.fixture.runtimeSourceRef,
        localAgentRef: input.fixture.localAgentRef,
        conversationAnchorId: input.conversationAnchorId,
        turnId: input.turnId,
        voiceStreamId: input.voiceStreamId,
        reason: 'zhiyu_electron_live_voice_interrupt',
        runtimeAuthBinding: input.runtimeAuthBinding,
      }),
      10_000,
      `Runtime voice interrupt RPC did not return for ${input.voiceStreamId}`,
    );

    for (;;) {
      const next = await nextAsyncIteratorValue(iterator, deadlineMs, `typed Runtime voice stream interrupted terminal for ${input.voiceStreamId}`);
      assert.equal(next.done, false, 'typed Runtime voice stream ended before interrupted terminal');
      const event = next.value;
      if (!event?.terminal) {
        continue;
      }
      return {
        typedFirstChunk,
        typedTerminalEvent: event,
        interruptResponse,
      };
    }
  } finally {
    await iterator.return?.();
  }
}

function createZhiyuLiveRuntimeAgentClient(fixture) {
  const runtime = createRuntimeForEndpoint(fixture.endpoint, zhiyuRuntimeVoiceObserverAppId);
  return createNimiRuntimeAgentClient({
    runtime: {
      appId: zhiyuRuntimeVoiceObserverAppId,
      auth: runtime.auth,
      appAuth: runtime.grants,
      agents: runtime.agents,
      appMessages: runtime.appMessages,
    },
    appId: zhiyuRuntimeVoiceObserverAppId,
    getSubjectUserId: () => fixture.ownerUserId,
    withScopes: createZhiyuLiveRuntimeScopeRunner(fixture, runtime),
  });
}

function createZhiyuLiveRuntimeAgentVoiceModule(fixture, runtimeAuthBinding) {
  const runtime = createRuntimeForEndpoint(fixture.endpoint, zhiyuAppId);
  return createNimiRuntimeAgentVoiceModule({
    runtime: {
      appId: zhiyuAppId,
      auth: runtime.auth,
      appAuth: runtime.grants,
      agents: runtime.agents,
      artifacts: runtime.artifacts,
    },
    getSubjectUserId: () => fixture.ownerUserId,
    withScopes: createZhiyuRuntimeAuthBindingScopeRunner(runtimeAuthBinding),
  });
}

function createZhiyuRuntimeAuthBindingScopeRunner(runtimeAuthBinding) {
  return async (_scopes, operation) => operation({
    metadata: zhiyuRuntimeAuthBindingMetadata(runtimeAuthBinding),
  });
}

function createZhiyuLiveRuntimeScopeRunner(fixture, runtime) {
  const sessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId: zhiyuRuntimeVoiceObserverAppId,
    appInstanceId: zhiyuRuntimeVoiceObserverAppInstanceId,
    deviceId: 'nimi-zhiyu-live-runtime-voice-observer-device',
    appVersion: 'zhiyu-electron-live-runtime-acceptance',
    developerRegistration: false,
    capabilities: zhiyuRuntimeProtectedScopes,
    auth: runtime.auth,
  });
  return (scopes, operation) =>
    withNimiRuntimeAgentScopes({
      runtime: {
        appId: zhiyuRuntimeVoiceObserverAppId,
        auth: runtime.auth,
        appAuth: runtime.grants,
      },
      subjectUserId: fixture.ownerUserId,
    }, scopes, async (callOptions) => {
      const metadata = await sessionMetadata();
      return operation({
        ...callOptions,
        metadata: {
          ...metadata,
          ...(callOptions.metadata ?? {}),
        },
      });
    });
}

function isRuntimeNativeNonFinalVoiceChunkEvent(event) {
  return event?.eventName === 'runtime.agent.presentation.voice_stream_chunk_available'
    && event?.detail?.voiceOutputMode === 'native_stream'
    && event?.detail?.voicePlaybackState === 'active'
    && event?.detail?.finalChunk === false
    && Boolean(event?.detail?.voiceStreamId || event?.detail?.voice_stream_id)
    && Boolean(event?.detail?.chunkTransportRef || event?.detail?.chunk_transport_ref)
    && !Boolean(event?.detail?.audioArtifactId || event?.detail?.audio_artifact_id);
}

async function nextAsyncIteratorValue(iterator, deadlineMs, label) {
  const remainingMs = Math.max(0, deadlineMs - Date.now());
  if (remainingMs <= 0) {
    throw new Error(`${label} timed out`);
  }
  let timeout = null;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), remainingMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function promiseWithTimeout(promise, timeoutMs, label) {
  let timeout = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} within ${timeoutMs}ms`)), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function summarizeTypedVoiceStreamEvent(event) {
  return {
    voiceStreamId: event?.voiceStreamId || '',
    conversationAnchorId: event?.conversationAnchorId || '',
    turnId: event?.turnId || '',
    streamId: event?.streamId || '',
    messageId: event?.messageId || '',
    chunkSequence: Number(event?.chunkSequence ?? 0),
    byteLength: Number(event?.chunk?.byteLength ?? 0),
    mimeType: event?.mimeType || '',
    voiceOutputMode: event?.voiceOutputMode,
    voicePlaybackState: event?.voicePlaybackState,
    terminal: event?.terminal === true,
    terminalReason: event?.terminalReason || '',
    replayTruncated: event?.replayTruncated === true,
  };
}

async function readLiveRuntimeFixtureArtifactBytes(fixture, artifactId) {
  const sessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId: desktopAppId,
    appInstanceId: `${desktopAppId}.live-runtime`,
    deviceId: 'nimi-desktop-live-runtime-device',
    appVersion: 'zhiyu-electron-live-runtime-acceptance',
    developerRegistration: false,
    auth: fixture.runtime.auth,
  });
  return fixture.runtime.artifacts.readArtifactBytes({ artifactId }, {
    metadata: await sessionMetadata(),
  });
}

async function interruptLiveRuntimeFixtureVoicePlayback(fixture, input) {
  const runtime = createRuntimeForEndpoint(fixture.endpoint, zhiyuAppId);
  const idempotencyKey = `zhiyu-live-runtime-voice-interrupt:${input.voiceStreamId}`;
  return runtime.agents.interruptAgentVoicePlayback({
    context: {
      appId: zhiyuAppId,
      subjectUserId: input.ownerUserId,
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef,
    },
    conversationAnchorId: input.conversationAnchorId,
    turnId: input.turnId,
    voiceStreamId: input.voiceStreamId,
    reason: input.reason,
  }, {
    metadata: {
      ...zhiyuRuntimeAuthBindingMetadata(input.runtimeAuthBinding),
      idempotencyKey,
      'x-nimi-idempotency-key': idempotencyKey,
    },
  });
}

function zhiyuRuntimeAuthBindingMetadata(runtimeAuthBinding) {
  if (runtimeAuthBinding?.kind === 'scopedBinding') {
    const bindingId = String(runtimeAuthBinding.bindingId || '').trim();
    assert.ok(bindingId, 'Zhiyu Runtime scoped binding id is required for owner-app voice operations');
    return { 'x-nimi-runtime-scoped-binding-id': bindingId };
  }
  if (runtimeAuthBinding?.kind === 'hostEquivalence') {
    const evidenceRef = String(runtimeAuthBinding.evidenceRef || '').trim();
    assert.ok(evidenceRef, 'Zhiyu Runtime host equivalence evidence is required for owner-app voice operations');
    return { 'x-nimi-runtime-host-equivalence': evidenceRef };
  }
  assert.fail('Zhiyu Runtime auth binding is required for owner-app voice operations');
}

function runtimeProjectionEventTurnId(event) {
  return String(
    event?.runtimeTurnId
      || event?.turnId
      || event?.detail?.runtimeTurnId
      || event?.detail?.turnId
      || event?.detail?.turn_id
      || '',
  ).trim();
}
