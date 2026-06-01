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

test('desktop bootstrap reads Runtime account projection instead of shared auth-session truth', () => {
  assert.match(runtimeBootstrapSource, /createLocalFirstPartyRuntimePlatformClient\(/);
  assert.match(runtimeBootstrapSource, /runtime\.account\.getAccountSessionStatus\(\{/);
  assert.match(runtimeBootstrapSource, /runtime\.account\.getAccessToken\(\{/);
  assert.doesNotMatch(runtimeBootstrapSource, /accessTokenProvider:/);
  assert.doesNotMatch(runtimeBootstrapSource, /bootstrapAuthSession\(/);
  assert.doesNotMatch(runtimeBootstrapSource, /resolvedBootstrapAuthSession/);
});

test('desktop bootstrap only projects authenticated when Runtime account token custody is usable', () => {
  assert.match(runtimeBootstrapSource, /AccountSessionState\.AUTHENTICATED/);
  assert.match(runtimeBootstrapSource, /accountTokenAvailable = Boolean\(tokenStatus\.accepted && tokenStatus\.accessToken\)/);
  assert.match(
    runtimeBootstrapSource,
    /if \(accountProjection\?\.accountId && accountTokenAvailable\) \{\s*useAppStore\.getState\(\)\.setAuthSession/s,
  );
  assert.match(
    runtimeBootstrapSource,
    /if \(accountProjection\?\.accountId\) \{\s*if \(accountTokenAvailable\) \{\s*await withBootstrapStepTimeout\(\s*'account profile hydrate'/s,
  );
  assert.doesNotMatch(
    runtimeBootstrapSource,
    /if \(accountProjection\?\.accountId\) \{\s*useAppStore\.getState\(\)\.setAuthSession/s,
    'Runtime account projection alone must not mark desktop authenticated',
  );
});

test('retired desktop bootstrap auth helper is hard-blocked', () => {
  assert.match(runtimeBootstrapAuthSource, /RuntimeAccountService owns local account truth/);
  assert.doesNotMatch(runtimeBootstrapAuthSource, /persistSharedDesktopSession/);
  assert.doesNotMatch(runtimeBootstrapAuthSource, /dataSync\.loadCurrentUser/);
});
