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
  assert.doesNotMatch(runtimeBootstrapSource, /getAccessToken|refreshAccountSession/);
  assert.doesNotMatch(runtimeBootstrapSource, /accessTokenProvider:/);
  assert.doesNotMatch(runtimeBootstrapSource, /bootstrapAuthSession\(/);
  assert.doesNotMatch(runtimeBootstrapSource, /resolvedBootstrapAuthSession/);
  assert.doesNotMatch(runtimeBootstrapSource, /createLocalFirstPartyRuntimePlatformClient\(/);
});

test('desktop bootstrap projects authenticated state from Runtime account truth without raw token access', () => {
  assert.match(runtimeBootstrapSource, /AccountSessionState\.AUTHENTICATED/);
  assert.match(
    runtimeBootstrapSource,
    /accountStatus\.state === AccountSessionState\.AUTHENTICATED\s*&& accountProjection\?\.accountId/s,
  );
  assert.match(
    runtimeBootstrapSource,
    /if \(accountProjection\?\.accountId\) \{\s*await withBootstrapStepTimeout\(\s*'account profile hydrate'/s,
  );
  assert.doesNotMatch(runtimeBootstrapSource, /accountTokenAvailable|tokenStatus/);
});

test('desktop Realm transport is Runtime-mediated and never calls public token refresh', () => {
  const desktopSessionSource = readFileSync(
    new URL('../src/shell/renderer/infra/sdk/desktop-nimi-client-session.ts', import.meta.url),
    'utf8',
  );
  const sdkRuntimeAccountRealmSource = readFileSync(
    new URL('../../../sdks/typescript/core/app/runtime-account-realm.ts', import.meta.url),
    'utf8',
  );
  assert.match(desktopSessionSource, /from '@nimiplatform\/sdk\/app'/);
  assert.match(desktopSessionSource, /createRuntimeAccountMediatedRealmTransport\(\{/);
  assert.doesNotMatch(desktopSessionSource, /createRealmWithRuntimeAccountToken|getAccessToken|refreshAccountSession/);
  assert.match(sdkRuntimeAccountRealmSource, /input\.runtime\.account\.invokeRealmUnary\(\{/);
  assert.doesNotMatch(sdkRuntimeAccountRealmSource, /refreshAccountSession/);
});

test('desktop bootstrap fails closed without a Realm-only token fallback when Runtime is unavailable', () => {
  assert.doesNotMatch(runtimeBootstrapSource, /configureDesktopRealmOnlySession/);
  const firstRuntimeUnavailableBranch = runtimeBootstrapSource.indexOf('if (runtimeUnavailable) {');
  const runtimeAccountStatusIndex = runtimeBootstrapSource.indexOf(
    'desktopSession.accountRuntime.account.getAccountSessionStatus',
  );

  assert.notEqual(firstRuntimeUnavailableBranch, -1);
  assert.notEqual(runtimeAccountStatusIndex, -1);
  assert.ok(
    firstRuntimeUnavailableBranch < runtimeAccountStatusIndex,
    'Runtime-unavailable bootstrap must take the fail-closed branch before Runtime account reads',
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
  assert.match(desktopSessionSource, /capabilities: \[\.{3}DESKTOP_RUNTIME_REGISTRATION_CAPABILITIES\]/);
  assert.match(desktopSessionSource, /accountRuntime\.grants\.authorizeExternalPrincipal\(/);
  assert.match(desktopSessionSource, /from ['"]\.\.\/\.\.\/\.\.\/shared\/runtime-account-contract/u);
  assert.match(desktopSessionSource, /scopeCatalogVersion: DESKTOP_RUNTIME_PROTECTED_SCOPE_CATALOG_VERSION/);
  assert.doesNotMatch(desktopSessionSource, /function buildDesktopRuntimeProtectedScopeSignature/u);
  assert.match(desktopSessionSource, /consentVersion: DESKTOP_RUNTIME_PROTECTED_AUTHORIZATION_VERSION/);
  assert.match(desktopSessionSource, /policyVersion: DESKTOP_RUNTIME_PROTECTED_AUTHORIZATION_VERSION/);
  assert.match(desktopSessionSource, /createNimiClientId\(`desktop-runtime-protected-access-\$\{DESKTOP_RUNTIME_PROTECTED_SCOPE_SIGNATURE\}`\)/);
  assert.match(desktopSessionSource, /'x-nimi-access-token-id': tokenId/);
  assert.match(desktopSessionSource, /'x-nimi-access-token-secret': secret/);
  assert.doesNotMatch(desktopSessionSource, /createNimiRuntimeAppSessionMetadataProvider/);
});

test('retired desktop bootstrap auth helper is deleted', () => {
  assert.equal(existsSync(retiredRuntimeBootstrapAuthUrl), false);
  assert.doesNotMatch(runtimeBootstrapSource, /runtime-bootstrap-auth/);
});
