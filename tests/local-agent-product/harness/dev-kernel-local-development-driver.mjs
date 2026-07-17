import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startProcess } from './cross-app-driver.mjs';
import { repoRoot } from './registry.mjs';
import {
  comparablePath,
  connectCdp,
  firstVisible,
  invokeDesktop,
  setWindowBounds,
  sha256,
  waitForTestId,
  waitUntil,
} from './dev-kernel-host-driver.mjs';

const OPEN_OPERATION = 'runtime_agent.conversation.open';
// Subscribe and snapshot share the exact read capability/resource grant. Only
// the operation that creates that pending grant receives a Desktop decision;
// the final posture check still requires all three operations to be granted.
const CONVERSATION_GRANT_APPROVAL_OPERATIONS = [
  'runtime_agent.conversation.turn_send',
  'runtime_agent.conversation.turn_subscribe',
];
const REQUIRED_PROVIDER_CONTEXT_LANES = [
  'runtime_policy', 'output_contract', 'source_identity', 'source_behavior', 'world_context',
  'relationship_context', 'source_knowledge', 'canonical_memory', 'conversation_history',
  'capability_context',
];

async function openDeveloperModeSettings(page) {
  await page.getByTestId('nav-tab:apps').click();
  await waitForTestId(page, 'panel:apps');
  const entry = await firstVisible(page, '[data-testid^="apps-open-developer-mode-"]');
  if (!entry) throw new Error('Desktop Apps surface has no Developer Mode entry');
  await entry.click();
  await waitForTestId(page, 'developer-mode-toggle');
}

