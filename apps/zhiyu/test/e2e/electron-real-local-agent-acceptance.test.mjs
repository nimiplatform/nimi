import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { _electron as electron } from 'playwright';
import { createNimiRealmSourceMaterializationPacket } from '@nimiplatform/sdk/realm';
import { withSdkDistLock } from '../../../../scripts/lib/sdk-dist-lock.mjs';
import {
  createFixtureRuntimeAgentClient,
  setFixtureRuntimeAgentPresentationProfile,
} from '../../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-runtime.test-helper.ts';
import {
  SOURCE_MATERIALIZATION_AUDIENCE,
  withRuntimeAgentLiveE2EFixture,
} from '../../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture.test-helper.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const mainEntry = path.join(root, 'dist-electron', 'main.js');
const zhiyuAppId = 'nimi.zhiyu';
const zhiyuRuntimeProtectedScopes = [
  'runtime.agent.read',
  'runtime.agent.write',
  'runtime.agent.autonomy.write',
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
  'runtime.agent.delegation.read',
  'runtime.agent.delegation.write',
  'runtime.agent.ai_config.read',
  'runtime.agent.ai_config.write',
  'ai.spend.meter',
];
const zhiyuAcceptanceTargetDisplayName = '\u989c\u771f\u537f';
const zhiyuAcceptanceTargetSourceRef = {
  kind: 'worldCharacter',
  worldId: 'world-runtime-live',
  sourceId: 'source-runtime-live-yan-zhenqing',
  sourceContentHash: 'hash-runtime-live-yan-zhenqing',
};
const zhiyuAcceptanceAvatarAssetRef = 'vrm_aaaaaaaaaaaa';
const zhiyuAcceptanceBackgroundAssetRef = 'bg_bbbbbbbbbbbb';

