import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { _electron as electron } from 'playwright';
import { withRuntimeAgentLiveE2EFixture } from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture.test-helper.ts';
import {
  createZhiyuLiveRuntimeAcceptanceRendererUrl,
  createZhiyuLiveRuntimeFixtureAcceptanceInitScript,
} from './live-runtime-fixture-adapter.mjs';

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
            NIMI_ZHIYU_ELECTRON_RENDERER_URL: createZhiyuLiveRuntimeAcceptanceRendererUrl(root),
            NIMI_ZHIYU_ELECTRON_RUNTIME_ENDPOINT: fixture.endpoint,
            NIMI_ZHIYU_ELECTRON_STANDARD_DATA_ROOT: dataRoot,
          },
        });

        try {
          const page = await app.firstWindow();
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
            'chat.stream',
            'text.embed',
            'image.generate',
            'audio.synthesize',
          ]);
          assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'false');
          assert.equal(await page.locator('[data-zhiyu-ai-config-chip]').getAttribute('data-zhiyu-ai-config-binding-label'), '未绑定模型');
          await assertPartnerSelectedProductState(page);
          await captureLiveRuntimeEvidence(page, 'partnerSelected', pageProblems, {
            preConfigEvidence,
          });
          await assertModelUnconfiguredProductState(page);

          await page.locator('[data-zhiyu-model-config-entry="conversation"]').click();
          await page.waitForSelector('[data-zhiyu-ai-config-drawer="open"]');
          const drawer = page.locator('[data-zhiyu-ai-config-drawer="open"]');
          await assertModelConfigDrawerProductQuality(page);
          const modelUnconfiguredEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          await captureLiveRuntimeEvidence(page, 'modelUnconfigured', pageProblems, {
            modelUnconfiguredEvidence,
          });
          await drawer
            .locator('button')
            .filter({ hasText: /Setup required|Select a model|选择.*模型|需要模型目标|未配置/i })
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
          const modelConfiguredEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
          await assertModelConfiguredProductState(page);
          await captureLiveRuntimeEvidence(page, 'modelConfigured', pageProblems, {
            modelConfiguredEvidence,
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
          assert.equal(
            await page.locator('[data-zhiyu-status-collapsed]').first().getAttribute('data-zhiyu-status-collapsed'),
            'true',
            'ready stage must collapse the readiness checklist into a summary',
          );
          assert.equal(await page.locator('[data-zhiyu-labeled-chip="conversation"]').count(), 1);
          assert.equal(await page.locator('[data-zhiyu-labeled-chip="route"]').count(), 1);
          assert.equal(await page.locator('[data-zhiyu-labeled-chip="chat"]').count(), 1);
          await assertProductShellPrimaryView(page);
          await assertLongTextNarrowChineseAndControls(page);
          await resetAcceptanceInputs(page);
          await captureLiveRuntimeEvidence(page, 'ready', pageProblems, {
            readyEvidence,
          });

          await page.locator('[data-chat-composer-textarea="true"]').fill('请用一句话确认织羽本地对话可用。');
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
          await page.getByText(/当前伙伴已完成本地对话校验/).first().waitFor({ timeout: 15_000 });
          const conversationText = await page.locator('[data-zhiyu-region="conversation"]').innerText();
          assert.match(conversationText, /今天/);
          assert.doesNotMatch(conversationText, /Today|Hello from the Runtime Agent live fixture|hello from Zhiyu live Runtime acceptance|Runtime acceptance/i);
          await assertChatCompletedNarrowComposerUsable(page);
          await captureLiveRuntimeEvidence(page, 'chatCompleted', pageProblems, {
            readyEvidence,
            chatCompletedEvidence,
          });
          await assertUniqueStageScreenshots();
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
    throw new Error(`${label} timed out: ${JSON.stringify({ evidence })}`, { cause: error });
  }
}

