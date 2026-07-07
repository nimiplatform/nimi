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

function kitSectionButton(page, section) {
  return page.locator(`[data-testid="chat-agent-center-section:${section}"]`).first();
}

async function openKitAgentCenterSection(page, section) {
  const button = kitSectionButton(page, section);
  await button.waitFor({ state: 'visible', timeout: 15_000 });
  await button.click();
  await page.locator('[data-zhiyu-agent-panel-tab]').first().waitFor({ timeout: 15_000 });
  assert.equal(
    await page.locator('[data-zhiyu-agent-panel-tab]').first().getAttribute('data-zhiyu-agent-panel-tab'),
    section,
    `Agent Center placement must project active Kit section ${section}`,
  );
  await page.locator(`#agent-center-${section}-title`).waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await button.getAttribute('aria-current'), 'page');
  return button;
}

export async function assertAppearanceConfigParity(page, importedAvatarAsset) {
  await openKitAgentCenterSection(page, 'appearance');
  const panel = page.locator('[data-zhiyu-agent-center-kit-surface="true"]').first();
  await panel.waitFor({ timeout: 15_000 });
  const text = await panel.innerText();
  assert.match(text, /Appearance/);
  assert.match(text, /Avatar|not admitted|not configured/);
  assert.equal(await page.locator('[data-zhiyu-agent-appearance-panel="true"]').count(), 0, 'Zhiyu-specific Appearance panel must not be inside Kit Agent Center');
  assert.equal(await page.locator('[data-zhiyu-avatar-import-action]').count(), 0, 'Avatar import controls are outside the RLA4 Kit Agent Center surface');
  if (importedAvatarAsset?.local_asset_id) {
    assert.ok(importedAvatarAsset.local_asset_id, 'imported Avatar fixture must still carry a local asset id for boundary evidence');
  }
  const layout = await page.evaluate(() => {
    const sideSheet = document.querySelector('[data-zhiyu-region="agent-panel"]');
    const tabButtons = Array.from(document.querySelectorAll('[data-testid^="chat-agent-center-section:"]'));
    const activeTab = document.querySelector('[data-testid="chat-agent-center-section:appearance"]');
    const presenceRail = document.querySelector('[data-zhiyu-region="presence"]');
    const relationshipRail = document.querySelector('[data-zhiyu-region="relationship-rail"]');
    const sideRect = sideSheet?.getBoundingClientRect();
    const activeRect = activeTab?.getBoundingClientRect();
    const presenceRect = presenceRail?.getBoundingClientRect();
    const railRect = relationshipRail?.getBoundingClientRect();
    return {
      sideWidth: sideRect?.width ?? 0,
      sideLeft: sideRect?.left ?? 0,
      presenceLeft: presenceRect?.left ?? 0,
      presenceRight: presenceRect?.right ?? 0,
      tabCount: tabButtons.length,
      activeTabAria: activeTab?.getAttribute('aria-current') ?? null,
      activeTabWidth: activeRect?.width ?? 0,
      contactsRailVisible: Boolean(railRect && railRect.width > 0 && railRect.height > 0),
      contactsRailLeft: railRect?.left ?? 0,
      contactsRailRight: railRect?.right ?? 0,
    };
  });
  assert.equal(layout.tabCount, 6, `Kit Agent Center must expose six sections: ${JSON.stringify(layout)}`);
  assert.equal(layout.activeTabAria, 'page', `Appearance section must expose active page semantics: ${JSON.stringify(layout)}`);
  assert.ok(layout.activeTabWidth >= 32, `active Appearance section button must remain usable: ${JSON.stringify(layout)}`);
  assert.ok(layout.sideWidth >= 440, `Agent Center side sheet is too narrow for Desktop parity: ${JSON.stringify(layout)}`);
  assert.equal(layout.contactsRailVisible, true, `Desktop contacts rail must remain visible with Appearance open: ${JSON.stringify(layout)}`);
  assert.ok(layout.contactsRailLeft >= layout.presenceLeft - 2 && layout.contactsRailRight <= layout.presenceRight + 2, `contacts rail must stay inside the left presence rail: ${JSON.stringify(layout)}`);
}

export async function assertBehaviorConfigParity(page) {
  await openKitAgentCenterSection(page, 'behavior');
  const panel = page.locator('[data-zhiyu-agent-center-kit-surface="true"]').first();
  const text = await panel.innerText();
  assert.match(text, /Behavior/);
  assert.match(text, /Autonomy/);
  const autonomy = panel.locator('input[aria-label="Autonomy enabled"]').first();
  await autonomy.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await autonomy.isDisabled(), true, 'Zhiyu must not expose app-local autonomy mutation controls inside Kit Agent Center');
}

