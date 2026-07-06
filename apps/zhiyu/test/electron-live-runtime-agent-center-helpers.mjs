import assert from 'node:assert/strict';
import {
  captureLiveRuntimeInteractionEvidence,
  escapeRegExp,
} from './electron-live-runtime-acceptance-helpers.mjs';

export async function assertAgentCenterHeaderParity(page, evidence) {
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

export async function closeAgentCenter(page) {
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

export async function assertAppearanceConfigParity(page, importedAvatarAsset) {
  await page.locator('[data-zhiyu-agent-center-tab-button="overview"]').click();
  await page.locator('[data-zhiyu-agent-panel-tab="overview"]').waitFor({ timeout: 15_000 });
  await page.locator('[data-zhiyu-agent-panel-tab="overview"] [data-zhiyu-panel-row="形象"]').click();
  await page.locator('[data-zhiyu-agent-panel-tab="appearance"]').waitFor({ timeout: 15_000 });
  const panel = page.locator('[data-zhiyu-agent-appearance-panel="true"]');
  await panel.waitFor({ timeout: 15_000 });
  await page.waitForFunction(() =>
    document.querySelector('[data-zhiyu-agent-appearance-panel="true"]')
      ?.getAttribute('data-zhiyu-avatar-appearance-ready') === 'true',
    undefined,
    { timeout: 15_000 },
  );
  assert.equal(
    await panel.getAttribute('data-zhiyu-avatar-appearance-ready'),
    'true',
    'Appearance panel must project the imported Avatar local asset before parity assertions continue',
  );
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
  const live2dAdapter = panel.locator('[data-zhiyu-avatar-import-action="live2d-adapter"]').first();
  await live2dAdapter.waitFor({ timeout: 15_000 });
  assert.equal(await live2dAdapter.getAttribute('data-zhiyu-avatar-import-state'), 'blocked');
  assert.ok(await live2dAdapter.getAttribute('data-zhiyu-avatar-import-reason'), 'Live2D adapter blocked control must expose a concrete reason');
  assert.equal(await live2dAdapter.isDisabled(), true, 'Live2D adapter import must stay blocked for a configured VRM asset');

  const clearAvatar = panel.locator('[data-zhiyu-avatar-import-action="clear"]').first();
  await clearAvatar.waitFor({ timeout: 15_000 });
  assert.equal(await clearAvatar.getAttribute('data-zhiyu-avatar-import-state'), 'available');
  assert.equal(await clearAvatar.isDisabled(), false, 'clear import control must be enabled after the VRM fixture is configured');

  await panel.locator('[data-zhiyu-avatar-evidence="true"]').waitFor({ timeout: 15_000 });
  assert.equal(await panel.locator('[data-zhiyu-avatar-evidence-row]').count(), 4);
  const panelTextWithImportedAsset = await panel.innerText();
  assert.match(panelTextWithImportedAsset, new RegExp(escapeRegExp(importedAvatarAsset.local_asset_id)));
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

export async function assertBehaviorConfigParity(page) {
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

export async function assertCognitionConfigParity(page) {
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

export async function assertAdvancedConfigParity(page) {
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

export async function assertAgentCenterKeyboardAccessibility(page) {
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

export async function assertDesktopShellTopbarParity(page, pageProblems) {
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

export async function assertLongTextNarrowChineseAndControls(page) {
  await page.setViewportSize({ width: 390, height: 900 });
  const shell = page.locator('[data-zhiyu-product-shell="workspace"]');
  await shell.waitFor({ timeout: 15_000 });
  const shellText = await shell.innerText();
  assert.match(shellText, /开始一段对话|当前伙伴|选择本地伙伴/);
  assert.match(shellText, /模型|本地对话模型已绑定|本地对话已就绪/);
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