async function assertNoPartnerProductState(page) {
  assert.equal(await page.locator('[data-zhiyu-product-stage]').getAttribute('data-zhiyu-product-stage'), 'source-required');
  assert.equal(await page.locator('[data-zhiyu-primary-action]').getAttribute('data-zhiyu-primary-action'), 'select-partner');
  assert.equal(await page.locator('[data-zhiyu-capability-setup-action="select-partner"]').count(), 1);
  assert.equal(await page.locator('[data-zhiyu-image-studio-setup-action="select-partner"]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-region="image-studio"]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-capability-studio-run]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-image-generate-run]').count(), 0);
  assert.equal(
    await page.locator('[data-zhiyu-status-collapsed]').first().getAttribute('data-zhiyu-status-collapsed'),
    'true',
  );
  const shellText = await page.locator('[data-zhiyu-product-shell="workspace"]').innerText();
  assert.match(shellText, /选择本地伙伴/);
  assert.match(shellText, /选择本地伙伴开始对话/);
  assert.match(shellText, /本地环境状态/);
  assert.doesNotMatch(shellText, /8 项 checklist|checklist dashboard/i);
  assert.doesNotMatch(shellText, /本地伙伴工作台|character\/persona|文字能力|图片创作/);
  assertPrimaryWorkspaceHasNoEngineeringCopy(shellText);
}

async function assertPartnerSelectedProductState(page) {
  assert.equal(await page.locator('[data-zhiyu-product-stage]').getAttribute('data-zhiyu-product-stage'), 'route-required');
  assert.equal(await page.locator('[data-zhiyu-primary-action]').getAttribute('data-zhiyu-primary-action'), 'configure-model');
  const shellText = await page.locator('[data-zhiyu-product-shell="workspace"]').innerText();
  assert.match(shellText, /当前伙伴/);
  assert.match(shellText, /未绑定模型|请先完成模型配置/);
  assert.match(shellText, /模型配置/);
  assert.doesNotMatch(shellText, /Runtime Live Source/);
  assertPrimaryWorkspaceHasNoEngineeringCopy(shellText);
}

async function assertModelUnconfiguredProductState(page) {
  assert.equal(await page.locator('[data-zhiyu-ai-config-chip]').getAttribute('data-zhiyu-ai-config-binding-label'), '未绑定模型');
  assert.equal(await page.locator('[data-zhiyu-capability-setup-action="configure-model"]').count(), 1);
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
  const drawer = page.locator('[data-zhiyu-ai-config-drawer="open"]');
  await drawer.waitFor({ timeout: 15_000 });
  const drawerText = await drawer.innerText();
  assert.match(drawerText, /模型目标已绑定/);
  assert.doesNotMatch(drawerText, /等待上游投影|not_projected|sourceRef|localAgentRef|回显通路|身份地板|graph-lite/);
}

