import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { startRealmFixtureServer } from '../../../apps/desktop/e2e/fixtures/realm-fixture-server.mjs';
import { createRealmFixtureManifest } from '../../../apps/desktop/scripts/explore-materialization-acceptance/acceptance-fixture.mjs';
import { persistResultEvidence } from './artifact-writer.mjs';
import {
  assessAccessibilityAudit,
  assessObservedProcessBudget,
  beginObservedProcess,
  createObservedProcessLedger,
  inspectNetworkAuthorityMaterial,
  isRuntimeObservedProcessMismatch,
  isRuntimeRestartUiTransition,
  isTypedProjectRevocationDenial,
  resolveHostRustToolchainHomes,
  waitForObservedProcessConnection,
} from './dev-kernel-contract.mjs';
import {
  allFiles,
  artifactIdFor,
  buildCheckpointResults,
  buildLeafResults,
  pointRowsForJourney,
  startProcess,
  terminateProcessTree,
} from './cross-app-driver.mjs';
import { repoRoot } from './registry.mjs';
import { registerTrialProcessIdentity } from './sandbox-hygiene.mjs';
import { assertSourceState } from './source-state.mjs';
import { validateJourneyResult } from './validation.mjs';
import { assertFixedServiceStatus } from './dev-kernel-fixed-service-contract.mjs';

const requireFromDesktop = createRequire(path.join(repoRoot, 'apps', 'desktop', 'package.json'));
const { chromium } = requireFromDesktop('playwright');
const { NIMI_STANDARD_SHELL_COMMANDS } = requireFromDesktop('@nimiplatform/kit/shell/capabilities');
const { getRuntimeWireCodec } = requireFromDesktop('@nimiplatform/sdk/runtime/generated');

