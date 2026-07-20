import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  browserAuthSafeChildEnvironment,
  createDevKernelBrowserAuthDriver,
  loadDevKernelBrowserAuthCredentials,
  requireCapturedAuthorizationUrl,
  requireDevKernelRealmPolicyProjection,
} from './dev-kernel-browser-auth-driver.mjs';

const PASSWORD = 'browser-auth-test-secret';
const EXPECTED_ACCOUNT_ID = 'test-primary-account-id';
const AUTHORIZATION_URL = authorizationUrl('state-aaaaaaaaaaaaaaaa');

test('browser auth driver completes real-flow orchestration and returns only the account projection', async () => {
  await withTrial(async ({ trialRoot, captureFile, diagnosticsRoot }) => {
    let browserCalls = 0;
    const driver = createDriver({
      trialRoot,
      captureFile,
      diagnosticsRoot,
      browserFlow: async ({ authorization, credential, profileRoot, childEnvironment }) => {
        browserCalls += 1;
        assert.equal(authorization.callback.origin, 'http://127.0.0.1:49151');
        assert.equal(credential.email, 'primary@example.invalid');
        assert.equal(credential.password, PASSWORD);
        assert.ok(profileRoot.startsWith(fs.realpathSync.native(trialRoot)));
        assert.equal(childEnvironment.SAFE_VALUE, 'retained');
        assert.equal('NIMI_DEV_KERNEL_PRIMARY_PASSWORD' in childEnvironment, false);
        return {
          callbackCompleted: true,
          consoleErrorCount: 0,
          networkRequestCount: 7,
          storageMutationCount: 0,
          secretMaterialObserved: false,
        };
      },
    });
    const result = await driver.authenticate({
      credentialRole: 'primary',
      expectedAccountId: EXPECTED_ACCOUNT_ID,
      label: 'primary-login',
      trigger: async () => fs.writeFileSync(captureFile, `${AUTHORIZATION_URL}\n`, { mode: 0o600 }),
      readAccountProjection: async () => ({
        state: 'authenticated',
        accountProjection: { accountId: EXPECTED_ACCOUNT_ID },
      }),
    });
    assert.equal(browserCalls, 1);
    assert.equal(result.accountId, EXPECTED_ACCOUNT_ID);
    assert.equal(result.callbackCompleted, true);
    assert.equal(result.browser.secretMaterialObserved, false);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(PASSWORD, 'u'));
    assert.equal(fs.existsSync(captureFile), false);
  });
});

test('browser auth driver rejects authorization origin, path, and query mismatches', () => {
  for (const url of [
    AUTHORIZATION_URL.replace('localhost:3002', '127.0.0.1:3002'),
    AUTHORIZATION_URL.replace('/api/auth/oauth/authorize', '/api/auth/token'),
    AUTHORIZATION_URL.replace('http://localhost:3002', 'https://localhost:3002'),
    AUTHORIZATION_URL.replace('nimi-desktop', 'nimi-runtime'),
    `${AUTHORIZATION_URL}&state=duplicate-state-value`,
    `${AUTHORIZATION_URL}&untrusted=value`,
  ]) {
    assert.throws(
      () => requireCapturedAuthorizationUrl(url),
      /dev-kernel-browser-auth-authorization-url-forbidden/u,
    );
  }
  assert.throws(
    () => requireCapturedAuthorizationUrl(AUTHORIZATION_URL.replace('49151', '49152')),
    /dev-kernel-browser-auth-callback-invalid/u,
  );
});

