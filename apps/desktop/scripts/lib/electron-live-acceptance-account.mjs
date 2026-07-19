import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  OFFLINE_STRIP_TEST_ID,
  captureAccountSessionSnapshot,
  captureRendererDiagnostics,
  invokeOptionalCommand,
  invokeRealmProbe,
  normalizeText,
  retryUntil,
  summarizeAuthorizations,
} from './electron-live-acceptance-runtime.mjs';

export async function validateRealmDisconnectRecovery(page, accountSequenceBefore) {
  process.stdout.write('NIMI_REALM_RECOVERY_READY\n');
  const offlineProbe = await waitForExplicitRealmUnavailable(page);
  await page.getByTestId('nav-tab:explore').click();
  const offlineStrip = page.getByTestId(OFFLINE_STRIP_TEST_ID);
  try {
    await offlineStrip.waitFor({ state: 'visible', timeout: 60_000 });
  } catch (error) {
    const diagnostics = await captureRendererDiagnostics(page);
    throw new Error(
      `Desktop did not project Realm L1 after exact 661/27: ${error instanceof Error ? error.message : String(error)}\n`
      + JSON.stringify(diagnostics, null, 2),
      { cause: error },
    );
  }
  const offlineText = normalizeText(await offlineStrip.innerText());
  assert.ok(offlineText, 'Realm outage must render an explicit L1 strip');
  assert.equal(await page.getByTestId('main-shell').isVisible(), true);
  assert.equal(await page.getByTestId('login-screen').count(), 0);
  const accountDuringOutage = await captureAccountSessionSnapshot(page);
  assert.equal(accountDuringOutage.status.state, 'authenticated');
  process.stdout.write('NIMI_REALM_OUTAGE_OBSERVED\n');

  const recoveredProbe = await retryUntil(
    () => invokeRealmProbe(page),
    (candidate) => candidate.ok === true
      && candidate.value?.accepted === true
      && candidate.value?.httpStatus === 200,
    240,
    500,
  );
  await offlineStrip.waitFor({ state: 'hidden', timeout: 120_000 });
  assert.equal(await page.getByTestId('main-shell').isVisible(), true);
  assert.equal(await page.getByTestId('login-screen').count(), 0);
  const accountAfterRecovery = await captureAccountSessionSnapshot(page);
  assert.equal(accountAfterRecovery.status.state, 'authenticated');
  return {
    offlineReasonCode: offlineProbe.value.reasonCode,
    offlineAccountReasonCode: offlineProbe.value.accountReasonCode,
    offlineText,
    accountSequenceBefore,
    accountSequenceDuringOutage: accountDuringOutage.status.sequence,
    accountSequenceAfterRecovery: accountAfterRecovery.status.sequence,
    accountStateDuringOutage: accountDuringOutage.status.state,
    accountStateAfterRecovery: accountAfterRecovery.status.state,
    recoveredHttpStatus: recoveredProbe.value.httpStatus,
  };
}

export async function validateShortJwtRefreshRotation(page, accountSequenceBefore) {
  assert.equal(
    await page.getByTestId('main-shell').isVisible(),
    true,
    'Short-JWT refresh acceptance requires the authenticated main shell',
  );
  await startAccountEventCapture(page, accountSequenceBefore);
  try {
    process.stdout.write('NIMI_REFRESH_ROTATION_READY\n');
    const reactive = await waitForRefreshCycleCount(page, 1, 300_000);
    assert.equal(reactive.probe.value.httpStatus, 200);
    assert.equal(
      await page.getByTestId('main-shell').isVisible(),
      true,
      'Reactive refresh must preserve the authenticated main shell',
    );

    const proactive = await waitForRefreshCycleCount(page, 2, 180_000);
    assert.equal(proactive.probe.value.httpStatus, 200);
    assert.equal(
      await page.getByTestId('main-shell').isVisible(),
      true,
      'Proactive refresh must preserve the authenticated main shell',
    );
    process.stdout.write('NIMI_REFRESH_SHORT_TTL_COMPLETE\n');

    const restored = await waitForRefreshCycleCount(page, 3, 300_000);
    assert.equal(restored.probe.value.httpStatus, 200);
    process.stdout.write('NIMI_REFRESH_ORIGINAL_KEY_RECOVERED\n');

    const finalStatus = await retryUntil(
      () => invokeOptionalCommand(page, 'runtime_account_session_status', {}),
      (candidate) => candidate.ok === true && candidate.value?.state === 'authenticated',
      60,
      500,
    );
    await page.getByTestId(OFFLINE_STRIP_TEST_ID).waitFor({ state: 'hidden', timeout: 60_000 });
    await page.getByTestId('main-shell').waitFor({ state: 'visible', timeout: 10_000 });
    assert.equal(await page.getByTestId('login-screen').count(), 0);
    const events = await readAccountEventCapture(page);
    return {
      accountSequenceBefore,
      accountSequenceAfter: finalStatus.value.sequence,
      finalState: finalStatus.value.state,
      cycles: deriveRefreshCycles(events),
      events,
    };
  } finally {
    await stopAccountEventCapture(page);
  }
}