const FIXTURE_ORIGIN = 'http://127.0.0.1:19443';
const RUNTIME_STATUS_COMMAND = NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status'];
const RUNTIME_UNARY_COMMAND = NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'];
const PRODUCT_CONTROL_RECORD_METHOD = '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord';
const PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD = '/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot';
const LOCAL_ENVIRONMENT_DEPENDENCY_JOBS_METHOD = '/nimi.runtime.v1.RuntimeLocalService/ListLocalEnvironmentDependencyJobs';
const OPEN_OPERATION = 'runtime_agent.conversation.open';
const CONVERSATION_OPERATIONS = [
  'runtime_agent.conversation.turn_send',
  'runtime_agent.conversation.turn_subscribe',
  'runtime_agent.conversation.snapshot',
];
const REQUIRED_PROVIDER_CONTEXT_LANES = [
  'runtime_policy',
  'output_contract',
  'source_identity',
  'source_behavior',
  'world_context',
  'relationship_context',
  'source_knowledge',
  'canonical_memory',
  'conversation_history',
  'capability_context',
];
const SECRET_TEXT = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:access|refresh|id)[_-]?token\s*[:=]|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.)/iu;
const ACCOUNT_REALM_ORIGIN = 'http://localhost:3002';
const ACCOUNT_WEB_ORIGIN = 'http://localhost:3000';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function readAcceptanceFixture() {
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

export function createEarlyCdpObserver(aggregate) {
  const contextRecords = new WeakMap();
  const pageRecords = new WeakMap();
  const pending = new Set();
  const operationTimeoutMs = 10_000;

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
      record.consoleErrors.push({ sha256: sha256(text), bytes: Buffer.byteLength(text) });
      if (SECRET_TEXT.test(text)) record.secretTextObserved = true;
    });
    page.on('pageerror', (error) => {
      const text = error instanceof Error ? error.message : String(error);
      record.pageErrors.push({ sha256: sha256(text), bytes: Buffer.byteLength(text) });
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
    async flush() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}

async function waitForTestId(page, testId, timeout = 60_000) {
  const locator = page.getByTestId(testId);
  await locator.waitFor({ state: 'visible', timeout });
  return locator;
}

async function firstVisible(page, selector) {
  const rows = await page.locator(selector).all();
  for (const row of rows) if (await row.isVisible()) return row;
  return null;
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
    return 'native-window-bounds';
  } catch {
    await connection.page.setViewportSize({ width, height });
    await new Promise((resolve) => setTimeout(resolve, 200));
    return 'cdp-viewport-fallback';
  }
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

export async function readProductControlJSONProjection(page, methodId) {
  const response = await invokeDesktopRuntimeUnary(page, methodId);
  const json = typeof response?.json === 'string' ? response.json : '';
  if (!json) throw new Error(`Product Control method ${methodId} returned no JSON projection`);
  return JSON.parse(json);
}

function comparablePath(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  const resolved = path.resolve(candidate);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function requireCheckpointDataRootProposal(projection, candidateId) {
  const proposal = projection?.dataRootProposal;
  const proposedPath = String(proposal?.path || '').trim();
  if (proposal?.authority !== 'runtime_protected_product_control'
    || proposal?.profile !== 'dev_kernel_checkpoint'
    || !path.isAbsolute(proposedPath)) {
    throw new Error('fixed service did not project a valid checkpoint data-root proposal');
  }
  const normalized = comparablePath(proposedPath);
  if (!/^dev-kernel-runtime-[0-9a-f]{32}$/u.test(String(candidateId))
    || normalized === comparablePath(path.parse(proposedPath).root)) {
    throw new Error(`checkpoint data-root proposal is not safely bound to Runtime candidate ${candidateId}`);
  }
  return path.resolve(proposedPath);
}

export async function completeDesktopFirstRun(connection, trial, screenshotsRoot, options = {}) {
  const { page } = connection;
  const startingPhase = await waitUntil(async () => {
    const phase = page.getByTestId('first-run-phase-storage');
    if (await phase.isVisible().catch(() => false)) {
      return await phase.getAttribute('data-phase-transient') === 'false' ? 'storage-ready' : null;
    }
    if (options.resumeFromDevice === true
      && await page.getByTestId('first-run-phase-device-scan').isVisible().catch(() => false)) {
      return 'device-scan-resume';
    }
    if (await page.getByTestId('main-shell').isVisible().catch(() => false)
      && typeof options.reuseReadyCandidateId === 'string') {
      return 'ready-shell-transition';
    }
    if (await page.getByTestId('login-screen').isVisible().catch(() => false)
      || await page.getByTestId('main-shell').isVisible().catch(() => false)) {
      return 'unexpected-auth-shell';
    }
    if (await page.getByTestId('app-bootstrap-error-screen').isVisible().catch(() => false)) {
      return 'bootstrap-error';
    }
    return null;
  }, { timeoutMs: 120_000, intervalMs: 100, label: 'Desktop first-run starting phase' });
  if (startingPhase === 'ready-shell-transition') {
    const productControlRecord = await readProductControlJSONProjection(
      page,
      PRODUCT_CONTROL_RECORD_METHOD,
    );
    return captureReusedReadyFirstRun(
      page,
      productControlRecord,
      options.reuseReadyCandidateId,
    );
  }
  if (startingPhase !== 'storage-ready' && startingPhase !== 'device-scan-resume') {
    throw new Error(startingPhase === 'unexpected-auth-shell'
      ? 'isolated Desktop trial skipped the required first-run gate'
      : 'Desktop entered bootstrap error before first-run');
  }

  const expectedDataRoot = comparablePath(trial.paths.runtimeData);
  let desktopPath = null;
  let narrowMethod = null;
  let narrowPath = null;
  let narrowMetrics = null;
  let selectedDataRoot;
  let serviceAfterStorage;
  if (startingPhase === 'storage-ready') {
    const displayedDataRoot = comparablePath(await page.getByTestId('first-run-storage-path').innerText());
    const hostProfileDataRoot = process.env.USERPROFILE
      ? comparablePath(path.join(process.env.USERPROFILE, 'Nimi'))
      : null;
    if (displayedDataRoot !== expectedDataRoot) {
      throw new Error(`first-run Storage proposed ${displayedDataRoot}, expected Runtime-owned proposal ${expectedDataRoot}`);
    }
    if (hostProfileDataRoot && expectedDataRoot === hostProfileDataRoot) {
      throw new Error(`first-run Storage resolved to the host profile root ${hostProfileDataRoot}`);
    }
    desktopPath = path.join(screenshotsRoot, 'desktop-first-run-storage.png');
    await page.screenshot({ path: desktopPath });
    narrowMethod = await setWindowBounds(connection, 390, 780);
    narrowPath = path.join(screenshotsRoot, 'desktop-first-run-storage-narrow.png');
    await page.screenshot({ path: narrowPath });
    narrowMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    await setWindowBounds(connection, 1440, 940);

    const serviceBeforeStorage = readFixedServiceStatus();
    const continueStorage = page.getByTestId('first-run-storage-continue');
    if (await continueStorage.isDisabled()) throw new Error('first-run Storage continue is disabled for the isolated proposal');
    const storageContinueHandled = typeof options.beforeStorageContinue === 'function'
      ? await options.beforeStorageContinue({ page, continueStorage }) === true
      : false;
    if (!storageContinueHandled) await continueStorage.click();
    const storageTransition = await waitUntil(async () => {
      if (await page.getByTestId('first-run-phase-device-scan').isVisible().catch(() => false)) {
        return { kind: 'advanced' };
      }
      const error = page.getByTestId('product-first-run-error');
      if (await error.isVisible().catch(() => false)) {
        return { kind: 'error', message: (await error.innerText()).slice(0, 1_000) };
      }
      const workflow = page.getByTestId('product-first-run-workflow');
      const pendingAction = await workflow.getAttribute('data-pending-action').catch(() => '');
      if (!pendingAction && !(await continueStorage.isDisabled().catch(() => true))) {
        return { kind: 'stalled', message: 'Storage mutation returned without advancing product state' };
      }
      return null;
    }, { timeoutMs: 120_000, intervalMs: 100, label: 'first-run Storage mutation completion' });
    if (storageTransition.kind !== 'advanced') {
      throw new Error(`first-run Storage failed: ${storageTransition.message}`);
    }
    serviceAfterStorage = await waitUntil(() => {
      const status = readFixedServiceStatus();
      return status.processId !== serviceBeforeStorage.processId ? status : null;
    }, {
      timeoutMs: 120_000,
      intervalMs: 500,
      label: 'fixed service PID replacement after first-run Storage sync',
    });
    selectedDataRoot = await readProductControlJSONProjection(page, PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD);
    if (comparablePath(selectedDataRoot?.dataRoot?.path) !== expectedDataRoot) {
      throw new Error(`Runtime selected data root ${selectedDataRoot?.dataRoot?.path || '<missing>'}, expected ${trial.paths.runtimeData}`);
    }
  } else {
    selectedDataRoot = await readProductControlJSONProjection(page, PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD);
    if (comparablePath(selectedDataRoot?.dataRoot?.path) !== expectedDataRoot) {
      throw new Error(`Runtime selected data root ${selectedDataRoot?.dataRoot?.path || '<missing>'}, expected ${trial.paths.runtimeData}`);
    }
    serviceAfterStorage = readFixedServiceStatus();
  }

  await waitForTestId(page, 'first-run-phase-device-scan', 120_000);
  let phaseAcceptance = null;
  if (options.captureAllPhases === true) {
    const initialDeviceControls = await page.evaluate(() => {
      const summary = document.querySelector('[data-testid="first-run-device-summary"]');
      const continueButton = document.querySelector('[data-testid="first-run-device-scan-continue"]');
      return {
        scanState: summary?.getAttribute('data-device-scan') || '',
        continueDisabled: continueButton instanceof HTMLButtonElement
          ? continueButton.disabled
          : null,
      };
    });
    const deviceInitialPath = path.join(screenshotsRoot, 'desktop-first-run-device-initial.png');
    await page.screenshot({ path: deviceInitialPath });
    const deviceNarrowMethod = await setWindowBounds(connection, 390, 780);
    const deviceNarrowPath = path.join(screenshotsRoot, 'desktop-first-run-device-initial-narrow.png');
    await page.screenshot({ path: deviceNarrowPath });
    const deviceNarrowMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    await setWindowBounds(connection, 1440, 940);
    phaseAcceptance = {
      deviceInitialScanState: initialDeviceControls.scanState,
      deviceContinueInitiallyDisabled: initialDeviceControls.scanState === 'pending'
        ? initialDeviceControls.continueDisabled
        : null,
      deviceInitialPath,
      deviceNarrowPath,
      deviceNarrowMethod,
      deviceNarrowMetrics,
    };
  }
  await waitUntil(async () => {
    const summary = page.getByTestId('first-run-device-summary');
    if (await summary.getAttribute('data-device-scan') !== 'settled') return false;
    const button = page.getByTestId('first-run-device-scan-continue');
    return !(await button.isDisabled()) ? button : false;
  }, { timeoutMs: 120_000, intervalMs: 250, label: 'settled first-run device scan' });
  if (phaseAcceptance) {
    phaseAcceptance.deviceSettledPath = path.join(screenshotsRoot, 'desktop-first-run-device-settled.png');
    await page.screenshot({ path: phaseAcceptance.deviceSettledPath });
  }
  if (options.exerciseDeviceRetry === true) {
    const retry = page.getByTestId('first-run-device-scan-retry');
    if (await retry.isDisabled()) throw new Error('first-run Device retry is disabled after a settled scan');
    await retry.click();
    const pendingControls = await waitUntil(async () => page.evaluate(() => {
      const summary = document.querySelector('[data-testid="first-run-device-summary"]');
      if (summary?.getAttribute('data-device-scan') !== 'pending') return null;
      const retryButton = document.querySelector('[data-testid="first-run-device-scan-retry"]');
      const continueButton = document.querySelector('[data-testid="first-run-device-scan-continue"]');
      if (!(retryButton instanceof HTMLButtonElement) || !(continueButton instanceof HTMLButtonElement)) return null;
      return {
        retryDisabled: retryButton.disabled,
        continueDisabled: continueButton.disabled,
      };
    }), { timeoutMs: 30_000, intervalMs: 10, label: 'first-run Device retry pending controls' });
    const retryDisabledWhilePending = pendingControls.retryDisabled;
    const continueDisabledWhilePending = pendingControls.continueDisabled;
    if (!retryDisabledWhilePending || !continueDisabledWhilePending) {
      throw new Error('first-run Device retry did not disable retry and continue while scan evidence was pending');
    }
    if (phaseAcceptance) {
      phaseAcceptance.deviceRetryPendingPath = path.join(screenshotsRoot, 'desktop-first-run-device-retry-pending.png');
      phaseAcceptance.deviceRetryDisabledWhilePending = retryDisabledWhilePending;
      phaseAcceptance.deviceContinueDisabledWhileRetryPending = continueDisabledWhilePending;
      await page.screenshot({ path: phaseAcceptance.deviceRetryPendingPath });
    }
    await waitUntil(async () => {
      const summary = page.getByTestId('first-run-device-summary');
      if (await summary.getAttribute('data-device-scan') !== 'settled') return false;
      return !(await page.getByTestId('first-run-device-scan-continue').isDisabled());
    }, { timeoutMs: 120_000, intervalMs: 100, label: 'settled first-run Device retry' });
  }
  await page.getByTestId('first-run-device-scan-continue').click();

  await waitForTestId(page, 'first-run-phase-local-ai', 120_000);
  if (phaseAcceptance) {
    phaseAcceptance.localAiContinueInitiallyDisabled = await page.getByTestId('first-run-local-ai-continue').isDisabled();
    phaseAcceptance.localAiPath = path.join(screenshotsRoot, 'desktop-first-run-local-ai.png');
    await page.screenshot({ path: phaseAcceptance.localAiPath });
    const localAiNarrowMethod = await setWindowBounds(connection, 390, 780);
    phaseAcceptance.localAiNarrowPath = path.join(screenshotsRoot, 'desktop-first-run-local-ai-narrow.png');
    await page.screenshot({ path: phaseAcceptance.localAiNarrowPath });
    phaseAcceptance.localAiNarrowMethod = localAiNarrowMethod;
    phaseAcceptance.localAiNarrowMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    await setWindowBounds(connection, 1440, 940);
  }
  const minimal = page.getByTestId('first-run-install-level-minimal');
  if (await minimal.isDisabled()) throw new Error('first-run Minimal plan is unavailable');
  await minimal.click();
  await waitUntil(async () => await minimal.getAttribute('data-selected') === 'true', {
    timeoutMs: 30_000,
    label: 'first-run Minimal selection',
  });
  const continueLocalAi = page.getByTestId('first-run-local-ai-continue');
  if (await continueLocalAi.isDisabled()) throw new Error('first-run Local AI continue stayed disabled after Minimal selection');
  await continueLocalAi.click();

  if (phaseAcceptance) {
    const setupArrival = await waitUntil(async () => {
      if (await page.getByTestId('first-run-phase-setup').isVisible().catch(() => false)) return 'setup';
      if (await page.getByTestId('login-screen').isVisible().catch(() => false)
        || await page.getByTestId('main-shell').isVisible().catch(() => false)) return 'ready';
      return null;
    }, { timeoutMs: 120_000, intervalMs: 100, label: 'first-run Setup phase' });
    phaseAcceptance.setupObserved = setupArrival === 'setup';
    if (setupArrival === 'setup') {
      phaseAcceptance.setupPath = path.join(screenshotsRoot, 'desktop-first-run-setup.png');
      await page.screenshot({ path: phaseAcceptance.setupPath });
      phaseAcceptance.setupNarrowMethod = await setWindowBounds(connection, 390, 780);
      phaseAcceptance.setupNarrowPath = path.join(screenshotsRoot, 'desktop-first-run-setup-narrow.png');
      await page.screenshot({ path: phaseAcceptance.setupNarrowPath });
      phaseAcceptance.setupNarrowMetrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      await setWindowBounds(connection, 1440, 940);
    }
  }

  const ready = await waitUntil(async () => {
    const explicitFailures = [];
    for (const testId of [
      'first-run-setup-error',
      'product-first-run-finalization-error',
      'first-run-repair-reason',
      'app-bootstrap-error-screen',
    ]) {
      const failure = page.getByTestId(testId);
      const visible = await failure.isVisible().catch(() => false);
      explicitFailures.push({
        testId,
        visible,
        text: visible ? await failure.innerText().catch(() => '') : '',
      });
    }
    const setupRetry = page.getByTestId('first-run-setup-retry');
    const setupRetryVisible = await setupRetry.isVisible().catch(() => false);
    return classifyFirstRunTerminalSnapshot({
      authShellVisible: await page.getByTestId('login-screen').isVisible().catch(() => false)
        || await page.getByTestId('main-shell').isVisible().catch(() => false),
      explicitFailures,
      setupRetryVisible,
      setupText: setupRetryVisible
        ? await page.getByTestId('first-run-phase-setup').innerText().catch(() => '')
        : '',
    });
  }, { timeoutMs: 600_000, intervalMs: 500, label: 'Desktop first-run backend admission' });
  if (ready.kind === 'failure') {
    const record = await readProductControlJSONProjection(page, PRODUCT_CONTROL_RECORD_METHOD).catch(() => null);
    const dependencyJobs = await readLocalEnvironmentDependencyJobDiagnostics(page).catch(() => []);
    const failedJobs = dependencyJobs.filter((job) => job.state === 'failed' || job.state === 'repair_required');
    const failureEvidence = {
      schemaVersion: 'nimi.dev-kernel-first-run-terminal-failure/v1',
      observedAt: new Date().toISOString(),
      terminal: ready,
      productControl: record,
      failedJobs,
    };
    const failurePath = path.join(path.dirname(screenshotsRoot), 'first-run-terminal-failure.json');
    fs.writeFileSync(failurePath, `${JSON.stringify(failureEvidence, null, 2)}\n`, { mode: 0o600 });
    await page.screenshot({ path: path.join(screenshotsRoot, 'desktop-first-run-terminal-failure.png') });
    const primary = failedJobs.find((job) => job.failureDetail) || failedJobs[0];
    const ownerReason = primary
      ? `${primary.dependencyFamily}/${primary.dependencyId} ${primary.reasonCode || primary.state}: ${primary.failureDetail || '<no detail>'}`
      : ready.text || 'no dependency-job failure projection was returned';
    throw new Error(`Desktop first-run failed at ${ready.testId}: ${ready.text}; Runtime owner reason: ${ownerReason}`);
  }
  const record = await readProductControlJSONProjection(page, PRODUCT_CONTROL_RECORD_METHOD);
  if (ready.kind !== 'auth-shell' || record?.state !== 'ready_for_use') {
    throw new Error(`Desktop first-run did not reach backend-admitted ready_for_use: ${JSON.stringify(record)}`);
  }
  const serviceAfterReady = readFixedServiceStatus();
  return {
    selectedDataRoot,
    productState: record.state,
    productControlRecord: record,
    serviceAfterStorage,
    serviceAfterReady,
    layout: { desktopPath, narrowPath, narrowMethod, narrowMetrics, phaseAcceptance },
  };
}

async function captureReusedReadyFirstRun(page, productControlRecord, candidateId) {
  if (productControlRecord?.state !== 'ready_for_use') {
    throw new Error(`Desktop cannot reuse non-ready Product Control: ${JSON.stringify(productControlRecord)}`);
  }
  const expectedDataRoot = requireCheckpointDataRootProposal(productControlRecord, candidateId);
  let rendererReloadedForReadyContinuity = false;
  try {
    await waitForTestId(page, 'main-shell', 15_000);
  } catch {
    const current = await readProductControlJSONProjection(page, PRODUCT_CONTROL_RECORD_METHOD);
    if (current?.state !== 'ready_for_use') {
      throw new Error(`Desktop ready transition regressed before renderer reload: ${JSON.stringify(current)}`);
    }
    rendererReloadedForReadyContinuity = true;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    try {
      await waitForTestId(page, 'main-shell', 30_000);
    } catch (error) {
      const diagnostics = await readDesktopRuntimeDiagnostics(page);
      const surface = await page.evaluate(() => {
        const visible = (testId) => {
          const element = document.querySelector(`[data-testid="${testId}"]`);
          return element instanceof HTMLElement && element.offsetParent !== null;
        };
        const workflow = document.querySelector('[data-testid="product-first-run-workflow"]');
        return {
          pathname: location.pathname,
          loginVisible: visible('login-screen'),
          mainShellVisible: visible('main-shell'),
          firstRunGateVisible: visible('desktop-first-run-gate'),
          bootstrapErrorVisible: visible('app-bootstrap-error-screen'),
          admissionFailureVisible: visible('desktop-admission-failed'),
          productState: workflow?.getAttribute('data-product-state') || '',
        };
      });
      throw new Error(`Desktop renderer reload did not restore the ready shell: ${JSON.stringify({ surface, diagnostics })}`, { cause: error });
    }
  }
  const selectedDataRoot = await readProductControlJSONProjection(
    page,
    PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD,
  );
  if (comparablePath(selectedDataRoot?.dataRoot?.path) !== comparablePath(expectedDataRoot)) {
    throw new Error(`ready Product Control selected data root ${selectedDataRoot?.dataRoot?.path || '<missing>'}, expected ${expectedDataRoot}`);
  }
  const serviceAtReady = readFixedServiceStatus();
  return {
    selectedDataRoot,
    productState: productControlRecord.state,
    productControlRecord,
    serviceAfterStorage: serviceAtReady,
    serviceAfterReady: serviceAtReady,
    reusedReady: true,
    rendererReloadedForReadyContinuity,
    layout: { narrowMetrics: null, phaseAcceptance: null },
  };
}

async function readLocalEnvironmentDependencyJobDiagnostics(page) {
  const response = await invokeDesktopRuntimeUnary(page, LOCAL_ENVIRONMENT_DEPENDENCY_JOBS_METHOD);
  return (response?.jobs || []).map((job) => ({
    jobId: String(job.jobId || ''),
    environmentKey: String(job.environmentKey || ''),
    dependencyFamily: String(job.dependencyFamily || ''),
    dependencyId: String(job.dependencyId || ''),
    state: String(job.state || ''),
    sourceKind: String(job.sourceKind || ''),
    canonicalRoot: String(job.canonicalRoot || ''),
    selectedSourceRecordId: String(job.selectedSourceRecordId || ''),
    failureDetail: String(job.failureDetail || '').slice(0, 4_096),
    retryable: job.retryable === true,
    reasonCode: String(job.reasonCode || ''),
    recoveryDisposition: String(job.recoveryDisposition || ''),
    consumerScope: String(job.consumerScope || ''),
  }));
}

export async function prepareDesktopFixedServiceBaseline(page) {
  const service = readFixedServiceStatus();
  await waitUntil(async () => {
    const status = await invokeDesktop(page, RUNTIME_STATUS_COMMAND);
    return status?.running === true && status?.managed === true ? status : null;
  }, { timeoutMs: 60_000, intervalMs: 250, label: 'fixed-service preflight protected carrier' });

  let account = await waitUntil(async () => {
    const status = await invokeDesktop(page, 'runtime_account_session_status');
    return status?.state ? status : null;
  }, { timeoutMs: 30_000, intervalMs: 250, label: 'fixed-service preflight account status' });
  const initialAccountState = account.state;
  if (account.state !== 'anonymous') {
    const loggedOut = await invokeDesktop(page, 'runtime_account_logout', {
      payload: { reason: 'dev_kernel_preflight_reset' },
    });
    if (loggedOut?.accepted !== true) {
      throw new Error(`fixed-service preflight account reset was rejected: ${JSON.stringify(loggedOut)}`);
    }
    account = await waitUntil(async () => {
      const status = await invokeDesktop(page, 'runtime_account_session_status');
      return status?.state === 'anonymous' ? status : null;
    }, { timeoutMs: 30_000, intervalMs: 250, label: 'fixed-service anonymous account baseline' });
  }
  if (account.state !== 'anonymous') {
    throw new Error(`fixed-service preflight retained non-anonymous account state: ${JSON.stringify(account)}`);
  }
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  return { service, initialAccountState, accountState: account.state };
}

async function setFixtureAccount(fixtureOrigin, accountId, displayName) {
  const response = await fetch(`${fixtureOrigin}/__fixture/control/current-user`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, displayName }),
  });
  if (!response.ok) throw new Error(`fixture account switch failed with ${response.status}`);
  return response.json();
}

