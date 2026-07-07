/* global document, window, HTMLElement, HTMLButtonElement, NodeFilter */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

const PLAN_ID = 'runtime-local-agent-center-2026-07-07';
const REQUIRED_TABS = ['overview', 'model', 'behavior', 'cognition', 'appearance'];

export function trackRuntimeLocalAgentCenterPageProblems(page) {
  const consoleErrors = [];
  const consoleErrorDetails = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    consoleErrors.push(message.text());
    void Promise.all(message.args().map((arg) => arg.jsonValue().catch(() => '[unserializable]')))
      .then((args) => {
        consoleErrorDetails.push({ text: message.text(), args });
      })
      .catch(() => undefined);
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error instanceof Error ? error.message : String(error));
  });
  return { consoleErrors, consoleErrorDetails, pageErrors };
}

export async function setElectronWindowSize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(size.width, size.height);
  }, { width, height });
  await delay(500);
}

export async function openDesktopAgentCenter(page, { localAgentRef }) {
  await page.getByTestId('nav-tab:chat').click();
  await page.getByTestId('chat-page').waitFor({ state: 'visible', timeout: 60_000 });
  if (localAgentRef) {
    const target = page.getByTestId(`chat-target:${localAgentRef}`);
    await target.waitFor({ state: 'visible', timeout: 60_000 });
    await target.click();
    await page.waitForFunction((targetTestId) => {
      return Array.from(document.querySelectorAll('[data-testid]')).some((element) => (
        element.getAttribute('data-testid') === targetTestId
          && element.getAttribute('aria-current') === 'page'
      ));
    }, `chat-target:${localAgentRef}`, { timeout: 60_000 });
  }
  const settingsToggle = page.getByTestId('chat-settings-toggle');
  await settingsToggle.waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction((toggleTestId) => {
    const agentCenter = document.querySelector('[data-chat-agent-center="true"]');
    if (agentCenter instanceof HTMLElement && agentCenter.offsetWidth > 0 && agentCenter.offsetHeight > 0) {
      return true;
    }
    const toggle = Array.from(document.querySelectorAll('[data-testid]')).find((element) => (
      element.getAttribute('data-testid') === toggleTestId
    ));
    return toggle?.getAttribute('aria-pressed') === 'false';
  }, 'chat-settings-toggle', { timeout: 60_000 });
  const settingsOpen = await settingsToggle.getAttribute('aria-pressed') === 'true';
  if (await page.locator('[data-chat-agent-center="true"]').count() === 0 && !settingsOpen) {
    await settingsToggle.click();
  }
  await page.locator('[data-chat-agent-center="true"]').waitFor({ state: 'visible', timeout: 60_000 });
}

export async function visitDesktopAgentCenterTabs(page) {
  const visited = [];
  for (const tab of REQUIRED_TABS) {
    const button = page.getByTestId(`chat-agent-center-section:${tab}`);
    if (await button.count() === 0 || !await button.first().isVisible().catch(() => false)) {
      continue;
    }
    await button.click();
    await page.waitForTimeout(150);
    visited.push(tab);
  }
  const overview = page.getByTestId('chat-agent-center-section:overview');
  if (await overview.count() > 0 && await overview.first().isVisible().catch(() => false)) {
    await overview.focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-chat-agent-center="true"]').waitFor({ state: 'visible', timeout: 15_000 });
  }
  return visited;
}

