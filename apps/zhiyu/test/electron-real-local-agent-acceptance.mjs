import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { _electron as electron } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const mainEntry = path.join(root, 'dist-electron', 'main.js');
const zhiyuAppId = 'nimi.zhiyu';

test('zhiyu Electron real local-agent flow lists, selects, configures, and chats through Runtime', { timeout: 300_000 }, async () => {
  await resetRealLocalAgentEvidenceRoot();

  await withTempDir('real-local-agent', async (tmpRoot) => {
    const runtimeEndpoint = runtimeEndpointFromEnv();
    const dataRoot = path.join(tmpRoot, 'standard-shell-data');
    await mkdir(dataRoot, { recursive: true });

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

      const targetAgent = chooseTargetAgent(listedEvidence.inventory.localAgents);
      const targetIndex = listedEvidence.inventory.localAgents.findIndex((agent) => agent.localAgentRef === targetAgent.localAgentRef);
      assert.notEqual(targetIndex, -1, 'target LocalAgent must be part of the listed Runtime inventory');
      assert.doesNotMatch(targetAgent.displayName || '', /\uFFFD/u, 'target LocalAgent display name must not contain replacement characters');
      assert.match(targetAgent.displayName || '', /\p{Script=Han}/u, 'target LocalAgent display name should remain human-readable Chinese for this acceptance scenario');
      await captureRealLocalAgentEvidence(page, 'listed', pageProblems, {
        runtimeEndpoint,
        targetAgent,
        listedEvidence,
      });

      const candidateButtons = page.locator('[data-zhiyu-local-agent-candidate="true"]');
      const switchAgent = listedEvidence.inventory.localAgents.find((agent) => agent.localAgentRef !== targetAgent.localAgentRef) || null;
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
        targetAgent.localAgentRef,
      );

      const selectedEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(selectedEvidence.localAgent.reasonCode, 'runtime-local-agent-selected');
      assert.equal(selectedEvidence.localAgent.runtimeSourceRef, targetAgent.runtimeSourceRef);
      assert.equal(selectedEvidence.conversation.localAgentRef, targetAgent.localAgentRef);
      assert.equal(await page.locator('[data-zhiyu-product-stage]').getAttribute('data-zhiyu-product-stage'), 'route-required');
      assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'false');
      await assertConversationTopStripRemoved(page);
      await assertProductDesignLayout(page, 'selected local agent');
      await captureRealLocalAgentEvidence(page, 'selected-closed-layout', pageProblems, {
        targetAgent,
        selectedEvidence,
      });
      await openAgentCenterOverview(page);
      await assertAgentCenterHeaderParity(page, selectedEvidence);
      await assertAgentCenterDoesNotNestSettings(page);
      await assertAppearanceConfigParity(page, async () => {
        await captureRealLocalAgentEvidence(page, 'appearance-config', pageProblems, {
          targetAgent,
          selectedEvidence,
          panelScreenshots: [
            'real-local-agent-appearance-config-panel.png',
            'real-local-agent-appearance-config-panel-bottom.png',
          ],
        });
        await captureRealLocalAgentPanelEvidence(page, 'appearance-config');
      });
      await assertSettingsEntryRoutesToAgentCenter(page, pageProblems, {
        targetAgent,
        selectedEvidence,
      });
      await captureRealLocalAgentEvidence(page, 'selected', pageProblems, {
        targetAgent,
        selectedEvidence,
      });

      await assertComposerModeTools(page);
      await page.locator('[data-zhiyu-composer-tool="model"]').click();
      const modelPanel = page.locator('[data-zhiyu-agent-panel-tab="model"]');
      await modelPanel.waitFor({ timeout: 15_000 });
      const modelConfig = page.locator('[data-zhiyu-ai-config-embedded="agent-center"]');
      await modelConfig.waitFor({ timeout: 15_000 });
      assert.equal(await page.locator('[data-zhiyu-ai-config-drawer="open"]').count(), 0);
      await captureRealLocalAgentEvidence(page, 'model-panel', pageProblems, {
        targetAgent,
        selectedEvidence,
      });

      const modelSelection = await selectTextGenerateModel(page, modelConfig);
      await waitForEvidence(page, () =>
        globalThis.window.__nimiZhiyuEvidence?.route?.reasonCode === 'runtime-route-ready'
        && Boolean(globalThis.window.__nimiZhiyuEvidence?.route?.executionBinding),
        'real Runtime model route ready',
      );

      const modelReadyEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(modelReadyEvidence.route.executionBinding.route === 'local' || modelReadyEvidence.route.executionBinding.route === 'cloud', true);
      assert.ok(modelReadyEvidence.route.executionBinding.modelId, 'Runtime route must expose a model id after model config');
      assert.equal(modelReadyEvidence.route.targetRefKinds['text.generate'] === 'local-runtime' || modelReadyEvidence.route.targetRefKinds['text.generate'] === 'cloud-connector', true);
      await captureRealLocalAgentEvidence(page, 'model-ready', pageProblems, {
        targetAgent,
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
        targetAgent.localAgentRef,
      );

      const chatCompletedEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(chatCompletedEvidence.chat.source, 'runtime');
      assert.equal(chatCompletedEvidence.chat.localAgentRef, targetAgent.localAgentRef);
      assert.equal(chatCompletedEvidence.chat.conversationAnchorId, modelReadyEvidence.conversation.conversationAnchorId);
      assert.equal(chatCompletedEvidence.chat.state, 'completed');
      assert.equal(chatCompletedEvidence.chat.ready, true);
      assert.equal(chatCompletedEvidence.turn.ready, true);
      assert.equal(chatCompletedEvidence.turn.localAgentRef, targetAgent.localAgentRef);
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
        targetAgent,
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
        targetAgent,
        modelSelection,
        followUpPromptLength: followUpPrompt.length,
        followUpReadyEvidence,
      });
    } finally {
      await app.close();
    }
  });
});