export async function loginDesktop(connection, expectedAccountId) {
  const { page } = connection;
  const mainShell = page.getByTestId('main-shell');
  if (await mainShell.isVisible().catch(() => false)) {
    await page.getByTestId('desktop-account-menu-trigger').click();
    await page.getByTestId('desktop-account-switch').click();
  }
  await waitForTestId(page, 'login-screen', 60_000);
  await page.getByTestId('login-logo-trigger').click();
  let outcome;
  try {
    outcome = await waitUntil(async () => {
      if (await page.getByTestId('main-shell').isVisible().catch(() => false)) return 'main-shell';
      if (await page.getByTestId('desktop-first-run-gate').isVisible().catch(() => false)) return 'first-run';
      const bodyText = await page.locator('body').innerText().catch(() => '');
      return /Authorization failed|授权失败|App is still starting|Runtime account service is unavailable/iu.test(bodyText)
        ? 'auth-error'
        : false;
    }, { timeoutMs: 300_000, label: 'Desktop login completion after real browser authentication' });
  } catch (error) {
    const diagnostics = await readDesktopRuntimeDiagnostics(page);
    let cleanup;
    try {
      cleanup = await invokeDesktop(page, 'runtime_account_logout', {
        payload: { reason: 'dev_kernel_login_timeout_cleanup' },
      });
    } catch (cleanupError) {
      cleanup = { error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) };
    }
    throw new Error(`Desktop login did not converge before timeout: ${JSON.stringify({ diagnostics, cleanup })}`, { cause: error });
  }
  if (outcome === 'auth-error') {
    const diagnostics = await readDesktopRuntimeDiagnostics(page);
    throw new Error(`Desktop login failed before main shell: ${JSON.stringify(diagnostics)}`);
  }
  const account = await waitUntil(async () => {
    const status = await invokeDesktop(page, 'runtime_account_session_status').catch(() => null);
    return status?.state === 'authenticated' ? status : null;
  }, { timeoutMs: 30_000, intervalMs: 250, label: 'Runtime-owned authenticated account projection' });
  if (account.accountProjection?.accountId !== expectedAccountId) {
    throw new Error(`Desktop login resolved unexpected account ${account.accountProjection?.accountId || '<missing>'}`);
  }
  return {
    outcome,
    accountId: account.accountProjection.accountId,
    accountLabel: outcome === 'main-shell'
      ? await page.getByTestId('desktop-account-menu-trigger').textContent()
      : '',
  };
}

async function readDesktopRuntimeDiagnostics(page) {
  const read = async (command) => {
    try {
      return { ok: true, value: await invokeDesktop(page, command) };
    } catch (error) {
      return {
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error || 'unknown'),
          code: typeof error === 'object' && error ? String(error.code || '') : '',
          reasonCode: typeof error === 'object' && error ? String(error.reasonCode || '') : '',
        },
      };
    }
  };
  const visibleText = await page.locator('body').innerText().catch(() => '');
  const boundedVisibleText = visibleText.trim().slice(0, 4_000);
  return {
    runtimeBridge: await read(RUNTIME_STATUS_COMMAND),
    accountSession: await read('runtime_account_session_status'),
    page: await page.evaluate(() => ({ title: document.title, pathname: location.pathname })),
    visibleText: SECRET_TEXT.test(boundedVisibleText)
      ? { redacted: true, sha256: sha256(boundedVisibleText), bytes: Buffer.byteLength(boundedVisibleText) }
      : { redacted: false, text: boundedVisibleText },
  };
}

async function openDeveloperModeSettings(page) {
  await page.getByTestId('nav-tab:apps').click();
  await waitForTestId(page, 'panel:apps');
  const entry = await firstVisible(page, '[data-testid^="apps-open-developer-mode-"]');
  if (!entry) throw new Error('Desktop Apps surface has no Developer Mode entry');
  await entry.click();
  await waitForTestId(page, 'developer-mode-toggle');
}

async function setDeveloperMode(page, enabled) {
  await openDeveloperModeSettings(page);
  const card = page.getByTestId('developer-mode-toggle');
  const button = page.getByTestId('developer-mode-toggle-button');
  const settled = await waitUntil(async () => {
    if (await button.isEnabled().catch(() => false)) return 'ready';
    const retry = page.getByTestId('developer-mode-retry-button');
    if (await retry.isVisible().catch(() => false)) {
      return { unavailable: true, detail: (await card.innerText()).trim().slice(0, 1_000) };
    }
    return null;
  }, { timeoutMs: 60_000, intervalMs: 100, label: 'Developer Mode Runtime projection' });
  if (settled !== 'ready') {
    throw new Error(`Developer Mode Runtime projection unavailable: ${settled.detail}`);
  }
  const expected = enabled ? 'on' : 'off';
  if (await card.getAttribute('data-developer-mode') !== expected) {
    await button.click();
    await waitUntil(async () => (
      await card.getAttribute('data-developer-mode') === expected
      && await button.isEnabled().catch(() => false)
    ), {
      timeoutMs: 30_000,
      label: `Developer Mode ${expected}`,
    });
  }
  return card.getAttribute('data-developer-mode');
}

async function approveLocalDevelopment(connection, decision, artifactsDir, captureLayout) {
  const { page } = connection;
  const dialog = await waitForTestId(page, 'local-development-approval-dialog', 90_000);
  const targetId = decision === 'allow-run-once' ? 'local-development-allow-once' : 'local-development-remember';
  const action = page.getByTestId(targetId);
  const disabledBeforeRisk = await action.isDisabled();
  if (!disabledBeforeRisk) throw new Error('local-development approval was enabled before native risk acknowledgement');
  let layout = null;
  if (captureLayout) {
    const desktopPath = path.join(artifactsDir, 'desktop-local-development-approval.png');
    await page.screenshot({ path: desktopPath });
    const narrowMethod = await setWindowBounds(connection, 390, 780);
    const narrowPath = path.join(artifactsDir, 'desktop-local-development-approval-narrow.png');
    await page.screenshot({ path: narrowPath });
    const narrowMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    await setWindowBounds(connection, 1440, 940);
    layout = { desktopPath, narrowPath, narrowMethod, narrowMetrics };
  }
  await page.getByTestId('local-development-native-risk-ack').check();
  if (await action.isDisabled()) throw new Error('local-development approval stayed disabled after native risk acknowledgement');
  const dialogText = await dialog.innerText();
  await action.click();
  await dialog.waitFor({ state: 'hidden', timeout: 60_000 });
  return { decision, disabledBeforeRisk, dialogTextSha256: sha256(dialogText), layout };
}

function startZhiyuDev(env, captureOptions = {}) {
  const launcherHome = os.homedir();
  return startProcess(process.execPath, [
    path.join(repoRoot, 'app-tools', 'bin', 'nimi-app.mjs'),
    'dev', '--shell', 'electron',
  ], {
    cwd: path.join(repoRoot, 'apps', 'zhiyu'),
    env: { ...env, HOME: launcherHome, USERPROFILE: launcherHome },
    ...captureOptions,
  });
}

async function waitZhiyuEvidence(page, predicate, label, timeoutMs = 90_000) {
  await page.waitForFunction((condition) => {
    const evidence = window.__nimiZhiyuDevKernelEvidence;
    if (!evidence) return false;
    if (condition.state && evidence.state !== condition.state) return false;
    if (condition.errorReason && evidence.lastError?.reasonCode !== condition.errorReason) return false;
    if (condition.openPermission && evidence.openPermission?.state !== condition.openPermission) return false;
    if (condition.anchor && !evidence.conversationAnchorId) return false;
    if (condition.completed && (evidence.state !== 'completed' || evidence.transcript.length < condition.completed)) return false;
    if (condition.buildMarker && evidence.buildMarker !== condition.buildMarker) return false;
    if (condition.conversationGranted) {
      const values = Object.values(evidence.conversationPermissions || {});
      if (values.length !== 3 || values.some((value) => value.state !== 'granted')) return false;
    }
    return true;
  }, predicate, { timeout: timeoutMs });
  const evidence = await page.evaluate(() => window.__nimiZhiyuDevKernelEvidence);
  if (!evidence) throw new Error(`${label} did not expose Zhiyu evidence`);
  return evidence;
}

function projectRuntimeUiEvidence(evidence) {
  return {
    state: evidence?.state || '',
    reasonCode: evidence?.lastError?.reasonCode || evidence?.session?.reasonCode || '',
    actionHint: evidence?.lastError?.actionHint || '',
    openPermissionState: evidence?.openPermission?.state || '',
  };
}

async function approveGrant(page, expectedOperation) {
  const dialog = await waitForTestId(page, 'local-app-grant-approval-dialog', 60_000);
  await waitUntil(async () => (await dialog.innerText()).includes(expectedOperation), {
    timeoutMs: 30_000,
    label: `grant dialog ${expectedOperation}`,
  });
  await page.getByTestId('local-app-grant-approve').click();
  await waitUntil(async () => !(await dialog.isVisible()) || !(await dialog.innerText()).includes(expectedOperation), {
    timeoutMs: 30_000,
    label: `grant approval ${expectedOperation}`,
  });
}

async function grantOpenConversation(desktopPage, zhiyuPage) {
  await zhiyuPage.getByTestId('zhiyu-dev-kernel-request-open-grant').click();
  await waitZhiyuEvidence(zhiyuPage, { state: 'open-grant-pending' }, 'open grant pending');
  await approveGrant(desktopPage, OPEN_OPERATION);
  await zhiyuPage.getByTestId('zhiyu-dev-kernel-refresh').click();
  await waitZhiyuEvidence(zhiyuPage, { openPermission: 'granted' }, 'open grant approved');
}

async function openConversation(zhiyuPage) {
  await zhiyuPage.getByTestId('zhiyu-dev-kernel-attempt-open').click();
  return waitZhiyuEvidence(zhiyuPage, { anchor: true }, 'conversation open');
}

async function grantConversationOperations(desktopPage, zhiyuPage) {
  await zhiyuPage.getByTestId('zhiyu-dev-kernel-request-conversation-grants').click();
  for (const operation of CONVERSATION_OPERATIONS) await approveGrant(desktopPage, operation);
  await zhiyuPage.getByTestId('zhiyu-dev-kernel-refresh').click();
  return waitZhiyuEvidence(zhiyuPage, { conversationGranted: true }, 'conversation grants approved');
}

async function sendTurnWithKeyboard(zhiyuPage, text, minimumTranscriptMessages) {
  const composer = zhiyuPage.getByTestId('zhiyu-dev-kernel-composer');
  await composer.fill(text);
  await composer.focus();
  const focused = await zhiyuPage.evaluate(() => document.activeElement?.getAttribute('data-testid') || '');
  await composer.press('Control+Enter');
  const evidence = await waitZhiyuEvidence(
    zhiyuPage,
    { completed: minimumTranscriptMessages },
    'RuntimeAgent turn completion',
    180_000,
  );
  return { evidence, focused };
}

async function openSettingsSecurity(page) {
  await page.getByTestId('nav-tab:settings').click();
  await waitForTestId(page, 'panel:settings');
  await page.getByTestId('settings-nav:security').click();
  await waitForTestId(page, 'local-development-authorizations');
}

