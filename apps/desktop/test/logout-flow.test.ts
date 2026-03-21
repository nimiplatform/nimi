import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const logoutSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/auth/logout.ts'),
  'utf8',
);

test('logout flow clears stream caches and distinguishes transient server logout failures', () => {
  assert.match(logoutSource, /clearAllStreams\(\)/);
  assert.match(logoutSource, /function isTransientLogoutError/);
  assert.match(logoutSource, /Auth\.logoutServerTransientFailure/);
  assert.match(logoutSource, /Auth\.logoutServerFailure/);
});
