/* global document, getComputedStyle, innerHeight, innerWidth, location */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { REPO_ROOT } from './acceptance-contract.mjs';

const require = createRequire(path.join(REPO_ROOT, 'apps', 'desktop', 'package.json'));
const { chromium } = require('playwright');

export async function connectObservedApplication(port, label, timeoutMs = 60_000) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  let diagnostic = '';
  while (Date.now() < deadline) {
    try {
      const browser = await chromium.connectOverCDP(endpoint);
      const contexts = browser.contexts();
      const pages = contexts.flatMap((context) => context.pages());
      if (pages.length !== 1) {
        await browser.close();
        throw new Error(`${label} must expose exactly one observed page, found ${pages.length}`);
      }
      const page = pages[0];
      const problems = capturePageProblems(page);
      await page.waitForLoadState('domcontentloaded');
      return Object.freeze({ browser, endpoint, label, page, problems });
    } catch (error) {
      diagnostic = error instanceof Error ? error.message : String(error);
      await delay(300);
    }
  }
  throw new Error(`Cannot connect to ${label} CDP at ${endpoint}: ${diagnostic}`);
}

export async function snapshotObservedApplication(observed, input) {
  const { page } = observed;
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.screenshot({ path: path.join(input.evidenceRoot, `${input.prefix}-desktop.png`), fullPage: true });
  const desktop = await domSummary(page);
  const accessibility = await accessibilityTree(page);
  const interactions = await interactionSummary(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: path.join(input.evidenceRoot, `${input.prefix}-390.png`), fullPage: true });
  const narrow = await domSummary(page);
  return Object.freeze({
    label: observed.label,
    endpoint: observed.endpoint,
    desktop,
    narrow,
    accessibility,
    interactions,
    longChineseText: longestChineseRun(desktop.bodyText),
  });
}

export async function invokeBridge(page, command, payload = {}) {
  return page.evaluate(async ({ commandName, commandPayload }) => {
    try {
      const bridge = globalThis.window?.__NIMI_ELECTRON_RUNTIME__;
      if (!bridge || typeof bridge.invoke !== 'function') throw new Error('electron-runtime-bridge-unavailable');
      return { ok: true, value: await bridge.invoke(commandName, commandPayload) };
    } catch (error) {
      return {
        ok: false,
        error: {
          name: typeof error?.name === 'string' ? error.name : 'Error',
          message: typeof error?.message === 'string' ? error.message : String(error),
          code: typeof error?.code === 'string' ? error.code : '',
          reasonCode: typeof error?.reasonCode === 'string' ? error.reasonCode : '',
          actionHint: typeof error?.actionHint === 'string' ? error.actionHint : '',
          source: typeof error?.source === 'string' ? error.source : '',
        },
      };
    }
  }, { commandName: command, commandPayload: payload });
}

export async function waitForDesktopSurface(page, timeoutMs = 60_000) {
  const handle = await page.waitForFunction(() => {
    const rows = [
      ['main', '[data-testid="main-shell"]'],
      ['login', '[data-testid="login-screen"]'],
      ['first-run', '[data-testid="desktop-first-run-gate"]'],
      ['admission-failed', '[data-testid="desktop-admission-failed"]'],
      ['bootstrap-error', '[data-testid="app-bootstrap-error-screen"]'],
    ];
    return rows.find(([, selector]) => document.querySelector(selector))?.[0] ?? null;
  }, undefined, { timeout: timeoutMs });
  return handle.jsonValue();
}

export async function beginNormalRealmLogin(page, captureFile) {
  const current = await invokeBridge(page, 'runtime_account_session_status', {});
  if (current.ok && current.value?.state === 'authenticated') return { alreadyAuthenticated: true, current };
  const selectors = ['[data-testid="topbar-login-button"]', '[data-testid="login-logo-trigger"]'];
  let clicked = false;
  for (const selector of selectors) {
    const trigger = page.locator(selector);
    if (await trigger.count()) {
      await trigger.first().click();
      clicked = true;
      break;
    }
  }
  if (!clicked) throw new Error('Desktop exposes no normal Realm login trigger');
  const deadline = Date.now() + 20_000;
  let authorizationUrl = '';
  while (Date.now() < deadline) {
    try {
      authorizationUrl = (await readFile(captureFile, 'utf8')).trim();
      if (authorizationUrl) break;
    } catch {
      // The signed Desktop creates the fresh capture only after a real login intent.
    }
    await delay(200);
  }
  const parsed = new URL(authorizationUrl);
  if (parsed.protocol !== 'http:' || parsed.hostname !== 'localhost' || parsed.port !== '3002'
    || parsed.pathname !== '/api/auth/oauth/authorize' || parsed.username || parsed.password) {
    throw new Error('Desktop normal login did not produce the exact local Realm authorization URL');
  }
  const loginBrowser = await chromium.launch({ headless: false });
  const loginPage = await loginBrowser.newPage();
  await loginPage.goto(authorizationUrl, { waitUntil: 'domcontentloaded' });
  return Object.freeze({ alreadyAuthenticated: false, authorizationUrl, loginBrowser, loginPage });
}

