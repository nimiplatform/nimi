import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const retiredRuntimeBootstrapAuthUrl = new URL(
  '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-auth.ts',
  import.meta.url,
);

const runtimeBootstrapSource = readFileSync(
  new URL('../src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts', import.meta.url),
  'utf8',
);

test('desktop bootstrap reads Runtime account projection instead of shared auth-session truth', () => {
  assert.match(runtimeBootstrapSource, /configureDesktopRuntimeRealmSession\(/);
  assert.match(runtimeBootstrapSource, /createNimiDesktopShellRuntimeAccountCaller\(/);
  assert.match(runtimeBootstrapSource, /desktopSession\.accountRuntime\.account\.getAccountSessionStatus\(\{/);
  assert.match(runtimeBootstrapSource, /desktopSession\.accountRuntime\.account\.getAccessToken\(\{/);
  assert.doesNotMatch(runtimeBootstrapSource, /accessTokenProvider:/);
  assert.doesNotMatch(runtimeBootstrapSource, /bootstrapAuthSession\(/);
  assert.doesNotMatch(runtimeBootstrapSource, /resolvedBootstrapAuthSession/);
  assert.doesNotMatch(runtimeBootstrapSource, /createLocalFirstPartyRuntimePlatformClient\(/);
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

test('desktop Realm transport refreshes Runtime account token once on Realm 401', () => {
  const desktopSessionSource = readFileSync(
    new URL('../src/shell/renderer/infra/sdk/desktop-nimi-client-session.ts', import.meta.url),
    'utf8',
  );
  assert.match(desktopSessionSource, /function createRuntimeAccountRefreshingRealmFetch/);
  assert.match(desktopSessionSource, /if \(response\.status !== 401\) \{\s*return response;\s*\}/s);
  assert.match(desktopSessionSource, /input\.runtime\.account\.refreshAccountSession\(\{\s*caller: input\.accountCaller,\s*\}\)/s);
  assert.match(desktopSessionSource, /input\.runtime\.account\.getAccessToken\(\{\s*caller: input\.accountCaller,\s*requestedScopes: \[\],\s*\}\)/s);
  assert.match(desktopSessionSource, /return input\.fetchImpl\(request, retryInit\);/);
});

test('retired desktop bootstrap auth helper is deleted', () => {
  assert.equal(existsSync(retiredRuntimeBootstrapAuthUrl), false);
  assert.doesNotMatch(runtimeBootstrapSource, /runtime-bootstrap-auth/);
});
