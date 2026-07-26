import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { inspectNetworkAuthorityMaterial } from './dev-kernel-contract.mjs';
import { repoRoot } from './registry.mjs';
import {
  assertFixedServiceStatus,
  validateFixedServiceStatus,
} from './dev-kernel-fixed-service-contract.mjs';

const requireFromDesktop = createRequire(path.join(repoRoot, 'apps', 'desktop', 'package.json'));
const { chromium } = requireFromDesktop('playwright');
const { NIMI_STANDARD_SHELL_COMMANDS } = requireFromDesktop('@nimiplatform/kit/shell/capabilities');
const { getRuntimeWireCodec } = requireFromDesktop('@nimiplatform/sdk/runtime/generated');

const FIXTURE_ORIGIN = 'http://127.0.0.1:19443';
export const RUNTIME_STATUS_COMMAND = NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status'];
export const RUNTIME_RESTART_COMMAND = NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.restart'];
const RUNTIME_UNARY_COMMAND = NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'];
export const PRODUCT_CONTROL_RECORD_METHOD = '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord';
export const PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD = '/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot';
export const LOCAL_ENVIRONMENT_DEPENDENCY_JOBS_METHOD = '/nimi.runtime.v1.RuntimeLocalService/ListLocalEnvironmentDependencyJobs';
const SECRET_TEXT = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:access|refresh|id)[_-]?token\s*[:=]|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.)/iu;
const ACCOUNT_REALM_ORIGIN = 'http://localhost:3002';
const ACCOUNT_WEB_ORIGIN = 'http://localhost:3000';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function readAcceptanceFixture() {
  const fixture = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config', 'dev-kernel-checkpoint-acceptance.json'), 'utf8'));
  if (fixture.checkpoint !== 'dev_kernel_checkpoint'
    || fixture.nonRelease !== true
    || fixture.schemaVersion !== 2
    || fixture.accountRealmBaseUrl !== ACCOUNT_REALM_ORIGIN
    || fixture.accountWebBaseUrl !== ACCOUNT_WEB_ORIGIN
    || fixture.fixtureBaseUrl !== FIXTURE_ORIGIN
    || fixture.providerBaseUrl !== `${FIXTURE_ORIGIN}/v1`
    || !/^local-agent:runtime-[0-9a-f]{32}$/u.test(fixture.agent?.localAgentRef || '')) {
    throw new Error('dev-kernel acceptance fixture is invalid');
  }
  return fixture;
}

export function acquireFixedServiceLock() {
  const lockPath = path.join(os.tmpdir(), 'nimi-dev-kernel-fixed-service.lock');
  const create = () => {
    const descriptor = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
    return {
      path: lockPath,
      release() {
        try { fs.closeSync(descriptor); } catch {}
        try { fs.unlinkSync(lockPath); } catch {}
      },
    };
  };
  try {
    return create();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const ownerPid = Number.parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
    let alive = Number.isSafeInteger(ownerPid) && ownerPid > 0;
    if (alive) {
      try { process.kill(ownerPid, 0); } catch { alive = false; }
    }
    if (alive) throw new Error(`fixed NimiRuntime acceptance service is already owned by PID ${ownerPid}`);
    fs.unlinkSync(lockPath);
    return create();
  }
}

export function readFixedServiceStatus() {
  const script = path.join(repoRoot, 'dist', 'windows-runtime-service-installer', 'install-nimi-runtime.ps1');
  if (!fs.existsSync(script)) throw new Error('signed dev-kernel service installer candidate is missing');
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-Mode', 'Status',
    '-Json',
  ], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`fixed-service status failed: ${result.stderr || result.stdout}`);
  const status = JSON.parse(result.stdout.trim());
  return assertFixedServiceStatus(status);
}

export async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to reserve a local CDP port');
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