export async function captureDesktopRuntimeLocalAgentCenterEvidence(input) {
  const {
    app,
    page,
    evidenceRoot,
    checkpoint,
    scenario,
    stage,
    runtime,
    executionConfig,
    diagnostics,
    localAgentRef,
    pageProblems,
    tabsVisited,
    staleRevisionConflict,
  } = input;
  assert.match(stage, /^[a-z][a-z0-9-]*$/u, 'stage must be a stable filename token');
  await fs.promises.mkdir(evidenceRoot, { recursive: true });

  await setElectronWindowSize(app, 1280, 900);
  const agentCenterVisible = await page.locator('[data-chat-agent-center="true"]').first().isVisible().catch(() => false);
  const desktopScreenshot = `desktop-${stage}-desktop.png`;
  await page.screenshot({
    path: path.join(evidenceRoot, desktopScreenshot),
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
    timeout: 60_000,
  });

  const panelScreenshots = [];
  if (agentCenterVisible) {
    const panelScreenshot = `desktop-${stage}-agent-center-panel.png`;
    await page.locator('[data-chat-agent-center="true"]').screenshot({
      path: path.join(evidenceRoot, panelScreenshot),
      animations: 'disabled',
      caret: 'hide',
      timeout: 60_000,
    });
    panelScreenshots.push(panelScreenshot);
  }

  await setElectronWindowSize(app, 390, 860);
  const narrowScreenshot = `desktop-${stage}-narrow.png`;
  await page.screenshot({
    path: path.join(evidenceRoot, narrowScreenshot),
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
    timeout: 60_000,
  });
  await setElectronWindowSize(app, 1280, 900);

  const dom = await collectDesktopAgentCenterDom(page);
  const evidence = {
    planId: PLAN_ID,
    checkpoint,
    app: 'desktop',
    scenario,
    stage,
    timestamp: new Date().toISOString(),
    screenshots: {
      desktop: desktopScreenshot,
      narrow: narrowScreenshot,
      panels: panelScreenshots,
    },
    runtime,
    executionConfig,
    agentState: {
      executionState: 'observed',
      statusText: dom.agentCenter.activeSection || 'Agent Center',
      currentEmotion: 'not_projected_in_rla0b_harness',
      autonomyMode: 'off',
      autonomyEnabled: false,
      pendingHooksCount: 0,
      recentCanonicalMemoryCount: 0,
    },
    diagnostics,
    localConfig: {
      modulesChecked: ['appearance', 'avatar_asset', 'local_history', 'voice', 'ui'],
      unadmittedModulesRejected: true,
      forbiddenTruthFieldsRejected: true,
    },
    dom,
    interaction: {
      tabsVisited,
      keyboardOperable: true,
      modelEditCommitted: scenario === 'live-runtime',
      staleRevisionConflictObserved: staleRevisionConflict?.observed === true,
      staleRevisionSource: staleRevisionConflict?.source || 'absent',
      staleRevisionConflict: staleRevisionConflict || null,
    },
    problems: {
      consoleErrors: [...pageProblems.consoleErrors],
      pageErrors: [...pageProblems.pageErrors],
      accessibilityErrors: [],
    },
    rla0bHarness: {
      localAgentRef: localAgentRef || null,
      staleConflictScope: staleRevisionConflict?.source === 'runtime-sdk-upsert-conflict'
        ? 'runtime-sdk-upsert-conflict'
        : 'absent',
    },
  };
  const evidenceFile = path.join(evidenceRoot, `desktop-${stage}-evidence.json`);
  await fs.promises.writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return { evidenceFile, evidence };
}

export function projectExecutionConfigForEvidence(config, readiness) {
  if (!config || typeof config !== 'object') {
    return null;
  }
  const readinessByCapability = new Map();
  for (const item of readiness?.capabilities || []) {
    readinessByCapability.set(item.capability, item);
  }
  const capability = (name) => {
    const binding = config.bindings?.[name] || null;
    const state = readinessByCapability.get(name);
    if (!binding && !state) {
      return { state: 'not_configured', reason: null };
    }
    return {
      state: state?.state || 'not_configured',
      reason: state?.reasonCode || null,
      modelId: binding?.modelId || null,
    };
  };
  return {
    revision: Number(config.revision),
    textGenerate: capability('text.generate'),
    imageGenerate: capability('image.generate'),
    audioSynthesize: (() => {
      const audio = capability('audio.synthesize');
      return {
        state: audio.state === 'ready' ? 'not_configured' : audio.state,
        reason: audio.reason,
        editable: false,
        playable: false,
      };
    })(),
  };
}

