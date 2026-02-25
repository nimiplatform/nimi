import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isExpectedUnauthorizedAutoLogin,
  withTimeout,
} from '../src/desktop-adapter/runtime-bootstrap.web.js';

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
