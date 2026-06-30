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
const runtimeDaemonSource = readFileSync(
  new URL('../src/shell/renderer/bridge/runtime-bridge/runtime-daemon.ts', import.meta.url),
  'utf8',
);
const runtimeAccountContractSource = readFileSync(
  new URL('../src/shell/shared/runtime-account-contract.ts', import.meta.url),
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
  const sdkRuntimeAccountRealmSource = readFileSync(
    new URL('../../../sdks/typescript/core/app/runtime-account-realm.ts', import.meta.url),
    'utf8',
  );
  assert.match(desktopSessionSource, /from '@nimiplatform\/sdk\/app'/);
  assert.match(desktopSessionSource, /createRealmWithRuntimeAccountToken\(\{/);
  assert.doesNotMatch(desktopSessionSource, /function createRuntimeAccountRefreshingRealmFetch/);
  assert.match(sdkRuntimeAccountRealmSource, /function createRuntimeAccountRefreshingRealmFetch/);
  assert.match(sdkRuntimeAccountRealmSource, /if \(response\.status !== 401\) \{\s*return response;\s*\}/s);
  assert.match(sdkRuntimeAccountRealmSource, /input\.runtime\.account\.refreshAccountSession\(\{\s*caller: input\.accountCaller,\s*\}\)/s);
  assert.match(sdkRuntimeAccountRealmSource, /input\.runtime\.account\.getAccessToken\(\{\s*caller: input\.accountCaller,\s*requestedScopes: \[\],\s*\}\)/s);
  assert.match(sdkRuntimeAccountRealmSource, /return fetchImpl\(request, retryInit\);/);
});

test('desktop bootstrap enters Realm-only strip mode before Runtime account reads when Runtime is unavailable', () => {
  assert.match(runtimeBootstrapSource, /configureDesktopRealmOnlySession/);
  const firstRuntimeUnavailableBranch = runtimeBootstrapSource.indexOf('if (runtimeUnavailable) {');
  const realmOnlyIndex = runtimeBootstrapSource.indexOf('configureDesktopRealmOnlySession', firstRuntimeUnavailableBranch);
  const runtimeAccountStatusIndex = runtimeBootstrapSource.indexOf(
    'desktopSession.accountRuntime.account.getAccountSessionStatus',
  );

  assert.notEqual(firstRuntimeUnavailableBranch, -1);
  assert.notEqual(realmOnlyIndex, -1);
  assert.notEqual(runtimeAccountStatusIndex, -1);
  assert.ok(
    realmOnlyIndex < runtimeAccountStatusIndex,
    'Runtime-unavailable bootstrap must not call Runtime account APIs before the Realm-only strip path',
  );
});

test('desktop renderer daemon status uses the host-neutral shell status surface', () => {
  assert.match(runtimeDaemonSource, /hasShellHostInvoke/);
  assert.match(runtimeDaemonSource, /getDaemonStatus\(\)/);
  assert.match(runtimeDaemonSource, /electron-runtime-endpoint-unavailable|external-daemon-required/);
  assert.doesNotMatch(
    runtimeDaemonSource,
    /if \(!hasTauriInvoke\(\)\) \{\s*return tauriUnavailableStatus\(\);/s,
  );
});

test('desktop Runtime session carries protected execution and Runtime Agent access metadata', () => {
  const desktopSessionSource = readFileSync(
    new URL('../src/shell/renderer/infra/sdk/desktop-nimi-client-session.ts', import.meta.url),
    'utf8',
  );
  assert.match(runtimeAccountContractSource, /'ai\.spend\.meter'/);
  assert.match(runtimeAccountContractSource, /'runtime\.agent\.admin'/);
  assert.match(runtimeAccountContractSource, /'runtime\.agent\.read'/);
  assert.match(runtimeAccountContractSource, /'runtime\.agent\.write'/);
  assert.match(runtimeAccountContractSource, /'runtime\.agent\.turn\.read'/);
  assert.match(runtimeAccountContractSource, /'runtime\.agent\.turn\.write'/);
  assert.match(desktopSessionSource, /withDesktopRuntimeProtectedScopes/);
  assert.match(desktopSessionSource, /assertDesktopProtectedScopes\(requestedScopes\)/);
  assert.match(desktopSessionSource, /capabilities: \[\.{3}DESKTOP_RUNTIME_PROTECTED_SCOPES\]/);
  assert.match(desktopSessionSource, /accountRuntime\.grants\.authorizeExternalPrincipal\(/);
  assert.match(desktopSessionSource, /from ['"]\.\.\/\.\.\/\.\.\/shared\/runtime-account-contract/u);
  assert.match(desktopSessionSource, /scopeCatalogVersion: DESKTOP_RUNTIME_PROTECTED_SCOPE_CATALOG_VERSION/);
  assert.doesNotMatch(desktopSessionSource, /function buildDesktopRuntimeProtectedScopeSignature/u);
  assert.match(desktopSessionSource, /consentVersion: DESKTOP_RUNTIME_PROTECTED_AUTHORIZATION_VERSION/);
  assert.match(desktopSessionSource, /policyVersion: DESKTOP_RUNTIME_PROTECTED_AUTHORIZATION_VERSION/);
  assert.match(desktopSessionSource, /createNimiClientId\(`desktop-runtime-protected-access-\$\{DESKTOP_RUNTIME_PROTECTED_SCOPE_SIGNATURE\}`\)/);
  assert.match(desktopSessionSource, /'x-nimi-access-token-id': tokenId/);
  assert.match(desktopSessionSource, /'x-nimi-access-token-secret': secret/);
  assert.match(desktopSessionSource, /\.\.\.appSessionMetadata,[\s\S]*\.\.\.protectedAccessMetadata/);
});

test('retired desktop bootstrap auth helper is deleted', () => {
  assert.equal(existsSync(retiredRuntimeBootstrapAuthUrl), false);
  assert.doesNotMatch(runtimeBootstrapSource, /runtime-bootstrap-auth/);
});