export async function assertCognitionConfigParity(page) {
  await openKitAgentCenterSection(page, 'cognition');
  const panel = page.locator('[data-zhiyu-agent-center-kit-surface="true"]').first();
  const text = await panel.innerText();
  assert.match(text, /Cognition/);
  assert.match(text, /Memory/);
  assert.equal(await page.locator('[data-zhiyu-agent-cognition-panel="true"]').count(), 0, 'Zhiyu-specific cognition panel must not be inside Kit Agent Center');
}

export async function assertAdvancedConfigParity(page) {
  await openKitAgentCenterSection(page, 'advanced');
  const panel = page.locator('[data-zhiyu-agent-center-kit-surface="true"]').first();
  const text = await panel.innerText();
  assert.match(text, /Advanced/);
  assert.match(text, /runtime-projection|unavailable/);
  assert.equal(await page.locator('[data-zhiyu-agent-center-capability-probe="open"]').count(), 0, 'Capability Probe must not be inside Kit Agent Center');
  assert.equal(await page.locator('[data-zhiyu-agent-advanced-technical-surfaces="true"]').count(), 0, 'technicalSurfaces must not be inside Kit Agent Center');
  assert.equal(await page.locator('[data-zhiyu-diagnostic-mode]').count(), 0, 'Zhiyu diagnostics surface must not be inside Kit Agent Center');
}

export async function assertAgentCenterKeyboardAccessibility(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const section of ['overview', 'appearance', 'model', 'behavior', 'cognition', 'advanced']) {
    const button = kitSectionButton(page, section);
    await button.waitFor({ state: 'visible', timeout: 15_000 });
    await button.focus();
    assert.equal(await button.evaluate((element) => element === globalThis.document.activeElement), true, `${section} section button must be keyboard focusable`);
    await page.keyboard.press('Enter');
    await page.locator(`#agent-center-${section}-title`).waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal(await button.getAttribute('aria-current'), 'page', `${section} section must expose active page semantics after keyboard activation`);
  }

  const composer = page.getByRole('textbox').first();
  await composer.waitFor({ state: 'visible', timeout: 15_000 });
  await composer.focus();
  assert.equal(await composer.evaluate((element) => element === globalThis.document.activeElement), true, 'composer textarea must be keyboard focusable');
  assert.equal(await composer.isEditable(), true);

  const sendButton = page.locator('[data-chat-composer-send="true"]').first();
  await sendButton.waitFor({ state: 'visible', timeout: 15_000 });
  await composer.fill('???????');
  await page.waitForFunction(() => document.querySelector('[data-chat-composer-send="true"]')?.disabled === false);
  await sendButton.focus();
  assert.equal(await sendButton.evaluate((element) => element === globalThis.document.activeElement), true, 'send button must be keyboard focusable');
  await composer.fill('');

  const voiceCapture = page.locator('[data-zhiyu-composer-tool="voice-capture"]').first();
  await voiceCapture.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await voiceCapture.isDisabled(), true);
  const handsFree = page.locator('[data-zhiyu-composer-tool="hands-free"]').first();
  await handsFree.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await handsFree.isDisabled(), true);

  await openKitAgentCenterSection(page, 'overview');
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
  await page.locator('[data-testid="chat-agent-center-section:advanced"][aria-current="page"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('[data-zhiyu-agent-panel-tab="advanced"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('#agent-center-advanced-title').waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await page.locator('[data-zhiyu-agent-center-capability-probe="open"]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-agent-advanced-technical-surfaces="true"]').count(), 0);
  assert.equal(await page.locator('[data-zhiyu-diagnostic-mode]').count(), 0);
  await assertOpenAgentPanelChatTrackCentering(page);
  assert.equal(
    await page.locator('[data-zhiyu-settings-panel="right"]').count(),
    0,
    'Desktop rail settings action must route to the merged Agent Center advanced tab, not a second settings panel',
  );
  await captureLiveRuntimeInteractionEvidence(page, 'rail-settings-advanced', pageProblems, {
    route: 'presence-rail-settings',
  });
  await page.locator('[data-testid="chat-agent-center-section:overview"]').click();
  await page.locator('#agent-center-overview-title').waitFor({ timeout: 15_000 });
  await page.locator('[data-zhiyu-composer-tool="agent"]').click();
  await page.locator('[data-testid="chat-agent-center-section:overview"]').click();
  await page.locator('#agent-center-overview-title').waitFor({ timeout: 15_000 });
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
