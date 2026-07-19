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
  assert.match(runtimeBootstrapSource, /desktopBridge\.getRuntimeAccountSessionStatus\(\)/);
  assert.doesNotMatch(runtimeBootstrapSource, /createNimiDesktopShellRuntimeAccountCaller\(/);
  assert.doesNotMatch(runtimeBootstrapSource, /accountRuntime\.account\.getAccountSessionStatus/);
  assert.doesNotMatch(runtimeBootstrapSource, /getAccessToken|refreshAccountSession/);
  assert.doesNotMatch(runtimeBootstrapSource, /accessTokenProvider:/);
  assert.doesNotMatch(runtimeBootstrapSource, /bootstrapAuthSession\(/);
  assert.doesNotMatch(runtimeBootstrapSource, /resolvedBootstrapAuthSession/);
  assert.doesNotMatch(runtimeBootstrapSource, /createLocalFirstPartyRuntimePlatformClient\(/);
});

test('desktop bootstrap projects authenticated state from Runtime account truth without raw token access', () => {
  assert.ok(
    runtimeBootstrapSource.includes("accountStatus?.state === 'authenticated'"),
    'authenticated renderer state must come from the exact protected account status projection',
  );
  assert.match(
    runtimeBootstrapSource,
    /if \(accountStatus\?\.state === 'authenticated' && accountProjection\?\.accountId\) \{\s*await withBootstrapStepTimeout\(\s*'account profile hydrate'/s,
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
  assert.match(
    desktopSessionSource,
    /createRuntimeAccountMediatedDesktopSourceReadinessRealmTransport\(\{/,
  );
  assert.doesNotMatch(desktopSessionSource, /createRealmWithRuntimeAccountToken|getAccessToken|refreshAccountSession/);
  assert.match(sdkRuntimeAccountRealmSource, /input\.runtime\.account\.invokeRealmUnary\(\{/);
  assert.doesNotMatch(sdkRuntimeAccountRealmSource, /refreshAccountSession/);
});

test('desktop bootstrap projects protected account unavailability independently from generic Runtime readiness', () => {
  assert.doesNotMatch(runtimeBootstrapSource, /configureDesktopRealmOnlySession/);
  const firstRuntimeUnavailableBranch = runtimeBootstrapSource.indexOf('if (runtimeUnavailable) {');
  const runtimeAccountStatusIndex = runtimeBootstrapSource.indexOf(
    'desktopBridge.getRuntimeAccountSessionStatus',
  );

  assert.notEqual(firstRuntimeUnavailableBranch, -1);
  assert.notEqual(runtimeAccountStatusIndex, -1);
  assert.ok(
    runtimeAccountStatusIndex < firstRuntimeUnavailableBranch,
    'exact native account status must be read before generic Runtime unavailable handling',
  );
  assert.match(runtimeBootstrapSource, /applyRuntimeAccountUnavailableProjection\(\);/);
  assert.doesNotMatch(runtimeBootstrapSource, /if \(!runtimeUnavailable\) \{\s*throw error;/);
  assert.match(runtimeBootstrapSource, /phase:protected-account-status:unavailable/);
  assert.doesNotMatch(runtimeBootstrapSource, /getAccessToken|refreshAccountSession|accessTokenProvider:/);
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

test('desktop Runtime session uses the host carrier without renderer-held authorization material', () => {
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
  assert.doesNotMatch(desktopSessionSource, /createNimiRuntimeFullAppRegistration|registerApp\(/);
  assert.match(desktopSessionSource, /from ['"]\.\.\/\.\.\/\.\.\/shared\/runtime-account-contract/u);
  assert.match(desktopSessionSource, /session\.runtimeTransport\.type === 'electron-ipc'/);
  assert.match(desktopSessionSource, /return \{\};/);
  assert.match(desktopSessionSource, /SDK_RUNTIME_AGENT_SCOPED_CARRIER_REQUIRED/);
  const protectedCarrierSection = desktopSessionSource.slice(
    desktopSessionSource.indexOf('async function getDesktopRuntimeProtectedAccessCallOptions'),
    desktopSessionSource.indexOf('export function installRealmProjectionSession'),
  );
  assert.doesNotMatch(protectedCarrierSection, /accountRuntime\.grants\./);
  assert.doesNotMatch(protectedCarrierSection, /x-nimi-access-token|tokenId|tokenSecret|sessionProof|bearer/i);
  assert.doesNotMatch(desktopSessionSource, /buildDesktopRuntimeProtectedScopeSignature|DESKTOP_RUNTIME_PROTECTED_SCOPE_SIGNATURE/u);
  assert.doesNotMatch(desktopSessionSource, /createNimiRuntimeAppSessionMetadataProvider/);
  assert.doesNotMatch(
    desktopSessionSource,
    /readonly\s+(?:accessToken|refreshToken)|authorization:\s*`Bearer|loginNimiRealmAuthPassword|createRealmFetchTransport/i,
  );
});

test('retired desktop bootstrap auth helper is deleted', () => {
  assert.equal(existsSync(retiredRuntimeBootstrapAuthUrl), false);
  assert.doesNotMatch(runtimeBootstrapSource, /runtime-bootstrap-auth/);
});
