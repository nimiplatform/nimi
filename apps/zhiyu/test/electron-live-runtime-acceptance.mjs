import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import { withRuntimeAgentLiveE2EFixture } from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture.test-helper.ts';

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
  await withRuntimeAgentLiveE2EFixture({
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

        const app = await electron.launch({
          args: [mainEntry],
          env: {
            ...process.env,
            NIMI_RUNTIME_GRPC_ADDR: '',
            NIMI_ZHIYU_ELECTRON_RENDERER_URL: rendererUrlForFixture(fixture),
            NIMI_ZHIYU_ELECTRON_RUNTIME_ENDPOINT: fixture.endpoint,
            NIMI_ZHIYU_ELECTRON_STANDARD_DATA_ROOT: dataRoot,
          },
        });

        try {
          const page = await app.firstWindow();
          const pageProblems = trackPageProblems(page);
          await page.waitForLoadState('domcontentloaded');
          await clearZhiyuAIConfigStorage(page);
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
            'chat.stream',
            'text.embed',
            'image.generate',
          ]);
          assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'false');
          assert.equal(await page.locator('[data-zhiyu-capability-studio-run="text.generate"]').isDisabled(), true);
          assert.equal(await page.locator('[data-zhiyu-capability-studio-run="chat.stream"]').isDisabled(), true);
          assert.equal(await page.locator('[data-zhiyu-capability-studio-run="text.embed"]').isDisabled(), true);
          assert.equal(await page.locator('[data-zhiyu-image-generate-run="image.generate"]').isDisabled(), true);
          assert.equal(await page.locator('[data-zhiyu-ai-config-chip]').getAttribute('data-zhiyu-ai-config-binding-label'), '未绑定模型');

          await page.locator('textarea[aria-label="Image generation prompt"]').fill(
            '生成一张用于 Zhiyu Runtime image.generate 验收的工业级产品界面截图，包含长中文描述但不要遮挡主要内容。',
          );
          assert.equal(await page.locator('[data-zhiyu-image-generate-run="image.generate"]').isDisabled(), false);
          await page.locator('[data-zhiyu-image-generate-run="image.generate"]').click();
          await waitForEvidence(page, () => {
            const imageStudio = globalThis.window.__nimiZhiyuEvidence?.imageStudio;
            return imageStudio?.state === 'failed'
              && imageStudio?.reasonCode === 'ai-config-binding-missing'
              && imageStudio?.artifactCount === 0;
          }, 'Image Studio missing binding failure evidence');
          const imageMissingBindingEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          assert.equal(imageMissingBindingEvidence.imageStudio.ready, false);
          assert.equal(imageMissingBindingEvidence.imageStudio.reasonCode, 'ai-config-binding-missing');
          assert.equal(imageMissingBindingEvidence.imageStudio.artifactCount, 0);
          assert.equal(
            await page.locator('[data-zhiyu-image-generate-reason]').getAttribute('data-zhiyu-image-generate-reason'),
            'ai-config-binding-missing',
          );
          await captureLiveRuntimeEvidence(page, 'imageMissingBinding', pageProblems, {
            imageMissingBindingEvidence,
          });

          await page.getByRole('button', { name: '模型配置' }).click();
          await page.waitForSelector('[data-zhiyu-ai-config-drawer="open"]');
          const drawer = page.locator('[data-zhiyu-ai-config-drawer="open"]');
          await drawer
            .locator('button')
            .filter({ hasText: /Setup required|Select a model|需要模型目标|未配置/i })
            .first()
            .click();
          const picker = page.locator('[role="dialog"]').filter({ hasText: 'Select Model' }).last();
          await picker.waitFor();
          await picker.getByRole('button', { name: /runtime-agent-live-e2e/i }).first().click();
          await picker.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
          await selectRuntimeModelForCapability(page, drawer, {
            section: 'embed',
            capabilityId: 'text.embed',
            modelName: /runtime-agent-live-e2e-embedding/i,
          });
          await selectRuntimeModelForCapability(page, drawer, {
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
          const modelConfigEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          await captureLiveRuntimeEvidence(page, 'modelConfig', pageProblems, {
            modelConfigEvidence,
          });
          await page.getByRole('button', { name: '关闭模型配置' }).click();
          await page.waitForSelector('[data-zhiyu-ai-config-drawer="open"]', { state: 'detached' });

          const readyEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          assert.equal(readyEvidence.route.reasonCode, 'runtime-route-ready');
          assert.equal(readyEvidence.route.aiConfigScopeOwnerId, zhiyuAppId);
          assert.equal(readyEvidence.route.aiConfigScopeSurfaceId, 'zhiyu-agent-home');
          assert.equal(readyEvidence.route.targetRefKinds['text.generate'], 'local-runtime');
          assert.equal(readyEvidence.route.targetRefKinds['chat.stream'], 'local-runtime');
          assert.equal(readyEvidence.route.targetRefKinds['text.embed'], 'local-runtime');
          assert.equal(readyEvidence.route.targetRefKinds['image.generate'], 'cloud-connector');
          assert.equal(readyEvidence.route.executionBinding.route, 'local');
          assert.match(readyEvidence.route.executionBinding.modelId, /runtime-agent-live-e2e/);
          assert.equal(await page.locator('[data-zhiyu-product-stage]').getAttribute('data-zhiyu-product-stage'), 'ready');
          assert.equal(await page.locator('[data-zhiyu-readiness-score]').getAttribute('data-zhiyu-readiness-score'), '8/8');
          assert.match(await page.locator('[data-zhiyu-ai-config-chip]').getAttribute('data-zhiyu-ai-config-binding-label'), /runtime-agent-live-e2e/);
          assert.equal(await page.locator('[data-zhiyu-memory-observatory]').getAttribute('data-zhiyu-memory-ready'), 'true');
          assert.equal(await page.locator('[data-zhiyu-memory-graph-state]').getAttribute('data-zhiyu-memory-graph-state'), 'not_projected');
          assert.equal(
            await page.locator('[data-zhiyu-memory-graph-state]').getAttribute('data-zhiyu-memory-graph-reason'),
            'runtime-agent-memory-graph-relations-not-admitted',
          );
          await assertProductShellPrimaryView(page);
          await assertAvatarPanelProjection(page);
          const avatarEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          await captureLiveRuntimeEvidence(page, 'avatarBlocked', pageProblems, {
            avatarEvidence,
          });
          await captureLiveRuntimeEvidence(page, 'ready', pageProblems, {
            readyEvidence,
          });

          assert.equal(await page.locator('[data-zhiyu-image-studio]').getAttribute('data-zhiyu-image-studio'), 'failed');
          assert.equal(await page.locator('[data-zhiyu-image-studio-disabled]').getAttribute('data-zhiyu-image-studio-disabled'), 'false');
          await captureLiveRuntimeEvidence(page, 'imageReady', pageProblems, {
            readyEvidence,
            imageStudioEvidence: await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence),
          });

          await page.locator('[data-zhiyu-image-generate-run="image.generate"]').click();
          await waitForEvidence(page, () => {
            const imageStudio = globalThis.window.__nimiZhiyuEvidence?.imageStudio;
            const firstArtifact = imageStudio?.firstArtifact;
            return imageStudio?.ready === true
              && imageStudio?.state === 'succeeded'
              && imageStudio?.reasonCode === 'zhiyu-image-studio-artifacts-ready'
              && imageStudio?.artifactCount === 1
              && Boolean(imageStudio?.jobId)
              && Boolean(imageStudio?.traceId)
              && firstArtifact?.mimeType === 'image/png'
              && firstArtifact?.previewSource === 'inline-bytes'
              && typeof firstArtifact?.previewUrl === 'string'
              && firstArtifact.previewUrl.startsWith('data:image/png;base64,');
          }, 'Image Studio completed artifact evidence');
          const imageCompletedEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          assert.equal(imageCompletedEvidence.imageStudio.ready, true);
          assert.equal(imageCompletedEvidence.imageStudio.state, 'succeeded');
          assert.equal(imageCompletedEvidence.imageStudio.reasonCode, 'zhiyu-image-studio-artifacts-ready');
          assert.equal(imageCompletedEvidence.imageStudio.artifactCount, 1);
          assert.equal(imageCompletedEvidence.imageStudio.firstArtifact.mimeType, 'image/png');
          assert.equal(imageCompletedEvidence.imageStudio.firstArtifact.previewSource, 'inline-bytes');
          assert.equal(
            await page.locator('[data-zhiyu-image-generate-artifact-count]').getAttribute('data-zhiyu-image-generate-artifact-count'),
            '1',
          );
          assert.equal(
            await page.locator('[data-zhiyu-image-generate-preview-source]').getAttribute('data-zhiyu-image-generate-preview-source'),
            'inline-bytes',
          );
          assert.equal(await page.locator('[data-zhiyu-image-generate-preview="rendered"]').count(), 1);
          await captureLiveRuntimeEvidence(page, 'imageCompleted', pageProblems, {
            readyEvidence,
            imageCompletedEvidence,
          });

          const capabilityTextEvidence = await runCapabilityStudio(page, pageProblems, {
            capabilityId: 'text.generate',
            prompt: 'Generate a compact Zhiyu Runtime acceptance sentence.',
            stage: 'capabilityText',
            label: 'Capability Studio text.generate',
            predicate: () => {
              const studio = globalThis.window.__nimiZhiyuEvidence?.capabilityStudio;
              return studio?.state === 'succeeded'
                && studio?.lastCapabilityId === 'text.generate'
                && studio?.resultKind === 'text'
                && /Hello from the Runtime Agent live fixture/.test(`${studio.text || studio.message || ''}`);
            },
          });
          assert.equal(capabilityTextEvidence.capabilityStudio.ready, true);
          assert.equal(capabilityTextEvidence.capabilityStudio.reasonCode, 'zhiyu-capability-studio-text-ready');
          assert.equal(capabilityTextEvidence.capabilityStudio.resultKind, 'text');
          assert.match(capabilityTextEvidence.capabilityStudio.text, /Hello from the Runtime Agent live fixture/);

          const capabilityStreamEvidence = await runCapabilityStudio(page, pageProblems, {
            capabilityId: 'chat.stream',
            prompt: 'Stream a compact Zhiyu Runtime acceptance sentence.',
            stage: 'capabilityStream',
            label: 'Capability Studio chat.stream',
            predicate: () => {
              const studio = globalThis.window.__nimiZhiyuEvidence?.capabilityStudio;
              return studio?.state === 'succeeded'
                && studio?.lastCapabilityId === 'chat.stream'
                && studio?.resultKind === 'text'
                && /Hello from the Runtime Agent live fixture/.test(`${studio.streamingText || studio.text || studio.message || ''}`);
            },
          });
          assert.equal(capabilityStreamEvidence.capabilityStudio.ready, true);
          assert.equal(capabilityStreamEvidence.capabilityStudio.reasonCode, 'zhiyu-capability-studio-stream-ready');
          assert.equal(capabilityStreamEvidence.capabilityStudio.resultKind, 'text');
          assert.match(capabilityStreamEvidence.capabilityStudio.streamingText, /Hello from the Runtime Agent live fixture/);

          const capabilityEmbeddingEvidence = await runCapabilityStudio(page, pageProblems, {
            capabilityId: 'text.embed',
            prompt: 'embedding sample for Zhiyu Runtime acceptance',
            stage: 'capabilityEmbed',
            label: 'Capability Studio text.embed',
            predicate: () => {
              const studio = globalThis.window.__nimiZhiyuEvidence?.capabilityStudio;
              return studio?.state === 'succeeded'
                && studio?.lastCapabilityId === 'text.embed'
                && studio?.resultKind === 'embedding'
                && studio?.vectorCount === 1
                && studio?.dimensions === 4
                && Array.isArray(studio?.sample)
                && studio.sample.length > 0;
            },
          });
          assert.equal(capabilityEmbeddingEvidence.capabilityStudio.ready, true);
          assert.equal(capabilityEmbeddingEvidence.capabilityStudio.reasonCode, 'zhiyu-capability-studio-embedding-ready');
          assert.equal(capabilityEmbeddingEvidence.capabilityStudio.resultKind, 'embedding');
          assert.equal(capabilityEmbeddingEvidence.capabilityStudio.vectorCount, 1);
          assert.equal(capabilityEmbeddingEvidence.capabilityStudio.dimensions, 4);
          assert.ok(capabilityEmbeddingEvidence.capabilityStudio.sample.length > 0);
          assert.equal(
            await page.locator('[data-zhiyu-capability-studio-dimensions]').getAttribute('data-zhiyu-capability-studio-dimensions'),
            '4',
          );

          await page.locator('[data-chat-composer-textarea="true"]').fill('hello from Zhiyu live Runtime acceptance');
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
          await captureLiveRuntimeEvidence(page, 'chatCompleted', pageProblems, {
            readyEvidence,
            chatCompletedEvidence,
          });
          assertNoPageProblems(pageProblems);
        } finally {
          await app.close();
        }
      });
    },
  });
});