export async function waitUntil(predicate, { timeoutMs = 60_000, intervalMs = 150, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timed out waiting for ${label}`, { cause: lastError });
}

export function classifyFirstRunTerminalSnapshot(snapshot) {
  if (snapshot?.authShellVisible === true) return { kind: 'auth-shell' };
  const explicitFailure = Array.isArray(snapshot?.explicitFailures)
    ? snapshot.explicitFailures.find((entry) => entry?.visible === true)
    : null;
  if (explicitFailure) {
    return {
      kind: 'failure',
      testId: String(explicitFailure.testId || 'first-run-unknown-error'),
      text: String(explicitFailure.text || '').slice(0, 500),
    };
  }
  if (snapshot?.setupRetryVisible === true) {
    return {
      kind: 'failure',
      testId: 'first-run-setup-retry',
      text: String(snapshot.setupText || 'First Run setup exposed a retry action').slice(0, 500),
    };
  }
  return false;
}

export async function probeRealRealmBrowserLoginAuthority(accountRealmOrigin, accountWebOrigin) {
  const authorization = new URL('/api/auth/oauth/authorize', accountRealmOrigin);
  authorization.searchParams.set('client_id', 'nimi-desktop');
  authorization.searchParams.set('redirect_uri', 'http://127.0.0.1:48123/oauth/callback');
  authorization.searchParams.set('code_challenge', 'dev-kernel-real-browser-login-challenge');
  authorization.searchParams.set('code_challenge_method', 'S256');
  authorization.searchParams.set('state', 'dev-kernel-real-browser-login-state');
  authorization.searchParams.set('response_type', 'code');
  const response = await fetch(authorization, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  const location = response.headers.get('location');
  if (response.status !== 302 || !location) {
    throw new Error(`real Realm OAuth authorize did not redirect to web login (status=${response.status})`);
  }
  const login = new URL(location, accountRealmOrigin);
  const oauthNextRaw = login.searchParams.get('oauth_next');
  const oauthNext = oauthNextRaw ? new URL(oauthNextRaw) : null;
  if (login.origin !== accountWebOrigin
    || login.pathname !== '/login'
    || oauthNext?.origin !== accountRealmOrigin
    || oauthNext?.pathname !== '/api/auth/oauth/authorize') {
    throw new Error(`real Realm OAuth authorize returned an invalid browser-login continuation: ${login.origin}${login.pathname}`);
  }
  return {
    accountRealmOrigin,
    accountWebOrigin,
    authorizeStatus: response.status,
    loginPath: login.pathname,
    oauthNextOrigin: oauthNext.origin,
    oauthNextPath: oauthNext.pathname,
    automaticLoopbackCallbackObserved: false,
  };
}

export async function connectCdp(port, label, timeoutMs = 240_000, observer = null) {
  const endpoint = `http://127.0.0.1:${port}`;
  await waitUntil(async () => {
    const response = await fetch(`${endpoint}/json/version`).catch(() => null);
    return response?.ok;
  }, { timeoutMs, intervalMs: 25, label: `${label} CDP endpoint` });
  return waitUntil(async () => {
    const browser = await chromium.connectOverCDP(endpoint).catch(() => null);
    if (!browser) return null;
    const context = browser.contexts()[0];
    if (!context) return null;
    observer?.attachContext(context, label);
    let pages = context.pages();
    let page = pages.find((candidate) => !candidate.url().startsWith('devtools://')) || pages[0];
    if (!page) {
      page = await context.waitForEvent('page', { timeout: 2_000 }).catch(() => null);
      pages = context.pages();
      page = page || pages.find((candidate) => !candidate.url().startsWith('devtools://')) || pages[0];
    }
    if (page) observer?.attachPage(page, label);
    return page ? { browser, context, page, endpoint } : null;
  }, { timeoutMs: 30_000, intervalMs: 25, label: `${label} page` });
}

export async function waitForCdpEndpointRelease(port, label, timeoutMs = 30_000) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  await waitUntil(async () => {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(1_000) }).catch(() => null);
    return response === null;
  }, { timeoutMs, intervalMs: 25, label: `${label} CDP endpoint release` });
}