export async function requireAnonymousRuntimeAccount(page) {
  const current = await invokeBridge(page, 'runtime_account_session_status', {});
  if (!current.ok) {
    throw Object.assign(new Error(`Cannot establish zero-session acceptance precondition: ${JSON.stringify(current)}`), {
      reasonCode: 'acceptance-account-state-unavailable',
      actionHint: 'repair_the_runtime_account_session_then_rerun',
    });
  }
  if (current.value?.state === 'authenticated') {
    throw Object.assign(new Error('The macOS acceptance chain requires a zero-session start and will not silently log out an existing user account.'), {
      reasonCode: 'acceptance-account-not-isolated',
      actionHint: 'log_out_the_existing_desktop_account_then_rerun_and_create_an_isolated_acceptance_account',
    });
  }
  if (current.value?.state !== 'anonymous') {
    throw Object.assign(new Error(`Runtime account state is not the required anonymous baseline: ${JSON.stringify(current)}`), {
      reasonCode: 'acceptance-account-state-untrusted',
      actionHint: 'repair_or_reset_the_runtime_account_session_then_rerun',
    });
  }
  return current;
}

export async function waitForAuthenticatedAccount(page, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await invokeBridge(page, 'runtime_account_session_status', {});
    if (last.ok && last.value?.state === 'authenticated' && last.value?.accountProjection?.accountId) return last;
    await delay(500);
  }
  throw Object.assign(new Error(`Desktop account did not become authenticated: ${JSON.stringify(last)}`), {
    reasonCode: 'acceptance-realm-login-incomplete',
    actionHint: 'complete_the_normal_realm_registration_or_login_in_the_open_browser',
  });
}

export async function navigateToDeveloperSettings(page) {
  const trigger = page.locator('[data-testid="desktop-account-menu-trigger"]');
  await trigger.waitFor({ state: 'visible', timeout: 20_000 });
  await trigger.click();
  const settings = page.locator('[data-testid="desktop-account-menu-item:settings"]');
  await settings.waitFor({ state: 'visible', timeout: 10_000 });
  await settings.click();
  const performance = page.locator('[data-testid="settings-nav:performance"]');
  await performance.waitFor({ state: 'visible', timeout: 20_000 });
  await performance.click();
  await page.locator('[data-testid="developer-mode-toggle"]').waitFor({ state: 'visible', timeout: 20_000 });
}

export async function setDeveloperModeThroughUI(page, enabled) {
  await navigateToDeveloperSettings(page);
  const card = page.locator('[data-testid="developer-mode-toggle"]');
  await expectDeveloperModeReady(card);
  const current = await card.getAttribute('data-developer-mode');
  if ((current === 'on') !== enabled) {
    const button = page.locator('[data-testid="developer-mode-toggle-button"]');
    await button.click();
  }
  await card.waitFor({ state: 'visible' });
  await page.waitForFunction((expected) => (
    document.querySelector('[data-testid="developer-mode-toggle"]')?.getAttribute('data-developer-mode') === expected
  ), enabled ? 'on' : 'off', { timeout: 20_000 });
  const projection = await invokeBridge(page, 'developer_mode_status', {});
  if (!projection.ok || Boolean(projection.value?.enabled) !== enabled) {
    throw new Error(`Developer Mode UI and Runtime projection disagree: ${JSON.stringify(projection)}`);
  }
  return projection;
}

export async function approvePendingLocalAppThroughUI(page) {
  const dialog = page.locator('[data-testid="local-development-approval-dialog"]');
  await dialog.waitFor({ state: 'visible', timeout: 90_000 });
  const permissionRows = await page.locator('[data-testid="local-development-permissions"] li').allTextContents();
  await page.locator('[data-testid="local-development-native-risk-ack"]').check();
  const allowProject = page.locator('[data-testid="local-development-remember"]');
  await allowProject.click();
  await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
  return Object.freeze({ permissionRows, publicPermissionCount: permissionRows.length });
}

export async function waitForAllowProjectAuthorization(page, input = {}) {
  const appId = input.appId ?? 'nimi.zhiyu';
  const timeoutMs = input.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await invokeBridge(page, 'local_development_authorizations_list', {});
    if (last.ok && Array.isArray(last.value)) {
      const matches = last.value.filter((row) => row.appId === appId
        && row.persistence === 'allow-project'
        && row.state === 'active'
        && (input.accountId === undefined || row.accountId === input.accountId));
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) {
        throw new Error(`Multiple active allow-project authorizations exist for ${appId}`);
      }
    }
    await delay(250);
  }
  throw new Error(`No exact active allow-project authorization reached the Desktop projection: ${JSON.stringify(last)}`);
}