async function withTempDir(prefix, run) {
  const dir = await mkdtemp(path.join(tmpdir(), `nimi-zhiyu-electron-${prefix}-`));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function waitForEvidence(page, predicate, label) {
  try {
    await page.waitForFunction(predicate, undefined, { timeout: 45_000 });
  } catch (error) {
    const evidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence).catch((evalError) => ({
      evaluationError: evalError instanceof Error ? evalError.message : String(evalError),
    }));
    const aiConfigStorage = await page.evaluate(() => {
      const out = {};
      for (const key of Object.keys(globalThis.localStorage)) {
        if (key.includes('ai-config') || key.includes('agent-home-ai')) {
          out[key] = globalThis.localStorage.getItem(key);
        }
      }
      return out;
    }).catch(() => ({}));
    throw new Error(`${label} timed out: ${JSON.stringify({ evidence, aiConfigStorage })}`, { cause: error });
  }
}

async function clearZhiyuAIConfigStorage(page) {
  await page.evaluate(() => {
    const prefixes = [
      'nimiapp-zhiyu:agent-home-ai-config:v1',
      'nimiapp-zhiyu:agent-home-ai-snapshot:',
    ];
    const exactKeys = new Set([
      'nimiapp-zhiyu:ai-config:index:v1',
      'nimiapp-zhiyu:agent-home-ai-snapshot-index:v1',
    ]);
    for (const key of Object.keys(globalThis.localStorage)) {
      if (exactKeys.has(key) || prefixes.some((prefix) => key.startsWith(prefix))) {
        globalThis.localStorage.removeItem(key);
      }
    }
  });
}