test('zhiyu Electron real local-agent flow lists, selects, configures, and chats through Runtime', { timeout: 600_000 }, async () => {
  await resetRealLocalAgentEvidenceRoot();

  await withFixtureRuntimeLocalAgent(async ({ endpoint, targetAgent }) => {
    await withTempDir('real-local-agent', async (tmpRoot) => {
      const runtimeEndpoint = endpoint;
      const dataRoot = path.join(tmpRoot, 'standard-shell-data');
      await mkdir(dataRoot, { recursive: true });
      await seedStandardShellAppearanceAssets({
        dataRoot,
        ownerUserId: targetAgent.ownerUserId,
        localAgentRef: targetAgent.localAgentRef,
      });

      await withSdkDistLock('zhiyu real local-agent electron app', async () => {
        const app = await electron.launch({
          args: [mainEntry],
          env: {
            ...process.env,
            NIMI_RUNTIME_GRPC_ADDR: runtimeEndpoint,
            NIMI_ZHIYU_ELECTRON_RUNTIME_ENDPOINT: runtimeEndpoint,
            NIMI_ZHIYU_ELECTRON_STANDARD_DATA_ROOT: dataRoot,
          },
        });

        try {
      const page = await app.firstWindow();
      const pageProblems = trackPageProblems(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
      await page.waitForSelector('[data-zhiyu-screen="home"]');
      await assertProductDesignRegions(page);
      await assertMigratedDesktopLogo(page);

      await waitForEvidence(page, () =>
        globalThis.window.__nimiZhiyuEvidence?.runtime?.ready === true
        && globalThis.window.__nimiZhiyuEvidence?.auth?.ready === true
        && globalThis.window.__nimiZhiyuEvidence?.inventory?.ready === true,
        'real Runtime inventory',
      );

      const listedEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(listedEvidence.inventory.source, 'runtime');
      assert.equal(listedEvidence.inventory.count, listedEvidence.inventory.localAgents.length);
      assert.ok(listedEvidence.inventory.count > 0, 'Runtime listAgents returned no active LocalAgents');
      await assertRelationshipRail(page, listedEvidence.inventory.count);
      await assertUnselectedLocalPartnerEmptyState(page);

      const targetAgentEvidence = chooseTargetAgent(listedEvidence.inventory.localAgents, targetAgent.localAgentRef);
      const targetIndex = listedEvidence.inventory.localAgents.findIndex((agent) => agent.localAgentRef === targetAgentEvidence.localAgentRef);
      assert.notEqual(targetIndex, -1, 'target LocalAgent must be part of the listed Runtime inventory');
      assert.doesNotMatch(targetAgentEvidence.displayName || '', /\uFFFD/u, 'target LocalAgent display name must not contain replacement characters');
      assert.match(targetAgentEvidence.displayName || '', /\p{Script=Han}/u, 'target LocalAgent display name should remain human-readable Chinese for this acceptance scenario');
      await captureRealLocalAgentEvidence(page, 'listed', pageProblems, {
        runtimeEndpoint,
        targetAgent: targetAgentEvidence,
        listedEvidence,
      });

      const candidateButtons = page.locator('[data-zhiyu-local-agent-candidate="true"]');
      const switchAgent = listedEvidence.inventory.localAgents.find((agent) => agent.localAgentRef !== targetAgentEvidence.localAgentRef) || null;
      if (switchAgent) {
        const switchIndex = listedEvidence.inventory.localAgents.findIndex((agent) => agent.localAgentRef === switchAgent.localAgentRef);
        assert.notEqual(switchIndex, -1, 'switch LocalAgent must be part of the listed Runtime inventory');
        await candidateButtons.nth(switchIndex).waitFor({ timeout: 15_000 });
        await candidateButtons.nth(switchIndex).click();
        await waitForEvidence(page, (switchLocalAgentRef) =>
          globalThis.window.__nimiZhiyuEvidence?.localAgent?.ready === true
          && globalThis.window.__nimiZhiyuEvidence?.localAgent?.localAgentRef === switchLocalAgentRef
          && globalThis.window.__nimiZhiyuEvidence?.conversation?.ready === true,
          'switched real Runtime LocalAgent',
          switchAgent.localAgentRef,
        );
        const switchedEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
        assert.equal(switchedEvidence.localAgent.localAgentRef, switchAgent.localAgentRef);
        assert.equal(switchedEvidence.chat.state, 'idle');
        await captureRealLocalAgentEvidence(page, 'switched-away', pageProblems, {
          switchAgent,
          switchedEvidence,
        });
      }
      await candidateButtons.nth(targetIndex).waitFor({ timeout: 15_000 });
      await candidateButtons.nth(targetIndex).click();

      await waitForEvidence(page, (targetLocalAgentRef) =>
        globalThis.window.__nimiZhiyuEvidence?.localAgent?.ready === true
        && globalThis.window.__nimiZhiyuEvidence?.localAgent?.localAgentRef === targetLocalAgentRef
        && globalThis.window.__nimiZhiyuEvidence?.conversation?.ready === true,
        'selected real Runtime LocalAgent',
        targetAgentEvidence.localAgentRef,
      );

      const selectedEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(selectedEvidence.localAgent.reasonCode, 'runtime-local-agent-selected');
      assert.equal(selectedEvidence.localAgent.runtimeSourceRef, targetAgentEvidence.runtimeSourceRef);
      assert.equal(selectedEvidence.conversation.localAgentRef, targetAgentEvidence.localAgentRef);
      assert.equal(await page.locator('[data-zhiyu-product-stage]').getAttribute('data-zhiyu-product-stage'), 'ready');
      assert.equal(selectedEvidence.route.reasonCode, 'runtime-agent-ai-config-ready');
      assert.ok(
        new Set(['runtime', 'nimi.desktop', zhiyuAppId]).has(selectedEvidence.route.updatedByAppId),
        `real Runtime AI Config must be written by Runtime or an admitted first-party config writer, got ${selectedEvidence.route.updatedByAppId}`,
      );
      assert.equal(selectedEvidence.route.executionBinding?.route, 'local');
      assert.ok(selectedEvidence.route.executionBinding?.modelId, 'real Runtime route must expose the selected local model id');
      assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'false');
      await assertConversationTopStripRemoved(page);
      await assertProductDesignLayout(page, 'selected local agent');
      await captureRealLocalAgentEvidence(page, 'selected-closed-layout', pageProblems, {
        targetAgent: targetAgentEvidence,
        selectedEvidence,
      });
      await openAgentCenterOverview(page);
      await assertAgentCenterHeaderParity(page, selectedEvidence);
      await assertAgentCenterDoesNotNestSettings(page);
      await assertAppearanceConfigParity(page, async () => {
        await captureRealLocalAgentEvidence(page, 'appearance-config', pageProblems, {
          targetAgent: targetAgentEvidence,
          selectedEvidence,
          panelScreenshots: [
            'real-local-agent-appearance-config-panel.png',
            'real-local-agent-appearance-config-panel-bottom.png',
          ],
        });
        await captureRealLocalAgentPanelEvidence(page, 'appearance-config');
      });
      await assertSettingsEntryRoutesToAgentCenter(page, pageProblems, {
        targetAgent: targetAgentEvidence,
        selectedEvidence,
      });
      await captureRealLocalAgentEvidence(page, 'selected', pageProblems, {
        targetAgent: targetAgentEvidence,
        selectedEvidence,
      });

      await assertComposerModeTools(page);
      await page.locator('[data-zhiyu-composer-tool="model"]').click();
      const modelPanel = page.locator('[data-zhiyu-agent-panel-tab="model"]');
      await modelPanel.waitFor({ timeout: 15_000 });
      const modelConfig = page.locator('[data-zhiyu-agent-center-kit-surface="true"]');
      await modelConfig.waitFor({ timeout: 15_000 });
      await modelConfig.locator('#agent-center-model-title').waitFor({ timeout: 15_000 });
      assert.equal(await page.locator('[data-zhiyu-ai-config-drawer="open"]').count(), 0);
      assert.equal(await page.locator('[data-zhiyu-ai-config-embedded="agent-center"]').count(), 0);
      await assertAgentCenterModelPanelLayout(page, 'real local agent model panel');
      await captureRealLocalAgentEvidence(page, 'model-panel', pageProblems, {
        targetAgent: targetAgentEvidence,
        selectedEvidence,
      });

      const modelSelection = await selectTextGenerateModel(page, modelConfig);
      await waitForEvidence(page, () =>
        globalThis.window.__nimiZhiyuEvidence?.route?.reasonCode === 'runtime-agent-ai-config-ready'
        && Boolean(globalThis.window.__nimiZhiyuEvidence?.route?.executionBinding),
        'real Runtime model route ready',
      );

      const modelReadyEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(modelReadyEvidence.route.executionBinding.route === 'local' || modelReadyEvidence.route.executionBinding.route === 'cloud', true);
      assert.ok(modelReadyEvidence.route.executionBinding.modelId, 'Runtime route must expose a model id after model config');
      assert.equal(modelReadyEvidence.route.capabilities['text.generate'].state, 'ready');
      assert.equal(modelReadyEvidence.route.capabilities['text.embed'].state, 'ready');
      await captureRealLocalAgentEvidence(page, 'model-ready', pageProblems, {
        targetAgent: targetAgentEvidence,
        modelSelection,
        modelReadyEvidence,
      });

      await waitForEvidence(page, () => globalThis.window.__nimiZhiyuEvidence?.turn?.ready === true, 'real Runtime turn readiness');
      assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'false');
      await assertComposerModeTools(page);

      const prompt = process.env.NIMI_ZHIYU_ACCEPTANCE_CHAT_PROMPT?.trim()
        || '请用一句中文确认你是当前本地伙伴，并说明你已经准备好继续对话。';
      await page.locator('[data-chat-composer-textarea="true"]').fill(prompt);
      assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'true');
      await page.locator('[data-chat-composer-send="true"]').click();

      await waitForEvidence(page, (targetLocalAgentRef) =>
        globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'completed'
        && globalThis.window.__nimiZhiyuEvidence?.chat?.ready === true
        && Boolean(globalThis.window.__nimiZhiyuEvidence?.chat?.outputText)
        && globalThis.window.__nimiZhiyuEvidence?.chat?.localAgentRef === targetLocalAgentRef,
        'real Runtime Agent chat completed',
        targetAgentEvidence.localAgentRef,
      );

      const chatCompletedEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(chatCompletedEvidence.chat.source, 'runtime');
      assert.equal(chatCompletedEvidence.chat.localAgentRef, targetAgentEvidence.localAgentRef);
      assert.equal(chatCompletedEvidence.chat.conversationAnchorId, modelReadyEvidence.conversation.conversationAnchorId);
      assert.equal(chatCompletedEvidence.chat.state, 'completed');
      assert.equal(chatCompletedEvidence.chat.ready, true);
      assert.equal(chatCompletedEvidence.turn.ready, true);
      assert.equal(chatCompletedEvidence.turn.localAgentRef, targetAgentEvidence.localAgentRef);
      assert.equal(chatCompletedEvidence.turn.conversationAnchorId, modelReadyEvidence.conversation.conversationAnchorId);
      assert.equal(chatCompletedEvidence.turn.requestId, chatCompletedEvidence.chat.requestId);
      assert.ok(chatCompletedEvidence.turn.messageId, 'completed turn must expose the sealed assistant message id');
      assert.equal(chatCompletedEvidence.composer.submitState, 'accepted');
      assert.equal(chatCompletedEvidence.composer.draftLength, prompt.trim().length);
      assert.ok(chatCompletedEvidence.chat.messageCount >= 2, 'chat transcript must contain user and partner messages');
      assert.ok(chatCompletedEvidence.chat.outputText.trim().length > 0, 'chat outputText must not be empty');
      assert.doesNotMatch(chatCompletedEvidence.chat.outputText, /\uFFFD/u, 'chat outputText must not contain replacement characters');
      await assertChatCompletionReleased(page, prompt);
      await assertConversationTopStripRemoved(page);
      await assertProductDesignLayout(page, 'chat completed');
      assertNoPageProblems(pageProblems);
      await captureRealLocalAgentEvidence(page, 'chat-completed', pageProblems, {
        targetAgent: targetAgentEvidence,
        modelSelection,
        chatCompletedEvidence,
      });

      const followUpPrompt = process.env.NIMI_ZHIYU_ACCEPTANCE_FOLLOW_UP_PROMPT?.trim() || '继续用一句中文回应。';
      await page.locator('[data-chat-composer-textarea="true"]').fill(followUpPrompt);
      await page.waitForFunction(() =>
        document.querySelector('[data-zhiyu-composer-state]')?.getAttribute('data-zhiyu-composer-state') === 'ready'
        && document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
        && document.querySelector('[data-chat-composer-send="true"]')?.disabled === false,
      );
      const followUpReadyEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(followUpReadyEvidence.chat.state, 'completed');
      assert.equal(await page.locator('[data-chat-composer-textarea="true"]').isDisabled(), false);
      assert.equal(await page.locator('[data-chat-composer-send="true"]').isDisabled(), false);
      await captureRealLocalAgentEvidence(page, 'follow-up-ready', pageProblems, {
        targetAgent: targetAgentEvidence,
        modelSelection,
        followUpPromptLength: followUpPrompt.length,
        followUpReadyEvidence,
      });
        } finally {
          await app.close();
        }
      });
    });
  });
});

async function assertProductDesignRegions(page) {
  for (const region of ['presence', 'conversation']) {
    await page.locator(`[data-zhiyu-region="${region}"]`).first().waitFor({ state: 'visible', timeout: 15_000 });
  }
  assert.equal(
    await page.locator('[data-zhiyu-side-panel-state]').getAttribute('data-zhiyu-side-panel-state'),
    'closed',
    'Agent Center must be closed by default in the primary chat layout',
  );
  assert.equal(await page.locator('[data-zhiyu-region="agent-panel"]').count(), 0);
}

async function assertMigratedDesktopLogo(page) {
  const logoContainer = page.locator('[data-zhiyu-desktop-logo-image="nimi"]').first();
  const logoImage = logoContainer.locator('img').first();
  await logoImage.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(
    await logoContainer.locator('svg').count(),
    0,
    'Desktop left rail brand mark must render the migrated Nimi logo image, not a placeholder icon',
  );
  const imageState = await logoImage.evaluate((node) => {
    const image = node;
    return {
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      src: image.currentSrc || image.src,
    };
  });
  assert.equal(imageState.complete, true, 'migrated Nimi logo image must finish loading in the real Electron shell');
  assert.ok(imageState.naturalWidth > 0, 'migrated Nimi logo image must not be broken');
  assert.ok(imageState.naturalHeight > 0, 'migrated Nimi logo image must not be broken');
  assert.match(imageState.src, /logo(?:-[A-Za-z0-9_-]+)?\.png/);
}

