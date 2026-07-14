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
const macosSmokeRunnerSource = fs.readFileSync(
  path.join(root, 'scripts/run-macos-smoke.mjs'),
  'utf8',
);
const registrySource = fs.readFileSync(
  path.join(root, 'e2e/helpers/registry.mjs'),
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
const authenticatedBaseProfile = JSON.parse(fs.readFileSync(
  path.join(root, 'e2e/fixtures/profiles/_authenticated-base.json'),
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
const exploreMaterializationRuntimeAgentConfigSource = fs.readFileSync(
  path.join(root, 'scripts/explore-materialization-acceptance/acceptance-runtime-agent-config.mjs'),
  'utf8',
);
const exploreMaterializationAcceptanceConstantsSource = fs.readFileSync(
  path.join(root, 'scripts/explore-materialization-acceptance/acceptance-constants.mjs'),
  'utf8',
);
const exploreMaterializationAcceptanceFixtureSource = fs.readFileSync(
  path.join(root, 'scripts/explore-materialization-acceptance/acceptance-fixture.mjs'),
  'utf8',
);
const wdioConfigSource = fs.readFileSync(
  path.join(root, 'wdio.conf.mjs'),
  'utf8',
);
const electronAcceptanceSource = fs.readFileSync(
  path.join(root, 'test/electron-acceptance.mjs'),
  'utf8',
);
const electronLiveRuntimeAcceptanceSource = fs.readFileSync(
  path.join(root, 'scripts/run-electron-live-runtime-acceptance.mjs'),
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

test('desktop E2E runner resets scenario artifact directories before each run', () => {
  assert.match(runnerSource, /function resetArtifactRoot\(\)/);
  assert.match(runnerSource, /resetArtifactRoot\(\)/);
  assert.match(runnerSource, /function resetArtifactDir\(artifactsDir\)/);
  assert.match(runnerSource, /refusing to reset E2E artifact directory outside/);
  assert.match(runnerSource, /fs\.rmSync\(resolved, \{ recursive: true, force: true \}\)/);
  assert.match(runnerSource, /resetArtifactDir\(artifactsDir\)/);
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

test('desktop E2E hard-cuts retired memory and in-app avatar render journeys', () => {
  assert.doesNotMatch(registrySource, /chat\.memory-standard-bind/);
  assert.doesNotMatch(registrySource, /chat\.live2d-render-smoke/);
  assert.doesNotMatch(registrySource, /chat\.vrm-/);
  assert.equal(fs.existsSync(path.join(root, 'e2e/specs/chat.memory-standard-bind.e2e.mjs')), false);
  assert.equal(fs.existsSync(path.join(root, 'e2e/specs/chat.live2d-render-smoke.e2e.mjs')), false);
  assert.equal(fs.existsSync(path.join(root, 'e2e/fixtures/profiles/chat.memory-standard-bind.json')), false);
});

test('runtime-unavailable boot smoke targets the canonical desktop release strip', () => {
  assert.match(runtimeUnavailableSpecSource, /E2E_IDS\.desktopReleaseStrip/);
  assert.doesNotMatch(runtimeUnavailableSpecSource, /E2E_IDS\.offlineStrip/);
});

test('offline recovery smoke targets Realm REST reachability, not runtime release readiness', () => {
  assert.equal(offlineRecoveryProfile.realmFixture?.restOnline, false);
  assert.equal(offlineRecoveryProfile.tauriFixture, undefined);
  assert.ok(offlineRecoveryProfile.artifactPolicy?.allowedRendererErrorMessages?.includes('action:load-current-user:failed'));
  assert.ok(offlineRecoveryProfile.artifactPolicy?.allowedRendererErrorMessages?.includes('action:load-world-list:failed'));
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

test('desktop E2E runner keeps runner ownership explicit without retired avatar visual smokes', () => {
  assert.match(registrySource, /export const WDIO_RUNNER = 'wdio';/);
  assert.match(registrySource, /export const MACOS_SMOKE_RUNNER = 'macos-smoke';/);
  assert.match(registrySource, /scenarioRunner\(entry\)/);
  assert.match(registrySource, /item\.bucket === 'journeys' && matchesRequestedRunner\(item, options\.runner\)/);
  assert.doesNotMatch(registrySource, /runner: MACOS_SMOKE_RUNNER,\s*profile: 'chat\.live2d/);
  assert.doesNotMatch(registrySource, /runner: MACOS_SMOKE_RUNNER,\s*profile: 'chat\.vrm/);
  assert.match(runnerSource, /function isRunE2eRunner\(entry\)/);
  assert.match(runnerSource, /runner === WDIO_RUNNER \|\| runner === ELECTRON_HOST_RUNNER/);
  assert.match(runnerSource, /selectScenarios\(options\)\.filter/);
  assert.match(runnerSource, /if \(entry && isRunE2eRunner\(entry\)\)/);
  assert.match(runnerSource, /scenario \$\{scenarioId\} is owned by \$\{scenarioRunner\(entry\)\}; use the owning runner/);
  assert.match(runnerSource, /if \(!isWdioScenarioEntry\(scenario\)\)/);
  assert.match(runnerSource, /scenario \$\{scenarioId\} is owned by \$\{scenarioRunner\(scenario\)\}; use scripts\/run-macos-smoke\.mjs/);
  assert.match(macosSmokeRunnerSource, /selectScenarios\(\{ \.\.\.options, runner: MACOS_SMOKE_RUNNER \}\)/);
});

test('desktop E2E failOnConsoleError treats browser severe logs as failures', () => {
  assert.match(wdioConfigSource, /function loadArtifactPolicy\(\)/);
  assert.match(wdioConfigSource, /process\.env\.NIMI_E2E_ARTIFACT_MANIFEST/);
  assert.match(wdioConfigSource, /browserLogs = await browser\.getLogs\('browser'\)/);
  assert.match(wdioConfigSource, /function collectRendererDebugLogs\(\)/);
  assert.match(wdioConfigSource, /renderer-debug\.json/);
  assert.match(wdioConfigSource, /function artifactMessageAllowlist/);
  assert.match(wdioConfigSource, /allowedRendererErrorMessages/);
  assert.match(wdioConfigSource, /unexpectedRendererErrors/);
  assert.match(wdioConfigSource, /String\(entry\.level \|\| ''\)\.toUpperCase\(\) === 'SEVERE'/);
  assert.match(wdioConfigSource, /artifactPolicy\.failOnConsoleError === true/);
  assert.match(wdioConfigSource, /browser severe logs detected/);
});

test('desktop E2E Realm fixture serves public world and source materialization packet contracts', () => {
  assert.match(realmFixtureServerSource, /entityKinds/);
  assert.match(realmFixtureServerSource, /relationshipTypes/);
  assert.match(realmFixtureServerSource, /pathname === '\/api\/realm\/core\/source-materialization-packets'/);
  assert.doesNotMatch(realmFixtureServerSource, new RegExp(`/api/human/${['source', 'connections'].join('-')}`));
  assert.match(realmFixtureServerSource, /runtime-source:\$\{sourceRef\.kind\}/);
});

test('materialization support fixtures retain world-character and Runtime Agent inputs', () => {
  assert.match(exploreMaterializationAcceptanceConstantsSource, /VALID_SOURCE_REF = FIXTURE_SOURCE_REF/);
  assert.match(exploreMaterializationAcceptanceConstantsSource, /source-materialization-packet-v2\.mjs/);
  assert.match(exploreMaterializationAcceptanceConstantsSource, /runtime\.agent\.ai_config\.read/);
  assert.match(exploreMaterializationAcceptanceConstantsSource, /runtime\.agent\.ai_config\.write/);
  assert.match(exploreMaterializationAcceptanceFixtureSource, /characters:\s*\[/);
  assert.match(exploreMaterializationAcceptanceFixtureSource, /profileCoverUrl/);
  assert.match(exploreMaterializationAcceptanceFixtureSource, /referenceImageUrl/);
  assert.match(exploreMaterializationAcceptanceFixtureSource, /voiceSampleUrl/);
  assert.match(exploreMaterializationAcceptanceFixtureSource, /interactionProfile/);
  assert.match(exploreMaterializationAcceptanceFixtureSource, /character-acceptance-disabled-hash/);
  assert.doesNotMatch(exploreMaterializationAcceptanceFixtureSource, /omitContentHash/);
  assert.match(exploreMaterializationRuntimeAgentConfigSource, /agentClient\.agentAIConfig\.get/);
});

test('Desktop Electron acceptance has no environment-activated direct-daemon runner', () => {
  for (const source of [electronAcceptanceSource, electronLiveRuntimeAcceptanceSource]) {
    assert.doesNotMatch(source, /NIMI_RLA_EVIDENCE_ROOT/);
    assert.doesNotMatch(source, /runtime-local-agent-center-runner/);
    assert.doesNotMatch(source, /startRuntimeDaemon/);
  }
});

test('authenticated desktop E2E chat messages use canonical Realm message DTOs', () => {
  const chats = authenticatedBaseProfile.realmFixture?.chats?.items;
  assert.ok(Array.isArray(chats), 'authenticated fixture must include chat rows');
  for (const chat of chats as Array<Record<string, unknown>>) {
    const lastMessage = chat.lastMessage as Record<string, unknown> | null | undefined;
    if (!lastMessage) {
      continue;
    }
    assert.equal(lastMessage.chatId, chat.id);
    assert.equal(lastMessage.type, 'TEXT');
    assert.equal(typeof lastMessage.senderId, 'string');
    assert.equal(typeof lastMessage.createdAt, 'string');
    assert.equal(typeof lastMessage.isRead, 'boolean');
    assert.deepEqual(lastMessage.payload, { content: lastMessage.text });
  }

  const messagesByChatId = authenticatedBaseProfile.realmFixture?.messagesByChatId;
  assert.ok(messagesByChatId && typeof messagesByChatId === 'object');
  for (const [chatId, page] of Object.entries(messagesByChatId)) {
    assert.ok(Array.isArray((page as { items?: unknown[] }).items), `missing message items for ${chatId}`);
    for (const message of (page as { items: Array<Record<string, unknown>> }).items) {
      assert.equal(message.chatId, chatId);
      assert.equal(message.type, 'TEXT');
      assert.equal(typeof message.senderId, 'string');
      assert.equal(typeof message.createdAt, 'string');
      assert.equal(typeof message.isRead, 'boolean');
      assert.deepEqual(message.payload, { content: message.text });
    }
  }
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
  assert.doesNotMatch(desktopE2eFixtureEnabledSource, /RUNTIME_ACCOUNT_GET_ACCESS_TOKEN_METHOD_ID/);
  assert.match(desktopE2eFixtureRuntimeAppSource, /AccountSessionState::Authenticated as i32/);
  assert.match(desktopE2eFixtureDisabledSource, /pub fn runtime_bridge_unary_override\([\s\S]*?Ok\(None\)/);
});