async function assertProductDesignRegions(page) {
  for (const region of ['presence', 'conversation', 'relationship-rail']) {
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
  await page.locator('[data-zhiyu-settings-entry="relationship-rail"]').waitFor({ state: 'visible', timeout: 15_000 });
}

async function assertSettingsEntryRoutesToAgentCenter(page, pageProblems, evidence) {
  await page.locator('[data-zhiyu-settings-entry="relationship-rail"]').click();
  await page.locator('[data-zhiyu-agent-panel-mode="agent"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('[data-zhiyu-agent-center-tab-button="advanced"][aria-current="page"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('[data-zhiyu-agent-advanced-panel="true"]').waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(
    await page.locator('[data-zhiyu-settings-panel="right"]').count(),
    0,
    'relationship rail settings entry must route to Agent Center advanced tab, not a second settings panel',
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
  await page.locator('[data-zhiyu-agent-center-tab-button="behavior"]').click();
  await page.locator('[data-zhiyu-agent-behavior-panel="true"]').waitFor({ timeout: 15_000 });
  await page.locator('[data-zhiyu-agent-panel-mode="agent"]').waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(
    await page.locator('[data-zhiyu-settings-panel="right"]').count(),
    0,
    'Agent Center Behavior tab must not open the generic Settings page',
  );
  assert.equal(await page.locator('[data-zhiyu-agent-behavior-control]').count(), 3);
  assert.equal(await page.locator('[data-zhiyu-agent-behavior-mode-option]').count(), 4);
  await page.locator('[data-zhiyu-agent-center-tab-button="cognition"]').click();
  await page.locator('[data-zhiyu-agent-cognition-panel="true"]').waitFor({ timeout: 15_000 });
  await page.locator('[data-zhiyu-agent-panel-mode="agent"]').waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(
    await page.locator('[data-zhiyu-settings-panel="right"]').count(),
    0,
    'Agent Center Cognition tab must not open the generic Settings page',
  );
  await page.locator('[data-zhiyu-agent-center-tab-button="advanced"]').click();
  await page.locator('[data-zhiyu-agent-advanced-panel="true"]').waitFor({ timeout: 15_000 });
  assert.equal(
    await page.locator('[data-zhiyu-settings-panel="right"]').count(),
    0,
    'Agent Center Advanced tab must not open the generic Settings page',
  );
  await page.locator('[data-zhiyu-agent-center-tab-button="overview"]').click();
}

async function assertAgentCenterHeaderParity(page, evidence) {
  await page.setViewportSize({ width: 1280, height: 900 });
  const header = page.locator('[data-zhiyu-agent-center-header="true"]').first();
  await header.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await header.locator('[data-zhiyu-agent-center-eyebrow]').innerText(), 'AGENT CENTER');
  const localAgentRef = evidence.localAgent.localAgentRef;
  assert.ok(localAgentRef, 'selected real LocalAgent evidence must include a localAgentRef');
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

async function openAgentCenterOverview(page) {
  await page.locator('[data-zhiyu-composer-tool="agent"]').click();
  await page.locator('[data-zhiyu-agent-panel-mode="agent"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('[data-zhiyu-agent-center-tab-button="overview"][aria-current="page"]').waitFor({ state: 'visible', timeout: 15_000 });
}

async function assertAppearanceConfigParity(page, captureAppearanceEvidence) {
  await page.locator('[data-zhiyu-agent-center-tab-button="overview"]').click();
  await page.locator('[data-zhiyu-agent-panel-tab="overview"]').waitFor({ timeout: 15_000 });
  await page.locator('[data-zhiyu-agent-panel-tab="overview"] [data-zhiyu-panel-row="形象"]').click();
  await page.locator('[data-zhiyu-agent-panel-tab="appearance"]').waitFor({ timeout: 15_000 });
  const panel = page.locator('[data-zhiyu-agent-appearance-panel="true"]');
  await panel.waitFor({ timeout: 15_000 });

  const panelText = await panel.innerText();
  for (const label of ['Avatar 设置', '导入来源', '证据', 'Live2D 工作台', '背景', '动效', '高级诊断']) {
    assert.match(panelText, new RegExp(label), `Appearance panel must include Desktop ${label} structure`);
  }

  assert.equal(await panel.locator('[data-zhiyu-avatar-evidence-row]').count(), 4);
  assert.equal(await panel.locator('[data-zhiyu-live2d-review-item]').count(), 5);
  assert.equal(await panel.locator('[data-zhiyu-live2d-review-item="adapter_manifest"]').count(), 1);
  assert.equal(await panel.locator('[data-zhiyu-agent-background-card="electron-local-config"]').count(), 1);
  assert.equal(await panel.locator('[data-zhiyu-background-import-action]').count(), 2);
  assert.equal(await panel.locator('[data-zhiyu-agent-motion-card="read-only"]').count(), 1);
  assert.equal(await panel.locator('[data-zhiyu-avatar-policy-row]').count(), 4);
  assert.equal(await panel.locator('[data-zhiyu-avatar-debug-shortcut]').count(), 7);
  await panel.locator('[data-zhiyu-avatar-advanced-diagnostics="deferred"]').waitFor({ timeout: 15_000 });

  for (const action of ['live2d', 'vrm']) {
    const control = panel.locator(`[data-zhiyu-avatar-import-action="${action}"]`).first();
    assert.equal(await control.getAttribute('data-zhiyu-avatar-import-state'), 'available');
    assert.equal(await control.isDisabled(), false);
  }
  for (const action of ['live2d-adapter', 'clear']) {
    const control = panel.locator(`[data-zhiyu-avatar-import-action="${action}"]`).first();
    assert.equal(await control.getAttribute('data-zhiyu-avatar-import-state'), 'blocked');
    assert.ok(await control.getAttribute('data-zhiyu-avatar-import-reason'), `${action} blocked import control must expose a concrete reason`);
    assert.equal(await control.isDisabled(), true);
  }
  const backgroundImport = panel.locator('[data-zhiyu-background-import-action="import"]').first();
  assert.equal(await backgroundImport.getAttribute('data-zhiyu-background-import-state'), 'available');
  assert.equal(await backgroundImport.isDisabled(), false);
  const backgroundClear = panel.locator('[data-zhiyu-background-import-action="clear"]').first();
  assert.equal(await backgroundClear.getAttribute('data-zhiyu-background-import-state'), 'blocked');
  assert.ok(await backgroundClear.getAttribute('data-zhiyu-background-import-reason'), 'clear background control must expose a concrete blocked reason');
  assert.equal(await backgroundClear.isDisabled(), true);

  if (captureAppearanceEvidence) {
    await captureAppearanceEvidence();
  }

  await page.locator('[data-zhiyu-agent-center-tab-button="overview"]').click();
}

async function assertComposerModeTools(page) {
  for (const tool of ['voice-capture', 'agent', 'hands-free', 'proactive', 'model']) {
    await page.locator(`[data-zhiyu-composer-tool="${tool}"]`).waitFor({ state: 'visible', timeout: 15_000 });
  }
  const captureTool = page.locator('[data-zhiyu-composer-tool="voice-capture"]').first();
  assert.equal(await captureTool.getAttribute('data-zhiyu-chat-voice-capture-state'), 'deferred');
  assert.equal(
    await captureTool.getAttribute('data-zhiyu-chat-voice-capture-reason'),
    'zhiyu-chat-voice-capture-runtime-surface-deferred',
  );
  assert.equal(await captureTool.isDisabled(), true);

  const voiceTool = page.locator('[data-zhiyu-composer-tool="hands-free"]').first();
  assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-state'), 'deferred');
  assert.equal(
    await voiceTool.getAttribute('data-zhiyu-chat-voice-reason'),
    'zhiyu-chat-voice-runtime-surface-deferred',
  );
  assert.equal(await voiceTool.isDisabled(), true);
}

async function assertConversationTopStripRemoved(page) {
  const conversation = page.locator('[data-zhiyu-region="conversation"]').first();
  assert.equal(await conversation.locator('.zhiyu-home__stage-topbar').count(), 0);
  assert.equal(await conversation.locator('.zhiyu-home__model-config-row').count(), 0);
  assert.equal(await conversation.locator('[data-zhiyu-ai-config-chip]').count(), 0);
  assert.equal(await conversation.locator('[data-zhiyu-model-config-entry="conversation"]').count(), 0);
  assert.equal(await conversation.locator('button[aria-label="通知"], button[aria-label="账户"]').count(), 0);
}

async function assertProductDesignLayout(page, label) {
  await page.setViewportSize({ width: 1280, height: 900 });
  const presence = await visibleBox(page.locator('[data-zhiyu-region="presence"]').first(), `${label} presence rail`);
  const conversation = await visibleBox(page.locator('[data-zhiyu-region="conversation"]').first(), `${label} conversation`);
  const relationship = await visibleBox(page.locator('[data-zhiyu-region="relationship-rail"]').first(), `${label} relationship rail`);
  const sidePanelState = await page.locator('[data-zhiyu-side-panel-state]').getAttribute('data-zhiyu-side-panel-state');
  assert.ok(presence.x < conversation.x, `${label}: presence rail should be left of conversation`);
  assert.ok(relationship.width <= 76, `${label}: relationship rail should remain compact like Desktop`);
  assert.ok(conversation.width >= 520, `${label}: conversation should remain the primary desktop work area`);
  await assertDesktopRelationshipRailDensity(page, label);
  if (sidePanelState === 'closed') {
    assert.equal(await page.locator('[data-zhiyu-region="agent-panel"]').count(), 0, `${label}: Agent Center must be detached in closed layout`);
    assert.ok(conversation.x + conversation.width <= relationship.x + 1, `${label}: closed conversation track should end before relationship rail`);
    const centered = await page.evaluate(() => {
      const conversationNode = document.querySelector('[data-zhiyu-region="conversation"]');
      const transcript = document.querySelector('.zhiyu-home__chat-transcript [data-canonical-transcript-width]');
      const composer = document.querySelector('.zhiyu-home__composer [data-canonical-composer-width]');
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
    assert.ok(side.x < relationship.x, `${label}: relationship rail should sit to the right of Agent Center`);
    assert.ok(side.width >= 300, `${label}: right agent panel should have usable desktop width`);
    await assertDesktopAgentCenterSideSheetDensity(page, label);
  }

  await page.setViewportSize({ width: 390, height: 900 });
  const narrowConversation = await visibleBox(page.locator('[data-zhiyu-region="conversation"]').first(), `${label} narrow conversation`);
  const narrowRelationship = await visibleBox(page.locator('[data-zhiyu-region="relationship-rail"]').first(), `${label} narrow relationship rail`);
  assert.ok(narrowConversation.width <= 390, `${label}: narrow conversation should not overflow the viewport`);
  assert.ok(narrowRelationship.width <= 390, `${label}: narrow relationship rail should not overflow the viewport`);
  if (sidePanelState === 'closed') {
    assert.equal(await page.locator('[data-zhiyu-region="agent-panel"]').count(), 0, `${label}: narrow closed layout must not render Agent Center`);
    assert.ok(narrowRelationship.y > narrowConversation.y, `${label}: relationship rail should stack below conversation on narrow closed viewports`);
  } else {
    const narrowSide = await visibleBox(page.locator('[data-zhiyu-region="agent-panel"]').first(), `${label} narrow agent panel`);
    assert.ok(narrowSide.y > narrowConversation.y, `${label}: agent panel should stack below conversation on narrow viewports`);
    assert.ok(narrowRelationship.y > narrowSide.y, `${label}: relationship rail should stack below Agent Center on narrow viewports`);
    assert.ok(narrowSide.width <= 390, `${label}: narrow agent panel should not overflow the viewport`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
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

  const addBubble = await visibleBox(
    page.locator('[data-zhiyu-primary-action]').first(),
    `${label} relationship add action`,
  );
  assert.ok(addBubble.width <= 44, `${label}: relationship add action should use Desktop 40px density`);
  assert.ok(addBubble.height <= 44, `${label}: relationship add action should use Desktop 40px density`);

  const topbarButton = await visibleBox(
    page.locator('[data-zhiyu-topbar-notifications="true"]').first(),
    `${label} Desktop topbar notification button`,
  );
  const accountButton = await visibleBox(
    page.locator('[data-zhiyu-topbar-account="true"]').first(),
    `${label} Desktop topbar account button`,
  );
  assert.ok(topbarButton.width <= 40, `${label}: notification topbar button should use Desktop 36px density`);
  assert.ok(topbarButton.height <= 40, `${label}: notification topbar button should use Desktop 36px density`);
  const viewport = page.viewportSize();
  assert.ok(viewport, `${label}: viewport size should be available for topbar clipping checks`);
  assert.ok(accountButton.x + accountButton.width <= viewport.width - 4, `${label}: account topbar button must not be clipped by the right viewport edge`);

  const railTool = await visibleBox(
    page.locator('[data-zhiyu-settings-entry="relationship-rail"]').first(),
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
    page.locator('.zhiyu-home__agent-panel-avatar').first(),
    `${label} Agent Center avatar`,
  );
  assert.ok(avatar.width <= 58, `${label}: Agent Center avatar should use Desktop 56px side-sheet density`);
  assert.ok(avatar.height <= 58, `${label}: Agent Center avatar should use Desktop 56px side-sheet density`);
  assert.ok(
    header.height <= 104,
    `${label}: Agent Center header should match Desktop compact side-sheet header rhythm; actual=${JSON.stringify(header)}`,
  );

  const overviewTab = await visibleBox(
    page.locator('[data-zhiyu-agent-center-tab-button="overview"]').first(),
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

function runtimeEndpointFromEnv() {
  return process.env.NIMI_ZHIYU_REAL_RUNTIME_ENDPOINT?.trim()
    || process.env.NIMI_ZHIYU_ELECTRON_RUNTIME_ENDPOINT?.trim()
    || process.env.NIMI_RUNTIME_GRPC_ADDR?.trim()
    || '127.0.0.1:46371';
}

function chooseTargetAgent(localAgents) {
  const pattern = regexFromEnv('NIMI_ZHIYU_ACCEPTANCE_AGENT_PATTERN', /颜真卿/u);
  const target = localAgents.find((agent) => pattern.test(agent.displayName || ''))
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
