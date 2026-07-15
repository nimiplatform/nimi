import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');
const requireFromDesktop = createRequire(path.join(repoRoot, 'apps', 'desktop', 'package.json'));
const { chromium } = requireFromDesktop('playwright');

const AUTHORIZATION_ORIGIN = 'http://localhost:3002';
const AUTHORIZATION_PATH = '/api/auth/oauth/authorize';
const WEB_LOGIN_ORIGIN = 'http://localhost:3000';
const SECRET_PATTERN = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:access|refresh|id)[_-]?token\s*[:=]|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.)/iu;
const LOGIN_ERROR_PATTERN = /(?:too many requests|rate limit|invalid (?:email|password|credentials)|sign[- ]?in failed|login failed|unauthorized|forbidden|try again)/iu;

export async function runRealChromeLogin({
  authorization,
  credential,
  profileRoot,
  failureRoot,
  label,
  childEnvironment,
}) {
  let context;
  let page;
  const consoleErrors = [];
  const networkRows = new Map();
  const audit = {
    callbackCompleted: false,
    consoleErrorCount: 0,
    networkRequestCount: 0,
    storageMutationCount: 0,
    secretMaterialObserved: false,
    ignoredCallbackResourceErrorCount: 0,
  };
  let stage = 'launch';
  try {
    fs.mkdirSync(profileRoot, { recursive: true, mode: 0o700 });
    context = await chromium.launchPersistentContext(profileRoot, {
      channel: 'chrome',
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: ['--no-first-run', '--disable-default-apps'],
      env: childEnvironment,
    });
    await context.exposeBinding('__nimiDevKernelStorageAudit', (_source, row) => {
      audit.storageMutationCount += 1;
      if (row?.secretMaterialObserved === true) audit.secretMaterialObserved = true;
    });
    await context.addInitScript(({ password }) => {
      const secretPattern = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:access|refresh|id)[_-]?token\s*[:=]|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.)/iu;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key, value) {
        const text = `${String(key)}\n${String(value)}`;
        void globalThis.__nimiDevKernelStorageAudit?.({
          secretMaterialObserved: text.includes(password) || secretPattern.test(text),
        });
        return original.call(this, key, value);
      };
    }, { password: credential.password });
    page = context.pages()[0] || await context.newPage();
    observeBrowserPage(page, authorization.callback, credential, consoleErrors, networkRows, audit);

    stage = 'authorization-navigation';
    await page.goto(authorization.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await requireAllowedBrowserLocation(page, authorization.callback);

    stage = 'login-form';
    await revealEmailForm(page);
    const email = page.getByTestId('login-email-input');
    await waitForControlOrLoginError(page, email, 60_000, stage);
    await email.fill(credential.email);
    await page.getByTestId('login-email-submit-arrow').click();

    stage = 'password-form';
    const password = page.getByTestId('login-password-input');
    await waitForControlOrLoginError(page, password, 12_000, stage);
    await password.fill(credential.password);

    stage = 'credential-submit';
    await password.press('Enter');
    await waitForCallbackOrLoginError(page, authorization.callback, 25_000);
    audit.callbackCompleted = true;
    await requireAllowedBrowserLocation(page, authorization.callback);
    await scanBrowserStorage(page, credential, audit);
    const networkProjection = [...networkRows.values()];
    const allowedCallbackFailures = networkProjection.filter((row) => (
      isAllowedBrowserFaviconFailure(row, authorization.callback)
    ));
    const callbackCompletedOverHttp = networkProjection.some((row) => (
      row?.method === 'GET'
      && row?.origin === authorization.callback.origin
      && row?.path === authorization.callback.path
      && row?.status === 200
    ));
    if (consoleErrors.length > 0
      && consoleErrors.every((value) => (
        /^Failed to load resource: the server responded with a status of 404/iu.test(value)
        || (callbackCompletedOverHttp
          && value === 'Failed to load resource: net::ERR_INVALID_HTTP_RESPONSE')
      ))
      && (allowedCallbackFailures.length >= consoleErrors.length || callbackCompletedOverHttp)) {
      audit.ignoredCallbackResourceErrorCount = consoleErrors.length;
      consoleErrors.length = 0;
    }
    audit.consoleErrorCount = consoleErrors.length;
    audit.networkRequestCount = networkRows.size;
    const blockingNetworkFailure = networkProjection.some((row) => (
      Number.isInteger(row.status)
      && row.status >= 400
      && !isAllowedBrowserFaviconFailure(row, authorization.callback)
    ));
    if (audit.secretMaterialObserved) {
      throw new Error('dev-kernel-browser-auth-secret-material-observed');
    }
    if (audit.consoleErrorCount > 0) {
      throw new Error('dev-kernel-browser-auth-console-error');
    }
    if (blockingNetworkFailure) {
      throw new Error('dev-kernel-browser-auth-network-error');
    }
    return safeBrowserAudit(audit);
  } catch (cause) {
    audit.consoleErrorCount = consoleErrors.length;
    audit.networkRequestCount = networkRows.size;
    await persistSanitizedBrowserFailure({
      page,
      failureRoot,
      label,
      stage,
      cause,
      consoleErrors,
      networkRows: [...networkRows.values()],
      audit,
      email: credential.email,
      password: credential.password,
    });
    throw new Error(`dev-kernel-browser-auth-failed:${stage}`);
  } finally {
    await context?.close().catch(() => undefined);
  }
}

