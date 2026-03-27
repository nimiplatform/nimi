import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  isExpectedUnauthorizedAutoLogin,
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

test('runtime-bootstrap.web defers chat and contact hydration until UI demand', () => {
  const bootstrapAuthSessionSection = runtimeBootstrapWebSource.slice(
    runtimeBootstrapWebSource.indexOf('async function bootstrapAuthSession'),
    runtimeBootstrapWebSource.indexOf('export function bootstrapRuntime()'),
  );

  assert.doesNotMatch(bootstrapAuthSessionSection, /deps\.dataSync\.loadChats\(\)/);
  assert.doesNotMatch(bootstrapAuthSessionSection, /deps\.dataSync\.loadContacts\(\)/);
});

test('runtime-bootstrap.web no longer restores bearer tokens from browser storage', () => {
  assert.doesNotMatch(runtimeBootstrapWebSource, /loadPersistedAccessToken/);
  assert.doesNotMatch(runtimeBootstrapWebSource, /fallbackToken/);
});