async function assertRelationshipRail(page, expectedCount) {
  const rail = page.locator('[data-zhiyu-region="relationship-rail"]').first();
  await rail.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(
    await rail.locator('[data-zhiyu-local-agent-candidate="true"]').count(),
    expectedCount,
    'Desktop relationship rail must render every Runtime LocalAgent returned by listAgents',
  );
  await page.locator('[data-zhiyu-settings-entry="presence-rail"]').waitFor({ state: 'visible', timeout: 15_000 });
}

async function assertSettingsEntryRoutesToAgentCenter(page, pageProblems, evidence) {
  await page.locator('[data-zhiyu-settings-entry="presence-rail"]').click();
  await page.locator('[data-zhiyu-agent-panel-mode="agent"]').waitFor({ state: 'visible', timeout: 15_000 });
  await agentCenterSectionButton(page, 'advanced').waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await agentCenterSectionButton(page, 'advanced').getAttribute('aria-current'), 'page');
  await page.locator('[data-zhiyu-agent-panel-tab="advanced"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('#agent-center-advanced-title').waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await page.locator('[data-zhiyu-agent-center-capability-probe="open"]').count(), 0);
  assert.equal(
    await page.locator('[data-zhiyu-settings-panel="right"]').count(),
    0,
    'presence rail settings entry must route to Agent Center advanced tab, not a second settings panel',
  );
  assert.equal(
    await page.locator('[data-zhiyu-agent-panel-footer-tab]').count(),
    0,
    'right panel must not expose a nested Agent/Settings footer switch',
  );
  await captureRealLocalAgentEvidence(page, 'settings-entry-advanced', pageProblems, evidence);
  await page.locator('[data-zhiyu-agent-panel-close="true"]').click();
  await page.locator('[data-zhiyu-region="agent-panel"]').waitFor({ state: 'detached', timeout: 15_000 });
  assert.equal(
    await page.locator('[data-zhiyu-side-panel-state]').getAttribute('data-zhiyu-side-panel-state'),
    'closed',
    'right Agent Center panel must be collapsible from its close affordance',
  );
  await captureRealLocalAgentEvidence(page, 'side-panel-closed', pageProblems, evidence);
  await page.locator('[data-zhiyu-local-agent-candidate-active="true"]').click();
  await page.locator('[data-zhiyu-agent-panel-mode="agent"]').waitFor({ state: 'visible', timeout: 15_000 });
}

async function assertAgentCenterDoesNotNestSettings(page) {
  await openKitAgentCenterSection(page, 'behavior');
  await page.locator('[data-zhiyu-agent-panel-mode="agent"]').waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(
    await page.locator('[data-zhiyu-settings-panel="right"]').count(),
    0,
    'Agent Center Behavior tab must not open the generic Settings page',
  );
  assert.match(await page.locator('[data-zhiyu-agent-center-kit-surface="true"]').innerText(), /主动陪伴/);
  assert.equal(await page.locator('[data-zhiyu-agent-behavior-panel="true"]').count(), 0);
  await openKitAgentCenterSection(page, 'cognition');
  await page.locator('[data-zhiyu-agent-panel-mode="agent"]').waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(
    await page.locator('[data-zhiyu-settings-panel="right"]').count(),
    0,
    'Agent Center Cognition tab must not open the generic Settings page',
  );
  assert.match(await page.locator('[data-zhiyu-agent-center-kit-surface="true"]').innerText(), /认知状态|最近记忆/);
  assert.equal(await page.locator('[data-zhiyu-agent-cognition-panel="true"]').count(), 0);
  await openKitAgentCenterSection(page, 'advanced');
  assert.equal(
    await page.locator('[data-zhiyu-settings-panel="right"]').count(),
    0,
    'Agent Center Advanced tab must not open the generic Settings page',
  );
  assert.match(await page.locator('[data-zhiyu-agent-center-kit-surface="true"]').innerText(), /高级|运行时投影|配置版本/);
  assert.equal(await page.locator('[data-zhiyu-agent-advanced-panel="true"]').count(), 0);
  await openKitAgentCenterSection(page, 'overview');
}

async function assertAgentCenterHeaderParity(page, evidence) {
  await page.setViewportSize({ width: 1280, height: 900 });
  const header = page.locator('[data-zhiyu-agent-center-header="true"]').first();
  await header.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await header.locator('[data-zhiyu-agent-center-eyebrow]').innerText(), '智能体中心');
  const localAgentRef = evidence.localAgent.localAgentRef;
  assert.ok(localAgentRef, 'selected real LocalAgent evidence must include a localAgentRef');
  assert.equal(await header.locator('[data-zhiyu-agent-center-local-agent-ref]').count(), 0);
  assert.equal((await header.innerText()).includes(localAgentRef), false, 'opaque Runtime LocalAgent ref must stay out of the user-facing header');
  const currentAgent = evidence.inventory.localAgents.find((agent) => agent.localAgentRef === localAgentRef);
  assert.equal(await header.locator('[data-zhiyu-agent-center-world-chip]').count(), 0, 'old world-role chip must not render');
  if (currentAgent?.sourceKind === 'worldCharacter') {
    assert.ok(currentAgent.sourceWorldName, 'world-character LocalAgent evidence must include the resolved sourceWorldName');
    const worldName = header.locator('[data-zhiyu-agent-center-world-name]').first();
    await worldName.waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal((await worldName.innerText()).trim(), currentAgent.sourceWorldName);
    assert.equal(await header.locator('[data-zhiyu-agent-center-world-icon]').count(), 1);
    assert.equal((await header.innerText()).includes('世界角色'), false, 'world metadata must render the world name instead of the role tag');
  } else {
    assert.equal(await header.locator('[data-zhiyu-agent-center-world-name]').count(), 0);
  }
  const runtimePill = header.locator('[data-zhiyu-agent-center-runtime-pill]').first();
  await runtimePill.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal((await runtimePill.innerText()).trim(), '运行时');
  assert.equal(await runtimePill.getAttribute('data-zhiyu-agent-center-runtime-pill'), 'ready');
  const headerLayout = await header.evaluate((root) => {
    const eyebrow = root.querySelector('[data-zhiyu-agent-center-eyebrow]');
    const pill = root.querySelector('[data-zhiyu-agent-center-runtime-pill]');
    const name = root.querySelector('.zhiyu-agent-center__title strong');
    const eyebrowRow = root.querySelector('.zhiyu-agent-center__chrome-row');
    const box = (element) => {
      const rect = element?.getBoundingClientRect();
      return rect
        ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, yCenter: rect.top + rect.height / 2 }
        : null;
    };
    return {
      eyebrow: box(eyebrow),
      pill: box(pill),
      name: box(name),
      eyebrowRowClass: eyebrowRow?.getAttribute('class') ?? '',
    };
  });
  assert.match(headerLayout.eyebrowRowClass, /\bgap-2\b/, `运行时 pill row must keep the requested compact text gap: ${JSON.stringify(headerLayout)}`);
  assert.ok(headerLayout.eyebrow && headerLayout.pill && headerLayout.name, `header placement evidence missing: ${JSON.stringify(headerLayout)}`);
  const eyebrowToPillGap = headerLayout.pill.left - headerLayout.eyebrow.right;
  assert.ok(eyebrowToPillGap >= 8 && eyebrowToPillGap <= 24, `运行时 pill must sit close to the 智能体中心 label: ${JSON.stringify({ eyebrowToPillGap, headerLayout })}`);
  assert.ok(Math.abs(headerLayout.pill.yCenter - headerLayout.eyebrow.yCenter) <= 4, `运行时 pill must share the 智能体中心 row: ${JSON.stringify(headerLayout)}`);
  assert.ok(headerLayout.name.top >= headerLayout.pill.bottom - 1, `partner name must stay below the Runtime pill row: ${JSON.stringify(headerLayout)}`);

  const stateChips = header.locator('[data-zhiyu-agent-center-state-chip]');
  const stateChipTexts = await stateChips.evaluateAll((elements) =>
    elements.map((element) => element.textContent?.trim() || ''),
  );
  assert.deepEqual(
    stateChipTexts.filter((text) => /not_configured|not_projected|unknown/iu.test(text)),
    [],
    `Agent Center header must not render missing state chips: ${JSON.stringify(stateChipTexts)}`,
  );
  assert.deepEqual(
    stateChipTexts.filter((text) => text.toLowerCase() === 'ready'),
    [],
    `Agent Center header must not duplicate generic ready state chips: ${JSON.stringify(stateChipTexts)}`,
  );
  if (!isMeaningfulHeaderState(evidence.companion.currentEmotion)) {
    assert.equal(await header.locator('[data-zhiyu-agent-center-state-chip="mood"]').count(), 0);
  }
  if (!isMeaningfulHeaderState(evidence.companion.executionState)) {
    assert.equal(await header.locator('[data-zhiyu-agent-center-state-chip="activity"]').count(), 0);
  }
  assert.equal(
    await header.locator('[data-zhiyu-agent-center-state-chip="appearance"]').count(),
    0,
    'not_configured appearance state must be handled by the checklist instead of duplicated in the header',
  );
}