async function selectRuntimeModelForCapability(page, drawer, input) {
  await openModelConfigSection(drawer, input.section);
  const capability = drawer.locator(`[data-nimi-model-config-capability="${input.capabilityId}"]`).first();
  await capability.waitFor({ timeout: 15_000 });
  await capability
    .locator('button')
    .filter({ hasText: /Setup required|Select a model/i })
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

async function runCapabilityStudio(page, pageProblems, input) {
  const prompt = page.locator('textarea[aria-label="Capability Studio prompt"]');
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

async function captureLiveRuntimeEvidence(page, stage, pageProblems, evidence) {
  const checkpoint = evidenceCheckpoint('live-runtime');
  const evidenceRoot = path.resolve(root, '..', '..', '.nimi', 'local', 'evidence', 'zhiyu', checkpoint);
  const screenshotNames = {
    ready: {
      desktop: 'live-runtime-ready-desktop.png',
      narrow: 'live-runtime-ready-narrow.png',
      evidence: 'live-runtime-ready-evidence.json',
    },
    modelConfig: {
      desktop: 'live-runtime-model-config-desktop.png',
      narrow: 'live-runtime-model-config-narrow.png',
      evidence: 'live-runtime-model-config-evidence.json',
    },
    chatCompleted: {
      desktop: 'live-runtime-agent-chat-completed-desktop.png',
      narrow: 'live-runtime-agent-chat-completed-narrow.png',
      evidence: 'live-runtime-agent-chat-completed-evidence.json',
    },
    capabilityText: {
      desktop: 'live-runtime-capability-text-desktop.png',
      narrow: 'live-runtime-capability-text-narrow.png',
      evidence: 'live-runtime-capability-text-evidence.json',
    },
    capabilityStream: {
      desktop: 'live-runtime-capability-stream-desktop.png',
      narrow: 'live-runtime-capability-stream-narrow.png',
      evidence: 'live-runtime-capability-stream-evidence.json',
    },
    capabilityEmbed: {
      desktop: 'live-runtime-capability-embed-desktop.png',
      narrow: 'live-runtime-capability-embed-narrow.png',
      evidence: 'live-runtime-capability-embed-evidence.json',
    },
    imageMissingBinding: {
      desktop: 'live-runtime-image-missing-binding-desktop.png',
      narrow: 'live-runtime-image-missing-binding-narrow.png',
      evidence: 'live-runtime-image-missing-binding-evidence.json',
    },
    imageReady: {
      desktop: 'live-runtime-image-ready-desktop.png',
      narrow: 'live-runtime-image-ready-narrow.png',
      evidence: 'live-runtime-image-ready-evidence.json',
    },
    imageCompleted: {
      desktop: 'live-runtime-image-completed-desktop.png',
      narrow: 'live-runtime-image-completed-narrow.png',
      evidence: 'live-runtime-image-completed-evidence.json',
    },
    avatarBlocked: {
      desktop: 'live-runtime-avatar-blocked-desktop.png',
      narrow: 'live-runtime-avatar-blocked-narrow.png',
      evidence: 'live-runtime-avatar-blocked-evidence.json',
    },
  }[stage];
  assert.ok(screenshotNames, `unsupported live Runtime evidence stage: ${stage}`);
  await mkdir(evidenceRoot, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: path.join(evidenceRoot, screenshotNames.desktop),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({
    path: path.join(evidenceRoot, screenshotNames.narrow),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const domEvidence = await page.evaluate(() => ({
    url: globalThis.location.href,
    title: globalThis.document.title,
    bodyText: globalThis.document.body?.innerText ?? '',
    zhiyuEvidence: globalThis.window.__nimiZhiyuEvidence ?? null,
  })).catch((error) => ({
    evaluationError: error instanceof Error ? error.message : String(error),
  }));
  await writeFile(
    path.join(evidenceRoot, screenshotNames.evidence),
    `${JSON.stringify({
      checkpoint,
      scenario: 'live-runtime',
      stage,
      pageProblems: [...pageProblems],
      ...evidence,
      domEvidence,
    }, null, 2)}\n`,
    'utf8',
  );
}

function evidenceCheckpoint(fallback) {
  return process.env.NIMI_ZHIYU_EVIDENCE_CHECKPOINT?.trim() || fallback;
}

function trackPageProblems(page) {
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(`console error: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
  });
  return problems;
}

function assertNoPageProblems(problems) {
  assert.deepEqual(problems, []);
}

async function assertProductShellPrimaryView(page) {
  const shell = page.locator('[data-zhiyu-product-shell="workspace"]');
  await shell.waitFor({ timeout: 15_000 });
  assert.equal(await shell.getAttribute('data-zhiyu-primary-ui'), 'true');

  const drawer = page.locator('#zhiyu-diagnostics-drawer');
  assert.equal(await drawer.getAttribute('data-zhiyu-diagnostics-drawer'), 'closed');
  assert.equal(await drawer.isHidden(), true);

  const primaryText = await shell.innerText();
  assert.match(primaryText, /本地 Agent 家园/);
  assert.match(primaryText, /打开诊断/);
  assert.doesNotMatch(
    primaryText,
    /not_projected|runtime-route-ready|runtime-agent-memory-graph-relations-not-admitted|zhiyu-ai-config-route-selection-required|ai-config-binding-missing|AIConfig targetRef|required for image\.generate|failed closed before request dispatch|Capability Studio has not run|Run core Runtime AI capabilities|configurationId|avatarDiagnosticCode|assetManifestPath|unsupportedFields/,
  );

  await page.locator('[data-zhiyu-diagnostics-toggle="open"]').click();
  await page.waitForSelector('[data-zhiyu-diagnostics-drawer="open"]', { state: 'visible' });
  const openDrawer = page.locator('[data-zhiyu-diagnostics-drawer="open"]');
  const drawerText = await openDrawer.innerText();
  assert.match(drawerText, /Runtime 诊断/);
  assert.equal(await openDrawer.locator('[data-zhiyu-region="diagnostics"]').count(), 1);
  assert.equal(await openDrawer.locator('[data-zhiyu-diagnostic-item]').count() > 0, true);

  await page.locator('[data-zhiyu-diagnostics-toggle="close"]').click();
  await page.waitForSelector('[data-zhiyu-diagnostics-drawer="closed"]', { state: 'attached' });
  assert.equal(await drawer.isHidden(), true);
}

async function assertAvatarPanelProjection(page) {
  const avatar = page.locator('[data-zhiyu-region="avatar"]');
  await avatar.waitFor({ timeout: 15_000 });
  assert.equal(await avatar.getAttribute('data-zhiyu-avatar-ready'), 'false');
  assert.equal(await avatar.getAttribute('data-zhiyu-avatar-control-state'), 'blocked');
  assert.equal(await avatar.getAttribute('data-zhiyu-avatar-launch-available'), 'false');
  assert.equal(await avatar.getAttribute('data-zhiyu-avatar-manage-available'), 'false');
  assert.equal(await avatar.getAttribute('data-zhiyu-avatar-unsupported-count'), '10');
  assert.equal(await avatar.locator('[data-avatar-backend-kind]').count(), 1);
  assert.equal(await avatar.locator('[data-zhiyu-avatar-launch-action]').count(), 0);
  assert.equal(await avatar.locator('[data-zhiyu-avatar-manage-action]').count(), 0);
  assert.equal(await avatar.locator('[data-zhiyu-avatar-unsupported-field]').count(), 0);
  const avatarText = await avatar.innerText();
  assert.match(avatarText, /Avatar 启动和管理只在 Runtime\/Avatar facade 投影明确授权后出现。/);
  assert.doesNotMatch(avatarText, /configurationId|avatarDiagnosticCode|assetManifestPath|motionState|expressionState/);
}

function rendererUrlForFixture(fixture) {
  const url = new URL(pathToFileURL(path.join(root, 'dist', 'index.html')).toString());
  url.searchParams.set('nimiElectronSdkAcceptance', '1');
  url.searchParams.set('nimiZhiyuLiveRuntimeFixture', encodeFixtureProjection(fixture));
  return url.toString();
}

function encodeFixtureProjection(fixture) {
  return Buffer.from(JSON.stringify({
    ownerUserId: fixture.ownerUserId,
    runtimeSourceRef: fixture.runtimeSourceRef,
    sourceRef: fixture.sourceRef,
    route: fixture.route,
  }), 'utf8').toString('base64url');
}