export async function setDeveloperMode(page, enabled) {
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

export async function resetLocalDevelopmentProjectAuthorization(page, identity) {
  const before = await invokeDesktop(page, 'local_development_authorizations_list');
  if (!Array.isArray(before)) throw new Error('local-development authorization baseline is not an array');
  const matches = selectLocalDevelopmentProjectAuthorizations(before, identity);
  let revokedCount = 0;
  for (const authorization of matches) {
    if (authorization.state === 'revoked') continue;
    const selector = String(authorization.selector || '').trim();
    if (!selector) throw new Error('local-development authorization baseline omitted its Desktop selector');
    const revoked = await invokeDesktop(page, 'local_development_authorization_revoke', {
      payload: { selector },
    });
    if (revoked?.state !== 'revoked') {
      throw new Error(`local-development authorization baseline revoke failed for ${selector}`);
    }
    revokedCount += 1;
  }
  const after = await invokeDesktop(page, 'local_development_authorizations_list');
  if (!Array.isArray(after)) throw new Error('local-development authorization baseline recheck is not an array');
  const remaining = selectLocalDevelopmentProjectAuthorizations(after, identity)
    .filter((authorization) => authorization.state !== 'revoked');
  if (remaining.length > 0) {
    throw new Error(`local-development authorization baseline retained ${remaining.length} non-revoked project authorization(s)`);
  }
  return { matchingBefore: matches.length, revokedCount, remainingNonRevoked: remaining.length };
}

export function selectLocalDevelopmentProjectAuthorizations(rows, {
  accountId,
  appId,
  canonicalProjectRoot,
  shell,
} = {}) {
  const expectedRoot = comparableProjectRoot(canonicalProjectRoot);
  if (!expectedRoot || !accountId || !appId || !shell) {
    throw new Error('local-development authorization baseline identity is invalid');
  }
  return (Array.isArray(rows) ? rows : []).filter((authorization) => (
    authorization?.accountId === accountId
    && authorization?.appId === appId
    && authorization?.shell === shell
    && comparableProjectRoot(authorization?.canonicalProjectRoot) === expectedRoot
  ));
}

function comparableProjectRoot(value) {
  const candidate = String(value || '').trim().replace(/^\\\\\?\\/u, '');
  if (/^[a-z]:[\\/]/iu.test(candidate)) return path.win32.resolve(candidate).toLowerCase();
  return comparablePath(candidate);
}

export async function approveLocalDevelopment(connection, decision, artifactsDir, captureLayout, browserAuth) {
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
  const browser = await authenticatePresence(browserAuth, page, () => action.click());
  await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
  return { decision, disabledBeforeRisk, dialogTextSha256: sha256(dialogText), layout, browser };
}

async function authenticatePresence(browserAuth, desktopPage, trigger) {
  if (!browserAuth?.driver
    || !['primary', 'secondary'].includes(browserAuth.credentialRole)
    || typeof browserAuth.expectedAccountId !== 'string'
    || typeof browserAuth.label !== 'string') {
    throw new Error('sensitive Desktop approval requires the harness-owned real Chrome auth driver');
  }
  return browserAuth.driver.authenticate({
    credentialRole: browserAuth.credentialRole,
    expectedAccountId: browserAuth.expectedAccountId,
    label: browserAuth.label,
    trigger,
    readAccountProjection: () => invokeDesktop(desktopPage, 'runtime_account_session_status'),
  });
}

export function startZhiyuDev(env, captureOptions = {}) {
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

export async function waitZhiyuEvidence(page, predicate, label, timeoutMs = 90_000, {
  transientRuntimeUnavailableMs = 0,
} = {}) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    const observation = await page.evaluate((condition) => {
      const evidence = window.__nimiZhiyuDevKernelEvidence;
      if (!evidence) return { matched: false, terminal: false, evidence: null };
      let matched = true;
      if (condition.state && evidence.state !== condition.state) matched = false;
      if (condition.errorReason && evidence.lastError?.reasonCode !== condition.errorReason) matched = false;
      if (condition.openPermission && evidence.openPermission?.state !== condition.openPermission) matched = false;
      if (condition.anchor && !evidence.conversationAnchorId) matched = false;
      if (condition.completed && (evidence.state !== 'completed' || evidence.transcript.length < condition.completed)) matched = false;
      if (condition.buildMarker && evidence.buildMarker !== condition.buildMarker) matched = false;
      if (condition.conversationGranted) {
        const values = Object.values(evidence.conversationPermissions || {});
        if (values.length !== 3 || values.some((value) => value.state !== 'granted')) matched = false;
      }
      return {
        matched,
        terminal: Boolean(evidence.lastError) && ['error', 'access-lost', 'runtime-unavailable'].includes(evidence.state),
        evidence: {
          state: evidence.state,
          openPermission: evidence.openPermission,
          lastError: evidence.lastError,
        },
      };
    }, predicate);
    latest = observation.evidence;
    if (observation.matched) {
      const evidence = await page.evaluate(() => window.__nimiZhiyuDevKernelEvidence);
      if (!evidence) throw new Error(`${label} did not expose Zhiyu evidence`);
      return evidence;
    }
    if (observation.terminal) {
      const transientRuntimeUnavailable = latest?.state === 'runtime-unavailable'
        && latest?.lastError?.reasonCode === 'runtime-service-unavailable'
        && Date.now() - startedAt < transientRuntimeUnavailableMs;
      if (!transientRuntimeUnavailable) {
        throw new Error(`${label} failed with evidence: ${JSON.stringify(latest)}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out with evidence: ${JSON.stringify(latest)}`);
}

export function classifyRememberedInitialGrantPosture(evidence) {
  if (evidence?.state === 'session-bound-zero-grant') return 'session-zero-grant';
  if (evidence?.state === 'access-lost' && evidence?.lastError?.reasonCode === 'grant-revoked') {
    return 'revoked-grant-history';
  }
  return null;
}

export async function waitRememberedInitialGrantPosture(page, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    const evidence = await page.evaluate(() => window.__nimiZhiyuDevKernelEvidence || null);
    latest = evidence ? {
      state: evidence.state,
      openPermission: evidence.openPermission,
      lastError: evidence.lastError,
    } : null;
    const posture = classifyRememberedInitialGrantPosture(evidence);
    if (posture) return { posture, evidence };
    if (latest?.lastError && ['error', 'access-lost', 'runtime-unavailable'].includes(latest.state)) {
      throw new Error(`${label} failed with evidence: ${JSON.stringify(latest)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out with evidence: ${JSON.stringify(latest)}`);
}

export function projectRuntimeUiEvidence(evidence) {
  return {
    state: evidence?.state || '',
    reasonCode: evidence?.lastError?.reasonCode || evidence?.session?.reasonCode || '',
    actionHint: evidence?.lastError?.actionHint || '',
    openPermissionState: evidence?.openPermission?.state || '',
  };
}

async function approveGrant(page, expectedOperation, browserAuth) {
  const dialog = await waitForTestId(page, 'local-app-grant-approval-dialog', 60_000);
  await waitUntil(async () => (await dialog.innerText()).includes(expectedOperation), {
    timeoutMs: 30_000,
    label: `grant dialog ${expectedOperation}`,
  });
  await authenticatePresence({
    ...browserAuth,
    label: `${browserAuth?.label || 'grant'}-${expectedOperation.replace(/[^a-z0-9]+/gu, '-')}`.slice(0, 80),
  }, page, () => page.getByTestId('local-app-grant-approve').click());
  await waitUntil(async () => !(await dialog.isVisible()) || !(await dialog.innerText()).includes(expectedOperation), {
    timeoutMs: 30_000,
    label: `grant approval ${expectedOperation}`,
  });
}

export async function grantOpenConversation(desktopPage, zhiyuPage, browserAuth) {
  await zhiyuPage.getByTestId('zhiyu-dev-kernel-request-open-grant').click();
  await waitZhiyuEvidence(zhiyuPage, { state: 'open-grant-pending' }, 'open grant pending');
  await approveGrant(desktopPage, OPEN_OPERATION, browserAuth);
  await zhiyuPage.getByTestId('zhiyu-dev-kernel-refresh').click();
  await waitZhiyuEvidence(zhiyuPage, { openPermission: 'granted' }, 'open grant approved');
}

export async function openConversation(zhiyuPage) {
  await zhiyuPage.getByTestId('zhiyu-dev-kernel-attempt-open').click();
  return waitZhiyuEvidence(zhiyuPage, { anchor: true }, 'conversation open');
}

export async function grantConversationOperations(desktopPage, zhiyuPage, browserAuth) {
  await zhiyuPage.getByTestId('zhiyu-dev-kernel-request-conversation-grants').click();
  for (const operation of CONVERSATION_GRANT_APPROVAL_OPERATIONS) await approveGrant(desktopPage, operation, browserAuth);
  await zhiyuPage.getByTestId('zhiyu-dev-kernel-refresh').click();
  return waitZhiyuEvidence(zhiyuPage, { conversationGranted: true }, 'conversation grants approved');
}

export async function sendTurnWithKeyboard(zhiyuPage, text, minimumTranscriptMessages) {
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
  if (!(await page.getByTestId('panel:settings').isVisible().catch(() => false))) {
    await page.getByTestId('desktop-account-menu-trigger').click();
    const settingsEntry = page.getByRole('button', { name: /^(Settings|设置)$/iu });
    await settingsEntry.click();
    await waitForTestId(page, 'panel:settings');
  }
  await page.getByTestId('settings-nav:security').click();
  await waitForTestId(page, 'local-development-authorizations');
}

export async function revokeOperationGrant(desktopPage, operationId) {
  await openSettingsSecurity(desktopPage);
  const section = await waitForTestId(desktopPage, 'local-app-grant-management');
  await waitUntil(async () => (await section.innerText()).includes(operationId), {
    timeoutMs: 30_000,
    label: `managed grant ${operationId}`,
  });
  const row = section.locator('[data-nimi-tone="card"]').filter({ hasText: operationId }).first();
  const revoke = row.locator('[data-testid^="local-app-grant-revoke:"]');
  await revoke.click();
  try {
    await waitUntil(async () => !(await section.innerText()).includes(operationId), {
      timeoutMs: 30_000,
      label: `revoked grant ${operationId}`,
    });
  } catch {
    const evidence = (await section.innerText()).replace(/\s+/gu, ' ').trim().slice(0, 2_000);
    throw new Error(`revoked grant ${operationId} failed with evidence: ${JSON.stringify(evidence)}`);
  }
}

export async function revokeProjectAuthorization(desktopPage) {
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

export function selectRememberedProjectAuthorizations(rows, { accountId, selector, state } = {}) {
  const matches = (Array.isArray(rows) ? rows : []).filter((row) => row?.appId === 'nimi.zhiyu'
    && row?.persistence === 'allow-remember-project'
    && (!accountId || row.accountId === accountId)
    && (!selector || row.selector === selector)
    && (!state || row.state === state));
  matches.sort((left, right) => Number(right?.updatedAtUnixMs || 0) - Number(left?.updatedAtUnixMs || 0));
  return matches;
}

export async function readRememberedAuthorization(desktopPage, { accountId, selector, state } = {}) {
  const rows = await invokeDesktop(desktopPage, 'local_development_authorizations_list');
  if (!Array.isArray(rows)) throw new Error('local-development authorizations projection is not an array');
  const matches = selectRememberedProjectAuthorizations(rows, { accountId, selector, state });
  if (matches.length === 0) {
    throw new Error(`remembered local-development authorization is missing${state ? ` in ${state}` : ''}`);
  }
  return matches[0];
}

export function startRawMismatchedZhiyu({ port, userDataRoot, agentId, env, captureOptions = {} }) {
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
  const deadline = Date.now() + 5_000;
  let lastError;
  while (Date.now() < deadline) {
    let page;
    try {
      page = !connection.page.isClosed()
        ? connection.page
        : connection.context.pages().find((candidate) => !candidate.isClosed() && !candidate.url().startsWith('devtools://'));
    } catch (error) {
      lastError = error;
    }
    if (page) {
      try {
        return await pageAuditLivePage(connection, page, label);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/(?:target page, context or browser has been closed|execution context was destroyed|frame was detached)/iu.test(message)) {
          throw error;
        }
        lastError = error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label} has no stable live renderer page for terminal audit`, { cause: lastError });
}

async function pageAuditLivePage(connection, page, label) {
  const { context } = connection;
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
  return { label, dom, storage, accessibility, processIds: await processIds({ ...connection, page }) };
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

export function summarizeProviderRequests(requests) {
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

export async function waitForRebuiltZhiyu(port, marker, observer, previousConnection, timeoutMs = 180_000) {
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