export async function completeDesktopAccountLogin(page, options) {
  const { app, openCapturedExternal = false } = options;
  assert.equal(
    await page.getByTestId('login-screen').isVisible(),
    true,
    'Runtime account login acceptance requires the explicit login surface',
  );
  const trigger = page.getByTestId('login-logo-trigger');
  assert.equal(await trigger.count(), 1);
  const ready = await retryUntil(
    async () => ({
      status: await invokeOptionalCommand(page, 'runtime_account_session_status', {}),
      triggerEnabled: await trigger.isEnabled(),
    }),
    (candidate) => candidate.status.ok === true
      && (candidate.status.value?.state === 'login-pending' || candidate.triggerEnabled),
    40,
    250,
  );
  if (ready.triggerEnabled) {
    await trigger.click();
  }
  let pending;
  try {
    pending = await retryUntil(
      () => invokeOptionalCommand(page, 'runtime_account_session_status', {}),
      (candidate) => candidate.ok === true && candidate.value?.state === 'login-pending',
      120,
      250,
    );
  } catch (error) {
    const diagnostics = await captureRendererDiagnostics(page);
    const directBegin = await invokeOptionalCommand(page, 'runtime_account_begin_login', {
      payload: {
        redirectUri: 'http://127.0.0.1:46373/oauth/callback',
        callbackOrigin: 'http://127.0.0.1:46373',
        requestedScopes: [],
        ttlSeconds: 300,
      },
    });
    const directBeginDisposition = directBegin.ok
      ? {
          ok: true,
          accepted: directBegin.value?.accepted,
          reasonCode: directBegin.value?.reasonCode,
          accountReasonCode: directBegin.value?.accountReasonCode,
          productionInert: directBegin.value?.productionInert,
        }
      : directBegin;
    throw new Error(
      `Desktop login did not enter login-pending:\n${JSON.stringify({ diagnostics, directBeginDisposition }, null, 2)}`,
      { cause: error },
    );
  }
  process.stdout.write('NIMI_DESKTOP_LOGIN_BROWSER_OPENED\n');
  if (openCapturedExternal) {
    await openCapturedOAuthAuthorization(app);
  }
  await page.getByTestId('main-shell').waitFor({ state: 'visible', timeout: 300_000 });
  const status = await retryUntil(
    () => invokeOptionalCommand(page, 'runtime_account_session_status', {}),
    (candidate) => candidate.ok === true && candidate.value?.state === 'authenticated',
    120,
    500,
  );
  const realm = await retryUntil(
    () => invokeRealmProbe(page),
    (candidate) => candidate.ok === true
      && candidate.value?.accepted === true
      && candidate.value?.httpStatus === 200,
    60,
    500,
  );
  await page.getByTestId(OFFLINE_STRIP_TEST_ID).waitFor({ state: 'hidden', timeout: 60_000 });
  assert.equal(await page.getByTestId('login-screen').count(), 0);
  const authorizations = await invokeOptionalCommand(
    page,
    'local_development_authorizations_list',
    {},
  );
  return {
    pendingSequence: pending.value.sequence,
    sequence: status.value.sequence,
    state: status.value.state,
    realmHttpStatus: realm.value.httpStatus,
    localProjectAuthorizations: summarizeAuthorizations(authorizations),
  };
}

async function openCapturedOAuthAuthorization(app) {
  const capturePath = normalizeText(process.env.NIMI_DESKTOP_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE);
  assert.ok(capturePath, 'Live external OAuth requires the exact capture file');
  const authorizationUrl = new URL(readFileSync(capturePath, 'utf8').trim());
  assert.equal(authorizationUrl.protocol, 'http:');
  assert.ok(
    authorizationUrl.hostname === 'localhost' || authorizationUrl.hostname === '127.0.0.1',
    'OAuth authorization authority must stay on loopback',
  );
  assert.equal(authorizationUrl.port, '3002');
  assert.equal(authorizationUrl.pathname, '/api/auth/oauth/authorize');
  await app.evaluate(async ({ shell }, href) => {
    await shell.openExternal(href);
  }, authorizationUrl.href);
}