async function revokeOperationGrant(desktopPage, operationId) {
  await openSettingsSecurity(desktopPage);
  const section = await waitForTestId(desktopPage, 'local-app-grant-management');
  await waitUntil(async () => (await section.innerText()).includes(operationId), {
    timeoutMs: 30_000,
    label: `managed grant ${operationId}`,
  });
  const row = section.locator('[data-nimi-tone="card"]').filter({ hasText: operationId }).first();
  const revoke = row.locator('[data-testid^="local-app-grant-revoke:"]');
  await revoke.click();
  await waitUntil(async () => !(await section.innerText()).includes(operationId), {
    timeoutMs: 30_000,
    label: `revoked grant ${operationId}`,
  });
}

async function revokeProjectAuthorization(desktopPage) {
  await openSettingsSecurity(desktopPage);
  const section = await waitForTestId(desktopPage, 'local-development-authorizations');
  const revoke = section.locator('[data-testid^="local-development-revoke:"]').first();
  await revoke.click();
  const confirm = section.locator('[data-testid^="local-development-revoke-confirm:"]').first();
  await confirm.click();
  await waitUntil(async () => /revoked|已撤销/iu.test(await section.innerText()), {
    timeoutMs: 30_000,
    label: 'revoked local-development project',
  });
}

async function readRememberedAuthorization(desktopPage, { accountId, selector, state } = {}) {
  const rows = await invokeDesktop(desktopPage, 'local_development_authorizations_list');
  if (!Array.isArray(rows)) throw new Error('local-development authorizations projection is not an array');
  const matches = rows.filter((row) => row?.appId === 'nimi.zhiyu'
    && row?.persistence === 'remember_project'
    && (!accountId || row.accountId === accountId)
    && (!selector || row.selector === selector)
    && (!state || row.state === state));
  matches.sort((left, right) => Number(right?.updatedAtUnixMs || 0) - Number(left?.updatedAtUnixMs || 0));
  if (matches.length === 0) {
    throw new Error(`remembered local-development authorization is missing${state ? ` in ${state}` : ''}`);
  }
  return matches[0];
}