test('browser auth driver rejects a symlinked capture path that escapes the canonical trial root', {
  skip: process.platform === 'win32',
}, async () => {
  await withTrial(async ({ trialRoot, diagnosticsRoot }) => {
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-browser-auth-outside-'));
    try {
      fs.symlinkSync(outsideRoot, path.join(trialRoot, 'escaped-control'), 'dir');
      assert.throws(() => createDriver({
        trialRoot,
        captureFile: path.join(trialRoot, 'escaped-control', 'browser-auth.capture'),
        diagnosticsRoot,
      }), /dev-kernel-browser-auth-capture-file-forbidden/u);
    } finally {
      fs.unlinkSync(path.join(trialRoot, 'escaped-control'));
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});

test('browser auth driver admits Runtime-generated opaque presence purposes', () => {
  const url = new URL(authorizationUrl('state-presenceopaque1'));
  url.searchParams.set('prompt', 'login');
  url.searchParams.set('presence_purpose', 'local_app_session/nimi.zhiyu/launch_v1_Aa0-_');
  url.searchParams.set('presence_nonce', 'nonce-Aa0_1234567890');
  assert.doesNotThrow(() => requireCapturedAuthorizationUrl(url.toString()));
});

test('browser auth driver rejects missing and duplicate capture URLs before launching Chrome', async () => {
  await withTrial(async ({ trialRoot, captureFile, diagnosticsRoot }) => {
    let browserCalls = 0;
    const driver = createDriver({
      trialRoot,
      captureFile,
      diagnosticsRoot,
      captureTimeoutMs: 20,
      browserFlow: async () => {
        browserCalls += 1;
        return {};
      },
    });
    const request = (trigger, label) => driver.authenticate({
      credentialRole: 'primary',
      expectedAccountId: EXPECTED_ACCOUNT_ID,
      label,
      trigger,
      readAccountProjection: async () => ({ state: 'authenticated', accountProjection: { accountId: EXPECTED_ACCOUNT_ID } }),
    });
    await assert.rejects(request(async () => undefined, 'missing-capture'), /dev-kernel-browser-auth-capture-missing/u);
    await assert.rejects(request(async () => {
      fs.writeFileSync(captureFile, `${AUTHORIZATION_URL}\n${authorizationUrl('state-bbbbbbbbbbbbbbbb')}\n`);
    }, 'duplicate-capture'), /dev-kernel-browser-auth-capture-duplicate/u);
    assert.equal(browserCalls, 0);
  });
});

test('browser auth driver fails closed instead of sleeping through Realm throttling', async () => {
  await withTrial(async ({ trialRoot, captureFile, diagnosticsRoot }) => {
    let triggers = 0;
    const driver = createDriver({ trialRoot, captureFile, diagnosticsRoot });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await driver.authenticate({
        credentialRole: 'primary',
        expectedAccountId: EXPECTED_ACCOUNT_ID,
        label: `bounded-${attempt}`,
        trigger: async () => {
          triggers += 1;
          fs.writeFileSync(captureFile, `${authorizationUrl(`state-bounded-${String(attempt).padStart(4, '0')}`)}\n`, { mode: 0o600 });
        },
        readAccountProjection: async () => ({
          state: 'authenticated',
          accountProjection: { accountId: EXPECTED_ACCOUNT_ID },
        }),
      });
    }
    await assert.rejects(driver.authenticate({
      credentialRole: 'primary',
      expectedAccountId: EXPECTED_ACCOUNT_ID,
      label: 'bounded-exhausted',
      trigger: async () => { triggers += 1; },
      readAccountProjection: async () => ({
        state: 'authenticated',
        accountProjection: { accountId: EXPECTED_ACCOUNT_ID },
      }),
    }), /dev-kernel-browser-auth-rate-window-exhausted/u);
    assert.equal(triggers, 5);
  });
});

test('browser auth driver admits the exact formal test-Realm budget projection', async () => {
  assert.deepEqual(requireDevKernelRealmPolicyProjection({
    schemaVersion: 'nimi.realm-test-policy/v1',
    profile: 'dev_kernel_checkpoint',
    passwordLoginLimit: 24,
    passwordLoginWindowMs: 15 * 60 * 1_000,
    loopbackOnly: true,
    freshPasswordVerificationRequired: true,
  }), {
    schemaVersion: 'nimi.realm-test-policy/v1',
    profile: 'dev_kernel_checkpoint',
    passwordLoginLimit: 24,
    passwordLoginWindowMs: 15 * 60 * 1_000,
    loopbackOnly: true,
    freshPasswordVerificationRequired: true,
  });
  assert.throws(() => requireDevKernelRealmPolicyProjection({
    schemaVersion: 'nimi.realm-test-policy/v1',
    profile: 'dev_kernel_checkpoint',
    passwordLoginLimit: 25,
    passwordLoginWindowMs: 15 * 60 * 1_000,
    loopbackOnly: true,
    freshPasswordVerificationRequired: true,
  }), /dev-kernel-browser-auth-realm-policy-invalid/u);

  await withTrial(async ({ trialRoot, captureFile, diagnosticsRoot }) => {
    const realmPolicy = requireDevKernelRealmPolicyProjection({
      schemaVersion: 'nimi.realm-test-policy/v1',
      profile: 'dev_kernel_checkpoint',
      passwordLoginLimit: 24,
      passwordLoginWindowMs: 15 * 60 * 1_000,
      loopbackOnly: true,
      freshPasswordVerificationRequired: true,
    });
    const driver = createDriver({ trialRoot, captureFile, diagnosticsRoot, realmPolicy });
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await driver.authenticate({
        credentialRole: 'primary',
        expectedAccountId: EXPECTED_ACCOUNT_ID,
        label: `formal-${attempt}`,
        trigger: async () => fs.writeFileSync(
          captureFile,
          `${authorizationUrl(`state-formal-${String(attempt).padStart(4, '0')}`)}\n`,
          { mode: 0o600 },
        ),
        readAccountProjection: async () => ({
          state: 'authenticated', accountProjection: { accountId: EXPECTED_ACCOUNT_ID },
        }),
      });
    }
    assert.deepEqual(driver.audit(), {
      profile: 'dev_kernel_checkpoint',
      passwordLoginLimit: 24,
      passwordLoginWindowMs: 15 * 60 * 1_000,
      attemptCount: 11,
      remainingAttempts: 13,
    });
  });
});

test('browser auth driver fails before startup when credentials are missing', () => {
  assert.throws(() => loadDevKernelBrowserAuthCredentials({
    roles: ['primary'],
    env: { NIMI_DEV_KERNEL_BROWSER_AUTH_CREDENTIALS_FILE: path.join(os.tmpdir(), 'missing-nimi-browser-auth.json') },
  }), /dev-kernel-browser-auth-credentials-missing:primary/u);
});

test('browser auth driver rejects an authenticated projection for the wrong account', async () => {
  await withTrial(async ({ trialRoot, captureFile, diagnosticsRoot }) => {
    const driver = createDriver({ trialRoot, captureFile, diagnosticsRoot });
    await assert.rejects(driver.authenticate({
      credentialRole: 'primary',
      expectedAccountId: EXPECTED_ACCOUNT_ID,
      label: 'account-mismatch',
      trigger: async () => fs.writeFileSync(captureFile, `${AUTHORIZATION_URL}\n`, { mode: 0o600 }),
      readAccountProjection: async () => ({
        state: 'authenticated',
        accountProjection: { accountId: '01J00000000000000000000099' },
      }),
    }), /dev-kernel-browser-auth-account-mismatch/u);
  });
});

test('browser auth credentials are removed from every child-process environment projection', () => {
  const safe = browserAuthSafeChildEnvironment(credentialEnv());
  for (const name of [
    'NIMI_DEV_KERNEL_PRIMARY_EMAIL',
    'NIMI_DEV_KERNEL_PRIMARY_PASSWORD',
    'NIMI_DEV_KERNEL_SECONDARY_EMAIL',
    'NIMI_DEV_KERNEL_SECONDARY_PASSWORD',
    'NIMI_DEV_KERNEL_BROWSER_AUTH_CREDENTIALS_FILE',
  ]) {
    assert.equal(name in safe, false);
  }
  assert.equal(safe.SAFE_VALUE, 'retained');
  const serialized = JSON.stringify(safe);
  assert.doesNotMatch(serialized, new RegExp(PASSWORD, 'u'));
  assert.doesNotMatch(serialized, /primary@example\.invalid|secondary@example\.invalid/u);
});

function authorizationUrl(state) {
  const url = new URL('http://localhost:3002/api/auth/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', 'nimi-desktop');
  url.searchParams.set('redirect_uri', 'http://127.0.0.1:49151/oauth/callback');
  url.searchParams.set('code_challenge', 'a'.repeat(43));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  return url.toString();
}

function createDriver({ trialRoot, captureFile, diagnosticsRoot, browserFlow, captureTimeoutMs, realmPolicy } = {}) {
  return createDevKernelBrowserAuthDriver({
    trialRoot,
    captureFile,
    diagnosticsRoot,
    requiredCredentialRoles: ['primary'],
    env: credentialEnv(),
    browserFlow: browserFlow || (async () => ({
      callbackCompleted: true,
      consoleErrorCount: 0,
      networkRequestCount: 1,
      storageMutationCount: 0,
      secretMaterialObserved: false,
    })),
    captureTimeoutMs,
    accountProjectionTimeoutMs: 50,
    realmPolicy,
  });
}

function credentialEnv() {
  return {
    SAFE_VALUE: 'retained',
    NIMI_DEV_KERNEL_PRIMARY_EMAIL: 'primary@example.invalid',
    NIMI_DEV_KERNEL_PRIMARY_PASSWORD: PASSWORD,
    NIMI_DEV_KERNEL_SECONDARY_EMAIL: 'secondary@example.invalid',
    NIMI_DEV_KERNEL_SECONDARY_PASSWORD: PASSWORD,
  };
}

async function withTrial(operation) {
  const trialRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-browser-auth-driver-'));
  const captureFile = path.join(trialRoot, 'control', 'browser-auth.capture');
  const diagnosticsRoot = path.join(trialRoot, 'artifacts', 'browser-auth');
  fs.mkdirSync(path.dirname(captureFile), { recursive: true });
  fs.mkdirSync(diagnosticsRoot, { recursive: true });
  try {
    await operation({ trialRoot, captureFile, diagnosticsRoot });
    const forbiddenCredentialValues = [PASSWORD, 'primary@example.invalid', 'secondary@example.invalid'];
    const retained = listFiles(trialRoot)
      .filter((file) => !file.endsWith('browser-auth.capture'))
      .map((file) => fs.readFileSync(file))
      .some((value) => forbiddenCredentialValues.some((credential) => value.includes(Buffer.from(credential))));
    assert.equal(retained, false, 'trial evidence must not retain browser credentials');
  } finally {
    fs.rmSync(trialRoot, { recursive: true, force: true });
  }
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  });
}