async function waitForRefreshCycleCount(page, expectedCount, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe = null;
  let lastEvents = [];
  while (Date.now() < deadline) {
    lastProbe = await invokeRealmProbe(page);
    lastEvents = await readAccountEventCapture(page);
    const cycles = deriveRefreshCycles(lastEvents);
    if (cycles.length >= expectedCount
      && lastProbe.ok === true
      && lastProbe.value?.accepted === true
      && lastProbe.value?.httpStatus === 200) {
      return { probe: lastProbe, cycles };
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `Timed out waiting for ${expectedCount} account refresh cycles: `
    + JSON.stringify({ lastProbe, events: lastEvents }, null, 2),
  );
}

async function startAccountEventCapture(page, afterSequence) {
  await page.evaluate(async (sequence) => {
    const hook = globalThis.window.__NIMI_ELECTRON_RUNTIME__;
    const capture = {
      streamId: '',
      pending: [],
      events: [],
      unsubscribe: null,
    };
    const acceptEnvelope = (payload) => {
      if (capture.events.length >= 256) throw new Error('account refresh event capture exceeded 256 events');
      if (payload?.streamId === capture.streamId && payload?.eventType === 'next') {
        capture.events.push(payload.event);
      }
    };
    capture.unsubscribe = hook.listen('runtime_account_session_events', ({ payload }) => {
      if (!capture.streamId) {
        capture.pending.push(payload);
        return;
      }
      acceptEnvelope(payload);
    });
    const opened = await hook.invoke('runtime_account_session_events_open', {
      afterSequence: sequence,
    });
    capture.streamId = opened.streamId;
    for (const payload of capture.pending.splice(0)) acceptEnvelope(payload);
    globalThis.__NIMI_ACCOUNT_REFRESH_ACCEPTANCE__ = capture;
  }, afterSequence);
}

async function readAccountEventCapture(page) {
  return await page.evaluate(() => {
    const capture = globalThis.__NIMI_ACCOUNT_REFRESH_ACCEPTANCE__;
    if (!capture) throw new Error('account refresh event capture is not open');
    return capture.events.map((event) => ({
      sequence: event.sequence,
      deliveryKind: event.deliveryKind,
      state: event.state,
      reasonCode: event.reasonCode,
      accountReasonCode: event.accountReasonCode,
      replayTruncated: event.replayTruncated,
    }));
  });
}

async function stopAccountEventCapture(page) {
  await page.evaluate(async () => {
    const capture = globalThis.__NIMI_ACCOUNT_REFRESH_ACCEPTANCE__;
    if (!capture) return;
    capture.unsubscribe?.();
    if (capture.streamId) {
      await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(
        'runtime_account_session_events_close',
        { streamId: capture.streamId },
      ).catch(() => undefined);
    }
    delete globalThis.__NIMI_ACCOUNT_REFRESH_ACCEPTANCE__;
  });
}

function deriveRefreshCycles(events) {
  const cycles = [];
  let pendingSequence = '';
  for (const event of events) {
    if (event.deliveryKind !== 'live') continue;
    if (event.state === 'refresh-pending' && !pendingSequence) {
      pendingSequence = event.sequence;
      continue;
    }
    if (event.state === 'authenticated' && pendingSequence) {
      cycles.push({
        refreshPendingSequence: pendingSequence,
        authenticatedSequence: event.sequence,
      });
      pendingSequence = '';
    }
  }
  return cycles;
}

async function waitForExplicitRealmUnavailable(page) {
  let lastCandidate = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    lastCandidate = await invokeRealmProbe(page, 2_000);
    if (lastCandidate.ok === true
      && lastCandidate.value?.accepted === false
      && lastCandidate.value?.reasonCode === 661
      && lastCandidate.value?.accountReasonCode === 27) {
      return lastCandidate;
    }
    if (lastCandidate.ok === false || lastCandidate.value?.accepted === false) {
      process.stdout.write(`NIMI_REALM_PROBE_CANDIDATE ${JSON.stringify(lastCandidate)}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Realm outage did not produce exact 661/27 transport failure: ${JSON.stringify(lastCandidate)}`);
}
