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
  const runtimePill = header.locator('[data-zhiyu-agent-center-runtime-pill]').first();
  await runtimePill.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await runtimePill.getAttribute('data-zhiyu-agent-center-runtime-pill'), 'ready');
  const headerLayout = await header.evaluate((root) => {
    const eyebrow = root.querySelector('[data-zhiyu-agent-center-eyebrow]');
    const pill = root.querySelector('[data-zhiyu-agent-center-runtime-pill]');
    const name = root.querySelector('.zhiyu-agent-center__title strong');
    const eyebrowRow = root.querySelector('.zhiyu-agent-center__eyebrow-row');
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
  assert.match(headerLayout.eyebrowRowClass, /\bgap-3\b/, `Runtime pill row must keep the requested small text gap: ${JSON.stringify(headerLayout)}`);
  assert.ok(headerLayout.eyebrow && headerLayout.pill && headerLayout.name, `header placement evidence missing: ${JSON.stringify(headerLayout)}`);
  const eyebrowToPillGap = headerLayout.pill.left - headerLayout.eyebrow.right;
  assert.ok(eyebrowToPillGap >= 8 && eyebrowToPillGap <= 24, `Runtime pill must sit a few letters to the right of AGENT CENTER: ${JSON.stringify({ eyebrowToPillGap, headerLayout })}`);
  assert.ok(Math.abs(headerLayout.pill.yCenter - headerLayout.eyebrow.yCenter) <= 4, `Runtime pill must share the AGENT CENTER row: ${JSON.stringify(headerLayout)}`);
  assert.ok(headerLayout.name.top >= headerLayout.pill.bottom - 1, `partner name must stay below the Runtime pill row: ${JSON.stringify(headerLayout)}`);
  const stateChipTexts = await header.locator('[data-zhiyu-agent-center-state-chip]').evaluateAll((elements) =>
    elements.map((element) => element.textContent?.trim().toLowerCase() || ''),
  );
  assert.deepEqual(
    stateChipTexts.filter((text) => text === 'ready'),
    [],
    `Agent Center header must not duplicate generic ready state chips: ${JSON.stringify(stateChipTexts)}`,
  );
  const localAgentRef = evidence.localAgent.localAgentRef;
  assert.ok(localAgentRef, 'ready evidence must include a Runtime LocalAgent ref');
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
  assert.match(text, /Appearance|外观/);
  assert.match(text, /Avatar|伙伴形象|尚未设置形象|not admitted|not configured/);
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
  assert.match(text, /Behavior|主动陪伴/);
  await panel.locator('[data-agent-center-behavior-page="proactive-companion"]').waitFor({ state: 'visible', timeout: 15_000 });
  const autonomy = panel.locator('[data-agent-center-proactive-toggle="true"]').first();
  await autonomy.waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction(() => {
    const toggle = document.querySelector('[data-agent-center-proactive-toggle="true"]');
    return toggle instanceof HTMLInputElement && !toggle.disabled;
  }, undefined, { timeout: 15_000 }).catch(() => undefined);
  const autonomyDebug = await panel.evaluate((root) => {
    const toggle = root.querySelector('[data-agent-center-proactive-toggle="true"]');
    return {
      disabled: toggle?.hasAttribute('disabled') ?? null,
      text: root.textContent?.trim().slice(0, 1200) ?? '',
      hasBehaviorPage: Boolean(root.querySelector('[data-agent-center-behavior-page="proactive-companion"]')),
      activeSection: root.querySelector('[data-agent-center-active-section-label="true"]')?.textContent?.trim() ?? null,
    };
  });
  assert.equal(
    await autonomy.isDisabled(),
    false,
    `Zhiyu must expose Runtime-backed autonomy mutation controls through Kit Agent Center: ${JSON.stringify(autonomyDebug)}`,
  );
  await panel.locator('[data-agent-center-budget-progress="true"]').waitFor({ state: 'attached', timeout: 15_000 });
  const highMode = panel.locator('[data-agent-center-behavior-mode="high"]').first();
  await highMode.click();
  await page.waitForFunction(() =>
    document.querySelector('[data-agent-center-behavior-mode="high"]')?.getAttribute('aria-pressed') === 'true',
  );
  const adjust = panel.locator('[data-agent-center-budget-adjust="true"]').first();
  await adjust.click();
  await panel.locator('[data-agent-center-autonomy-apply="true"]').waitFor({ state: 'visible', timeout: 15_000 });
}

export async function assertCognitionConfigParity(page) {
  await openKitAgentCenterSection(page, 'cognition');
  const panel = page.locator('[data-zhiyu-agent-center-kit-surface="true"]').first();
  const text = await panel.innerText();
  assert.match(text, /Cognition/);
  assert.match(text, /记忆状态|最近记忆/);
  assert.doesNotMatch(text, /Runtime 尚未返回生命周期、情绪与记忆摘要。/);
  assert.doesNotMatch(text, /织羽不会补写、猜测或伪造这些信息。/);
  assert.doesNotMatch(text, /这里仅展示 Runtime 投影出来的 canonical memory 摘要。/);
  assert.doesNotMatch(text, /当 Runtime 投影出近期记忆后，这里会显示记忆摘要、记忆类型和展示原因。/);
  assert.doesNotMatch(text, /不会编辑记忆|不会伪造记忆|不在本地保存记忆真相/);
  assert.doesNotMatch(text, /关于认知投影/);
  assert.equal(await page.locator('[data-agent-center-cognition-about="true"]').count(), 0, 'Cognition tab must not render the removed about projection card');
  assert.equal(await page.locator('[data-agent-center-cognition-readonly-chip]').count(), 0, 'Cognition tab must not render the removed readonly memory chips');
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
  assert.equal(await voiceCapture.getAttribute('data-zhiyu-chat-voice-capture-ready'), 'true');
  assert.equal(await voiceCapture.isDisabled(), false);
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