export function safeBrowserAudit(value) {
  return Object.freeze({
    callbackCompleted: value?.callbackCompleted === true,
    consoleErrorCount: finiteCount(value?.consoleErrorCount),
    networkRequestCount: finiteCount(value?.networkRequestCount),
    storageMutationCount: finiteCount(value?.storageMutationCount),
    secretMaterialObserved: value?.secretMaterialObserved === true,
    ignoredCallbackResourceErrorCount: finiteCount(value?.ignoredCallbackResourceErrorCount),
  });
}

export async function removeBrowserProfile(profileRoot) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(profileRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) throw error;
      await delay(100 + attempt * 25);
    }
  }
  throw new Error('dev-kernel-browser-auth-profile-cleanup-failed');
}

async function revealEmailForm(page) {
  const email = page.getByTestId('login-email-input');
  if (await email.isVisible().catch(() => false)) return;
  const logo = page.getByTestId('login-logo-trigger');
  await waitForControlOrLoginError(page, logo, 60_000, 'login-logo');
  await logo.click();
}

async function waitForControlOrLoginError(page, locator, timeoutMs, stage) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.isVisible().catch(() => false)) return;
    const error = await visibleLoginError(page);
    if (error) throw new Error(`dev-kernel-browser-auth-login-error:${stage}`);
    await delay(100);
  }
  throw new Error(`dev-kernel-browser-auth-control-timeout:${stage}`);
}

async function waitForCallbackOrLoginError(page, callback, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = new URL(page.url());
    if (sameCallback(current, callback)) return;
    if (await visibleLoginError(page)) {
      throw new Error('dev-kernel-browser-auth-login-rejected');
    }
    await delay(100);
  }
  throw new Error('dev-kernel-browser-auth-callback-timeout');
}

async function visibleLoginError(page) {
  return page.evaluate((pattern) => {
    const body = document.body?.innerText || '';
    const visibleDanger = [...document.querySelectorAll('*')].some((element) => (
      element.offsetParent !== null
      && /(?:status-danger|text-red|text-destructive)/u.test(element.className || '')
      && element.innerText.trim().length > 0
    ));
    return visibleDanger || new RegExp(pattern, 'iu').test(body);
  }, LOGIN_ERROR_PATTERN.source).catch(() => false);
}

function observeBrowserPage(page, callback, credential, consoleErrors, networkRows, audit) {
  page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    const text = message.text();
    if (containsCredentialMaterial(text, credential)) {
      audit.secretMaterialObserved = true;
      consoleErrors.push('[REDACTED_CREDENTIAL_MATERIAL]');
      return;
    }
    consoleErrors.push(scrubText(text, credential).slice(0, 1_000));
  });
  page.on('pageerror', (error) => {
    const text = error instanceof Error ? error.message : String(error || '');
    if (containsCredentialMaterial(text, credential)) audit.secretMaterialObserved = true;
    consoleErrors.push(scrubText(text, credential).slice(0, 1_000));
  });
  page.on('request', (request) => {
    let url;
    try { url = new URL(request.url()); } catch { return; }
    const key = `${request.method()} ${url.origin}${url.pathname}`;
    networkRows.set(key, { method: request.method(), origin: url.origin, path: url.pathname, status: null });
  });
  page.on('response', (response) => {
    let url;
    try { url = new URL(response.url()); } catch { return; }
    const request = response.request();
    const key = `${request.method()} ${url.origin}${url.pathname}`;
    const row = networkRows.get(key) || { method: request.method(), origin: url.origin, path: url.pathname };
    networkRows.set(key, { ...row, status: response.status() });
    if (isAllowedBrowserFaviconFailure({
      status: response.status(),
      origin: url.origin,
      path: url.pathname,
    }, callback)) return;
  });
}