function isMeaningfulHeaderState(value) {
  const normalized = String(value || '').trim().toLowerCase().replaceAll('-', '_');
  return Boolean(
    normalized
    && normalized !== 'not_projected'
    && !normalized.startsWith('not_projected_')
    && normalized !== 'not_configured'
    && normalized !== 'not_selected'
    && normalized !== 'unknown'
    && normalized !== 'ready',
  );
}

function agentCenterSectionButton(page, section) {
  return page.locator(`[data-testid="chat-agent-center-section:${section}"]`).first();
}

async function openKitAgentCenterSection(page, section) {
  const button = agentCenterSectionButton(page, section);
  await button.waitFor({ state: 'visible', timeout: 15_000 });
  await button.click();
  await page.locator('[data-zhiyu-agent-panel-tab]').first().waitFor({ timeout: 15_000 });
  assert.equal(
    await page.locator('[data-zhiyu-agent-panel-tab]').first().getAttribute('data-zhiyu-agent-panel-tab'),
    section,
    `Agent Center placement must project active Kit section ${section}`,
  );
  await page.locator(`#agent-center-${section}-title`).waitFor({
    state: section === 'appearance' ? 'attached' : 'visible',
    timeout: 15_000,
  });
  assert.equal(await button.getAttribute('aria-current'), 'page');
  return button;
}

async function openAgentCenterOverview(page) {
  await page.locator('[data-zhiyu-composer-tool="agent"]').click();
  await page.locator('[data-zhiyu-agent-panel-mode="agent"]').waitFor({ state: 'visible', timeout: 15_000 });
  await agentCenterSectionButton(page, 'overview').waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await agentCenterSectionButton(page, 'overview').getAttribute('aria-current'), 'page');
}

async function assertAppearanceConfigParity(page, captureAppearanceEvidence) {
  await openKitAgentCenterSection(page, 'appearance');
  const panel = page.locator('[data-zhiyu-agent-center-kit-surface="true"]').first();
  await panel.waitFor({ timeout: 15_000 });
  await panel.locator('#agent-center-appearance-title').waitFor({ state: 'attached', timeout: 15_000 });

  const panelText = await panel.innerText();
  for (const label of ['外观', '伙伴形象', '当前形象', '让形象显示出来', '形象管理', '聊天背景', '技术详情']) {
    assert.match(panelText, new RegExp(label), `Appearance panel must include redesigned ${label} structure`);
  }
  assert.doesNotMatch(panelText, /动态效果/u, 'Appearance panel must not expose a non-actionable dynamic effects module');

  for (const label of ['继续完成配置', '更换形象', '导入 Live2D 文件夹', '导入 VRM 文件', '选择旁路配置文件', '上传背景图片', '选择推荐背景']) {
    await panel.getByText(label, { exact: false }).waitFor({ state: 'visible', timeout: 15_000 });
  }

  for (const selector of [
    '[data-agent-center-appearance-surface="visual-setup"]',
    '[data-agent-center-appearance-hero="character-preview"]',
    '[data-agent-center-appearance-avatar-card="true"]',
    '[data-agent-center-appearance-avatar-preview="configured"]',
    '[data-agent-center-appearance-primary-action="continue"]',
    '[data-agent-center-appearance-secondary-action="change"]',
    '[data-agent-center-appearance-progress="display-checklist"]',
    '[data-agent-center-appearance-management="asset-import"]',
    '[data-agent-center-appearance-background="chat-scene"]',
    '[data-agent-center-appearance-diagnostics="collapsed"]',
  ]) {
    await panel.locator(selector).waitFor({ state: 'visible', timeout: 15_000 });
  }

  const preview = panel.locator('[data-avatar-preview-tier="avatar_preview_service"]').first();
  await preview.waitFor({ state: 'attached', timeout: 15_000 });
  assert.equal(await preview.getAttribute('data-avatar-preview-nonplaceholder'), 'false');
  assert.equal(
    await panel.locator('[data-avatar-preview-nonplaceholder="true"]').count(),
    0,
    'Shell material without a registered Avatar preview surface must never appear Ready',
  );

  const backgroundCard = panel.locator('[data-agent-center-appearance-background="chat-scene"]').first();
  const backgroundCardText = await backgroundCard.innerText();
  assert.doesNotMatch(
    backgroundCardText,
    /尚未设置/u,
    'Chat background placeholder must not duplicate the unset state with a text badge',
  );

  const progressBarWidth = await panel.locator('[data-agent-center-appearance-progress-bar]').evaluate((element) =>
    (element instanceof HTMLElement ? element.style.width : ''),
  );
  assert.match(progressBarWidth, /^\d+%$/u, `Appearance progress bar must expose a concrete percentage width: ${progressBarWidth}`);

  const recommendedBackgroundButton = panel.getByRole('button', { name: /选择推荐背景/u }).first();
  await recommendedBackgroundButton.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await recommendedBackgroundButton.isDisabled(), true, 'recommended background must stay disabled until a typed adapter exists');

  const diagnostics = panel.locator('[data-agent-center-appearance-diagnostics="collapsed"]').first();
  await diagnostics.locator('summary').click();
  await panel.locator('[data-agent-center-avatar-autoplay="true"]').waitFor({ state: 'visible', timeout: 15_000 });
  await diagnostics.locator('summary').click();

  await assertAppearanceNarrowLayout(page, panel);

  if (captureAppearanceEvidence) {
    await captureAppearanceEvidence();
  }

  await openKitAgentCenterSection(page, 'overview');
}

