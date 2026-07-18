import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createDevKernelExternalUrlCapture,
  requireDevKernelAuthorizationUrl,
} from '../src-electron/dev-kernel-external-url-capture';

const VALID_AUTHORIZATION_URL = authorizationUrl('state-aaaaaaaaaaaaaaaa');

test('dev-kernel external URL capture admits one exact Realm authorization URL at a time', async () => {
  await withTrialRoot(async (trialRoot) => {
    const captureFile = path.join(trialRoot, 'control', 'browser-auth.capture');
    const capture = createDevKernelExternalUrlCapture(checkpointEnv(trialRoot, captureFile));
    assert.equal(await capture.capture(VALID_AUTHORIZATION_URL), true);
    assert.equal(await readFile(captureFile, 'utf8'), `${VALID_AUTHORIZATION_URL}\n`);

    await rm(captureFile, { force: true });
    const second = authorizationUrl('state-bbbbbbbbbbbbbbbb');
    assert.equal(await capture.capture(second), true);
    assert.equal(await readFile(captureFile, 'utf8'), `${second}\n`);

    await assert.rejects(
      capture.capture(second),
      /desktop-external-url-capture-duplicate/u,
    );
  });
});

test('dev-kernel external URL capture requires checkpoint mode and a trial-owned path', async () => {
  await withTrialRoot(async (trialRoot) => {
    const captureFile = path.join(trialRoot, 'capture.txt');
    assert.throws(() => createDevKernelExternalUrlCapture({
      NIMI_DESKTOP_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE: captureFile,
      NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ROOT: trialRoot,
    }), /desktop-external-url-capture-checkpoint-required/u);
    assert.throws(() => createDevKernelExternalUrlCapture(checkpointEnv(
      trialRoot,
      path.join(trialRoot, '..', 'outside.capture'),
    )), /desktop-external-url-capture-path-forbidden/u);
  });
});

test('dev-kernel external URL capture rejects non-Realm origins and paths', () => {
  for (const url of [
    'https://localhost:3002/api/auth/oauth/authorize?state=x',
    'http://127.0.0.1:3002/api/auth/oauth/authorize?state=x',
    'http://localhost:3002/api/auth/token?state=x',
    'http://localhost:3000/api/auth/oauth/authorize?state=x',
    'http://localhost:3002/api/auth/oauth/authorize#fragment',
  ]) {
    assert.throws(() => requireDevKernelAuthorizationUrl(url), /desktop-external-url-capture-url-forbidden/u);
  }
});

test('dev-kernel external URL capture admits Runtime-generated opaque presence purposes', () => {
  const url = new URL(authorizationUrl('state-presenceopaque1'));
  url.searchParams.set('prompt', 'login');
  url.searchParams.set('presence_purpose', 'account_security/session_revoke/evidence_v1_Aa0-_');
  url.searchParams.set('presence_nonce', 'nonce-Aa0_1234567890');
  assert.doesNotThrow(() => requireDevKernelAuthorizationUrl(url.toString()));
});

test('dev-kernel external URL capture rejects incomplete, duplicate, and extended authorization queries', () => {
  for (const url of [
    authorizationUrl('state-cccccccccccccccc').replace('nimi-desktop', 'nimi-runtime'),
    `${authorizationUrl('state-dddddddddddddddd')}&state=duplicate-state-value`,
    `${authorizationUrl('state-eeeeeeeeeeeeeeee')}&untrusted=value`,
    `${authorizationUrl('state-ffffffffffffffff')}&prompt=login`,
    authorizationUrl('state-gggggggggggggggg').replace('49151', '49152'),
  ]) {
    assert.throws(() => requireDevKernelAuthorizationUrl(url), /desktop-external-url-capture-url-forbidden/u);
  }
});

test('dev-kernel external URL capture rejects a pre-existing capture file', async () => {
  await withTrialRoot(async (trialRoot) => {
    const captureFile = path.join(trialRoot, 'capture.txt');
    await writeFile(captureFile, '', { mode: 0o600 });
    const capture = createDevKernelExternalUrlCapture(checkpointEnv(trialRoot, captureFile));
    await assert.rejects(
      capture.capture(VALID_AUTHORIZATION_URL),
      /desktop-external-url-capture-file-not-fresh/u,
    );
  });
});

function authorizationUrl(state: string): string {
  const url = new URL('http://localhost:3002/api/auth/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', 'nimi-desktop');
  url.searchParams.set('redirect_uri', 'http://127.0.0.1:49151/oauth/callback');
  url.searchParams.set('code_challenge', 'a'.repeat(43));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  return url.toString();
}

function checkpointEnv(trialRoot: string, captureFile: string): Record<string, string> {
  return {
    NIMI_DEV_KERNEL_CHECKPOINT: '1',
    NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ROOT: trialRoot,
    NIMI_DESKTOP_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE: captureFile,
  };
}

async function withTrialRoot(operation: (trialRoot: string) => Promise<void>): Promise<void> {
  const trialRoot = await mkdtemp(path.join(os.tmpdir(), 'nimi-external-url-capture-'));
  try {
    await operation(trialRoot);
  } finally {
    await rm(trialRoot, { recursive: true, force: true });
  }
}