export function createEarlyCdpObserver(aggregate, {
  initialPhase = 'unclassified',
  classifyConsoleError = undefined,
} = {}) {
  const contextRecords = new WeakMap();
  const pageRecords = new WeakMap();
  const pending = new Set();
  const operationTimeoutMs = 10_000;
  let currentPhase = initialPhase;

  const track = (promise, record, operation) => {
    let timer;
    const bounded = Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${operation} timed out after ${operationTimeoutMs}ms`)), operationTimeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    const tracked = bounded.catch((error) => {
      const text = error instanceof Error ? error.message : String(error);
      // A navigation intentionally destroys the previous renderer execution
      // context. The observer re-runs both audits on the next DOMContentLoaded;
      // completion flags below still require a successful audit of the live
      // document, so this does not turn an incomplete observation into a pass.
      if (/(?:execution context was destroyed|frame was detached|target page, context or browser has been closed)/iu.test(text)) {
        return;
      }
      record.observerErrors.push({
        code: text.includes('timed out after') ? 'observer-operation-timeout' : 'observer-operation-failed',
        operation,
        sha256: sha256(text),
        bytes: Buffer.byteLength(text),
      });
    }).finally(() => pending.delete(tracked));
    pending.add(tracked);
  };

  const createRecord = (label, kind) => {
    const record = {
      label,
      kind,
      attachedAtUnixMs: Date.now(),
      consoleErrors: [],
      pageErrors: [],
      observerErrors: [],
      requestCount: 0,
      responseCount: 0,
      responseBodyCount: 0,
      websocketCount: 0,
      historicalResourceCount: 0,
      historicalResourceAuditCompleted: false,
      requestObserverAttached: false,
      storageObserverAttached: false,
      storageAuditCompleted: false,
      storageAuthorityMaterialObserved: false,
      authorizationHeaderObserved: false,
      secretTextObserved: false,
    };
    aggregate.push(record);
    return record;
  };

  const attachPage = (page, label) => {
    const existing = pageRecords.get(page);
    if (existing) return existing;
    const record = createRecord(label, 'renderer-page');
    pageRecords.set(page, record);
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      const classification = typeof classifyConsoleError === 'function'
        ? classifyConsoleError({ phase: currentPhase, text, kind: 'console' })
        : null;
      record.consoleErrors.push({
        sha256: sha256(text),
        bytes: Buffer.byteLength(text),
        phase: currentPhase,
        expected: classification?.expected === true,
        classification: boundedDiagnosticCode(classification?.code) || 'unclassified-console-error',
        diagnostic: sanitizeDiagnosticText(text),
      });
      if (SECRET_TEXT.test(text)) record.secretTextObserved = true;
    });
    page.on('pageerror', (error) => {
      const text = error instanceof Error ? error.message : String(error);
      record.pageErrors.push({
        sha256: sha256(text),
        bytes: Buffer.byteLength(text),
        phase: currentPhase,
        expected: false,
        classification: 'unhandled-page-error',
        diagnostic: sanitizeDiagnosticText(text),
      });
      if (SECRET_TEXT.test(text)) record.secretTextObserved = true;
    });
    page.on('websocket', (socket) => {
      record.websocketCount += 1;
      if (inspectNetworkAuthorityMaterial({ url: socket.url() }).secretTextObserved) {
        record.secretTextObserved = true;
      }
    });
    const captureHistoricalResources = async () => {
      const urls = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
      record.historicalResourceCount = Math.max(record.historicalResourceCount, urls.length);
      record.historicalResourceAuditCompleted = true;
      if (urls.some((url) => inspectNetworkAuthorityMaterial({ url }).secretTextObserved)) {
        record.secretTextObserved = true;
      }
    };
    const inspectStorageValue = (key, value) => {
      const populatedAuthorityKey = /(?:access|refresh|id)[_-]?token|authorization|bearer/iu.test(String(key || ''))
        && String(value || '').trim().length > 0;
      const secretValue = inspectNetworkAuthorityMaterial({ postData: `${key || ''}=${value || ''}` }).secretTextObserved;
      if (populatedAuthorityKey || secretValue) record.storageAuthorityMaterialObserved = true;
    };
    const captureStorage = async () => {
      await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
      const rows = await page.evaluate(() => {
        const entries = [];
        for (const storage of [window.localStorage, window.sessionStorage]) {
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index) || '';
            entries.push([key, storage.getItem(key) || '']);
          }
        }
        return entries;
      });
      for (const [key, value] of rows) inspectStorageValue(key, value);
      record.storageAuditCompleted = true;
    };
    page.on('domcontentloaded', () => {
      track(captureHistoricalResources(), record, 'historical-resources');
      track(captureStorage(), record, 'dom-storage-audit');
    });
    track(captureHistoricalResources(), record, 'historical-resources');
    track((async () => {
      const session = await page.context().newCDPSession(page);
      await session.send('DOMStorage.enable');
      record.storageObserverAttached = true;
      session.on('DOMStorage.domStorageItemAdded', ({ key, newValue }) => inspectStorageValue(key, newValue));
      session.on('DOMStorage.domStorageItemUpdated', ({ key, newValue }) => inspectStorageValue(key, newValue));
      await captureStorage();
    })(), record, 'dom-storage-audit');
    return record;
  };

  const attachContext = (context, label) => {
    const existing = contextRecords.get(context);
    if (existing) return existing;
    const record = createRecord(`${label}:network`, 'renderer-network-context');
    record.requestObserverAttached = true;
    contextRecords.set(context, record);
    context.on('request', (request) => {
      record.requestCount += 1;
      const finding = inspectNetworkAuthorityMaterial({
        url: request.url(),
        postData: request.postData() || '',
        headers: request.headers(),
      });
      if (finding.authorizationHeaderObserved) record.authorizationHeaderObserved = true;
      if (finding.secretTextObserved) record.secretTextObserved = true;
    });
    context.on('response', (response) => {
      record.responseCount += 1;
      track((async () => {
        const headers = await response.allHeaders().catch(() => ({}));
        const headerFinding = inspectNetworkAuthorityMaterial({ url: response.url(), headers });
        if (headerFinding.authorizationHeaderObserved) record.authorizationHeaderObserved = true;
        if (headerFinding.secretTextObserved) record.secretTextObserved = true;
        const contentType = String(headers['content-type'] || '').toLowerCase();
        const resourceType = response.request().resourceType();
        if (!['fetch', 'xhr'].includes(resourceType)
          || !/(?:application\/json|text\/plain|application\/problem\+json)/u.test(contentType)) return;
        const declaredBytes = Number.parseInt(String(headers['content-length'] || ''), 10);
        if (Number.isFinite(declaredBytes) && declaredBytes > 1_048_576) return;
        const body = await response.body();
        if (body.byteLength > 1_048_576) return;
        record.responseBodyCount += 1;
        if (inspectNetworkAuthorityMaterial({ postData: body.toString('utf8') }).secretTextObserved) {
          record.secretTextObserved = true;
        }
      })(), record, 'response-authority-audit');
    });
    context.on('page', (page) => attachPage(page, `${label}:page`));
    for (const page of context.pages()) attachPage(page, label);
    return record;
  };

  return {
    attachContext,
    attachPage,
    setPhase(phase) {
      const next = String(phase || '').trim();
      if (!/^[a-z][a-z0-9-]{0,79}$/u.test(next)) throw new Error(`invalid CDP observer phase ${next || '<empty>'}`);
      currentPhase = next;
    },
    async flush() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}

function boundedDiagnosticCode(value) {
  const code = String(value || '').trim();
  return /^[a-z][a-z0-9-]{0,79}$/u.test(code) ? code : '';
}

function sanitizeDiagnosticText(value) {
  return String(value || '')
    .replace(/(?:bearer\s+[a-z0-9._~+/=-]+|(?:access|refresh|id)[_-]?token\s*[:=]|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.)/giu, '[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[REDACTED]')
    .replace(/[A-Z]:\\Users\\[^\\\s]+/giu, '[LOCAL_USER_PATH]')
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/giu, '$1?[REDACTED]')
    .replace(/\b(?:password|secret|credential)\s*[:=]\s*[^\s]+/giu, '[REDACTED]')
    .slice(0, 1_000);
}

export async function waitForTestId(page, testId, timeout = 60_000) {
  const locator = page.getByTestId(testId);
  await locator.waitFor({ state: 'visible', timeout });
  return locator;
}

export async function firstVisible(page, selector) {
  const rows = await page.locator(selector).all();
  for (const row of rows) if (await row.isVisible()) return row;
  return null;
}

async function readDocumentViewport(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
  }));
}

function nativeViewportMatchesRequest(viewport, width, height) {
  return Number.isFinite(viewport?.innerWidth)
    && Number.isFinite(viewport?.innerHeight)
    && viewport.innerWidth <= width
    && viewport.innerWidth >= Math.max(1, width - 96)
    && viewport.innerHeight <= height
    && viewport.innerHeight >= Math.max(1, height - 128);
}

export async function setWindowBounds(connection, width, height) {
  try {
    const session = await connection.context.newCDPSession(connection.page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { width, height, windowState: 'normal' },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (nativeViewportMatchesRequest(await readDocumentViewport(connection.page), width, height)) {
      return 'native-window-bounds';
    }
  } catch {
    // A failed native resize is handled by the exact viewport fallback below.
  }
  await connection.page.setViewportSize({ width, height });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const viewport = await readDocumentViewport(connection.page);
  if (viewport.innerWidth !== width || viewport.innerHeight !== height) {
    throw new Error(
      `viewport resize failed: expected ${width}x${height}, observed inner ${viewport.innerWidth}x${viewport.innerHeight} (document ${viewport.clientWidth}x${viewport.clientHeight})`,
    );
  }
  return 'cdp-viewport-fallback';
}

export async function invokeDesktop(page, command, payload = {}) {
  return page.evaluate(async ({ commandName, commandPayload }) => {
    const electronRuntime = window.__NIMI_ELECTRON_RUNTIME__;
    if (!electronRuntime || typeof electronRuntime.invoke !== 'function') {
      throw new Error('Electron standard shell invoke is unavailable');
    }
    try {
      return await electronRuntime.invoke(commandName, commandPayload);
    } catch (error) {
      const failure = error && typeof error === 'object' ? error : {};
      throw new Error(JSON.stringify({
        command: commandName,
        name: typeof failure.name === 'string' ? failure.name : '',
        message: typeof failure.message === 'string' ? failure.message : String(error),
        code: typeof failure.code === 'string' ? failure.code : '',
        reasonCode: typeof failure.reasonCode === 'string' ? failure.reasonCode : '',
        actionHint: typeof failure.actionHint === 'string' ? failure.actionHint : '',
        source: typeof failure.source === 'string' ? failure.source : '',
        retryable: failure.retryable === true,
      }));
    }
  }, { commandName: command, commandPayload: payload });
}

export async function invokeDesktopRuntimeUnary(page, methodId, request = {}, timeoutMs = 10_000) {
  const codec = getRuntimeWireCodec(methodId);
  const response = await invokeDesktop(page, RUNTIME_UNARY_COMMAND, {
    methodId,
    requestBytesBase64: Buffer.from(codec.encodeRequest(request)).toString('base64'),
    timeoutMs,
  });
  return decodeDesktopRuntimeUnaryResponse(codec, response, methodId);
}

export function decodeDesktopRuntimeUnaryResponse(codec, response, methodId) {
  if (typeof response?.responseBytesBase64 !== 'string') {
    throw new Error(`Runtime unary ${methodId} returned no response bytes field`);
  }
  // An empty base64 string is the canonical protobuf encoding for a response
  // whose fields all have default values (for example, an empty job list).
  return codec.decodeResponse(Buffer.from(response.responseBytesBase64, 'base64'));
}

export function classifyFirstRunStorageRecoverySnapshot(snapshot) {
  if (snapshot?.deviceVisible === true) return 'advanced';
  if (snapshot?.errorVisible !== true && String(snapshot?.pendingAction || '').trim()) return 'pending';
  return false;
}

export function isAuthoritativeFirstRunStorageAdvance(snapshot, productControl, expectedDataRoot) {
  return snapshot?.deviceVisible === true
    && snapshot?.errorVisible !== true
    && String(snapshot?.pendingAction || '').trim() === ''
    && productControl?.state === 'data_root_selected'
    && comparablePath(productControl?.record?.dataRoot?.path) === comparablePath(expectedDataRoot);
}

export function isRecoverableFirstRunStorageRestart(transition, serviceBefore, serviceAfter) {
  const beforePid = Number(serviceBefore?.processId);
  const afterPid = Number(serviceAfter?.processId);
  const beforeCandidateId = String(serviceBefore?.runtimeCandidateId || '').trim();
  const stableCandidateFields = [
    'runtimeCandidateId',
    'runtimeBinarySha256',
    'runtimeBuildRecordSha256',
    'sourceDirtyDescriptorSha256',
    'sourceTreeSha256',
  ];
  return transition?.kind === 'error'
    && String(transition?.message || '').trim() === 'runtime-service-unavailable'
    && validateFixedServiceStatus(serviceBefore).length === 0
    && validateFixedServiceStatus(serviceAfter).length === 0
    && beforePid !== afterPid
    && beforeCandidateId !== ''
    && stableCandidateFields.every((field) => serviceAfter[field] === serviceBefore[field]);
}

export async function readProductControlJSONProjection(page, methodId) {
  const response = await invokeDesktopRuntimeUnary(page, methodId);
  const json = typeof response?.json === 'string' ? response.json : '';
  if (!json) throw new Error(`Product Control method ${methodId} returned no JSON projection`);
  return JSON.parse(json);
}

export function comparablePath(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  const resolved = path.resolve(candidate);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function requireRecordedProductControlDataRoot(projection, acceptedStatuses = ['selected', 'ready']) {
  const dataRoot = projection?.record?.dataRoot;
  const recordedPath = String(dataRoot?.path || '').trim();
  const accepted = new Set(acceptedStatuses);
  if (!accepted.has(String(dataRoot?.status || '').trim())
    || !path.isAbsolute(recordedPath)
    || comparablePath(recordedPath) === comparablePath(path.parse(recordedPath).root)) {
    throw new Error(
      `Product Control record has no safe dataRoot.path with status ${[...accepted].join(' or ')}`,
    );
  }
  return path.resolve(recordedPath);
}
