import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runnerSource = fs.readFileSync(
  path.join(root, 'scripts/run-e2e.mjs'),
  'utf8',
);
const runtimeUnavailableSpecSource = fs.readFileSync(
  path.join(root, 'e2e/specs/boot.runtime-unavailable.degraded-shell.e2e.mjs'),
  'utf8',
);
const offlineRecoverySpecSource = fs.readFileSync(
  path.join(root, 'e2e/specs/offline.banner-and-recovery.e2e.mjs'),
  'utf8',
);
const offlineRecoveryProfile = JSON.parse(fs.readFileSync(
  path.join(root, 'e2e/fixtures/profiles/offline.banner-and-recovery.json'),
  'utf8',
));
const authenticatedBootSpecSource = fs.readFileSync(
  path.join(root, 'e2e/specs/boot.authenticated.main-shell.e2e.mjs'),
  'utf8',
);
const shellNavigationSpecSource = fs.readFileSync(
  path.join(root, 'e2e/specs/shell.core-navigation.e2e.mjs'),
  'utf8',
);
const desktopE2eFixtureSource = fs.readFileSync(
  path.join(root, 'src-tauri/src/desktop_e2e_fixture.rs'),
  'utf8',
);
const tauriHttpEnvSource = fs.readFileSync(
  path.join(root, 'src-tauri/src/main_parts/env_http.rs'),
  'utf8',
);
const realmFixtureServerSource = fs.readFileSync(
  path.join(root, 'e2e/fixtures/realm-fixture-server.mjs'),
  'utf8',
);

test('desktop E2E runner resolves native WebDriver command names to executable paths', () => {
  assert.match(runnerSource, /function resolveNativeDriverPath\(nativeDriver\)/);
  assert.match(runnerSource, /os\.platform\(\) === 'win32' \? 'where\.exe' : 'which'/);
  assert.match(runnerSource, /const nativeDriver = resolveNativeDriverPath\(process\.env\.NIMI_E2E_NATIVE_DRIVER\);/);
});

test('desktop E2E runner fails fast when tauri-driver exits before opening the WebDriver port', () => {
  assert.match(runnerSource, /let driverExit = null;/);
  assert.match(runnerSource, /tauri-driver exited before opening/);
  assert.match(runnerSource, /see \$\{path\.join\(artifactsDir, 'tauri-driver\.log'\)\}/);
});

test('desktop E2E runner tears down native WebDriver process trees between scenarios', () => {
  assert.match(runnerSource, /async function terminateProcessTree\(child\)/);
  assert.match(runnerSource, /taskkill\.exe/);
  assert.match(runnerSource, /waitForPortClosed\(driverHost, driverPort, 10000\)/);
});

test('runtime-unavailable boot smoke targets the canonical desktop release strip', () => {
  assert.match(runtimeUnavailableSpecSource, /E2E_IDS\.desktopReleaseStrip/);
  assert.doesNotMatch(runtimeUnavailableSpecSource, /E2E_IDS\.offlineStrip/);
});

test('offline recovery smoke targets Realm REST reachability, not runtime release readiness', () => {
  assert.equal(offlineRecoveryProfile.realmFixture?.restOnline, false);
  assert.equal(offlineRecoveryProfile.tauriFixture, undefined);
  assert.match(runnerSource, /const fixtureServer = await startRealmFixtureServer/);
  assert.match(runnerSource, /fixtureOrigin: fixtureServer\.origin/);
  assert.match(offlineRecoverySpecSource, /clickByTestId\(E2E_IDS\.navTab\('contacts'\)\)/);
  assert.match(offlineRecoverySpecSource, /updateRealmRestOnline\(true\)/);
  assert.doesNotMatch(offlineRecoverySpecSource, /updateRuntimeBridgeStatus/);
  assert.match(realmFixtureServerSource, /reasonCode:\s*ReasonCode\.REALM_UNAVAILABLE/);
  assert.match(realmFixtureServerSource, /actionHint:\s*'retry_realm_request'/);
});

test('desktop E2E fixture Realm origin is admitted by the packaged HTTP bridge allowlist', () => {
  assert.match(tauriHttpEnvSource, /crate::desktop_e2e_fixture::runtime_defaults_override\(\)/);
  assert.match(tauriHttpEnvSource, /defaults\.realm\.realm_base_url/);
  assert.match(tauriHttpEnvSource, /defaults\.realm\.jwks_url/);
  assert.match(tauriHttpEnvSource, /defaults\.realm\.revocation_url/);
  assert.match(tauriHttpEnvSource, /defaults\.realm\.jwt_issuer/);
});

test('authenticated desktop boot smoke fails closed on missing account projection', () => {
  assert.match(authenticatedBootSpecSource, /E2E_IDS\.shellSidebarRail/);
  assert.match(authenticatedBootSpecSource, /E2E_IDS\.navTab\('home'\)/);
  assert.match(authenticatedBootSpecSource, /authenticated shell must not render the login action/);
});

test('core navigation smoke waits for the authenticated rail before tab assertions', () => {
  assert.match(shellNavigationSpecSource, /E2E_IDS\.shellSidebarRail/);
  assert.match(shellNavigationSpecSource, /E2E_IDS\.navTab\('home'\)/);
});

test('desktop E2E fixture owns RuntimeAccount projection through runtime bridge unary overrides', () => {
  assert.match(desktopE2eFixtureSource, /RuntimeAccountService\/GetAccountSessionStatus/);
  assert.match(desktopE2eFixtureSource, /RuntimeAccountService\/GetAccessToken/);
  assert.match(desktopE2eFixtureSource, /AccountSessionState::Authenticated/);
  assert.match(desktopE2eFixtureSource, /AccountSessionState::Anonymous/);
});