function assertPrimaryWorkspaceHasNoEngineeringCopy(text) {
  assert.doesNotMatch(
    text,
    /上游投影|准入来源|等待投影|not_projected|Runtime\b|SDK\b|sourceRef|localAgentRef|回显通路|身份地板|graph-lite|Runtime Agent|LocalAgent|Runtime Live Source|Capability Studio|Image Studio|Avatar Presence/,
  );
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

async function assertModelConfigDrawerProductQuality(page) {
  const drawer = page.locator('[data-zhiyu-ai-config-drawer="open"]');
  await drawer.waitFor({ timeout: 15_000 });
  assert.equal(await drawer.getAttribute('data-zhiyu-ai-config-drawer-panel'), 'kit-glass');
  await drawer.locator('.zhiyu-ai-config-drawer__model-hub').waitFor({ timeout: 15_000 });

  const unlabeledOrTinyButtons = await drawer.locator('button').evaluateAll((buttons) => buttons
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

  const back = drawer.locator('[data-nimi-model-config-back="true"]').first();
  await back.waitFor({ timeout: 15_000 });
  const backBox = await back.boundingBox();
  assert.ok(backBox && backBox.width >= 60 && backBox.height >= 28, `model config back control is too small: ${JSON.stringify(backBox)}`);
  assert.match(await back.evaluate((button) => `${button.getAttribute('aria-label') || button.textContent || ''}`), /返回|Back/i);

  const capabilityButton = drawer.locator('[data-nimi-model-config-capability] > button').first();
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

  const drawerPanelStyle = await drawer.evaluate((panel) => {
    const style = globalThis.getComputedStyle(panel);
    return {
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
    };
  });
  assert.notEqual(drawerPanelStyle.backgroundColor, 'rgba(0, 0, 0, 0)');
  assert.notEqual(drawerPanelStyle.boxShadow, 'none');
}

async function assertLongTextNarrowChineseAndControls(page) {
  await page.setViewportSize({ width: 390, height: 900 });
  const shell = page.locator('[data-zhiyu-product-shell="workspace"]');
  await shell.waitFor({ timeout: 15_000 });
  const shellText = await shell.innerText();
  assert.match(shellText, /当前伙伴|选择本地伙伴/);
  assert.match(shellText, /模型配置/);
  assert.doesNotMatch(shellText, /文字能力|图片创作|本地伙伴工作台/);
  assert.doesNotMatch(shellText, /缁囩窘|缂佸洨|绐|�/);

  const longChineseText = '这是一段用于窄屏验收的长中文输入，包含连续描述、标点和产品语义，目标是确认输入框不会溢出，按钮仍可点击，布局不会互相遮挡。'.repeat(2);
  await page.locator('[data-chat-composer-textarea="true"]').fill(longChineseText);

  assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'true');

  const controls = [
    page.locator('[data-zhiyu-model-config-entry="conversation"]'),
    page.locator('[data-chat-composer-send="true"]'),
    page.locator('[data-zhiyu-diagnostics-entry="nav"]'),
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

const stageScreenshotRegistry = new Map();
const extraReadyPanelScreenshots = [];

function resolveEvidenceRoot() {
  const checkpoint = evidenceCheckpoint('live-runtime');
  return {
    checkpoint,
    evidenceRoot: path.resolve(root, '..', '..', '.nimi', 'local', 'evidence', 'zhiyu', checkpoint),
  };
}

async function resetLiveRuntimeEvidenceRoot() {
  const { evidenceRoot } = resolveEvidenceRoot();
  stageScreenshotRegistry.clear();
  extraReadyPanelScreenshots.splice(0);
  await mkdir(evidenceRoot, { recursive: true });
  for (const entry of await readdir(evidenceRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^live-runtime-.*\.(?:png|json)$/u.test(entry.name)) {
      continue;
    }
    await rm(path.join(evidenceRoot, entry.name), { force: true });
  }
}

async function resetAcceptanceInputs(page) {
  await page.locator('[data-chat-composer-textarea="true"]').fill('');
}

async function assertUniqueStageScreenshots() {
  const seen = new Map();
  for (const [file, hash] of stageScreenshotRegistry) {
    const existing = seen.get(hash);
    assert.equal(
      existing,
      undefined,
      `stage screenshots must not be byte-identical: ${existing} == ${file}`,
    );
    seen.set(hash, file);
  }
}

async function registerStageScreenshot(filePath) {
  const digest = createHash('md5').update(await readFile(filePath)).digest('hex');
  stageScreenshotRegistry.set(path.basename(filePath), digest);
}

async function captureLiveRuntimeEvidence(page, stage, pageProblems, evidence) {
  const { checkpoint, evidenceRoot } = resolveEvidenceRoot();
  const sectionCaptureSelectors = {
    avatarBlocked: '[data-zhiyu-region="avatar"]',
  };
  const screenshotNames = {
    noPartner: {
      desktop: 'live-runtime-no-partner-desktop.png',
      narrow: 'live-runtime-no-partner-narrow.png',
      evidence: 'live-runtime-no-partner-evidence.json',
    },
    partnerSelected: {
      desktop: 'live-runtime-partner-selected-desktop.png',
      narrow: 'live-runtime-partner-selected-narrow.png',
      evidence: 'live-runtime-partner-selected-evidence.json',
    },
    modelUnconfigured: {
      desktop: 'live-runtime-model-unconfigured-desktop.png',
      narrow: 'live-runtime-model-unconfigured-narrow.png',
      evidence: 'live-runtime-model-unconfigured-evidence.json',
    },
    modelConfigured: {
      desktop: 'live-runtime-model-configured-desktop.png',
      narrow: 'live-runtime-model-configured-narrow.png',
      evidence: 'live-runtime-model-configured-evidence.json',
    },
    ready: {
      desktop: 'live-runtime-ready-desktop.png',
      narrow: 'live-runtime-ready-narrow.png',
      evidence: 'live-runtime-ready-evidence.json',
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
    avatarBlocked: {
      desktop: 'live-runtime-avatar-blocked-desktop.png',
      narrow: 'live-runtime-avatar-blocked-narrow.png',
      evidence: 'live-runtime-avatar-blocked-evidence.json',
    },
  }[stage];
  assert.ok(screenshotNames, `unsupported live Runtime evidence stage: ${stage}`);
  await mkdir(evidenceRoot, { recursive: true });
  const sectionSelector = sectionCaptureSelectors[stage] ?? null;
  const captureStageScreenshot = async (screenshotPath) => {
    if (sectionSelector) {
      const section = page.locator(sectionSelector).first();
      await section.waitFor({ timeout: 15_000 });
      await section.scrollIntoViewIfNeeded();
      await page.screenshot({ path: screenshotPath, fullPage: false });
      return;
    }
    await page.screenshot({ path: screenshotPath, fullPage: true });
  };
  await page.setViewportSize({ width: 1280, height: 900 });
  const desktopPath = path.join(evidenceRoot, screenshotNames.desktop);
  await captureStageScreenshot(desktopPath);
  await registerStageScreenshot(desktopPath);
  const panelScreenshots = await capturePanelScreenshots(page, stage, evidenceRoot);
  if (stage === 'ready' && extraReadyPanelScreenshots.length > 0) {
    panelScreenshots.push(...extraReadyPanelScreenshots.splice(0));
  }
  await page.setViewportSize({ width: 390, height: 900 });
  const narrowPath = path.join(evidenceRoot, screenshotNames.narrow);
  await captureStageScreenshot(narrowPath);
  await registerStageScreenshot(narrowPath);
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
      panelScreenshots: panelScreenshots,
      ...evidence,
      domEvidence,
    }, null, 2)}\n`,
    'utf8',
  );
}

async function capturePanelScreenshots(page, stage, evidenceRoot) {
  const panelTargets = {
    noPartner: [
      ['[data-zhiyu-region="conversation"]', 'live-runtime-no-partner-conversation-panel.png'],
      ['[data-zhiyu-region="relationship-rail"]', 'live-runtime-no-partner-relationship-panel.png'],
    ],
    partnerSelected: [
      ['[data-zhiyu-region="conversation"]', 'live-runtime-partner-selected-conversation-panel.png'],
      ['[data-zhiyu-region="relationship-rail"]', 'live-runtime-partner-selected-relationship-panel.png'],
    ],
    modelUnconfigured: [
      ['[data-zhiyu-ai-config-drawer="open"]', 'live-runtime-model-unconfigured-panel.png'],
      [null, 'live-runtime-model-unconfigured-viewport.png'],
    ],
    modelConfigured: [
      ['[data-zhiyu-ai-config-drawer="open"]', 'live-runtime-model-configured-panel.png'],
      [null, 'live-runtime-model-configured-viewport.png'],
    ],
    ready: [
      ['[data-zhiyu-region="conversation"]', 'live-runtime-ready-conversation-panel.png'],
      ['[data-zhiyu-region="relationship-rail"]', 'live-runtime-ready-relationship-panel.png'],
    ],
    chatCompleted: [
      ['[data-zhiyu-region="conversation"]', 'live-runtime-agent-chat-panel.png'],
    ],
  }[stage] || [];
  const captured = [];
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [selector, filename] of panelTargets) {
    if (selector === null) {
      await page.screenshot({ path: path.join(evidenceRoot, filename), fullPage: false });
      captured.push(filename);
      continue;
    }
    const locator = page.locator(selector).first();
    await locator.waitFor({ timeout: 15_000 });
    await locator.scrollIntoViewIfNeeded();
    await locator.screenshot({ path: path.join(evidenceRoot, filename) });
    captured.push(filename);
  }
  return captured;
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

  assert.equal(await shell.locator('[data-zhiyu-region="conversation"]').count(), 1);
  assert.equal(await shell.locator('[data-zhiyu-region="relationship-rail"]').count(), 1);

  const primaryText = await shell.innerText();
  assert.match(primaryText, /当前伙伴|选择本地伙伴/);
  assert.match(primaryText, /模型配置/);
  assert.doesNotMatch(
    primaryText,
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
    'primary product copy must not render raw ISO timestamps',
  );
  assert.doesNotMatch(
    primaryText,
    /本地伙伴工作台|文字能力|图片创作|上游投影|准入来源|等待投影|not_projected|Runtime\b|SDK\b|sourceRef|localAgentRef|回显通路|身份地板|graph-lite|Runtime Agent Chat|Capability Studio|Image Studio|Avatar Presence|\bempty\b|local:runtime-agent-live-e2e|runtime-agent-live-e2e|Hello from the Runtime Agent live fixture|Today|hello from Zhiyu live Runtime acceptance|Runtime acceptance|zhiyu-avatar-blocked|canonical capabilities|Runtime\/SDK route projection|Platform capability catalog|runtime-route-ready|runtime-agent-memory-graph-relations-not-admitted|zhiyu-ai-config-route-selection-required|ai-config-binding-missing|AIConfig targetRef|required for image\.generate|failed closed before request dispatch|Capability Studio has not run|Run core Runtime AI capabilities|configurationId|avatarDiagnosticCode|assetManifestPath|unsupportedFields/,
  );

  await page.locator('[data-zhiyu-diagnostics-entry="nav"]').click();
  await page.waitForSelector('[data-zhiyu-diagnostics-drawer="open"]', { state: 'visible' });
  const openDrawer = page.locator('[data-zhiyu-diagnostics-drawer="open"]');
  const drawerText = await openDrawer.innerText();
  assert.match(drawerText, /Runtime 诊断/);
  assert.equal(await openDrawer.locator('[data-zhiyu-region="diagnostics"]').count(), 1);
  assert.equal(await openDrawer.locator('[data-zhiyu-diagnostic-item]').count() > 0, true);
  await assertDiagnosticsCapabilityMatrixReadable(openDrawer);

  const { evidenceRoot } = resolveEvidenceRoot();
  await mkdir(evidenceRoot, { recursive: true });
  await openDrawer.locator('.zhiyu-home__diagnostics-drawer').screenshot({
    path: path.join(evidenceRoot, 'live-runtime-diagnostics-open-panel.png'),
  });
  await page.screenshot({
    path: path.join(evidenceRoot, 'live-runtime-diagnostics-open-desktop.png'),
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await openDrawer.waitFor({ timeout: 15_000 });
  await assertDiagnosticsCapabilityMatrixReadable(openDrawer);
  await page.screenshot({
    path: path.join(evidenceRoot, 'live-runtime-diagnostics-open-narrow.png'),
    fullPage: false,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await openDrawer.waitFor({ timeout: 15_000 });
  extraReadyPanelScreenshots.push(
    'live-runtime-diagnostics-open-panel.png',
    'live-runtime-diagnostics-open-desktop.png',
    'live-runtime-diagnostics-open-narrow.png',
  );

  await page.locator('[data-zhiyu-diagnostics-toggle="close"]').click();
  await page.waitForSelector('[data-zhiyu-diagnostics-drawer="closed"]', { state: 'attached' });
  assert.equal(await drawer.isHidden(), true);
}

async function assertDiagnosticsCapabilityMatrixReadable(openDrawer) {
  await openDrawer.locator('[data-zhiyu-capability-governance-chip]').first().waitFor({ timeout: 15_000 });
  const issues = await openDrawer.locator('.zhiyu-home__capability-governance').evaluateAll((rows) => {
    const out = [];
    for (const [rowIndex, row] of rows.entries()) {
      const rowRect = row.getBoundingClientRect();
      const cells = Array.from(row.querySelectorAll('[data-zhiyu-capability-governance-chip]'));
      if (cells.length === 0) {
        out.push({ rowIndex, issue: 'empty matrix row' });
        continue;
      }
      const rects = cells.map((cell, cellIndex) => {
        const rect = cell.getBoundingClientRect();
        const style = globalThis.getComputedStyle(cell);
        if (style.whiteSpace === 'nowrap') {
          out.push({ rowIndex, cellIndex, issue: 'nowrap cell', text: cell.textContent });
        }
        if (!/anywhere|break-word/.test(style.overflowWrap) && !/break-word|break-all/.test(style.wordBreak)) {
          out.push({ rowIndex, cellIndex, issue: 'missing long-token wrap policy', text: cell.textContent });
        }
        if (rect.left < rowRect.left - 1 || rect.right > rowRect.right + 1) {
          out.push({
            rowIndex,
            cellIndex,
            issue: 'cell overflows matrix row',
            cell: { left: rect.left, right: rect.right },
            row: { left: rowRect.left, right: rowRect.right },
          });
        }
        return { cellIndex, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      for (let index = 0; index < rects.length; index += 1) {
        for (let nextIndex = index + 1; nextIndex < rects.length; nextIndex += 1) {
          const left = Math.max(rects[index].left, rects[nextIndex].left);
          const right = Math.min(rects[index].right, rects[nextIndex].right);
          const top = Math.max(rects[index].top, rects[nextIndex].top);
          const bottom = Math.min(rects[index].bottom, rects[nextIndex].bottom);
          if (right - left > 0.5 && bottom - top > 0.5) {
            out.push({
              rowIndex,
              issue: 'overlapping matrix cells',
              cells: [rects[index].cellIndex, rects[nextIndex].cellIndex],
            });
          }
        }
      }
    }
    return out;
  });
  assert.deepEqual(issues, []);

  const itemIssues = await openDrawer.locator('[data-zhiyu-capability-item]').evaluateAll((items) => items
    .map((item, itemIndex) => {
      const style = globalThis.getComputedStyle(item);
      const itemRect = item.getBoundingClientRect();
      const content = item.querySelector('.zhiyu-home__capability-item-title');
      const status = item.querySelector('[data-zhiyu-capability-status-badge]');
      const governance = item.querySelector('.zhiyu-home__capability-governance');
      const contentRect = content?.getBoundingClientRect();
      const statusRect = status?.getBoundingClientRect();
      const governanceRect = governance?.getBoundingClientRect();
      const failures = [];
      if (style.display !== 'grid') {
        failures.push('item is not grid');
      }
      if (governanceRect && governanceRect.bottom > itemRect.bottom + 1) {
        failures.push({
          issue: 'governance matrix escapes item height',
          itemRect: { top: itemRect.top, bottom: itemRect.bottom, height: itemRect.height },
          governanceRect: { top: governanceRect.top, bottom: governanceRect.bottom, height: governanceRect.height },
          gridTemplateRows: style.gridTemplateRows,
        });
      }
      if (contentRect && statusRect) {
        const overlapX = Math.min(contentRect.right, statusRect.right) - Math.max(contentRect.left, statusRect.left);
        const overlapY = Math.min(contentRect.bottom, statusRect.bottom) - Math.max(contentRect.top, statusRect.top);
        if (overlapX > 0.5 && overlapY > 0.5) {
          failures.push('status badge overlaps capability content');
        }
      }
      return failures.length ? { itemIndex, failures } : null;
    })
    .filter(Boolean));
  assert.deepEqual(itemIssues, []);
}

async function assertChatCompletedNarrowComposerUsable(page) {
  await page.setViewportSize({ width: 390, height: 900 });
  const composer = page.locator('[data-canonical-composer-root="true"]').first();
  await composer.waitFor({ timeout: 15_000 });
  const metrics = await composer.evaluate((root) => {
    const shell = root.querySelector('[data-canonical-composer-width]');
    const textarea = root.querySelector('[data-chat-composer-textarea="true"]');
    const toolbar = root.querySelector('[data-chat-composer-toolbar="true"]');
    const trailing = root.querySelector('[data-chat-composer-toolbar-trailing="true"]');
    const send = root.querySelector('[data-chat-composer-send="true"]');
    if (!shell || !textarea || !toolbar || !trailing || !send) {
      return { missing: true };
    }
    const rootRect = root.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const trailingRect = trailing.getBoundingClientRect();
    const sendRect = send.getBoundingClientRect();
    return {
      missing: false,
      widthClass: shell.getAttribute('data-canonical-composer-width'),
      responsiveFloor: shell.getAttribute('data-canonical-composer-responsive-floor'),
      toolbarMode: toolbar.getAttribute('data-chat-composer-toolbar-mode'),
      rootWidth: rootRect.width,
      shellWidth: shellRect.width,
      textareaWidth: textareaRect.width,
      textareaLeft: textareaRect.left,
      textareaRight: textareaRect.right,
      toolbarLeft: toolbarRect.left,
      toolbarRight: toolbarRect.right,
      trailingLeft: trailingRect.left,
      trailingTop: trailingRect.top,
      trailingBottom: trailingRect.bottom,
      sendWidth: sendRect.width,
      sendHeight: sendRect.height,
      documentOverflow: globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth,
    };
  });

  assert.equal(metrics.missing, false, 'narrow composer is missing required DOM controls');
  assert.match(metrics.widthClass || '', /max\(320px,calc\(100vw-520px\)\)/);
  assert.equal(metrics.responsiveFloor, '320');
  assert.equal(metrics.toolbarMode, 'compact-horizontal');
  assert.ok(metrics.shellWidth >= 320, `composer shell is too narrow at 390px: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.textareaWidth >= 250, `composer textarea collapsed at 390px: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.sendWidth >= 34 && metrics.sendHeight >= 34, `composer send button is not usable at 390px: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.toolbarLeft >= metrics.textareaLeft - 1, `composer toolbar escapes left edge: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.toolbarRight <= metrics.textareaRight + 1, `composer toolbar escapes textarea row width: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.trailingLeft > metrics.toolbarLeft, `composer trailing controls are not laid out horizontally: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.documentOverflow <= 2, `completed narrow composer overflows horizontally: ${JSON.stringify(metrics)}`);
  await page.setViewportSize({ width: 1280, height: 900 });
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
  assert.match(avatarText, /形象启动和管理会在获得授权后出现。/);
  assert.doesNotMatch(avatarText, /上游明确授权/);
  assert.doesNotMatch(
    avatarText,
    /启动和管理入口会在授权后出现。/,
    'duplicate avatar authorization copy must not render',
  );
  const waitingAuthorizationCount = (avatarText.match(/等待授权/g) || []).length;
  assert.ok(
    waitingAuthorizationCount <= 1,
    `等待授权 must render at most once in the avatar panel, saw ${waitingAuthorizationCount}`,
  );
  assert.doesNotMatch(avatarText, /configurationId|avatarDiagnosticCode|assetManifestPath|motionState|expressionState|zhiyu-avatar|not_projected|\bruntime\b/);
}