export async function revokeActiveLocalAppThroughUI(page) {
  await navigateToDeveloperSettings(page);
  const revoke = page.locator('[data-testid^="local-development-revoke:"]').first();
  await revoke.waitFor({ state: 'visible', timeout: 30_000 });
  const selector = await revoke.getAttribute('data-testid');
  await revoke.click();
  const confirm = page.locator('[data-testid^="local-development-revoke-confirm:"]').first();
  await confirm.waitFor({ state: 'visible', timeout: 10_000 });
  await confirm.click();
  await confirm.waitFor({ state: 'hidden', timeout: 30_000 });
  return selector;
}

export async function waitForLocalDevelopmentRun(page, expectedState, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await invokeBridge(page, 'local_development_runs_list', {});
    if (last.ok && Array.isArray(last.value) && last.value.some((row) => row.appId === 'nimi.zhiyu' && row.state === expectedState)) {
      return last.value.find((row) => row.appId === 'nimi.zhiyu' && row.state === expectedState);
    }
    await delay(500);
  }
  throw new Error(`Zhiyu local-development run did not reach ${expectedState}: ${JSON.stringify(last)}`);
}

export async function inspectRendererSecurity(page) {
  return page.evaluate(() => ({
    electronGlobal: 'electron' in globalThis.window,
    ipcRendererGlobal: 'ipcRenderer' in globalThis.window,
    nodeProcessGlobal: 'process' in globalThis.window,
    requireGlobal: 'require' in globalThis.window,
    runtimeBridge: Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__),
  }));
}

export async function closeObservedApplication(observed) {
  await observed.browser.close();
}

async function domSummary(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0;
    };
    const controls = [...document.querySelectorAll('button,input,textarea,select')]
      .filter(visible)
      .slice(0, 200)
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          text: String(element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').trim().slice(0, 240),
          testId: element.getAttribute('data-testid') || '',
          disabled: Boolean(element.disabled),
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
        };
      });
    return {
      url: location.href,
      title: document.title,
      lang: document.documentElement.lang,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyText: String(document.body?.innerText || '').slice(0, 60_000),
      controls,
      visibleControlCount: controls.length,
      enabledControlCount: controls.filter((row) => !row.disabled).length,
    };
  });
}

async function accessibilityTree(page) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Accessibility.enable');
    const result = await session.send('Accessibility.getFullAXTree');
    return (result.nodes ?? []).slice(0, 1000).map((node) => ({
      ignored: Boolean(node.ignored),
      role: node.role?.value ?? '',
      name: node.name?.value ?? '',
      disabled: node.properties?.find((property) => property.name === 'disabled')?.value?.value ?? false,
    }));
  } finally {
    await session.detach();
  }
}

async function interactionSummary(page) {
  return page.evaluate(() => {
    const controls = [...document.querySelectorAll('button,input,textarea,select')].filter((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    });
    const enabled = controls.filter((element) => !element.disabled);
    enabled[0]?.focus();
    return {
      enabledCount: enabled.length,
      focusableFirstTag: document.activeElement?.tagName?.toLowerCase() ?? '',
      undersizedControls: controls.map((element) => {
        const box = element.getBoundingClientRect();
        return { tag: element.tagName.toLowerCase(), width: box.width, height: box.height };
      }).filter((row) => row.width < 24 || row.height < 24),
    };
  });
}

function capturePageProblems(page) {
  const value = { consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') value.consoleErrors.push(message.text().slice(0, 2000));
  });
  page.on('pageerror', (error) => value.pageErrors.push(error.message.slice(0, 2000)));
  page.on('requestfailed', (request) => value.failedRequests.push({
    url: request.url(), error: request.failure()?.errorText ?? '',
  }));
  page.on('response', (response) => {
    if (response.status() >= 400) value.httpErrors.push({ status: response.status(), url: response.url() });
  });
  return value;
}

async function expectDeveloperModeReady(card) {
  await card.waitFor({ state: 'visible', timeout: 20_000 });
  const button = card.locator('[data-testid="developer-mode-toggle-button"]');
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await button.isEnabled()) return;
    await delay(250);
  }
  throw new Error('Developer Mode UI remained unavailable');
}

function longestChineseRun(value) {
  const matches = String(value).match(/[\p{Script=Han}\p{P}\p{Zs}]{12,}/gu) ?? [];
  return matches.sort((left, right) => right.length - left.length)[0]?.slice(0, 1000) ?? '';
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