function startRawMismatchedZhiyu({ port, userDataRoot, agentId, env, captureOptions = {} }) {
  fs.mkdirSync(userDataRoot, { recursive: true });
  const electron = path.join(repoRoot, 'apps', 'zhiyu', 'node_modules', 'electron', 'dist', 'electron.exe');
  const main = path.join(repoRoot, 'apps', 'zhiyu', 'dist-electron', 'main.js');
  return startProcess(electron, [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataRoot}`,
    main,
    '--nimi-dev-renderer-url=http://127.0.0.1:1472',
    `--nimi-dev-agent-id=${agentId}`,
  ], { cwd: path.join(repoRoot, 'apps', 'zhiyu'), env, ...captureOptions });
}

async function processIds(connection) {
  try {
    const session = await connection.context.newCDPSession(connection.page);
    const response = await session.send('SystemInfo.getProcessInfo');
    return response.processInfo
      .filter((row) => Number.isSafeInteger(row.id) && row.id > 0)
      .map((row) => ({ type: row.type, id: row.id }))
      .sort((left, right) => left.id - right.id);
  } catch {
    return [];
  }
}

export async function pageAudit(connection, label) {
  const { page, context } = connection;
  const dom = await page.evaluate(() => ({
    title: document.title,
    lang: document.documentElement.lang,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    visibleButtons: [...document.querySelectorAll('button')].filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).length,
    disabledButtons: [...document.querySelectorAll('button:disabled')].length,
    inputs: document.querySelectorAll('input, textarea').length,
  }));
  const storage = await page.evaluate(() => {
    const secretText = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:access|refresh|id)[_-]?token\s*[:=]|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.)/iu;
    const rows = [];
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) || '';
        rows.push({ key, value: storage.getItem(key) || '' });
      }
    }
    const leak = rows.some(({ key, value }) => (
      (/(?:access|refresh|id)[_-]?token|authorization|bearer/iu.test(key) && value.trim().length > 0)
      || secretText.test(value)
    ));
    return { entryCount: rows.length, authorityMaterialObserved: leak };
  });
  let accessibility = [];
  try {
    const session = await context.newCDPSession(page);
    await session.send('Accessibility.enable');
    const tree = await session.send('Accessibility.getFullAXTree');
    accessibility = tree.nodes.slice(0, 500).map((node) => ({
      role: node.role?.value || '',
      name: String(node.name?.value || '').slice(0, 240),
      ignored: node.ignored === true,
    }));
  } catch {
    accessibility = [];
  }
  return { label, dom, storage, accessibility, processIds: await processIds(connection) };
}

function providerContextLaneSequence(request) {
  if (request?.body?.stream !== true || !Array.isArray(request.body.messages)) return [];
  return request.body.messages.flatMap((message, index, messages) => {
    if (!['system', 'user', 'assistant'].includes(message?.role) || typeof message.content !== 'string') return [];
    const match = message.content.match(/(?:^|\n)lane=([a-z_]+)(?:\n|$)/u);
    if (match) return [match[1]];
    const committed = (message.role === 'user' && messages[index + 1]?.role === 'assistant')
      || (message.role === 'assistant' && messages[index - 1]?.role === 'user' && index < messages.length - 1);
    return committed ? ['conversation_history'] : [];
  });
}

function summarizeProviderRequests(requests) {
  const sequences = requests.map(providerContextLaneSequence).filter((sequence) => sequence.length > 0);
  const contextLaneIds = [...new Set(sequences.flat())].sort();
  const order = new Map(REQUIRED_PROVIDER_CONTEXT_LANES.map((lane, index) => [lane, index]));
  const contextLaneOrderVerified = sequences.every((sequence) => sequence.every((lane, index) => index === 0
    || (order.get(sequence[index - 1]) ?? Number.MAX_SAFE_INTEGER) <= (order.get(lane) ?? Number.MAX_SAFE_INTEGER)));
  const missingLaneIds = REQUIRED_PROVIDER_CONTEXT_LANES.filter((lane) => !contextLaneIds.includes(lane));
  return {
    complete: sequences.length >= 1 && contextLaneOrderVerified && missingLaneIds.length === 0,
    providerRequestCount: requests.length,
    contextRequestCount: sequences.length,
    contextLaneIds,
    requiredContextLaneIds: REQUIRED_PROVIDER_CONTEXT_LANES,
    missingLaneIds,
    contextLaneOrderVerified,
  };
}

async function waitForRebuiltZhiyu(port, marker, observer, previousConnection, timeoutMs = 180_000) {
  const reused = await waitUntil(async () => {
    if (previousConnection.page.isClosed()) return 'reconnect';
    const evidence = await previousConnection.page.evaluate(() => window.__nimiZhiyuDevKernelEvidence).catch(() => null);
    return evidence?.buildMarker === marker ? 'same-target' : null;
  }, { timeoutMs, intervalMs: 50, label: `Zhiyu process replacement for ${marker}` });
  if (reused === 'same-target') return previousConnection;
  return waitUntil(async () => {
    const connection = await connectCdp(port, 'rebuilt Zhiyu', 5_000, observer).catch(() => null);
    if (!connection) return null;
    const evidence = await connection.page.evaluate(() => window.__nimiZhiyuDevKernelEvidence).catch(() => null);
    if (evidence?.buildMarker !== marker) return null;
    return connection;
  }, { timeoutMs, intervalMs: 100, label: `Zhiyu build marker ${marker}` });
}

export async function runDevKernelCoreTrial(input) {
  return runDevKernelTrial({ ...input, executionMode: 'core' });
}

export async function runDevKernelOwnerMinimalTrial(input) {
  return runDevKernelTrial({ ...input, executionMode: 'owner-minimal' });
}

async function runDevKernelTrial({ architecture, journey, trial, sourceState, outputDir, executionMode }) {
  if (!['core', 'owner-minimal'].includes(executionMode)) {
    throw new Error(`unsupported dev-kernel execution mode ${executionMode || '<missing>'}`);
  }
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error(`dev-kernel-core requires Windows x64, got ${process.platform}/${process.arch}`);
  }
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const fixtureConfig = readAcceptanceFixture();
  const lock = acquireFixedServiceLock();
  const artifactsRoot = path.join(trial.paths.artifacts, 'dev-kernel');
  const screenshotsRoot = path.join(artifactsRoot, 'screenshots');
  const processLogsRoot = path.join(artifactsRoot, 'process-logs');
  fs.mkdirSync(screenshotsRoot, { recursive: true });
  fs.mkdirSync(processLogsRoot, { recursive: true });
  const processLogOptions = (label) => {
    if (!/^[a-z0-9-]+$/u.test(label)) throw new Error(`invalid process log label ${label}`);
    return {
      stdoutPath: path.join(processLogsRoot, `${label}.stdout.log`),
      stderrPath: path.join(processLogsRoot, `${label}.stderr.log`),
    };
  };
  const manifestPath = path.join(trial.paths.control, 'realm-fixture-manifest.json');
  const providerRawPath = path.join(trial.paths.providerRaw, 'provider-capture-local-sensitive.json');
  const probePath = path.join(repoRoot, 'apps', 'zhiyu', 'src-electron', 'dev-kernel-restart-probe.ts');
  const originalProbe = fs.readFileSync(probePath);
  const buildMarker = `acceptance-${sha256(trial.identity.journeyTrialId).slice(0, 12)}`;
  let fixture;
  let desktopHandle;
  let runOnceHandle;
  let rememberedHandle;
  let reactivatedHandle;
  let finalHandle;
  let rawHandle;
  let probeRestored = false;
  const observedPages = [];
  const observer = createEarlyCdpObserver(observedPages);
  const observations = {};
  const processLedger = createObservedProcessLedger();
  const observeRegisteredProcess = (role, handle, label) => {
    const registration = registerTrialProcessIdentity(trial, handle, label);
    processLedger.observe(role, `pid:${registration.pid}:created:${registration.creationTime}`, {
      kind: 'process-start',
      pid: registration.pid,
      label,
    });
    return registration;
  };

  try {
    const serviceBefore = readFixedServiceStatus();
    observations.serviceBefore = serviceBefore;
    processLedger.observe('runtime', `pid:${serviceBefore.processId}`, {
      kind: 'fixed-service-process',
      pid: serviceBefore.processId,
      phase: 'initial',
    });

    const realmManifest = createRealmFixtureManifest(FIXTURE_ORIGIN);
    realmManifest.scenarioId = 'dev-kernel-checkpoint.fixed-service-local-development';
    realmManifest.devKernelCheckpoint = {
      nonRelease: true,
      allowedAccountIds: [fixtureConfig.primaryAccountId, fixtureConfig.secondaryAccountId],
    };
    realmManifest.realmFixture.currentUser = {
      id: fixtureConfig.primaryAccountId,
      displayName: '开发内核主账号',
      handle: '@dev-kernel-primary',
      email: `${fixtureConfig.primaryAccountId}@nimi.local`,
      avatarUrl: '',
    };
    realmManifest.realmFixture.providerRequests = [];
    writeJson(manifestPath, realmManifest);
    fixture = await startRealmFixtureServer({ manifestPath, host: '127.0.0.1', port: 19443 });
    if (fixture.origin !== FIXTURE_ORIGIN) throw new Error(`fixture origin drifted: ${fixture.origin}`);
    observations.accountAuthority = await probeRealRealmBrowserLoginAuthority(
      fixtureConfig.accountRealmBaseUrl,
      fixtureConfig.accountWebBaseUrl,
    );
    processLedger.observe('realm', `fixture-listener:${fixture.origin}`, { kind: 'fixture-listener-start' });
    processLedger.observe('provider', `fixture-provider:${fixture.origin}`, { kind: 'fixture-provider-start' });

    const [desktopCdpPort, zhiyuCdpPort, rawCdpPort] = await Promise.all([reservePort(), reservePort(), reservePort()]);
    const rawUserDataRoot = path.join(trial.paths.root, 'zhiyu-raw-mismatch-user-data');
    fs.mkdirSync(rawUserDataRoot, { recursive: true });
    const hostToolchainHomes = resolveHostRustToolchainHomes({
      env: process.env,
      hostHome: os.homedir(),
    });
    for (const [name, toolchainRoot] of Object.entries(hostToolchainHomes)) {
      if (!fs.existsSync(toolchainRoot) || !fs.statSync(toolchainRoot).isDirectory()) {
        throw new Error(`${name} does not identify an installed host toolchain directory: ${toolchainRoot}`);
      }
      const relativeToTrial = path.relative(path.resolve(trial.paths.root), path.resolve(toolchainRoot));
      if (relativeToTrial === '' || (!relativeToTrial.startsWith(`..${path.sep}`) && relativeToTrial !== '..' && !path.isAbsolute(relativeToTrial))) {
        throw new Error(`${name} must remain outside the isolated product trial root`);
      }
    }
    const baseEnv = {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      NIMI_REALM_URL: ACCOUNT_REALM_ORIGIN,
      VITE_NIMI_REALM_URL: ACCOUNT_REALM_ORIGIN,
      NIMI_REALM_JWKS_URL: `${ACCOUNT_REALM_ORIGIN}/api/auth/jwks`,
      NIMI_REALM_REVOCATION_URL: `${ACCOUNT_REALM_ORIGIN}/api/auth/sessions/introspect`,
      NIMI_REALM_JWT_ISSUER: ACCOUNT_REALM_ORIGIN,
      NIMI_REALM_JWT_AUDIENCE: 'nimi-runtime',
      NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ROOT: trial.paths.root,
      NIMI_LOCAL_AGENT_PRODUCT_CONTROL_ROOT: trial.paths.control,
      NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_USER_DATA_ROOT: trial.paths.desktopUserData,
      NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT: trial.paths.zhiyuUserData,
      NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_CDP_PORT: String(desktopCdpPort),
      NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_CDP_PORT: String(zhiyuCdpPort),
      NIMI_LOCAL_AGENT_PRODUCT_AGENT_ID: fixtureConfig.agent.localAgentRef,
      NIMI_LOCAL_AGENT_PRODUCT_ACCOUNT_ID: fixtureConfig.primaryAccountId,
      NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_ID: 'dev-kernel-core',
      NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ID: trial.identity.journeyTrialId,
      RUSTUP_HOME: hostToolchainHomes.rustupHome,
      CARGO_HOME: hostToolchainHomes.cargoHome,
      // Desktop/Runtime trial state has explicit owner-scoped roots. Preserve
      // the user's APPDATA/LOCALAPPDATA so shell.openExternal reuses the real
      // browser profile instead of creating a disposable Chrome first-run.
      HOME: trial.paths.root,
      USERPROFILE: trial.paths.root,
    };

    const desktopLaunch = beginObservedProcess({
      connect: () => connectCdp(desktopCdpPort, 'Desktop', 300_000, observer),
      start: () => startProcess(process.execPath, [
        path.join(repoRoot, 'apps', 'desktop', 'scripts', 'run-dev-kernel-checkpoint-electron.mjs'),
      ], {
        cwd: repoRoot,
        env: baseEnv,
        ...processLogOptions('desktop-electron-checkpoint-launcher'),
      }),
    });
    desktopHandle = desktopLaunch.handle;
    observeRegisteredProcess('desktop', desktopHandle, 'desktop-electron-checkpoint-launcher');
    const desktop = await waitForObservedProcessConnection({
      connectionPromise: desktopLaunch.connectionPromise,
      handle: desktopHandle,
      label: 'Desktop Electron checkpoint launcher',
    });
    observations.fixedServicePreflight = await prepareDesktopFixedServiceBaseline(desktop.page);
    const desktopBootstrapOutcome = await waitUntil(async () => {
      if (await desktop.page.getByTestId('login-screen').isVisible().catch(() => false)) return 'anonymous-login';
      if (await desktop.page.getByTestId('main-shell').isVisible().catch(() => false)) return 'unexpected-main-shell';
      if (await desktop.page.getByTestId('desktop-first-run-gate').isVisible().catch(() => false)) {
        return 'unexpected-pre-auth-first-run';
      }
      if (await desktop.page.getByTestId('app-bootstrap-error-screen').isVisible().catch(() => false)) {
        return 'bootstrap-error';
      }
      if (desktopHandle.child.exitCode !== null) throw new Error('Desktop exited before bootstrap');
      return false;
    }, { timeoutMs: 120_000, label: 'Desktop isolated anonymous login shell' });
    if (desktopBootstrapOutcome === 'bootstrap-error') {
      const diagnostics = await readDesktopRuntimeDiagnostics(desktop.page);
      throw new Error(`Desktop bootstrap failed before auth shell: ${JSON.stringify(diagnostics)}`);
    }
    if (desktopBootstrapOutcome !== 'anonymous-login') {
      throw new Error(`isolated Desktop checkpoint entered invalid pre-auth state ${desktopBootstrapOutcome}`);
    }
    const primaryLogin = await loginDesktop(desktop, fixtureConfig.primaryAccountId);
    if (primaryLogin.outcome === 'first-run') {
      const productControl = await readProductControlJSONProjection(
        desktop.page,
        PRODUCT_CONTROL_RECORD_METHOD,
      );
      if (productControl?.state === 'ready_for_use') {
        observations.firstRun = await captureReusedReadyFirstRun(
          desktop.page,
          productControl,
          serviceBefore.runtimeCandidateId,
        );
      } else {
        const proposedDataRoot = requireCheckpointDataRootProposal(
          productControl,
          serviceBefore.runtimeCandidateId,
        );
        observations.firstRun = await completeDesktopFirstRun(desktop, {
          ...trial,
          paths: { ...trial.paths, runtimeData: proposedDataRoot },
        }, screenshotsRoot, {
          reuseReadyCandidateId: serviceBefore.runtimeCandidateId,
        });
        observations.firstRun.reusedReady = false;
      }
    } else if (primaryLogin.outcome === 'main-shell') {
      const productControlRecord = await readProductControlJSONProjection(
        desktop.page,
        PRODUCT_CONTROL_RECORD_METHOD,
      );
      observations.firstRun = await captureReusedReadyFirstRun(
        desktop.page,
        productControlRecord,
        serviceBefore.runtimeCandidateId,
      );
    } else {
      throw new Error(`Desktop login entered unsupported product state ${primaryLogin.outcome}`);
    }
    processLedger.observe('runtime', `pid:${observations.firstRun.serviceAfterStorage.processId}`, {
      kind: 'fixed-service-process',
      pid: observations.firstRun.serviceAfterStorage.processId,
      phase: 'after-storage-selection',
    });
    processLedger.observe('runtime', `pid:${observations.firstRun.serviceAfterReady.processId}`, {
      kind: 'fixed-service-process',
      pid: observations.firstRun.serviceAfterReady.processId,
      phase: 'after-first-run-ready',
    });
    observations.primaryAccountLabel = await desktop.page
      .getByTestId('desktop-account-menu-trigger')
      .textContent();
    observations.primaryAccountSession = await invokeDesktop(
      desktop.page,
      'runtime_account_session_status',
    );
    observations.developerModeEnabled = await setDeveloperMode(desktop.page, true);

    const runOnceLaunch = beginObservedProcess({
      connect: () => connectCdp(zhiyuCdpPort, 'run-once Zhiyu', 180_000, observer),
      start: () => startZhiyuDev(baseEnv, processLogOptions('zhiyu-run-once-launcher')),
    });
    runOnceHandle = runOnceLaunch.handle;
    observeRegisteredProcess('zhiyu', runOnceHandle, 'zhiyu-run-once-launcher');
    observations.runOnceApproval = await approveLocalDevelopment(
      desktop,
      'allow-run-once',
      screenshotsRoot,
      true,
    );
    const runOnceZhiyu = await waitForObservedProcessConnection({
      connectionPromise: runOnceLaunch.connectionPromise,
      handle: runOnceHandle,
      label: 'run-once Zhiyu Electron launcher',
    });
    await waitForTestId(runOnceZhiyu.page, 'zhiyu-dev-kernel-root');
    const zeroGrant = await waitZhiyuEvidence(
      runOnceZhiyu.page,
      { state: 'session-bound-zero-grant' },
      'zero-grant session',
    );
    await runOnceZhiyu.page.getByTestId('zhiyu-dev-kernel-attempt-open').click();
    const noGrant = await waitZhiyuEvidence(runOnceZhiyu.page, { errorReason: 'no-grant' }, 'no-grant denial');
    observations.zeroGrant = zeroGrant;
    observations.noGrant = noGrant;
    await runOnceZhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-zero-grant-desktop.png') });
    observations.zhiyuNarrowMethod = await setWindowBounds(runOnceZhiyu, 390, 780);
    await runOnceZhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-zero-grant-narrow.png') });
    observations.zhiyuZeroNarrowMetrics = await runOnceZhiyu.page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    await setWindowBounds(runOnceZhiyu, 1060, 780);

    await grantOpenConversation(desktop.page, runOnceZhiyu.page);
    const ownerOpen = await openConversation(runOnceZhiyu.page);
    observations.ownerSelectedOperation = ownerOpen;

    const rawLaunch = beginObservedProcess({
      connect: () => connectCdp(rawCdpPort, 'raw mismatched Zhiyu', 90_000, observer),
      start: () => startRawMismatchedZhiyu({
        port: rawCdpPort,
        userDataRoot: rawUserDataRoot,
        agentId: fixtureConfig.agent.localAgentRef,
        env: baseEnv,
        captureOptions: processLogOptions('zhiyu-raw-mismatch-launcher'),
      }),
    });
    rawHandle = rawLaunch.handle;
    observeRegisteredProcess('zhiyu', rawHandle, 'zhiyu-raw-mismatch-launcher');
    const rawZhiyu = await waitForObservedProcessConnection({
      connectionPromise: rawLaunch.connectionPromise,
      handle: rawHandle,
      label: 'raw mismatched Zhiyu Electron launcher',
    });
    await waitForTestId(rawZhiyu.page, 'zhiyu-dev-kernel-root');
    const rawInitial = await waitUntil(
      () => rawZhiyu.page.evaluate(() => window.__nimiZhiyuDevKernelEvidence || null),
      { timeoutMs: 30_000, label: 'raw Zhiyu evidence' },
    );
    if (!rawInitial.lastError) {
      await rawZhiyu.page.getByTestId('zhiyu-dev-kernel-attempt-open').click();
    }
    const rawDenied = await waitUntil(async () => {
      const value = await rawZhiyu.page.evaluate(() => window.__nimiZhiyuDevKernelEvidence || null);
      return value?.lastError ? value : null;
    }, { timeoutMs: 30_000, label: 'raw process mismatch denial' });
    observations.processMismatch = rawDenied;
    await rawZhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-raw-process-mismatch.png') });
    await terminateProcessTree(rawHandle);
    rawHandle = null;

    await revokeOperationGrant(desktop.page, OPEN_OPERATION);
    await runOnceZhiyu.page.getByTestId('zhiyu-dev-kernel-attempt-open').click();
    observations.grantRevoked = await waitUntil(async () => {
      const value = await runOnceZhiyu.page.evaluate(() => window.__nimiZhiyuDevKernelEvidence || null);
      return ['grant-revoked', 'revoked'].includes(value?.lastError?.reasonCode) ? value : null;
    }, { timeoutMs: 30_000, label: 'revoked grant denial' });
    await runOnceZhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-grant-revoked.png') });

    if (executionMode === 'owner-minimal') {
      await observer.flush();
      const desktopAudit = await pageAudit(desktop, 'owner-minimal Desktop');
      const zhiyuAudit = await pageAudit(runOnceZhiyu, 'owner-minimal Zhiyu');
      const privacyOk = observedPages.every((page) => page.authorizationHeaderObserved === false
        && page.secretTextObserved === false
        && page.consoleErrors.length === 0
        && page.pageErrors.length === 0
        && page.observerErrors.length === 0
        && (page.kind !== 'renderer-network-context' || page.requestObserverAttached === true)
        && (page.kind !== 'renderer-page' || (
          page.historicalResourceAuditCompleted === true
          && page.storageObserverAttached === true
          && page.storageAuditCompleted === true
          && page.storageAuthorityMaterialObserved === false
        )))
        && desktopAudit.storage.authorityMaterialObserved === false
        && zhiyuAudit.storage.authorityMaterialObserved === false;
      const facts = [
        ['dev-principal-session', observations.runOnceApproval.decision === 'allow-run-once'],
        ['zero-grant-session', observations.zeroGrant.session?.state === 'session-bound-zero-grant'],
        ['operation-denied-before-grant', observations.noGrant.lastError?.reasonCode === 'no-grant'],
        ['selected-runtime-agent-operation', Boolean(observations.ownerSelectedOperation.conversationAnchorId)],
        ['process-mismatch-denied', isRuntimeObservedProcessMismatch(observations.processMismatch)],
        ['grant-revoked-next-operation-denied', ['grant-revoked', 'revoked'].includes(observations.grantRevoked.lastError?.reasonCode)],
      ];
      const checkpoints = facts.map(([checkpointId, passed]) => ({
        checkpointId,
        outcome: passed ? 'passed' : 'failed',
      }));
      const summaryPath = path.join(artifactsRoot, 'owner-minimal-summary.json');
      writeJson(summaryPath, {
        schemaVersion: 'nimi.local-agent-product-owner-minimal-observation/v1',
        journeyTrialId: trial.identity.journeyTrialId,
        runtimeCandidateId: serviceBefore.runtimeCandidateId,
        productControlState: observations.firstRun.productState,
        accountState: observations.primaryAccountSession?.state || null,
        developerMode: observations.developerModeEnabled,
        runOnceDecision: observations.runOnceApproval.decision,
        zeroGrantState: observations.zeroGrant.session?.state || null,
        noGrantReason: observations.noGrant.lastError?.reasonCode || null,
        selectedOperationAnchorId: observations.ownerSelectedOperation.conversationAnchorId || null,
        processMismatchReason: observations.processMismatch.lastError?.reasonCode || null,
        grantRevokedReason: observations.grantRevoked.lastError?.reasonCode || null,
        privacyOk,
      });
      const pageSummaryPath = path.join(artifactsRoot, 'owner-minimal-dom-console-a11y.json');
      writeJson(pageSummaryPath, { observedPages, desktopAudit, zhiyuAudit });
      const screenshotFiles = allFiles(screenshotsRoot).filter((file) => path.extname(file).toLowerCase() === '.png');
      const outcome = checkpoints.every((checkpoint) => checkpoint.outcome === 'passed') && privacyOk
        ? 'passed'
        : 'failed';
      const result = {
        schemaVersion: 'nimi.local-agent-product-owner-minimal-result/v1',
        journeyTrialId: trial.identity.journeyTrialId,
        journeyId: 'dev-kernel-owner-minimal',
        tier: 'L2',
        batch: trial.identity.batch,
        repeatIndex: trial.identity.repeatIndex,
        sourceState,
        durationMs: Math.round(performance.now() - started),
        checkpoints,
        artifacts: [],
        privacy: { ok: privacyOk, findings: privacyOk ? [] : ['owner-minimal protected carrier observation failed privacy or console checks'] },
        outcome,
      };
      assertSourceState(sourceState, repoRoot);
      const persisted = persistResultEvidence({
        outputDir,
        result,
        artifactInputs: [
          { artifactId: 'owner-minimal-summary', file: summaryPath },
          { artifactId: 'owner-minimal-dom-console-a11y', file: pageSummaryPath },
          ...screenshotFiles.map((file, index) => ({
            artifactId: artifactIdFor('owner-minimal-shell', screenshotsRoot, file, index),
            file,
          })),
        ],
      });
      if (persisted.result.outcome !== 'passed') {
        const failed = checkpoints.filter((checkpoint) => checkpoint.outcome !== 'passed')
          .map((checkpoint) => checkpoint.checkpointId);
        throw new Error(`dev-kernel owner-minimal failed: ${failed.join(', ') || 'privacy'}`);
      }
      return persisted;
    }
    await terminateProcessTree(runOnceHandle);
    runOnceHandle = null;

    const rememberedLaunch = beginObservedProcess({
      connect: () => connectCdp(zhiyuCdpPort, 'remembered Zhiyu', 180_000, observer),
      start: () => startZhiyuDev(baseEnv, processLogOptions('zhiyu-remembered-launcher')),
    });
    rememberedHandle = rememberedLaunch.handle;
    observeRegisteredProcess('zhiyu', rememberedHandle, 'zhiyu-remembered-launcher');
    observations.rememberedApproval = await approveLocalDevelopment(
      desktop,
      'allow-remember-project',
      screenshotsRoot,
      false,
    );
    let zhiyu = await waitForObservedProcessConnection({
      connectionPromise: rememberedLaunch.connectionPromise,
      handle: rememberedHandle,
      label: 'remembered Zhiyu Electron launcher',
    });
    await waitForTestId(zhiyu.page, 'zhiyu-dev-kernel-root');
    await waitZhiyuEvidence(zhiyu.page, { state: 'session-bound-zero-grant' }, 'remembered zero-grant session');
    observations.rememberedAuthorization = await waitUntil(
      () => readRememberedAuthorization(desktop.page, {
        accountId: fixtureConfig.primaryAccountId,
        state: 'active',
      }),
      { timeoutMs: 30_000, label: 'active remembered authorization' },
    );
    await grantOpenConversation(desktop.page, zhiyu.page);
    const fullOpen = await openConversation(zhiyu.page);
    await grantConversationOperations(desktop.page, zhiyu.page);
    const firstTurn = await sendTurnWithKeyboard(
      zhiyu.page,
      '第一轮：请确认固定 Windows Runtime 服务、Desktop 授权与知语 local_development carrier 已真实连通。',
      2,
    );
    observations.firstConversation = firstTurn;
    const anchorId = firstTurn.evidence.conversationAnchorId;
    const firstTranscriptCount = firstTurn.evidence.transcript.length;
    await zhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-conversation-desktop.png') });
    const sendButton = zhiyu.page.getByTestId('zhiyu-dev-kernel-send');
    observations.sendDisabledAfterEmptyDraft = await sendButton.isDisabled();

    const editedProbe = originalProbe.toString('utf8').replace(
      "export const DEV_KERNEL_RESTART_PROBE = 'baseline';",
      `export const DEV_KERNEL_RESTART_PROBE = '${buildMarker}';`,
    );
    if (editedProbe === originalProbe.toString('utf8')) throw new Error('restart probe baseline marker is missing');
    const rebuiltZhiyuPromise = waitForRebuiltZhiyu(zhiyuCdpPort, buildMarker, observer, zhiyu);
    fs.writeFileSync(probePath, editedProbe, 'utf8');
    const preEditRuns = await invokeDesktop(desktop.page, 'local_development_runs_list');
    zhiyu = await rebuiltZhiyuPromise;
    await waitForTestId(zhiyu.page, 'zhiyu-dev-kernel-root');
    await zhiyu.page.getByTestId('zhiyu-dev-kernel-refresh').click();
    await waitZhiyuEvidence(zhiyu.page, { openPermission: 'granted', buildMarker }, 'post-edit grants');
    const postEditOpen = await openConversation(zhiyu.page);
    if (postEditOpen.conversationAnchorId !== anchorId) throw new Error('conversation anchor changed after supervised process replacement');
    await waitZhiyuEvidence(zhiyu.page, { conversationGranted: true }, 'post-edit conversation grants');
    const secondTurn = await sendTurnWithKeyboard(
      zhiyu.page,
      '第二轮：这是源码编辑、重新构建和进程替换之后的连续性验证，请回复当前会话仍然连续。',
      firstTranscriptCount + 2,
    );
    const postEditRuns = await invokeDesktop(desktop.page, 'local_development_runs_list');
    const preEditGeneration = Number(preEditRuns[0]?.hostGeneration);
    const postEditGeneration = Number(postEditRuns[0]?.hostGeneration);
    if (Number.isInteger(preEditGeneration)
      && Number.isInteger(postEditGeneration)
      && postEditGeneration > preEditGeneration) {
      processLedger.observe('zhiyu', `host-generation:${postEditGeneration}`, {
        kind: 'supervised-process-replacement',
        previousGeneration: preEditGeneration,
        hostGeneration: postEditGeneration,
      });
    }
    observations.editBuildRestart = {
      buildMarker,
      preEditRuns,
      postEditRuns,
      anchorBefore: anchorId,
      anchorAfter: secondTurn.evidence.conversationAnchorId,
      transcriptBefore: firstTranscriptCount,
      transcriptAfter: secondTurn.evidence.transcript.length,
    };

    observations.modeOff = await setDeveloperMode(desktop.page, false);
    await waitUntil(async () => rememberedHandle.child.exitCode !== null || zhiyu.page.isClosed(), {
      timeoutMs: 60_000,
      label: 'mode-off supervised host termination',
    });
    observations.dormantAuthorization = await waitUntil(
      () => readRememberedAuthorization(desktop.page, {
        accountId: fixtureConfig.primaryAccountId,
        selector: observations.rememberedAuthorization.selector,
        state: 'dormant',
      }),
      { timeoutMs: 30_000, label: 'mode-off dormant authorization' },
    );
    if (rememberedHandle.child.exitCode === null) await terminateProcessTree(rememberedHandle);
    rememberedHandle = null;
    fs.writeFileSync(probePath, originalProbe);
    probeRestored = true;
    observations.modeOn = await setDeveloperMode(desktop.page, true);
    const reactivatedLaunch = beginObservedProcess({
      connect: () => connectCdp(zhiyuCdpPort, 'reactivated Zhiyu', 180_000, observer),
      start: () => startZhiyuDev(baseEnv, processLogOptions('zhiyu-reactivated-launcher')),
    });
    reactivatedHandle = reactivatedLaunch.handle;
    observeRegisteredProcess('zhiyu', reactivatedHandle, 'zhiyu-reactivated-launcher');
    observations.reactivationApproval = await approveLocalDevelopment(
      desktop,
      'allow-remember-project',
      screenshotsRoot,
      false,
    );
    zhiyu = await waitForObservedProcessConnection({
      connectionPromise: reactivatedLaunch.connectionPromise,
      handle: reactivatedHandle,
      label: 'reactivated Zhiyu Electron launcher',
    });
    await waitForTestId(zhiyu.page, 'zhiyu-dev-kernel-root');
    await zhiyu.page.getByTestId('zhiyu-dev-kernel-refresh').click();
    await waitZhiyuEvidence(zhiyu.page, { openPermission: 'granted', buildMarker: 'baseline' }, 'reactivated grants');
    observations.reactivatedAuthorization = await waitUntil(
      () => readRememberedAuthorization(desktop.page, {
        accountId: fixtureConfig.primaryAccountId,
        selector: observations.rememberedAuthorization.selector,
        state: 'active',
      }),
      { timeoutMs: 30_000, label: 'reactivated remembered authorization' },
    );
    const reactivatedOpen = await openConversation(zhiyu.page);
    if (reactivatedOpen.conversationAnchorId !== anchorId) throw new Error('conversation anchor changed after remembered-project reactivation');

    const runtimeBeforeRestart = readFixedServiceStatus();
    await desktop.page.getByTestId('nav-tab:runtime').click();
    const restartButton = await waitForTestId(desktop.page, 'runtime-service-restart');
    const restart = restartButton.click();
    const runtimeUnavailableEvidence = await waitUntil(async () => {
      await zhiyu.page.getByTestId('zhiyu-dev-kernel-refresh').click().catch(() => undefined);
      return zhiyu.page.evaluate(() => {
        const evidence = window.__nimiZhiyuDevKernelEvidence;
        return evidence?.state === 'runtime-unavailable' ? evidence : null;
      }).catch(() => null);
    }, { timeoutMs: 60_000, intervalMs: 50, label: 'Zhiyu Runtime-unavailable UI during fixed-service restart' });
    await zhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-runtime-unavailable.png') });
    await restart;
    const runtimeAfterRestart = await waitUntil(() => {
      const status = readFixedServiceStatus();
      return status.processId !== runtimeBeforeRestart.processId ? status : null;
    }, { timeoutMs: 60_000, intervalMs: 500, label: 'fixed service PID rotation' });
    processLedger.observe('runtime', `pid:${runtimeAfterRestart.processId}`, {
      kind: 'fixed-service-process',
      pid: runtimeAfterRestart.processId,
      phase: 'explicit-runtime-restart',
    });
    await zhiyu.page.getByTestId('zhiyu-dev-kernel-refresh').click();
    const runtimeRecoveredEvidence = await waitZhiyuEvidence(
      zhiyu.page,
      { openPermission: 'granted' },
      'post-Runtime-restart grants',
      90_000,
    );
    await zhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-runtime-recovered.png') });
    const postRuntimeOpen = await openConversation(zhiyu.page);
    if (postRuntimeOpen.conversationAnchorId !== anchorId) throw new Error('conversation anchor changed after Runtime restart');
    await waitZhiyuEvidence(zhiyu.page, { conversationGranted: true }, 'post-Runtime-restart conversation grants');
    const thirdTurn = await sendTurnWithKeyboard(
      zhiyu.page,
      '第三轮：固定 Runtime 服务已经重启。请确认此前的会话仍可继续。',
      secondTurn.evidence.transcript.length + 2,
    );
    observations.runtimeRestart = {
      before: runtimeBeforeRestart,
      after: runtimeAfterRestart,
      unavailableUi: projectRuntimeUiEvidence(runtimeUnavailableEvidence),
      recoveredUi: projectRuntimeUiEvidence(runtimeRecoveredEvidence),
      anchorBefore: anchorId,
      anchorAfter: thirdTurn.evidence.conversationAnchorId,
      transcriptBefore: secondTurn.evidence.transcript.length,
      transcriptAfter: thirdTurn.evidence.transcript.length,
    };

    const desktopAuditBeforeSwitch = await pageAudit(desktop, 'desktop-before-account-switch');
    const zhiyuAuditBeforeSwitch = await pageAudit(zhiyu, 'zhiyu-before-account-switch');
    const preAccountSwitchEvidence = await zhiyu.page.evaluate(() => window.__nimiZhiyuDevKernelEvidence || null);
    const secondaryLogin = await loginDesktop(desktop, fixtureConfig.secondaryAccountId);
    await setFixtureAccount(fixture.origin, fixtureConfig.secondaryAccountId, '开发内核第二账号');
    const postSwitchOperation = zhiyu.page.getByTestId('zhiyu-dev-kernel-attempt-open');
    await postSwitchOperation.waitFor({ state: 'visible', timeout: 30_000 });
    await postSwitchOperation.click();
    const accountSwitchEvidence = await waitUntil(async () => {
      const evidence = await zhiyu.page.evaluate(() => window.__nimiZhiyuDevKernelEvidence || null).catch(() => null);
      const reasonCode = evidence?.lastError?.reasonCode;
      if (!['account-changed', 'revoked', 'process-replaced'].includes(reasonCode)) return null;
      if (reasonCode === preAccountSwitchEvidence?.lastError?.reasonCode
        && evidence?.state === preAccountSwitchEvidence?.state) return null;
      return evidence;
    }, { timeoutMs: 30_000, label: 'new selected-operation denial after account switch' });
    const accountSwitchRuns = await invokeDesktop(desktop.page, 'local_development_runs_list');
    const desktopAuditAfterSwitch = await pageAudit(desktop, 'desktop-after-account-switch');
    const zhiyuAuditAfterSwitch = await pageAudit(zhiyu, 'zhiyu-after-account-switch-denial');
    observations.accountSwitch = {
      login: secondaryLogin,
      evidence: accountSwitchEvidence,
      runs: accountSwitchRuns,
      auditLabels: [desktopAuditAfterSwitch.label, zhiyuAuditAfterSwitch.label],
    };
    if (reactivatedHandle.child.exitCode === null) await terminateProcessTree(reactivatedHandle);
    reactivatedHandle = null;

    const restoredPrimaryLogin = await loginDesktop(desktop, fixtureConfig.primaryAccountId);
    await setFixtureAccount(fixture.origin, fixtureConfig.primaryAccountId, '开发内核主账号');
    observations.primaryAccountRestored = restoredPrimaryLogin;
    await setDeveloperMode(desktop.page, true);
    const finalLaunch = beginObservedProcess({
      connect: () => connectCdp(zhiyuCdpPort, 'final primary Zhiyu', 180_000, observer),
      start: () => startZhiyuDev(baseEnv, processLogOptions('zhiyu-final-primary-launcher')),
    });
    finalHandle = finalLaunch.handle;
    observeRegisteredProcess('zhiyu', finalHandle, 'zhiyu-final-primary-launcher');
    observations.finalReactivationApproval = await approveLocalDevelopment(
      desktop,
      'allow-remember-project',
      screenshotsRoot,
      false,
    );
    const finalZhiyu = await waitForObservedProcessConnection({
      connectionPromise: finalLaunch.connectionPromise,
      handle: finalHandle,
      label: 'final primary Zhiyu Electron launcher',
    });
    await waitForTestId(finalZhiyu.page, 'zhiyu-dev-kernel-root');
    await finalZhiyu.page.getByTestId('zhiyu-dev-kernel-refresh').click();
    await waitZhiyuEvidence(finalZhiyu.page, { openPermission: 'granted' }, 'final primary grant posture');
    const finalOpen = await openConversation(finalZhiyu.page);
    if (finalOpen.conversationAnchorId !== anchorId) throw new Error('conversation anchor changed after returning to primary account');

    const revokeProject = revokeProjectAuthorization(desktop.page);
    await revokeProject;
    if (finalZhiyu.page.isClosed()) {
      throw new Error('project revoke terminated the admitted renderer before the selected post-revoke operation could be attempted');
    }
    const preRevokeAttemptEvidence = await finalZhiyu.page.evaluate(() => window.__nimiZhiyuDevKernelEvidence || null);
    const postRevokeOperation = finalZhiyu.page.getByTestId('zhiyu-dev-kernel-attempt-open');
    await postRevokeOperation.waitFor({ state: 'visible', timeout: 30_000 });
    await postRevokeOperation.click();
    const projectRevokeDenial = await waitUntil(async () => {
      const evidence = await finalZhiyu.page.evaluate(() => window.__nimiZhiyuDevKernelEvidence || null);
      if (!['revoked', 'project-changed'].includes(evidence?.lastError?.reasonCode)) return null;
      if (evidence.state !== 'access-lost') return null;
      if (evidence.lastError.reasonCode === preRevokeAttemptEvidence?.lastError?.reasonCode
        && preRevokeAttemptEvidence?.state === 'access-lost') return null;
      return evidence;
    }, { timeoutMs: 30_000, label: 'typed selected-operation denial after project revoke' });
    observations.projectRevoke = {
      operationId: OPEN_OPERATION,
      attempted: true,
      beforeState: preRevokeAttemptEvidence?.state || '',
      beforeReasonCode: preRevokeAttemptEvidence?.lastError?.reasonCode || '',
      denial: projectRevokeDenial,
    };
    const zhiyuAudit = await pageAudit(finalZhiyu, 'zhiyu-after-project-revoke-denial');
    await finalZhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-project-revoked.png') });
    const zhiyuRevokedNarrowMethod = await setWindowBounds(finalZhiyu, 390, 780);
    await finalZhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-project-revoked-narrow.png') });
    const zhiyuRevokedNarrowMetrics = await finalZhiyu.page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    await setWindowBounds(finalZhiyu, 1060, 780);

    await desktop.page.screenshot({ path: path.join(screenshotsRoot, 'desktop-security-revoked.png') });
    const desktopNarrowMethod = await setWindowBounds(desktop, 390, 780);
    await desktop.page.screenshot({ path: path.join(screenshotsRoot, 'desktop-security-revoked-narrow.png') });
    const desktopNarrowMetrics = await desktop.page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    await setWindowBounds(desktop, 1440, 940);

    const fixtureManifest = await (await fetch(`${fixture.origin}/__fixture/control/manifest`)).json();
    writeJson(providerRawPath, fixtureManifest);
    const providerRequests = fixtureManifest.realmFixture?.providerRequests || [];
    const providerSummary = summarizeProviderRequests(providerRequests);
    const providerSummaryPath = path.join(artifactsRoot, 'provider-capture-summary.json');
    writeJson(providerSummaryPath, providerSummary);

    const desktopAudit = await pageAudit(desktop, 'desktop-final');
    await observer.flush();
    const desktopAccessibility = assessAccessibilityAudit(desktopAudit);
    const zhiyuAccessibility = assessAccessibilityAudit(zhiyuAudit, { requiresInput: true });
    const pageSummary = {
      desktop: {
        audit: desktopAudit,
        auditBeforeSwitch: desktopAuditBeforeSwitch,
        auditAfterSwitch: desktopAuditAfterSwitch,
        accessibilityAcceptance: desktopAccessibility,
        narrowMethod: desktopNarrowMethod,
        narrowMetrics: desktopNarrowMetrics,
      },
      zhiyu: {
        audit: zhiyuAudit,
        auditBeforeSwitch: zhiyuAuditBeforeSwitch,
        auditAfterSwitch: zhiyuAuditAfterSwitch,
        accessibilityAcceptance: zhiyuAccessibility,
        narrowMethod: observations.zhiyuNarrowMethod,
        narrowMetrics: observations.zhiyuZeroNarrowMetrics,
        revokedNarrowMethod: zhiyuRevokedNarrowMethod,
        revokedNarrowMetrics: zhiyuRevokedNarrowMetrics,
      },
      observedPages,
    };
    const pageSummaryPath = path.join(artifactsRoot, 'real-shell-dom-console-a11y.json');
    writeJson(pageSummaryPath, pageSummary);

    const runtimeFinal = readFixedServiceStatus();
    const serviceSummaryPath = path.join(artifactsRoot, 'fixed-service-summary.json');
    writeJson(serviceSummaryPath, {
      before: serviceBefore,
      afterStorageSelection: observations.firstRun.serviceAfterStorage,
      afterFirstRunReady: observations.firstRun.serviceAfterReady,
      afterRestart: observations.runtimeRestart.after,
      final: runtimeFinal,
    });

    const safeObservations = {
      firstRun: {
        productState: observations.firstRun.productState,
        selectedDataRootSha256: sha256(observations.firstRun.selectedDataRoot.dataRoot.path),
        serviceProcessIds: [
          observations.firstRun.serviceAfterStorage.processId,
          observations.firstRun.serviceAfterReady.processId,
        ],
        narrowMetrics: observations.firstRun.layout.narrowMetrics,
        reusedReady: observations.firstRun.reusedReady === true,
      },
      productionAccountSession: {
        state: observations.primaryAccountSession?.state || null,
        accountProjection: observations.primaryAccountSession?.accountProjection || null,
        productionInert: observations.primaryAccountSession?.productionInert ?? null,
        runtimeCandidateId: serviceBefore.runtimeCandidateId,
      },
      runOnceApproval: observations.runOnceApproval,
      zeroGrant: {
        state: observations.zeroGrant.state,
        session: observations.zeroGrant.session,
      },
      noGrantReason: observations.noGrant.lastError?.reasonCode,
      selectedOperationAnchorId: observations.ownerSelectedOperation.conversationAnchorId,
      processMismatchReason: observations.processMismatch.lastError?.reasonCode,
      grantRevokedReason: observations.grantRevoked.lastError?.reasonCode,
      rememberedApproval: observations.rememberedApproval,
      rememberedAuthorization: observations.rememberedAuthorization,
      conversation: {
        anchorId,
        threadId: firstTurn.evidence.threadId,
        eventNames: firstTurn.evidence.eventNames,
        transcriptMessageCount: firstTurn.evidence.transcript.length,
        keyboardFocusTestId: firstTurn.focused,
      },
      editBuildRestart: observations.editBuildRestart,
      mode: {
        off: observations.modeOff,
        on: observations.modeOn,
        dormantAuthorization: observations.dormantAuthorization,
        reactivationApproval: observations.reactivationApproval,
        reactivatedAuthorization: observations.reactivatedAuthorization,
      },
      runtimeRestart: observations.runtimeRestart,
      accountSwitch: observations.accountSwitch,
      projectRevoke: {
        operationId: observations.projectRevoke.operationId,
        attempted: observations.projectRevoke.attempted,
        beforeState: observations.projectRevoke.beforeState,
        beforeReasonCode: observations.projectRevoke.beforeReasonCode,
        denial: {
          state: observations.projectRevoke.denial?.state || '',
          lastError: observations.projectRevoke.denial?.lastError || null,
        },
      },
      sendDisabledAfterEmptyDraft: observations.sendDisabledAfterEmptyDraft,
    };
    const journeySummaryPath = path.join(artifactsRoot, 'dev-kernel-journey-summary.json');
    writeJson(journeySummaryPath, safeObservations);

    const auditedPageSnapshots = [
      desktopAudit,
      desktopAuditBeforeSwitch,
      desktopAuditAfterSwitch,
      zhiyuAudit,
      zhiyuAuditBeforeSwitch,
      zhiyuAuditAfterSwitch,
    ];
    const privacyOk = observedPages.every((page) => page.authorizationHeaderObserved === false
      && page.secretTextObserved === false
      && page.consoleErrors.length === 0
      && page.pageErrors.length === 0
      && page.observerErrors.length === 0
      && (page.kind !== 'renderer-network-context' || page.requestObserverAttached === true)
      && (page.kind !== 'renderer-page' || (
        page.historicalResourceAuditCompleted === true
        && page.storageObserverAttached === true
        && page.storageAuditCompleted === true
        && page.storageAuthorityMaterialObserved === false
      )))
      && auditedPageSnapshots.every((audit) => audit.storage.authorityMaterialObserved === false);
    const desktopLayoutOk = observations.runOnceApproval.layout?.narrowMetrics.scrollWidth
      <= observations.runOnceApproval.layout?.narrowMetrics.clientWidth
      && (observations.firstRun.reusedReady === true
        || observations.firstRun.layout.narrowMetrics.scrollWidth <= observations.firstRun.layout.narrowMetrics.clientWidth)
      && desktopNarrowMetrics.scrollWidth <= desktopNarrowMetrics.clientWidth;
    const zhiyuLayoutOk = observations.zhiyuZeroNarrowMetrics.scrollWidth
      <= observations.zhiyuZeroNarrowMetrics.clientWidth
      && zhiyuRevokedNarrowMetrics.scrollWidth <= zhiyuRevokedNarrowMetrics.clientWidth;
    const accountSwitchDenied = ['account-changed', 'revoked', 'process-replaced'].includes(
      observations.accountSwitch.evidence?.lastError?.reasonCode,
    ) || observations.accountSwitch.runs.some((run) => (
      ['authorization-required', 'revoked', 'stopped'].includes(run.state)
      && ['principal-unauthorized', 'account-changed', 'local-app-account-changed'].includes(run.reasonCode)
    ));
    const processMismatchDenied = isRuntimeObservedProcessMismatch(observations.processMismatch);
    const processObservation = processLedger.snapshot();
    const processStarts = processObservation.processStarts;
    const processBudget = assessObservedProcessBudget(
      processStarts,
      journey.environment.start_limits,
      { provider: 1, realm: 1, runtime: 2, desktop: 1, zhiyu: 6 },
    );
    const processProblems = processBudget.ok
      ? []
      : [...processBudget.overages, ...processBudget.missing].map((problem) => `observed-process-budget:${problem}`);

    const facts = new Map();
    const pass = (checkpointId, passed, correlations = {}) => facts.set(checkpointId, {
      passed: passed === true,
      correlations,
    });
    pass('fixed-service-ready', serviceBefore.state === 'running', { serviceName: serviceBefore.serviceName, processId: serviceBefore.processId });
    pass('production-account-login', observations.firstRun.productState === 'ready_for_use'
      && observations.primaryAccountSession?.state === 'authenticated'
      && observations.primaryAccountSession?.accountProjection?.accountId === fixtureConfig.primaryAccountId
      && observations.primaryAccountSession?.productionInert === false
      && fixtureManifest.realmFixture?.runtimeAccountTokenRequests?.length >= 1, {
      accountId: observations.primaryAccountSession?.accountProjection?.accountId || null,
      accountState: observations.primaryAccountSession?.state || null,
      runtimeCandidateId: serviceBefore.runtimeCandidateId,
      selectedDataRootSha256: sha256(observations.firstRun.selectedDataRoot.dataRoot.path),
    });
    pass('developer-mode-enabled', observations.developerModeEnabled === 'on');
    pass('run-once-project-admitted', observations.runOnceApproval.decision === 'allow-run-once');
    pass('zero-grant-session', observations.zeroGrant.session?.state === 'session-bound-zero-grant');
    pass('operation-denied-before-grant', observations.noGrant.lastError?.reasonCode === 'no-grant');
    pass('selected-operation-granted', observations.ownerSelectedOperation.openPermission?.state === 'granted');
    pass('selected-runtime-agent-operation', Boolean(observations.ownerSelectedOperation.conversationAnchorId), { conversationAnchorId: observations.ownerSelectedOperation.conversationAnchorId });
    pass('process-mismatch-denied', processMismatchDenied, { reasonCode: observations.processMismatch.lastError?.reasonCode || null });
    pass('grant-revoked-next-operation-denied', ['grant-revoked', 'revoked'].includes(observations.grantRevoked.lastError?.reasonCode));
    pass('remembered-project-admitted', observations.rememberedApproval.decision === 'allow-remember-project'
      && observations.rememberedAuthorization.state === 'active'
      && observations.rememberedAuthorization.persistence === 'remember_project');
    pass('runtime-agent-conversation', firstTurn.evidence.eventNames.includes('runtime.agent.turn.completed') && firstTurn.evidence.transcript.length >= 2, { conversationAnchorId: anchorId });
    pass('edit-build-process-replaced', observations.editBuildRestart.preEditRuns[0]?.hostGeneration < observations.editBuildRestart.postEditRuns[0]?.hostGeneration, { buildMarker });
    pass('conversation-resumed-after-process-replacement', observations.editBuildRestart.anchorAfter === anchorId && observations.editBuildRestart.transcriptAfter > observations.editBuildRestart.transcriptBefore, { conversationAnchorId: anchorId });
    pass('mode-off-dormant', observations.modeOff === 'off'
      && observations.dormantAuthorization.state === 'dormant'
      && observations.dormantAuthorization.selector === observations.rememberedAuthorization.selector);
    pass('remembered-project-reactivated', observations.modeOn === 'on'
      && observations.reactivationApproval.decision === 'allow-remember-project'
      && observations.reactivatedAuthorization.state === 'active'
      && observations.reactivatedAuthorization.selector === observations.rememberedAuthorization.selector);
    pass('fixed-service-restarted', isRuntimeRestartUiTransition(observations.runtimeRestart), {
      beforeProcessId: observations.runtimeRestart.before.processId,
      afterProcessId: observations.runtimeRestart.after.processId,
      unavailableState: observations.runtimeRestart.unavailableUi.state,
      recoveredState: observations.runtimeRestart.recoveredUi.state,
    });
    pass('conversation-resumed-after-runtime-restart', observations.runtimeRestart.anchorAfter === anchorId && observations.runtimeRestart.transcriptAfter > observations.runtimeRestart.transcriptBefore, { conversationAnchorId: anchorId });
    pass('account-switch-invalidated', accountSwitchDenied, { secondaryAccountId: fixtureConfig.secondaryAccountId });
    pass('project-revoked-next-operation-denied', isTypedProjectRevocationDenial(observations.projectRevoke), {
      operationId: observations.projectRevoke.operationId,
      reasonCode: observations.projectRevoke.denial?.lastError?.reasonCode || null,
    });
    pass('desktop-real-shell-acceptance', desktopLayoutOk && desktopAccessibility.ok && observations.runOnceApproval.disabledBeforeRisk === true);
    pass('zhiyu-real-shell-acceptance', zhiyuLayoutOk && zhiyuAccessibility.ok && firstTurn.focused === 'zhiyu-dev-kernel-composer' && observations.sendDisabledAfterEmptyDraft === true);
    pass('protected-carrier-privacy-closeout', privacyOk && processBudget.ok);

    const processSummaryPath = path.join(artifactsRoot, 'process-summary.json');
    writeJson(processSummaryPath, {
      schemaVersion: 'nimi.local-agent-product-process-summary/v3-dev-kernel',
      processStarts,
      startLimits: journey.environment.start_limits,
      budget: processBudget,
      observedEvents: processObservation.events,
      serviceProcessIds: [...new Set(processObservation.events
        .filter((event) => event.role === 'runtime' && Number.isSafeInteger(event.pid))
        .map((event) => event.pid))],
      desktopProcessIds: desktopAudit.processIds,
      zhiyuProcessIds: zhiyuAudit.processIds,
      observedPageCount: observedPages.length,
    });

    const environmentIdentity = {
      rootId: sha256(trial.paths.root),
      accountIds: [fixtureConfig.primaryAccountId, fixtureConfig.secondaryAccountId],
      runtimeSourceRefs: [fixtureConfig.agent.runtimeSourceRef],
      localAgentIds: [fixtureConfig.agent.localAgentRef],
      processStarts,
    };
    const environmentPath = path.join(artifactsRoot, 'environment.json');
    writeJson(environmentPath, {
      schemaVersion: 'nimi.local-agent-product-environment/v3-dev-kernel',
      journeyTrialId: trial.identity.journeyTrialId,
      platform: process.platform,
      architecture: process.arch,
      sourceState,
      ...environmentIdentity,
    });

    const points = pointRowsForJourney(architecture, journey.journey_id);
    const safeEvidenceRefs = [
      'dev-kernel-journey-summary',
      'fixed-service-summary',
      'provider-capture-summary',
      'real-shell-dom-console-a11y',
      'process-summary',
      'journey-environment',
    ];
    const completedAt = new Date().toISOString();
    const correlations = {
      accountId: fixtureConfig.primaryAccountId,
      runtimeSourceRef: fixtureConfig.agent.runtimeSourceRef,
      localAgentRef: fixtureConfig.agent.localAgentRef,
      conversationAnchorId: anchorId,
      runtimeProcessId: runtimeFinal.processId,
    };
    const { checkpoints, checkpointById } = buildCheckpointResults({
      journey,
      points,
      facts,
      correlations,
      artifactRefs: safeEvidenceRefs,
      startedAt,
      completedAt,
    });
    const leafResults = buildLeafResults({
      points,
      checkpointById,
      journeyTrialId: trial.identity.journeyTrialId,
      artifactRefs: safeEvidenceRefs,
    });
    const proofPath = path.join(artifactsRoot, 'journey-checkpoint-proof.json');
    writeJson(proofPath, {
      schemaVersion: 'nimi.local-agent-product-checkpoint-proof/v3-dev-kernel',
      journeyTrialId: trial.identity.journeyTrialId,
      facts: Object.fromEntries(facts),
      correlations,
    });

    const screenshotFiles = allFiles(screenshotsRoot).filter((file) => path.extname(file).toLowerCase() === '.png');
    const artifactInputs = [
      { artifactId: 'dev-kernel-journey-summary', file: journeySummaryPath },
      { artifactId: 'fixed-service-summary', file: serviceSummaryPath },
      { artifactId: 'provider-capture-summary', file: providerSummaryPath },
      { artifactId: 'real-shell-dom-console-a11y', file: pageSummaryPath },
      { artifactId: 'process-summary', file: processSummaryPath },
      { artifactId: 'journey-environment', file: environmentPath },
      { artifactId: 'journey-checkpoint-proof', file: proofPath },
      ...screenshotFiles.map((file, index) => ({
        artifactId: artifactIdFor('real-shell', screenshotsRoot, file, index),
        file,
      })),
    ];
    const outcome = checkpoints.every((checkpoint) => checkpoint.outcome === 'passed')
      && processProblems.length === 0 ? 'passed' : 'failed';
    const result = {
      schemaVersion: 'nimi.local-agent-product-journey-result/v2',
      journeyTrialId: trial.identity.journeyTrialId,
      journeyId: journey.journey_id,
      tier: journey.applicable_layer,
      batch: trial.identity.batch,
      repeatIndex: trial.identity.repeatIndex,
      sourceState,
      environmentIdentity,
      durationMs: Math.round(performance.now() - started),
      checkpoints,
      leafResults,
      artifacts: [],
      processProblems,
      privacy: { ok: privacyOk, findings: privacyOk ? [] : ['protected carrier page observation detected console/storage/network authority material'] },
      outcome,
    };
    assertSourceState(sourceState, repoRoot);
    const persisted = persistResultEvidence({ outputDir, result, artifactInputs });
    const failures = validateJourneyResult({
      architecture,
      journey,
      result: persisted.result,
      expectedSourceState: sourceState,
    });
    if (failures.length > 0) throw new Error(`dev-kernel-core result validation failed: ${failures.join('; ')}`);
    if (persisted.result.outcome !== 'passed') {
      const failed = persisted.result.checkpoints
        .filter((checkpoint) => checkpoint.outcome !== 'passed')
        .map((checkpoint) => checkpoint.checkpointId);
      throw new Error(`dev-kernel-core product checkpoints failed: ${failed.join(', ')}`);
    }
    return persisted;
  } finally {
    if (!probeRestored) fs.writeFileSync(probePath, originalProbe);
    await Promise.all([
      rawHandle ? terminateProcessTree(rawHandle) : undefined,
      runOnceHandle ? terminateProcessTree(runOnceHandle) : undefined,
      rememberedHandle ? terminateProcessTree(rememberedHandle) : undefined,
      reactivatedHandle ? terminateProcessTree(reactivatedHandle) : undefined,
      finalHandle ? terminateProcessTree(finalHandle) : undefined,
      desktopHandle ? terminateProcessTree(desktopHandle) : undefined,
    ]);
    if (fixture) await fixture.close().catch(() => undefined);
    lock.release();
  }
}