async function assertAppearanceNarrowLayout(page, panel) {
  await page.setViewportSize({ width: 390, height: 900 });
  await panel.locator('[data-agent-center-appearance-surface="visual-setup"]').waitFor({ state: 'visible', timeout: 15_000 });
  const layout = await page.evaluate(() => {
    const surface = document.querySelector('[data-agent-center-appearance-surface="visual-setup"]');
    const rect = surface?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      surfaceWidth: rect?.width ?? 0,
      surfaceRight: rect?.right ?? 0,
    };
  });
  assert.ok(layout.surfaceWidth > 0, `appearance surface must render on narrow viewport: ${JSON.stringify(layout)}`);
  assert.ok(layout.scrollWidth <= layout.viewportWidth + 1, `appearance narrow viewport must not horizontally overflow: ${JSON.stringify(layout)}`);
  assert.ok(layout.surfaceRight <= layout.viewportWidth + 1, `appearance surface must stay inside narrow viewport: ${JSON.stringify(layout)}`);
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function assertComposerModeTools(page) {
  for (const tool of ['voice-capture', 'agent', 'hands-free', 'proactive', 'model']) {
    await page.locator(`[data-zhiyu-composer-tool="${tool}"]`).waitFor({ state: 'visible', timeout: 15_000 });
  }
  const captureTool = page.locator('[data-zhiyu-composer-tool="voice-capture"]').first();
  assert.equal(await captureTool.getAttribute('data-zhiyu-chat-voice-capture-state'), 'failed');
  assert.equal(await captureTool.getAttribute('data-zhiyu-chat-voice-capture-ready'), 'false');
  assert.equal(
    await captureTool.getAttribute('data-zhiyu-chat-voice-capture-reason'),
    'runtime-voice-capture-route-not-ready',
  );
  assert.equal(await captureTool.isDisabled(), true);

  const voiceTool = page.locator('[data-zhiyu-composer-tool="hands-free"]').first();
  assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-state'), 'idle');
  assert.equal(
    await voiceTool.getAttribute('data-zhiyu-chat-voice-reason'),
    'runtime-voice-no-current-output',
  );
  assert.equal(await voiceTool.isDisabled(), true);
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
    const sectionButtons = [...document.querySelectorAll('[data-testid^="chat-agent-center-section:"]')]
      .map((element) => element.getAttribute('data-testid')?.replace(/^chat-agent-center-section:/u, '') || '')
      .filter(Boolean);
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      panel: box('[data-zhiyu-region="agent-panel"]'),
      header: box('[data-zhiyu-agent-center-header="true"]'),
      kitSurface: box('[data-zhiyu-agent-center-kit-surface="true"]'),
      modelTitle: box('#agent-center-model-title'),
      activeTab: box('[data-testid="chat-agent-center-section:model"][aria-current="page"]'),
      composer: box('.zhiyu-chat-canvas__composer [data-canonical-composer-width]'),
      textarea: box('[data-chat-composer-textarea="true"]'),
      sectionButtons,
      legacyAiConfigCount: document.querySelectorAll('[data-zhiyu-ai-config-embedded="agent-center"]').length,
    };
  });
  assert.ok(metrics.panel, `${label}: Agent Center panel must render on wide desktop`);
  assert.ok(metrics.header, `${label}: Agent Center header must render`);
  assert.ok(metrics.kitSurface, `${label}: Kit Agent Center surface must render`);
  assert.ok(metrics.modelTitle, `${label}: model section title must render`);
  assert.ok(metrics.activeTab, `${label}: model section button must expose active page semantics`);
  assert.ok(metrics.composer, `${label}: composer must render`);
  assert.ok(metrics.textarea, `${label}: composer textarea must render`);
  assert.equal(metrics.legacyAiConfigCount, 0, `${label}: legacy Zhiyu AIConfig must not be embedded in Agent Center`);
  for (const section of ['overview', 'model', 'behavior', 'cognition', 'appearance', 'advanced']) {
    assert.ok(metrics.sectionButtons.includes(section), `${label}: Kit Agent Center section ${section} is missing: ${JSON.stringify(metrics)}`);
  }
  assert.ok(metrics.panel.y <= 64, `${label}: Agent Center is vertically detached from desktop side-sheet rhythm: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.panel.height >= metrics.viewport.height - 112, `${label}: Agent Center should use the available desktop side-sheet height: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.kitSurface.y >= metrics.header.bottom - 4, `${label}: Kit surface overlaps the Zhiyu placement header: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.modelTitle.y >= metrics.kitSurface.y - 4, `${label}: model title escapes the Kit surface: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.textarea.height <= 80, `${label}: composer textarea should keep Kit compact auto-height when empty: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.composer.height <= 190, `${label}: composer surface is too tall for desktop agent chat: ${JSON.stringify(metrics)}`);
  const { evidenceRoot } = resolveEvidenceRoot();
  await mkdir(evidenceRoot, { recursive: true });
  await page.screenshot({
    path: path.join(evidenceRoot, 'real-local-agent-model-panel-wide.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function assertConversationTopStripRemoved(page) {
  const conversation = page.locator('[data-zhiyu-region="conversation"]').first();
  assert.equal(await conversation.locator('.zhiyu-home__stage-topbar').count(), 0);
  assert.equal(await conversation.locator('.zhiyu-home__model-config-row').count(), 0);
  assert.equal(await conversation.locator('[data-zhiyu-ai-config-chip]').count(), 0);
  assert.equal(await conversation.locator('[data-zhiyu-model-config-entry="conversation"]').count(), 0);
  assert.equal(await conversation.locator('button[aria-label="通知"], button[aria-label="账户"]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-topbar-chrome="true"]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-topbar-notifications="true"]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-topbar-account="true"]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-primary-action]').count(), 0);
}

async function assertProductDesignLayout(page, label) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await assertDesktopAgentChatVisualFidelity(page, label);
  const presence = await visibleBox(page.locator('[data-zhiyu-region="presence"]').first(), `${label} presence rail`);
  const conversation = await visibleBox(page.locator('[data-zhiyu-region="conversation"]').first(), `${label} conversation`);
  const relationship = await visibleBox(page.locator('[data-zhiyu-region="relationship-rail"]').first(), `${label} relationship rail`);
  const sidePanelState = await page.locator('[data-zhiyu-side-panel-state]').getAttribute('data-zhiyu-side-panel-state');
  assert.ok(presence.x < conversation.x, `${label}: presence rail should be left of conversation`);
  assert.ok(relationship.width <= presence.width, `${label}: contacts rail should remain inside the left presence rail`);
  assert.ok(
    relationship.x >= presence.x - 1 && relationship.x + relationship.width <= presence.x + presence.width + 1,
    `${label}: contacts rail must be contained by the left presence rail`,
  );
  assert.ok(conversation.width >= 520, `${label}: conversation should remain the primary desktop work area`);
  await assertDesktopRelationshipRailDensity(page, label);
  if (sidePanelState === 'closed') {
    assert.equal(await page.locator('[data-zhiyu-region="agent-panel"]').count(), 0, `${label}: Agent Center must be detached in closed layout`);
    const centered = await page.evaluate(() => {
      const conversationNode = document.querySelector('[data-zhiyu-region="conversation"]');
      const transcript = document.querySelector('.zhiyu-chat-canvas__transcript [data-canonical-transcript-width]');
      const composer = document.querySelector('.zhiyu-chat-canvas__composer [data-canonical-composer-width]');
      const conversationRect = conversationNode?.getBoundingClientRect();
      const transcriptRect = transcript?.getBoundingClientRect();
      const composerRect = composer?.getBoundingClientRect();
      if (!conversationRect || !transcriptRect || !composerRect) {
        return { missing: true };
      }
      const conversationCenter = conversationRect.left + conversationRect.width / 2;
      const transcriptCenter = transcriptRect.left + transcriptRect.width / 2;
      const composerCenter = composerRect.left + composerRect.width / 2;
      return {
        missing: false,
        conversation: { left: conversationRect.left, right: conversationRect.right, width: conversationRect.width },
        transcript: { left: transcriptRect.left, right: transcriptRect.right, width: transcriptRect.width, centerDelta: Math.abs(transcriptCenter - conversationCenter) },
        composer: { left: composerRect.left, right: composerRect.right, width: composerRect.width, centerDelta: Math.abs(composerCenter - conversationCenter) },
      };
    });
    assert.equal(centered.missing, false, `${label}: centered chat metrics must be available`);
    assert.ok(centered.transcript.centerDelta <= 28, `${label}: transcript should be centered in the closed conversation track: ${JSON.stringify(centered)}`);
    assert.ok(centered.composer.centerDelta <= 28, `${label}: composer should be centered in the closed conversation track: ${JSON.stringify(centered)}`);
    assert.ok(centered.transcript.left >= centered.conversation.left - 1 && centered.transcript.right <= centered.conversation.right + 1, `${label}: transcript must stay inside conversation track: ${JSON.stringify(centered)}`);
    assert.ok(centered.composer.left >= centered.conversation.left - 1 && centered.composer.right <= centered.conversation.right + 1, `${label}: composer must stay inside conversation track: ${JSON.stringify(centered)}`);
  } else {
    const side = await visibleBox(page.locator('[data-zhiyu-region="agent-panel"]').first(), `${label} agent panel`);
    assert.ok(conversation.x < side.x, `${label}: conversation should be left of right agent panel`);
    assert.ok(side.width >= 300, `${label}: right agent panel should have usable desktop width`);
    await assertDesktopAgentCenterSideSheetDensity(page, label);
  }

  await page.setViewportSize({ width: 390, height: 900 });
  const narrowPresence = await visibleBox(page.locator('[data-zhiyu-region="presence"]').first(), `${label} narrow presence rail`);
  const narrowConversation = await visibleBox(page.locator('[data-zhiyu-region="conversation"]').first(), `${label} narrow conversation`);
  const narrowRelationship = await visibleBox(page.locator('[data-zhiyu-region="relationship-rail"]').first(), `${label} narrow relationship rail`);
  assert.ok(narrowConversation.width <= 390, `${label}: narrow conversation should not overflow the viewport`);
  assert.ok(narrowRelationship.width <= narrowPresence.width, `${label}: narrow contacts rail should stay inside the presence rail`);
  assert.ok(narrowRelationship.x >= narrowPresence.x - 1 && narrowRelationship.x + narrowRelationship.width <= narrowPresence.x + narrowPresence.width + 1, `${label}: narrow contacts rail must be contained by the left presence rail`);
  if (sidePanelState === 'closed') {
    assert.equal(await page.locator('[data-zhiyu-region="agent-panel"]').count(), 0, `${label}: narrow closed layout must not render Agent Center`);
    assert.ok(
      narrowPresence.x < narrowConversation.x || narrowPresence.y < narrowConversation.y,
      `${label}: narrow contacts rail should stay before the conversation`,
    );
  } else {
    const narrowSide = await visibleBox(page.locator('[data-zhiyu-region="agent-panel"]').first(), `${label} narrow agent panel`);
    const narrowGridDebug = await page.evaluate(() => {
      const layout = document.querySelector('[data-zhiyu-side-panel-state]');
      if (!layout) {
        return { missing: true };
      }
      const style = getComputedStyle(layout);
      return {
        missing: false,
        className: layout.getAttribute('class'),
        state: layout.getAttribute('data-zhiyu-side-panel-state'),
        gridTemplateAreas: style.gridTemplateAreas,
        gridTemplateColumns: style.gridTemplateColumns,
        gridTemplateRows: style.gridTemplateRows,
        display: style.display,
      };
    });
    assert.ok(
      narrowSide.y > narrowConversation.y,
      `${label}: agent panel should stack below conversation on narrow viewports: ${JSON.stringify({ narrowGridDebug, narrowPresence, narrowConversation, narrowRelationship, narrowSide })}`,
    );
    assert.ok(
      narrowPresence.x < narrowConversation.x || narrowPresence.y < narrowConversation.y,
      `${label}: narrow contacts rail should stay before the conversation when Agent Center is open`,
    );
    assert.ok(narrowSide.width <= 390, `${label}: narrow agent panel should not overflow the viewport`);
  }
  const horizontalOverflow = await page.evaluate(() =>
    globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth,
  );
  assert.ok(horizontalOverflow <= 2, `${label}: narrow layout overflows horizontally by ${horizontalOverflow}px`);
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function assertDesktopAgentChatVisualFidelity(page, label) {
  const metrics = await page.evaluate(() => {
    const root = document.querySelector('[data-zhiyu-agent-chat-shell="primary"]');
    const workspace = document.querySelector('[data-zhiyu-product-shell="workspace"]');
    const layout = document.querySelector('[data-zhiyu-side-panel-state]');
    const conversation = document.querySelector('[data-zhiyu-region="conversation"]');
    const side = document.querySelector('[data-zhiyu-region="agent-panel"]');
    const readStyle = (node) => {
      if (!node) {
        return null;
      }
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderTopWidth: style.borderTopWidth,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        columnGap: style.columnGap,
        height: rect.height,
        marginTop: style.marginTop,
        paddingLeft: style.paddingLeft,
        paddingTop: style.paddingTop,
        rowGap: style.rowGap,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      };
    };
    return {
      root: readStyle(root),
      workspace: readStyle(workspace),
      layout: readStyle(layout),
      conversation: readStyle(conversation),
      side: readStyle(side),
    };
  });
  assert.ok(metrics.root?.backgroundImage?.includes('radial-gradient'), `${label}: shell must preserve the misty multi-layer Desktop Agent Chat background: ${JSON.stringify(metrics.root)}`);
  assert.equal(metrics.workspace?.paddingLeft, '0px', `${label}: workspace must not introduce an outer white-card gutter: ${JSON.stringify(metrics.workspace)}`);
  assert.equal(metrics.workspace?.paddingTop, '0px', `${label}: workspace must not introduce an outer white-card gutter: ${JSON.stringify(metrics.workspace)}`);
  assert.equal(metrics.layout?.columnGap, '0px', `${label}: desktop shell grid should preserve Desktop Agent Chat track rhythm without card gaps: ${JSON.stringify(metrics.layout)}`);
  assert.equal(metrics.layout?.rowGap, '0px', `${label}: desktop shell grid should preserve Desktop Agent Chat track rhythm without card gaps: ${JSON.stringify(metrics.layout)}`);
  assert.equal(metrics.conversation?.borderTopWidth, '0px', `${label}: conversation canvas must remain visually transparent, not become a bordered white panel: ${JSON.stringify(metrics.conversation)}`);
  assert.equal(metrics.conversation?.borderRadius, '0px', `${label}: conversation canvas must not become a rounded outer card: ${JSON.stringify(metrics.conversation)}`);
  if (metrics.side) {
    assert.equal(metrics.side.width, 500, `${label}: Agent Center should keep the 500px Desktop side-sheet width: ${JSON.stringify(metrics.side)}`);
    assert.ok(metrics.side.y >= 48, `${label}: Agent Center should float inside the shell, not fill the entire height: ${JSON.stringify(metrics.side)}`);
    assert.ok(metrics.side.height <= 804, `${label}: Agent Center should keep the target side-sheet vertical inset: ${JSON.stringify(metrics.side)}`);
  }
}

async function assertDesktopRelationshipRailDensity(page, label) {
  assert.equal(
    await page.locator('[data-zhiyu-relationship-rail-density="desktop"]').count(),
    1,
    `${label}: relationship rail must declare Desktop compact density`,
  );
  const currentAgentBubble = await visibleBox(
    page.locator('[data-zhiyu-local-agent-candidate-active="true"]').first(),
    `${label} active relationship avatar`,
  );
  assert.ok(currentAgentBubble.width <= 44, `${label}: active relationship avatar should use Desktop 40px density`);
  assert.ok(currentAgentBubble.height <= 44, `${label}: active relationship avatar should use Desktop 40px density`);

  assert.equal(await page.locator('[data-zhiyu-primary-action]').count(), 0, `${label}: relationship rail must not render the removed add action`);
  assert.equal(await page.locator('[data-zhiyu-topbar-chrome="true"]').count(), 0, `${label}: relationship rail must not render migrated topbar chrome`);
  assert.equal(await page.locator('[data-zhiyu-topbar-notifications="true"]').count(), 0, `${label}: relationship rail must not render notification chrome`);
  assert.equal(await page.locator('[data-zhiyu-topbar-account="true"]').count(), 0, `${label}: relationship rail must not render account chrome`);

  const railTool = await visibleBox(
    page.locator('[data-zhiyu-settings-entry="presence-rail"]').first(),
    `${label} Desktop rail settings action`,
  );
  assert.ok(railTool.width <= 44, `${label}: rail tool action should use Desktop 40px density`);
  assert.ok(railTool.height <= 44, `${label}: rail tool action should use Desktop 40px density`);
}

async function assertDesktopAgentCenterSideSheetDensity(page, label) {
  const sideSheet = page.locator('[data-zhiyu-agent-center-side-sheet="desktop"]').first();
  await sideSheet.waitFor({ state: 'visible', timeout: 15_000 });
  const sideSheetBox = await visibleBox(sideSheet, `${label} Desktop Agent Center side sheet`);
  assert.ok(sideSheetBox.width <= 504, `${label}: Agent Center should use Desktop shared side-sheet width`);
  assert.ok(sideSheetBox.width >= 480, `${label}: Agent Center should keep a usable Desktop side-sheet width`);

  const header = await visibleBox(
    page.locator('[data-zhiyu-agent-center-header="true"]').first(),
    `${label} Agent Center header`,
  );
  const avatar = await visibleBox(
    page.locator('.zhiyu-agent-center__avatar').first(),
    `${label} Agent Center avatar`,
  );
  assert.ok(avatar.width <= 58, `${label}: Agent Center avatar should use Desktop 56px side-sheet density`);
  assert.ok(avatar.height <= 58, `${label}: Agent Center avatar should use Desktop 56px side-sheet density`);
  assert.ok(
    header.height <= 104,
    `${label}: Agent Center header should match Desktop compact side-sheet header rhythm; actual=${JSON.stringify(header)}`,
  );

  const overviewTab = await visibleBox(
    agentCenterSectionButton(page, 'overview'),
    `${label} Agent Center overview tab`,
  );
  assert.ok(overviewTab.height <= 38, `${label}: Agent Center nav buttons should use Desktop h-9 density`);

  const scrollBox = await visibleBox(
    page.locator('[data-zhiyu-agent-panel-tab]').first(),
    `${label} Agent Center scroll body`,
  );
  assert.ok(scrollBox.x - sideSheetBox.x <= 18, `${label}: Agent Center body should use Desktop px-3/px-4 side-sheet inset`);
}

async function visibleBox(locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await locator.boundingBox();
  assert.ok(box, `${label} should expose a rendered bounding box`);
  return box;
}

async function withTempDir(prefix, run) {
  const dir = await mkdtemp(path.join(tmpdir(), `nimi-zhiyu-${prefix}-`));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withFixtureRuntimeLocalAgent(run) {
  await withRuntimeAgentLiveE2EFixture({
    run: async (context) => {
      await context.admitLocalFirstPartyRuntimeAccountCaller({
        appId: zhiyuAppId,
        appInstanceId: `${zhiyuAppId}.local-first-party`,
        deviceId: 'nimi-zhiyu-local-first-party-device',
        capabilities: zhiyuRuntimeProtectedScopes,
      });
      const agentClient = createFixtureRuntimeAgentClient(context.runtime);
      const sourceMaterializationPacket = await createNimiRealmSourceMaterializationPacket(
        context.realm,
        () => {},
        zhiyuAcceptanceTargetSourceRef,
        SOURCE_MATERIALIZATION_AUDIENCE,
      );
      const targetAgent = await agentClient.initialize({
        ownerUserId: context.ownerUserId,
        runtimeSourceRef: runtimeSourceRefForSource(zhiyuAcceptanceTargetSourceRef),
        displayName: zhiyuAcceptanceTargetDisplayName,
        sourceMaterializationPacket,
      });
      await setFixtureRuntimeAgentPresentationProfile({
        presentation: context.agentPresentation,
        identity: {
          ownerUserId: context.ownerUserId,
          runtimeSourceRef: targetAgent.runtimeSourceRef,
          localAgentRef: targetAgent.localAgentRef,
        },
        profile: {
          backendKind: 'vrm',
          avatarAssetRef: zhiyuAcceptanceAvatarAssetRef,
          expressionProfileRef: 'runtime-expression-profile:zhiyu-real-local-agent-calm',
          idlePreset: 'runtime-idle-preset:idle-soft',
          interactionPolicyRef: 'runtime-interaction-policy:zhiyu-real-local-agent-ambient',
          defaultVoiceReference: 'preset_voice_id:zhiyu-real-local-agent',
          avatarAutoplay: true,
          backgroundAssetRef: zhiyuAcceptanceBackgroundAssetRef,
        },
      });
      await agentClient.openConversation({
        ownerUserId: context.ownerUserId,
        runtimeSourceRef: targetAgent.runtimeSourceRef,
        localAgentRef: targetAgent.localAgentRef,
        metadata: {
          appId: zhiyuAppId,
          surface: 'zhiyu.real-local-agent.acceptance',
        },
      });
      await run({
        endpoint: context.endpoint,
        targetAgent,
      });
    },
  });
}

async function seedStandardShellAppearanceAssets(input) {
  const agentCenterRoot = path.join(
    input.dataRoot,
    'agent-center',
    'accounts',
    segment(input.ownerUserId),
    'agents',
    segment(input.localAgentRef),
    'agent-center',
  );
  const avatarDir = path.join(
    agentCenterRoot,
    'modules',
    'avatar_asset',
    'packages',
    'vrm',
    zhiyuAcceptanceAvatarAssetRef,
  );
  const avatarFilesDir = path.join(avatarDir, 'files');
  const avatarBytes = validVrmGlb();
  const avatarFileDigest = sha256(avatarBytes);
  const avatarFiles = [{
    path: 'files/fixture.vrm',
    sha256: avatarFileDigest,
    bytes: avatarBytes.byteLength,
    mime: 'model/vrm',
  }];
  const avatarPackageDigest = avatarContentDigest(avatarFiles);
  await mkdir(avatarFilesDir, { recursive: true });
  await writeFile(path.join(avatarFilesDir, 'fixture.vrm'), avatarBytes);
  await writeFile(path.join(avatarDir, 'manifest.json'), `${JSON.stringify({
    manifest_version: 1,
    asset_version: '1.0.0',
    local_asset_id: zhiyuAcceptanceAvatarAssetRef,
    kind: 'vrm',
    loader_min_version: '1.0.0',
    display_name: 'Zhiyu real local agent fixture',
    display_name_i18n: {},
    entry_file: 'files/fixture.vrm',
    required_files: ['files/fixture.vrm'],
    content_digest: `sha256:${avatarPackageDigest}`,
    files: avatarFiles,
    limits: {
      max_manifest_bytes: 262_144,
      max_asset_bytes: 524_288_000,
      max_file_bytes: 104_857_600,
      max_file_count: 2_048,
    },
    capabilities: {
      backend_kind: 'vrm',
      profile_ref: `avatar.backend_profile:vrm:${zhiyuAcceptanceAvatarAssetRef}:import_validated`,
      materialization_ref: `agent-center-avatar-asset:${segment(input.ownerUserId)}:${segment(input.localAgentRef)}:vrm:${zhiyuAcceptanceAvatarAssetRef}`,
    },
    import: {
      imported_at: '1970-01-01T00:00:00.000Z',
      source_label: 'zhiyu-real-local-agent-fixture.vrm',
      source_fingerprint: `sha256:${avatarPackageDigest}`,
    },
  }, null, 2)}\n`);

  const backgroundDir = path.join(
    agentCenterRoot,
    'modules',
    'appearance',
    'backgrounds',
    zhiyuAcceptanceBackgroundAssetRef,
  );
  const backgroundBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l0G3WQAAAABJRU5ErkJggg==',
    'base64',
  );
  await mkdir(backgroundDir, { recursive: true });
  await writeFile(path.join(backgroundDir, 'image.png'), backgroundBytes);
  await writeFile(path.join(backgroundDir, 'manifest.json'), `${JSON.stringify({
    manifest_version: 1,
    background_asset_id: zhiyuAcceptanceBackgroundAssetRef,
    display_name: 'Zhiyu real local agent fixture',
    image_file: 'image.png',
    mime: 'image/png',
    bytes: backgroundBytes.byteLength,
    pixel_width: 1,
    pixel_height: 1,
    limits: {
      max_bytes: 20_971_520,
      max_pixel_width: 8_192,
      max_pixel_height: 8_192,
    },
    sha256: sha256(backgroundBytes),
    imported_at: '1970-01-01T00:00:00.000Z',
    source_label: 'zhiyu-real-local-agent-fixture.png',
  }, null, 2)}\n`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function avatarContentDigest(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(String(file.bytes));
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function validVrmGlb() {
  const root = {
    asset: { version: '2.0' },
    extensionsUsed: ['VRMC_vrm'],
    extensions: { VRMC_vrm: { specVersion: '1.0' } },
  };
  const json = Buffer.from(JSON.stringify(root), 'utf8');
  const padding = (4 - (json.byteLength % 4)) % 4;
  const jsonChunk = padding === 0 ? json : Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
  const glb = Buffer.alloc(20 + jsonChunk.byteLength);
  glb.write('glTF', 0, 'ascii');
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.byteLength, 8);
  glb.writeUInt32LE(jsonChunk.byteLength, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(glb, 20);
  return glb;
}

function segment(value) {
  const text = String(value || '');
  const body = text.startsWith('~') ? text.slice(1) : text;
  if (/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(body)) {
    return text;
  }
  return `id_${sha256(text).slice(0, 24)}`;
}

function runtimeSourceRefForSource(sourceRef) {
  return [
    'runtime-source',
    sourceRef.kind,
    sourceRef.worldId,
    sourceRef.sourceId,
    sourceRef.sourceContentHash,
  ].map((value) => String(value || '').trim()).join(':');
}

async function assertUnselectedLocalPartnerEmptyState(page) {
  const shellText = await page.locator('[data-zhiyu-product-shell="workspace"]').innerText();
  assert.match(shellText, /选择一位本地伙伴，开始对话/);
  assert.doesNotMatch(shellText, /请先在左侧选择一位已有的本地伙伴开始对话/);
  assert.doesNotMatch(shellText, /请先选择已存在的本地伙伴/);
  assert.match(shellText, /如果想添加更多伙伴，请到Nimi桌面端的「探索」中选择角色/);
  assert.doesNotMatch(shellText, /你还没有添加可对话的本地伙伴/);
  assert.equal(await page.locator('[data-zhiyu-desktop-open-action="desktop_open_select_partner"]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'false');
  assert.equal(await page.locator('[data-chat-composer-send="true"]').isDisabled(), true);
}

function chooseTargetAgent(localAgents, targetLocalAgentRef) {
  const pattern = regexFromEnv(
    'NIMI_ZHIYU_ACCEPTANCE_AGENT_PATTERN',
    new RegExp(escapeRegExp(zhiyuAcceptanceTargetDisplayName), 'u'),
  );
  const target = localAgents.find((agent) => agent.localAgentRef === targetLocalAgentRef)
    || localAgents.find((agent) => pattern.test(agent.displayName || ''))
    || localAgents.find((agent) => pattern.test(agent.localAgentRef || ''));
  if (!target) {
    const available = localAgents.map((agent) => ({
      displayName: agent.displayName,
      localAgentRef: agent.localAgentRef,
      runtimeSourceRef: agent.runtimeSourceRef,
    }));
    throw new Error(`Runtime inventory did not include the target LocalAgent ${pattern}: ${JSON.stringify(available, null, 2)}`);
  }
  return target;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

async function selectTextGenerateModel(page, drawer) {
  await openModelConfigSection(drawer, 'chat');
  const capability = drawer.locator('[data-nimi-model-config-capability="text.generate"]').first();
  await capability.waitFor({ timeout: 15_000 });
  const dialogCountBefore = await page.locator('[role="dialog"]').count();
  await capability.locator('button').first().click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('[role="dialog"]').length > count,
    dialogCountBefore,
    { timeout: 15_000 },
  );
  const picker = page.locator('[role="dialog"]').nth(dialogCountBefore);
  await picker.waitFor({ timeout: 15_000 });

  const modelPattern = regexFromEnv(
    'NIMI_ZHIYU_ACCEPTANCE_TEXT_MODEL_PATTERN',
    /gemma-?4|gemma|gpt|claude|qwen|deepseek|doubao|seed|kimi|moonshot/i,
  );
  const requestedSource = process.env.NIMI_ZHIYU_ACCEPTANCE_MODEL_SOURCE?.trim().toLowerCase() || 'auto';
  const sources = requestedSource === 'cloud'
    ? ['cloud']
    : requestedSource === 'local'
      ? ['local']
      : ['local', 'cloud'];

  for (const source of sources) {
    await switchPickerSource(picker, source);
    const modelButton = picker.getByRole('button', { name: modelPattern }).first();
    if (await modelButton.count()) {
      const label = await modelButton.innerText().catch(() => String(modelPattern));
      await modelButton.click({ timeout: 15_000 });
      await picker.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
      return { source, modelPattern: String(modelPattern), label };
    }
  }

  const pickerText = await picker.innerText().catch(() => '');
  throw new Error(`Model picker did not expose a text.generate model matching ${modelPattern}. Set NIMI_ZHIYU_ACCEPTANCE_TEXT_MODEL_PATTERN or NIMI_ZHIYU_ACCEPTANCE_MODEL_SOURCE. Picker text: ${pickerText}`);
}

async function switchPickerSource(picker, source) {
  const label = source === 'cloud' ? /^Cloud$/i : /^Local$/i;
  const tab = picker.getByRole('button', { name: label }).first();
  if (await tab.count()) {
    await tab.click({ timeout: 5_000 }).catch(() => undefined);
  }
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

async function assertChatCompletionReleased(page, prompt) {
  assert.equal(await page.locator('[data-zhiyu-agent-chat-state]').getAttribute('data-zhiyu-agent-chat-state'), 'completed');
  assert.equal(await page.locator('[data-zhiyu-agent-chat-ready]').getAttribute('data-zhiyu-agent-chat-ready'), 'true');
  assert.equal(await page.locator('[data-zhiyu-composer-state]').getAttribute('data-zhiyu-composer-state'), 'blocked');
  assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'false');
  assert.equal(await page.locator('[data-chat-composer-textarea="true"]').isDisabled(), false);
  assert.equal(await page.locator('[data-chat-composer-send="true"]').isDisabled(), true);
  assert.equal(await page.locator('[data-chat-composer-textarea="true"]').inputValue(), '');
  const bodyText = await page.locator('body').innerText();
  assert.doesNotMatch(bodyText, /\bStreaming\b/u);
  assert.doesNotMatch(bodyText, /runtime-agent-chat-submitting|zhiyu-runtime-turn-submitting/u);
  assert.ok(prompt.trim().length > 0, 'submitted prompt should be non-empty');
}

async function waitForEvidence(page, predicate, label, argument) {
  try {
    await page.waitForFunction(predicate, argument, { timeout: 60_000 });
  } catch (error) {
    const evidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence).catch((evalError) => ({
      evaluationError: evalError instanceof Error ? evalError.message : String(evalError),
    }));
    await page.evaluate((reason) => {
      globalThis.window.__nimiZhiyuAbortActiveTurn?.(reason);
    }, `acceptance_timeout:${label}`).catch(() => undefined);
    throw new Error(`${label} timed out: ${JSON.stringify({ evidence })}`, { cause: error });
  }
}

function regexFromEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const match = raw.match(/^\/(.+)\/([a-z]*)$/i);
  if (match) {
    return new RegExp(match[1], match[2]);
  }
  return new RegExp(raw, 'i');
}

function resolveEvidenceRoot() {
  const checkpoint = process.env.NIMI_ZHIYU_EVIDENCE_CHECKPOINT?.trim() || 'real-local-agent';
  return {
    checkpoint,
    evidenceRoot: path.resolve(root, '..', '..', '.nimi', 'local', 'evidence', 'zhiyu', checkpoint),
  };
}

async function resetRealLocalAgentEvidenceRoot() {
  const { evidenceRoot } = resolveEvidenceRoot();
  await mkdir(evidenceRoot, { recursive: true });
  for (const entry of await readdir(evidenceRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^real-local-agent-.*\.(?:png|json)$/u.test(entry.name)) {
      continue;
    }
    await rm(path.join(evidenceRoot, entry.name), { force: true });
  }
}

async function captureRealLocalAgentEvidence(page, stage, pageProblems, evidence) {
  const { checkpoint, evidenceRoot } = resolveEvidenceRoot();
  await mkdir(evidenceRoot, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: path.join(evidenceRoot, `real-local-agent-${stage}-desktop.png`),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({
    path: path.join(evidenceRoot, `real-local-agent-${stage}-narrow.png`),
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
    path.join(evidenceRoot, `real-local-agent-${stage}-evidence.json`),
    `${JSON.stringify({
      checkpoint,
      scenario: 'real-local-agent',
      stage,
      pageProblems: [...pageProblems],
      ...evidence,
      domEvidence,
    }, null, 2)}\n`,
    'utf8',
  );
}

async function captureRealLocalAgentPanelEvidence(page, stage) {
  const { evidenceRoot } = resolveEvidenceRoot();
  const panel = page.locator('[data-zhiyu-region="agent-panel"]');
  const panelScroll = page.locator('[data-zhiyu-agent-panel-tab="appearance"]');
  await page.setViewportSize({ width: 1280, height: 900 });
  await panel.screenshot({
    path: path.join(evidenceRoot, `real-local-agent-${stage}-panel.png`),
  });
  await panelScroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await panel.screenshot({
    path: path.join(evidenceRoot, `real-local-agent-${stage}-panel-bottom.png`),
  });
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