async function scanBrowserStorage(page, credential, audit) {
  const projection = await page.evaluate(({ secretPattern, passwordValue }) => {
    const pattern = new RegExp(secretPattern, 'iu');
    const rows = [];
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) || '';
        rows.push(`${key}\n${storage.getItem(key) || ''}`);
      }
    }
    return {
      entries: rows.length,
      secretMaterialObserved: rows.some((row) => row.includes(passwordValue) || pattern.test(row)),
    };
  }, {
    secretPattern: SECRET_PATTERN.source,
    passwordValue: credential.password,
  }).catch(() => ({
    entries: 0,
    secretMaterialObserved: false,
  }));
  audit.storageMutationCount += projection.entries;
  if (projection.secretMaterialObserved) audit.secretMaterialObserved = true;
}

async function requireAllowedBrowserLocation(page, callback) {
  const current = new URL(page.url());
  if (current.origin === AUTHORIZATION_ORIGIN && current.pathname === AUTHORIZATION_PATH) return;
  if (current.origin === WEB_LOGIN_ORIGIN && current.pathname === '/login') return;
  if (sameCallback(current, callback)) return;
  throw new Error('dev-kernel-browser-auth-navigation-forbidden');
}

async function persistSanitizedBrowserFailure({
  page,
  failureRoot,
  label,
  stage,
  cause,
  consoleErrors,
  networkRows,
  audit,
  email,
  password,
}) {
  const credential = { email, password };
  fs.mkdirSync(failureRoot, { recursive: true, mode: 0o700 });
  const screenshotPath = path.join(failureRoot, 'browser-failure.png');
  const screenshotMasks = page
    ? [
      page.locator('input'),
      page.getByText(email, { exact: false }),
      page.getByText(password, { exact: false }),
    ]
    : [];
  await page?.screenshot({ path: screenshotPath, mask: screenshotMasks }).catch(() => undefined);
  const dom = await page?.evaluate(() => ({
    origin: location.origin,
    path: location.pathname,
    title: document.title,
    text: (document.body?.innerText || '').slice(0, 4_000),
    controls: [...document.querySelectorAll('input,button')].slice(0, 100).map((element) => ({
      tag: element.tagName.toLowerCase(),
      type: element instanceof HTMLInputElement ? element.type : '',
      testId: element.getAttribute('data-testid') || '',
      disabled: 'disabled' in element ? Boolean(element.disabled) : false,
    })),
  })).catch(() => null);
  const diagnostic = {
    schemaVersion: 'nimi.dev-kernel-browser-auth-failure/v1',
    label,
    stage,
    errorCode: safeErrorCode(cause),
    page: dom ? { ...dom, text: scrubText(dom.text, credential) } : null,
    console: consoleErrors.slice(-50).map((value) => scrubText(value, credential)),
    network: networkRows.slice(-100),
    audit: safeBrowserAudit(audit),
  };
  const serialized = `${JSON.stringify(diagnostic, null, 2)}\n`;
  if (containsCredentialMaterial(serialized, credential)) {
    throw new Error('dev-kernel-browser-auth-diagnostic-redaction-failed');
  }
  fs.writeFileSync(path.join(failureRoot, 'browser-failure.json'), serialized, { mode: 0o600 });
}

function sameCallback(url, callback) {
  return url.origin === callback.origin && url.pathname === callback.path;
}

function isAllowedBrowserFaviconFailure(row, callback) {
  return row?.status === 404
    && row?.path === '/favicon.ico'
    && [WEB_LOGIN_ORIGIN, AUTHORIZATION_ORIGIN, callback.origin].includes(row?.origin);
}

function safeErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown');
  const match = message.match(/^([a-z][a-z0-9-]{0,127})/u);
  return match?.[1] || 'browser-auth-failed';
}

function scrubText(value, credential) {
  return String(value || '')
    .replaceAll(credential.email, '[REDACTED_CREDENTIAL_MATERIAL]')
    .replaceAll(credential.password, '[REDACTED_CREDENTIAL_MATERIAL]')
    .replace(/bearer\s+[a-z0-9._~+/=-]+/giu, '[REDACTED_CREDENTIAL_MATERIAL]')
    .replace(/eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]*/giu, '[REDACTED_CREDENTIAL_MATERIAL]');
}

function containsCredentialMaterial(value, credential) {
  const text = String(value || '');
  return Boolean(
    (credential.email && text.includes(credential.email))
    || (credential.password && text.includes(credential.password))
    || SECRET_PATTERN.test(text)
  );
}

function finiteCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
