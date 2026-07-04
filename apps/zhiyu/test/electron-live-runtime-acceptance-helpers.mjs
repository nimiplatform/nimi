import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const stageScreenshotRegistry = new Map();
const extraReadyPanelScreenshots = [];

function resolveEvidenceRoot() {
  const checkpoint = evidenceCheckpoint('live-runtime');
  return {
    checkpoint,
    evidenceRoot: path.resolve(root, '..', '..', '.nimi', 'local', 'evidence', 'zhiyu', checkpoint),
  };
}

export async function resetLiveRuntimeEvidenceRoot() {
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

export async function resetAcceptanceInputs(page) {
  await page.locator('[data-chat-composer-textarea="true"]').fill('');
}

export async function captureLiveRuntimeInteractionEvidence(page, stage, pageProblems, evidence) {
  assert.match(stage, /^[a-z][A-Za-z0-9-]*$/u, 'interaction evidence stage must be a stable filename token');
  const { checkpoint, evidenceRoot } = resolveEvidenceRoot();
  await mkdir(evidenceRoot, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const screenshotPath = path.join(evidenceRoot, `live-runtime-${stage}.png`);
  await page.locator('[data-zhiyu-region="agent-panel"]').first().screenshot({ path: screenshotPath });
  const domEvidence = await page.evaluate(() => ({
    activeAgentPanelMode: globalThis.document
      .querySelector('[data-zhiyu-agent-panel-mode]')
      ?.getAttribute('data-zhiyu-agent-panel-mode') ?? null,
    activeAgentPanelTab: globalThis.document
      .querySelector('[data-zhiyu-agent-panel-tab]')
      ?.getAttribute('data-zhiyu-agent-panel-tab') ?? null,
    settingsPanelCount: globalThis.document.querySelectorAll('[data-zhiyu-settings-panel="right"]').length,
    advancedPanelVisible: Boolean(globalThis.document.querySelector('[data-zhiyu-agent-advanced-panel="true"]')),
  })).catch((error) => ({
    evaluationError: error instanceof Error ? error.message : String(error),
  }));
  await writeFile(
    path.join(evidenceRoot, `live-runtime-${stage}-evidence.json`),
    `${JSON.stringify({
      checkpoint,
      scenario: 'live-runtime',
      stage,
      pageProblems: [...pageProblems],
      screenshot: path.basename(screenshotPath),
      ...evidence,
      domEvidence,
    }, null, 2)}\n`,
    'utf8',
  );
}

export async function assertUniqueStageScreenshots() {
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

export async function captureLiveRuntimeEvidence(page, stage, pageProblems, evidence) {
  const { checkpoint, evidenceRoot } = resolveEvidenceRoot();
  const sectionCaptureSelectors = {
    avatarBlocked: '[data-zhiyu-region="avatar"]',
  };
  const narrowSectionCaptureSelectors = {
    modelUnconfigured: '[data-zhiyu-region="agent-panel"]',
    modelConfigured: '[data-zhiyu-region="agent-panel"]',
    appearanceConfig: '[data-zhiyu-region="agent-panel"]',
    behaviorConfig: '[data-zhiyu-region="agent-panel"]',
    cognitionConfig: '[data-zhiyu-region="agent-panel"]',
    advancedConfig: '[data-zhiyu-region="agent-panel"]',
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
    appearanceConfig: {
      desktop: 'live-runtime-appearance-config-desktop.png',
      narrow: 'live-runtime-appearance-config-narrow.png',
      evidence: 'live-runtime-appearance-config-evidence.json',
    },
    behaviorConfig: {
      desktop: 'live-runtime-behavior-config-desktop.png',
      narrow: 'live-runtime-behavior-config-narrow.png',
      evidence: 'live-runtime-behavior-config-evidence.json',
    },
    cognitionConfig: {
      desktop: 'live-runtime-cognition-config-desktop.png',
      narrow: 'live-runtime-cognition-config-narrow.png',
      evidence: 'live-runtime-cognition-config-evidence.json',
    },
    advancedConfig: {
      desktop: 'live-runtime-advanced-config-desktop.png',
      narrow: 'live-runtime-advanced-config-narrow.png',
      evidence: 'live-runtime-advanced-config-evidence.json',
    },
    ready: {
      desktop: 'live-runtime-ready-desktop.png',
      narrow: 'live-runtime-ready-narrow.png',
      evidence: 'live-runtime-ready-evidence.json',
    },
    staleRoute: {
      desktop: 'live-runtime-stale-route-desktop.png',
      narrow: 'live-runtime-stale-route-narrow.png',
      evidence: 'live-runtime-stale-route-evidence.json',
    },
    chatStreaming: {
      desktop: 'live-runtime-agent-chat-streaming-desktop.png',
      narrow: 'live-runtime-agent-chat-streaming-narrow.png',
      evidence: 'live-runtime-agent-chat-streaming-evidence.json',
    },
    chatCanceled: {
      desktop: 'live-runtime-agent-chat-canceled-desktop.png',
      narrow: 'live-runtime-agent-chat-canceled-narrow.png',
      evidence: 'live-runtime-agent-chat-canceled-evidence.json',
    },
    chatFailed: {
      desktop: 'live-runtime-agent-chat-failed-desktop.png',
      narrow: 'live-runtime-agent-chat-failed-narrow.png',
      evidence: 'live-runtime-agent-chat-failed-evidence.json',
    },
    chatCompleted: {
      desktop: 'live-runtime-agent-chat-completed-desktop.png',
      narrow: 'live-runtime-agent-chat-completed-narrow.png',
      evidence: 'live-runtime-agent-chat-completed-evidence.json',
    },
    actionArtifact: {
      desktop: 'live-runtime-action-artifact-desktop.png',
      narrow: 'live-runtime-action-artifact-narrow.png',
      evidence: 'live-runtime-action-artifact-evidence.json',
    },
    chatMultiTurn: {
      desktop: 'live-runtime-agent-chat-multi-turn-desktop.png',
      narrow: 'live-runtime-agent-chat-multi-turn-narrow.png',
      evidence: 'live-runtime-agent-chat-multi-turn-evidence.json',
    },
    chatRestartHydrated: {
      desktop: 'live-runtime-agent-chat-restart-hydrated-desktop.png',
      narrow: 'live-runtime-agent-chat-restart-hydrated-narrow.png',
      evidence: 'live-runtime-agent-chat-restart-hydrated-evidence.json',
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
  const captureStageScreenshot = async (screenshotPath, selector = sectionSelector) => {
    if (selector) {
      const section = page.locator(selector).first();
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
  await captureStageScreenshot(narrowPath, narrowSectionCaptureSelectors[stage]);
  await registerStageScreenshot(narrowPath);
  await page.setViewportSize({ width: 1280, height: 900 });
  const domEvidence = await page.evaluate(() => {
    const readVisibleElementEvidence = (selector) => {
      const element = globalThis.document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        return {
          present: false,
          visible: false,
          text: null,
          reason: null,
          action: null,
        };
      }
      const box = element.getBoundingClientRect();
      const style = globalThis.getComputedStyle(element);
      return {
        present: true,
        visible: box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
        text: element.innerText,
        reason: element.getAttribute('data-zhiyu-agent-chat-failure-reason'),
        action: element.getAttribute('data-zhiyu-agent-chat-failure-action'),
      };
    };
    return {
      url: globalThis.location.href,
      title: globalThis.document.title,
      bodyText: globalThis.document.body?.innerText ?? '',
      chatFailureNotice: readVisibleElementEvidence('[data-zhiyu-agent-chat-failure="true"]'),
      chatSubmit: {
        enabled: globalThis.document
          .querySelector('[data-zhiyu-submit-enabled]')
          ?.getAttribute('data-zhiyu-submit-enabled') ?? null,
        buttonDisabled: globalThis.document
          .querySelector('[data-chat-composer-send="true"]')
          ?.hasAttribute('disabled') ?? null,
      },
      zhiyuEvidence: globalThis.window.__nimiZhiyuEvidence ?? null,
    };
  }).catch((error) => ({
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
      ['[data-zhiyu-region="relationship-rail"]', 'live-runtime-no-partner-relationship-rail.png'],
    ],
    partnerSelected: [
      ['[data-zhiyu-region="conversation"]', 'live-runtime-partner-selected-conversation-panel.png'],
      ['[data-zhiyu-region="relationship-rail"]', 'live-runtime-partner-selected-relationship-rail.png'],
    ],
    modelUnconfigured: [
      ['[data-zhiyu-region="agent-panel"]', 'live-runtime-model-unconfigured-panel.png'],
      [null, 'live-runtime-model-unconfigured-viewport.png'],
    ],
    modelConfigured: [
      ['[data-zhiyu-region="agent-panel"]', 'live-runtime-model-configured-panel.png'],
      [null, 'live-runtime-model-configured-viewport.png'],
    ],
    appearanceConfig: [
      ['[data-zhiyu-region="agent-panel"]', 'live-runtime-appearance-config-panel.png'],
      [null, 'live-runtime-appearance-config-viewport.png'],
    ],
    behaviorConfig: [
      ['[data-zhiyu-region="agent-panel"]', 'live-runtime-behavior-config-panel.png'],
      [null, 'live-runtime-behavior-config-viewport.png'],
    ],
    cognitionConfig: [
      ['[data-zhiyu-region="agent-panel"]', 'live-runtime-cognition-config-panel.png'],
      [null, 'live-runtime-cognition-config-viewport.png'],
    ],
    advancedConfig: [
      ['[data-zhiyu-region="agent-panel"]', 'live-runtime-advanced-config-panel.png'],
      [null, 'live-runtime-advanced-config-viewport.png'],
    ],
    ready: [
      ['[data-zhiyu-region="conversation"]', 'live-runtime-ready-conversation-panel.png'],
      ['[data-zhiyu-region="relationship-rail"]', 'live-runtime-ready-relationship-rail.png'],
    ],
    staleRoute: [
      ['[data-zhiyu-region="conversation"]', 'live-runtime-stale-route-conversation-panel.png'],
    ],
    chatCompleted: [
      ['[data-zhiyu-region="conversation"]', 'live-runtime-agent-chat-panel.png'],
    ],
    chatFailed: [
      ['[data-zhiyu-region="conversation"]', 'live-runtime-agent-chat-failed-panel.png'],
    ],
    actionArtifact: [
      ['[data-zhiyu-region="conversation"]', 'live-runtime-action-artifact-panel.png'],
    ],
    chatMultiTurn: [
      ['[data-zhiyu-region="conversation"]', 'live-runtime-agent-chat-multi-turn-panel.png'],
    ],
    chatRestartHydrated: [
      ['[data-zhiyu-region="conversation"]', 'live-runtime-agent-chat-restart-hydrated-panel.png'],
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
  if (stage === 'appearanceConfig' || stage === 'cognitionConfig' || stage === 'advancedConfig') {
    const scrollPane = page.locator('[data-zhiyu-region="agent-panel"] .zhiyu-home__agent-panel-scroll').first();
    await scrollPane.waitFor({ timeout: 15_000 });
    await scrollPane.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const bottomFilename = stage === 'appearanceConfig'
      ? 'live-runtime-appearance-config-panel-bottom.png'
      : stage === 'cognitionConfig'
        ? 'live-runtime-cognition-config-panel-bottom.png'
        : 'live-runtime-advanced-config-panel-bottom.png';
    await page.locator('[data-zhiyu-region="agent-panel"]').first().screenshot({ path: path.join(evidenceRoot, bottomFilename) });
    captured.push(bottomFilename);
    await scrollPane.evaluate((node) => {
      node.scrollTop = 0;
    });
  }
  return captured;
}

function evidenceCheckpoint(fallback) {
  return process.env.NIMI_ZHIYU_EVIDENCE_CHECKPOINT?.trim() || fallback;
}

export function trackPageProblems(page) {
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

export function assertNoPageProblems(problems) {
  assert.deepEqual(problems, []);
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function assertProductShellPrimaryView(page) {
  const shell = page.locator('[data-zhiyu-product-shell="workspace"]');
  await shell.waitFor({ timeout: 15_000 });
  assert.equal(await shell.getAttribute('data-zhiyu-primary-ui'), 'true');

  const drawer = page.locator('#zhiyu-diagnostics-drawer');
  assert.equal(await drawer.getAttribute('data-zhiyu-diagnostics-drawer'), 'closed');
  assert.equal(await drawer.isHidden(), true);

  assert.equal(await shell.locator('[data-zhiyu-side-panel-state]').getAttribute('data-zhiyu-side-panel-state'), 'closed');
  assert.equal(await shell.locator('[data-zhiyu-region="conversation"]').count(), 1);
  assert.equal(await shell.locator('[data-zhiyu-region="agent-panel"]').count(), 0);
  assert.equal(await shell.locator('[data-zhiyu-region="relationship-rail"]').count(), 1);

  const primaryText = await shell.innerText();
  assert.match(primaryText, /开始一段对话|当前伙伴|选择本地伙伴/);
  assert.match(primaryText, /模型|本地对话模型已绑定/);
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

export async function assertDiagnosticsCapabilityMatrixReadable(openDrawer) {
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

export async function assertChatCompletedNarrowComposerUsable(page) {
  await page.setViewportSize({ width: 390, height: 900 });
  const composer = page.locator('[data-canonical-composer-root="true"]').first();
  await composer.waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => {
    const transcript = document.querySelector('[data-canonical-transcript-root="true"]');
    if (!transcript) {
      return false;
    }
    return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= 8;
  }, undefined, { timeout: 5_000 }).catch(() => undefined);
  const metrics = await composer.evaluate((root) => {
    const shell = root.querySelector('[data-canonical-composer-width]');
    const textarea = root.querySelector('[data-chat-composer-textarea="true"]');
    const toolbar = root.querySelector('[data-chat-composer-toolbar="true"]');
    const trailing = root.querySelector('[data-chat-composer-toolbar-trailing="true"]');
    const send = root.querySelector('[data-chat-composer-send="true"]');
    const transcript = document.querySelector('[data-canonical-transcript-root="true"]');
    if (!shell || !textarea || !toolbar || !trailing || !send || !transcript) {
      return { missing: true };
    }
    const rootRect = root.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const trailingRect = trailing.getBoundingClientRect();
    const sendRect = send.getBoundingClientRect();
    const transcriptBottomGap = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    return {
      missing: false,
      widthClass: shell.getAttribute('data-canonical-composer-width'),
      responsiveFloor: shell.getAttribute('data-canonical-composer-responsive-floor'),
      toolbarMode: toolbar.getAttribute('data-chat-composer-toolbar-mode'),
      rootWidth: rootRect.width,
      rootTop: rootRect.top,
      rootBottom: rootRect.bottom,
      shellWidth: shellRect.width,
      shellTop: shellRect.top,
      shellBottom: shellRect.bottom,
      textareaWidth: textareaRect.width,
      textareaLeft: textareaRect.left,
      textareaRight: textareaRect.right,
      textareaBottom: textareaRect.bottom,
      toolbarLeft: toolbarRect.left,
      toolbarRight: toolbarRect.right,
      toolbarBottom: toolbarRect.bottom,
      trailingLeft: trailingRect.left,
      trailingTop: trailingRect.top,
      trailingBottom: trailingRect.bottom,
      sendWidth: sendRect.width,
      sendHeight: sendRect.height,
      sendBottom: sendRect.bottom,
      transcriptScrollTop: transcript.scrollTop,
      transcriptScrollHeight: transcript.scrollHeight,
      transcriptClientHeight: transcript.clientHeight,
      transcriptBottomGap,
      viewportHeight: globalThis.innerHeight,
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
  assert.ok(metrics.rootTop >= 0, `composer root is clipped above the narrow viewport: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.shellBottom <= metrics.viewportHeight, `composer shell is clipped below the narrow viewport: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.toolbarBottom <= metrics.viewportHeight, `composer toolbar is clipped below the narrow viewport: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.sendBottom <= metrics.viewportHeight, `composer send button is clipped below the narrow viewport: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.transcriptBottomGap <= 8, `completed narrow transcript is not scrolled to the latest turn: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.documentOverflow <= 2, `completed narrow composer overflows horizontally: ${JSON.stringify(metrics)}`);
  await page.setViewportSize({ width: 1280, height: 900 });
}

export async function assertAvatarPanelProjection(page) {
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
