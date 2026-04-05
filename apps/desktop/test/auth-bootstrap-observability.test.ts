import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const runtimeBootstrapSource = readFileSync(
  new URL('../src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts', import.meta.url),
  'utf8',
);

const runtimeBootstrapAuthSource = readFileSync(
  new URL('../src/shell/renderer/infra/bootstrap/runtime-bootstrap-auth.ts', import.meta.url),
  'utf8',
);

test('desktop bootstrap logs shared auth-session resolution before auto-login runs', () => {
  assert.match(runtimeBootstrapSource, /message: 'phase:bootstrap-auth-session:resolved'/);
  assert.match(runtimeBootstrapSource, /resolution: resolvedBootstrapAuthSession\.resolution/);
  assert.match(runtimeBootstrapSource, /shouldClearPersistedSession: resolvedBootstrapAuthSession\.shouldClearPersistedSession/);
  assert.match(runtimeBootstrapSource, /hasAccessToken: Boolean\(String\(resolvedBootstrapAuthSession\.session\?\.accessToken \|\| ''\)\.trim\(\)\)/);
});

test('desktop bootstrap auth logs missing-token skip reason instead of silently clearing auth', () => {
  assert.match(runtimeBootstrapAuthSource, /message: 'phase:auto-login:skipped'/);
  assert.match(runtimeBootstrapAuthSource, /reason: 'missing-token'/);
  assert.match(runtimeBootstrapAuthSource, /resolution: input\.resolution \|\| 'unknown'/);
  assert.doesNotMatch(
    runtimeBootstrapAuthSource,
    /if \(!envToken\) \{\s*useAppStore\.getState\(\)\.clearAuthSession\(\);\s*return;\s*\}/,
  );
});
