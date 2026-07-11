import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  isExpectedUnauthorizedAutoLogin,
  rebootstrapRuntime,
  withTimeout,
} from '../src/desktop-adapter/runtime-bootstrap.web.js';

const runtimeBootstrapWebSource = readFileSync(
  new URL('../src/desktop-adapter/runtime-bootstrap.web.ts', import.meta.url),
  'utf8',
);

test('runtime-bootstrap.web detects unauthorized auto-login errors', () => {
  assert.equal(isExpectedUnauthorizedAutoLogin(new Error('HTTP_401 token expired')), true);
  assert.equal(isExpectedUnauthorizedAutoLogin(new Error('request unauthorized by policy')), true);
  assert.equal(isExpectedUnauthorizedAutoLogin(new Error('network timeout')), false);
});

test('runtime-bootstrap.web withTimeout resolves and times out deterministically', async () => {
  const resolved = await withTimeout(Promise.resolve('ok'), 20, 'fast-path');
  assert.equal(resolved, 'ok');

  await assert.rejects(
    async () => withTimeout(new Promise<void>(() => {}), 10, 'timeout-branch'),
    /timeout-branch timeout after 10ms/,
  );
});

test('runtime-bootstrap.web exports rebootstrapRuntime for desktop renderer parity', () => {
  assert.equal(typeof rebootstrapRuntime, 'function');
  assert.match(runtimeBootstrapWebSource, /export function rebootstrapRuntime\(\): Promise<void>/);
  assert.match(runtimeBootstrapWebSource, /bootstrapPromise = null;\s*return bootstrapRuntime\(\);/);
});

test('runtime-bootstrap.web defers chat and contact hydration until UI demand', () => {
  const bootstrapAuthSessionSection = runtimeBootstrapWebSource.slice(
    runtimeBootstrapWebSource.indexOf('async function bootstrapAuthSession'),
    runtimeBootstrapWebSource.indexOf('export function bootstrapRuntime()'),
  );

  assert.doesNotMatch(bootstrapAuthSessionSection, /deps\.dataSync\.loadChats\(\)/);
  assert.doesNotMatch(bootstrapAuthSessionSection, /deps\.dataSync\.loadContacts\(\)/);
});

test('runtime-bootstrap.web does not admit browser environment bearer tokens', () => {
  assert.doesNotMatch(runtimeBootstrapWebSource, /loadPersistedAuthSession/);
  assert.doesNotMatch(runtimeBootstrapWebSource, /type AuthSessionSnapshot/);
  assert.doesNotMatch(runtimeBootstrapWebSource, /hasAuthenticatedSnapshot/);
  assert.doesNotMatch(runtimeBootstrapWebSource, /fallbackToken/);
  assert.doesNotMatch(runtimeBootstrapWebSource, /envAccessToken|defaults\.realm\.accessToken|VITE_NIMI_ACCESS_TOKEN/);
});

// Wave C hard-cut lock — apps/web no longer participates in the desktop login
// critical path. The realm OAuth authority 302-redirects directly to the
// desktop loopback (R-OAUTH-* / spec K-ACCSVC-008), so a `?desktop_callback=`
// URL never lands on apps/web. Any reintroduction of `hasDesktopCallbackRequestInLocation`
// import or `preservePersistedAuthSession = …` derivation must fail this test.
test('runtime-bootstrap.web does not import the legacy desktop_callback URL detector', () => {
  assert.doesNotMatch(runtimeBootstrapWebSource, /hasDesktopCallbackRequestInLocation/);
});

test('runtime-bootstrap.web does not derive preservePersistedAuthSession from desktop_callback URL', () => {
  assert.doesNotMatch(
    runtimeBootstrapWebSource,
    /preservePersistedAuthSession\s*=\s*deps\.hasDesktopCallbackRequestInLocation\(\)/,
  );
});
