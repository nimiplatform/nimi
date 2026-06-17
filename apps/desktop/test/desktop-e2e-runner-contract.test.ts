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
const desktopE2eFixtureEnabledSource = fs.readFileSync(
  path.join(root, 'src-tauri/src/desktop_e2e_fixture/enabled.rs'),
  'utf8',
);
const desktopE2eFixtureDisabledSource = fs.readFileSync(
  path.join(root, 'src-tauri/src/desktop_e2e_fixture/disabled.rs'),
  'utf8',
);
const desktopE2eFixtureRuntimeAppSource = fs.readFileSync(
  path.join(root, 'src-tauri/src/desktop_e2e_fixture/runtime_app.rs'),
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
const chatMemoryStandardBindSpecSource = fs.readFileSync(
  path.join(root, 'e2e/specs/chat.memory-standard-bind.e2e.mjs'),
  'utf8',
);
const chatLive2dRenderSmokeSpecSource = fs.readFileSync(
  path.join(root, 'e2e/specs/chat.live2d-render-smoke.e2e.mjs'),
  'utf8',
);
const wdioConfigSource = fs.readFileSync(
  path.join(root, 'wdio.conf.mjs'),
  'utf8',
);

test('desktop E2E runner resolves native WebDriver command names to executable paths', () => {
  assert.match(runnerSource, /function resolveNativeDriverPath\(nativeDriver\)/);
  assert.match(runnerSource, /os\.platform\(\) === 'win32' \? 'where\.exe' : 'which'/);
  assert.match(runnerSource, /const nativeDriver = await resolveNativeDriverPath\(process\.env\.NIMI_E2E_NATIVE_DRIVER\);/);
});

test('desktop E2E runner provisions matching Edge WebDriver on Windows by default', () => {
  assert.match(runnerSource, /async function ensureWindowsEdgeDriverPath\(\)/);
  assert.match(runnerSource, /resolveCommandPath\('msedgedriver\.exe'\)/);
  assert.match(runnerSource, /function resolveWindowsEdgeVersion\(\)/);
  assert.match(runnerSource, /apps\/desktop\/\.cache\/tools\/msedgedriver/);
  assert.match(runnerSource, /https:\/\/msedgedriver\.microsoft\.com\/\$\{version\}\/edgedriver_win64\.zip/);
  assert.match(runnerSource, /failed to download Edge WebDriver/);
  assert.match(runnerSource, /Expand-Archive -LiteralPath/);
  assert.match(runnerSource, /set NIMI_E2E_NATIVE_DRIVER to a compatible native WebDriver binary/);
});

test('desktop E2E runner isolates WebDriver ports per scenario', () => {
  assert.match(runnerSource, /async function resolveDriverPorts\(host\)/);
  assert.match(runnerSource, /NIMI_E2E_NATIVE_DRIVER_PORT/);
  assert.match(runnerSource, /findFreePort\(host, new Set\(\[driverPort\]\)\)/);
  assert.match(runnerSource, /tauri-driver port and native WebDriver port must differ/);
  assert.match(runnerSource, /'--port',\s*String\(driverPort\),\s*'--native-port',\s*String\(nativeDriverPort\)/);
  assert.match(runnerSource, /driver_port: driverPort/);
  assert.match(runnerSource, /native_driver_port: nativeDriverPort/);
  assert.match(runnerSource, /waitForPortClosed\(driverHost, driverPort, 10000\)/);
  assert.match(runnerSource, /waitForPortClosed\(driverHost, nativeDriverPort, 10000\)/);
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
  assert.match(runnerSource, /waitForPortClosed\(driverHost, nativeDriverPort, 10000\)/);
});

test('desktop E2E chat scenarios target canonical local-agent anchors', () => {
  assert.match(chatMemoryStandardBindSpecSource, /E2E_IDS\.localAgentRef\('user-e2e-primary', 'agent-e2e-alpha'\)/);
  assert.match(chatLive2dRenderSmokeSpecSource, /E2E_IDS\.localAgentRef\('user-e2e-primary', 'agent-e2e-alpha'\)/);
  assert.doesNotMatch(chatMemoryStandardBindSpecSource, /chatTarget\('agent-e2e-alpha'\)/);
  assert.doesNotMatch(chatLive2dRenderSmokeSpecSource, /chatTarget\('agent-e2e-alpha'\)/);
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
  assert.match(offlineRecoverySpecSource, /clickByTestId\(E2E_IDS\.navTab\('explore'\)\)/);
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

test('desktop E2E runner builds the fixture surface only through an explicit Cargo feature', () => {
  assert.match(runnerSource, /'--features',\s*'desktop-e2e-fixture'/);
});

test('desktop E2E runner launches WDIO from the desktop package dependency context', () => {
  assert.match(runnerSource, /'--filter',\s*'@nimiplatform\/desktop',\s*'exec',\s*'wdio'/);
  assert.match(runnerSource, /const desktopSpecPath = path\.relative\(desktopRoot, path\.join\(repoRoot, scenario\.spec\)\);/);
  assert.match(runnerSource, /'wdio\.conf\.mjs'/);
  assert.match(runnerSource, /desktopSpecPath/);
  assert.match(wdioConfigSource, /specs:\s*\['e2e\/specs\/\*\*\/\*\.e2e\.mjs'\]/);
});

test('desktop E2E failOnConsoleError treats browser severe logs as failures', () => {
  assert.match(wdioConfigSource, /function loadArtifactPolicy\(\)/);
  assert.match(wdioConfigSource, /process\.env\.NIMI_E2E_ARTIFACT_MANIFEST/);
  assert.match(wdioConfigSource, /browserLogs = await browser\.getLogs\('browser'\)/);
  assert.match(wdioConfigSource, /String\(entry\.level \|\| ''\)\.toUpperCase\(\) === 'SEVERE'/);
  assert.match(wdioConfigSource, /artifactPolicy\.failOnConsoleError === true/);
  assert.match(wdioConfigSource, /browser severe logs detected/);
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

test('desktop E2E fixture Runtime overrides are test-feature gated and production no-op', () => {
  assert.match(desktopE2eFixtureSource, /#\[cfg\(any\(test, feature = "desktop-e2e-fixture"\)\)\][\s\S]*#\[path = "desktop_e2e_fixture\/enabled\.rs"\][\s\S]*mod enabled/);
  assert.match(desktopE2eFixtureSource, /#\[cfg\(not\(any\(test, feature = "desktop-e2e-fixture"\)\)\)\][\s\S]*(?:#\[allow\(dead_code\)\][\s\S]*)?#\[path = "desktop_e2e_fixture\/disabled\.rs"\][\s\S]*mod disabled/);
  assert.match(desktopE2eFixtureEnabledSource, /RUNTIME_ACCOUNT_GET_ACCOUNT_SESSION_STATUS_METHOD_ID/);
  assert.match(desktopE2eFixtureEnabledSource, /RUNTIME_ACCOUNT_GET_ACCESS_TOKEN_METHOD_ID/);
  assert.match(desktopE2eFixtureRuntimeAppSource, /AccountSessionState::Authenticated as i32/);
  assert.match(desktopE2eFixtureDisabledSource, /pub fn runtime_bridge_unary_override\([\s\S]*?Ok\(None\)/);
});