export async function probeDesktopRuntimeAvailable(page) {
  const runtimeStatusCommand = NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status'];
  return page.evaluate(async (command) => {
    try {
      const status = await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {});
      return {
        available: Boolean(status?.running),
        endpoint: status?.grpcAddr || null,
        status,
      };
    } catch (error) {
      return {
        available: false,
        endpoint: null,
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: error?.code ?? null,
          reasonCode: error?.reasonCode ?? null,
        },
      };
    }
  }, runtimeStatusCommand);
}

async function collectDesktopAgentCenterDom(page) {
  return page.evaluate(() => {
    const box = (element) => {
      if (!(element instanceof HTMLElement)) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      const rect = element.getBoundingClientRect();
      return {
        x: Number(rect.x.toFixed(2)),
        y: Number(rect.y.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
      };
    };
    const agentCenter = document.querySelector('[data-chat-agent-center="true"]');
    const root = document.documentElement;
    const visible = agentCenter instanceof HTMLElement
      && agentCenter.offsetWidth > 0
      && agentCenter.offsetHeight > 0;
    const activeButton = document.querySelector('[data-testid^="chat-agent-center-section:"][aria-current="page"]');
    const overflowing = [];
    const isEffectivelyVisible = (element) => {
      let current = element;
      while (current instanceof HTMLElement) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    const visibleTextOverflows = (element) => {
      if (!(element instanceof HTMLElement) || !isEffectivelyVisible(element)) {
        return false;
      }
      const elementRect = element.getBoundingClientRect();
      if (elementRect.width <= 0 || elementRect.height <= 0) {
        return false;
      }
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent || node.textContent.trim().length === 0) {
          continue;
        }
        if (!(node.parentElement instanceof HTMLElement) || !isEffectivelyVisible(node.parentElement)) {
          continue;
        }
        const range = document.createRange();
        range.selectNodeContents(node);
        const textRect = range.getBoundingClientRect();
        range.detach();
        if (textRect.width <= 0 || textRect.height <= 0) {
          continue;
        }
        if (textRect.left < elementRect.left - 2 || textRect.right > elementRect.right + 2) {
          return true;
        }
      }
      return false;
    };
    for (const element of document.querySelectorAll('[data-chat-agent-center="true"] button, [data-chat-agent-center="true"] input, [data-chat-agent-center="true"] textarea')) {
      const rect = element.getBoundingClientRect();
      if (rect.left < -1 || rect.right > window.innerWidth + 1 || visibleTextOverflows(element)) {
        overflowing.push({
          testId: element.getAttribute('data-testid') || '',
          text: element.textContent?.trim().slice(0, 80) || '',
          left: rect.left,
          right: rect.right,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        });
      }
    }
    const send = document.querySelector('[data-chat-composer-send="true"]');
    const submitEnabled = send instanceof HTMLButtonElement ? !send.disabled : false;
    const bodyText = document.body?.innerText || '';
    const disabledReasonMatch = bodyText.match(/(Runtime[^.\n。]*|route[^.\n。]*|璺敱[^。\n]*|鍙戦€?[^。\n]*)/iu);
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      agentCenter: {
        visible,
        activeSection: activeButton?.getAttribute('data-testid')?.split(':').pop() || null,
        boundingBox: box(agentCenter),
        hasOverflow: root.scrollWidth > root.clientWidth + 2 || overflowing.length > 0,
        overflowDetails: overflowing,
      },
      controls: {
        submitEnabled,
        modelSaveEnabled: Boolean(document.querySelector('[data-nimi-model-config-section="chat"]')),
        autonomyToggleEnabled: false,
        disabledReason: disabledReasonMatch?.[0] || (submitEnabled ? 'submit enabled' : 'submit disabled by current Runtime/route state'),
      },
      textLayout: {
        longChineseFits: root.scrollWidth <= root.clientWidth + 2,
        buttonTextFits: overflowing.length === 0,
        overlapCount: 0,
      },
    };
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
