import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const authSource = readFileSync(new URL('../src/shell/auth/runtime-platform.ts', import.meta.url), 'utf8');
const authGateSource = readFileSync(new URL('../src/shell/auth/auth-gate.tsx', import.meta.url), 'utf8');
const runtimeAccountAuthSource = readFileSync(new URL('../src/shell/auth/runtime-account-auth.ts', import.meta.url), 'utf8');
const runtimeTransportSource = readFileSync(new URL('../src/shell/auth/runtime-transport.ts', import.meta.url), 'utf8');
const runtimeLoginSource = readFileSync(new URL('../src/shell/auth/runtime-login-page.tsx', import.meta.url), 'utf8');
const productSource = readFileSync(new URL('../src/shell/routes/product-area.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const tauriMainSource = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
const appSource = [authSource, runtimeLoginSource, productSource].join('\n');
const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');
const admission = readFileSync(new URL('../ADMISSION.md', import.meta.url), 'utf8');

test('auth glue uses app-scoped SDK Runtime developer projections', () => {
  assert.match(authSource, /createNimiClient/);
  assert.match(authSource, /createNimiDeveloperRegisteredRuntimeAccountCaller/);
  assert.match(authSource, /createNimiRuntimeFullAppRegistration/);
  assert.match(authSource, /createNimiRuntimeAppSessionMetadataProvider/);
  assert.doesNotMatch(authSource, /createRealmFetchTransport|getRuntimeDefaults|getAccessToken/);
  assert.match(authSource, /'developer-registered-local-app'/);
  assert.match(authSource, /'third-party-nimi-app'/);
  assert.match(authSource, /getRuntimeNimiClient/);
  assert.match(authSource, /getRuntimeSubjectUserId/);
  assert.match(authSource, /createTesterRuntimeTransportConfig/);
  assert.doesNotMatch(authSource, /type:\s*'tauri-ipc'/);
  assert.doesNotMatch(authSource, /createNimiAppRuntimePlatformClient/);
  assert.doesNotMatch(authSource, /createPlatformClient\s*\(/);
  assert.doesNotMatch(authSource, /getPlatformClient\(/);
});

test('Runtime transport selector supports Electron without spoofing Tauri', () => {
  assert.match(runtimeTransportSource, /hasElectronRuntime/);
  assert.match(runtimeTransportSource, /type:\s*'electron-ipc'/);
  assert.match(runtimeTransportSource, /type:\s*'tauri-ipc'/);
  const electronBranchStart = runtimeTransportSource.indexOf("hostKind === 'electron'");
  const tauriBranchStart = runtimeTransportSource.indexOf("type: 'tauri-ipc'");
  assert.ok(electronBranchStart >= 0, 'runtime transport must branch for Electron');
  assert.ok(tauriBranchStart > electronBranchStart, 'Tauri branch must follow Electron branch');
  const electronBranchSource = runtimeTransportSource.slice(electronBranchStart, tauriBranchStart);
  assert.doesNotMatch(electronBranchSource, /commandNamespace|eventNamespace/);
  assert.match(runtimeTransportSource, /typeof window !== 'undefined'/);
  assert.doesNotMatch(runtimeTransportSource, /__NIMI_TAURI_RUNTIME__\s*=/);
  assert.doesNotMatch(runtimeTransportSource, /__TAURI__\?\.core\?\.invoke/);
});

test('single login model uses Runtime account login without developer-session bypass', () => {
  assert.doesNotMatch(authSource, /VITE_NIMI_RUNTIME_DEVELOPER_SESSION/);
  assert.doesNotMatch(authGateSource, /dev-standalone/);
  assert.doesNotMatch(authGateSource, /runtime-developer-session/);
  assert.match(authSource, /const runtimeDeveloperRegistrationRequested = true/);
  assert.match(authSource, /developerRegistration:\s*runtimeDeveloperRegistrationRequested/);
  assert.match(authSource, /registerDeveloperRegisteredRuntimeAccountCaller/);
  assert.match(authSource, /runtimeProtectedScopes = \['ai\.spend\.meter'\]/);
  assert.match(authSource, /accountRuntime\.grants\.authorizeExternalPrincipal/);
  assert.match(authGateSource, /loadRuntimeAccountUser/);
  assert.match(authGateSource, /clearRuntimePlatformProjection/);
  assert.match(authGateSource, /clearRuntimePlatformProjection\(\);\s*setReloadKey/s);
  assert.match(authSource, /status: 'login-required'/);
  assert.match(authSource, /ACCOUNT_SESSION_NOT_AUTHENTICATED/);
  assert.match(authGateSource, /projection\.status === 'login-required'/);
  assert.match(authGateSource, /<RuntimeLoginPage client=\{state\.projection\.client\}/);
  assert.match(runtimeAccountAuthSource, /createRuntimeAccountBrowserBroker/);
  assert.match(runtimeAccountAuthSource, /from '@nimiplatform\/kit\/auth'/);
  assert.doesNotMatch(runtimeAccountAuthSource, /runtime\.account\.beginLogin\(/);
  assert.doesNotMatch(runtimeAccountAuthSource, /runtime\.account\.completeLogin\(/);
  assert.doesNotMatch(runtimeAccountAuthSource, /desktop-runtime-oauth-url|#\/login|desktop_callback/);
  assert.match(runtimeLoginSource, /DesktopShellAuthPage/);
  assert.match(runtimeLoginSource, /createNimiAppRuntimeAccountBroker\(client\)/);
});

test('renderer bootstrap installs Kit runtime bridge before render', () => {
  assert.match(
    mainSource,
    /import \{[^}]*installNimiShellRuntimeBridge[^}]*\} from '@nimiplatform\/kit\/shell\/renderer\/bridge'/,
  );
  const bootstrapAt = mainSource.indexOf('installNimiShellRuntimeBridge()');
  const renderAt = mainSource.indexOf('.render(');
  assert.ok(bootstrapAt > -1, 'main.tsx must call installNimiShellRuntimeBridge()');
  assert.match(mainSource, /createRendererEntryModuleLoader/);
  assert.match(mainSource, /from '@nimiplatform\/kit\/shell\/renderer\/bootstrap'/);
  assert.ok(renderAt > -1, 'main.tsx must render the app');
  assert.ok(bootstrapAt < renderAt, 'bootstrap must run before render');
  assert.doesNotMatch(mainSource, /__NIMI_TAURI_RUNTIME__/);
  assert.doesNotMatch(mainSource, /Failed to fetch dynamically imported module|Importing a module script failed|function isRetryable/);
});

test('Tauri scaffold consumes Kit shared command registration and renderer probe', () => {
  assert.match(tauriMainSource, /nimi_shell_tauri::nimi_shell_tauri_runtime_bridge_handler!\[/);
  assert.doesNotMatch(tauriMainSource, /@with_runtime_defaults/);
  assert.match(tauriMainSource, /capabilities::diagnostics::build_renderer_entry_probe_script/);
  assert.match(tauriMainSource, /RendererEntryProbeScriptConfig/);
  assert.doesNotMatch(tauriMainSource, /tauri::generate_handler!\[/);
  assert.doesNotMatch(tauriMainSource, /desktop_macos_smoke_ping/);
  assert.doesNotMatch(tauriMainSource, /globalRecord\.__TAURI__\?\.core\?\.invoke/);
});

test('generated shell rejects placeholder and private Desktop imports', () => {
  assert.equal(existsSync(new URL('../src/shell/routes/demo-surfaces.tsx', import.meta.url)), false);
  assert.doesNotMatch(appSource, /Replace this route with app product behavior/);
  assert.doesNotMatch(appSource, /Open product action/);
  assert.doesNotMatch(appSource, /Add app-owned surfaces/);
  assert.doesNotMatch(appSource, /from ['\"]@renderer\//);
  assert.doesNotMatch(appSource, /from ['\"]@runtime\//);
});

test('settings route avoids file directory collisions and keeps relative ESM imports explicit', () => {
  assert.equal(existsSync(new URL('../src/shell/routes/settings.tsx', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/shell/routes/settings-route.tsx', import.meta.url)), true);
  for (const retiredProofFile of [
    '../src/shell/routes/settings/fixtures.ts',
    '../src/shell/routes/settings/runtime-projections.ts',
    '../src/shell/routes/settings/realm-kit-projections.ts',
    '../src/shell/routes/settings/runtime-rows.tsx',
    '../src/shell/routes/settings/sdk-rows.tsx',
  ]) {
    assert.equal(existsSync(new URL(retiredProofFile, import.meta.url)), false);
  }
  const settingsFiles = [
    '../src/shell/routes/settings-route.tsx',
    '../src/shell/routes/settings/realm-rows.tsx',
    '../src/shell/routes/settings/types.ts',
    '../src/shell/routes/settings/view.tsx',
  ];
  for (const file of settingsFiles) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"]\.\.?\/[^'"]+(?<!\.js)['"]/u, `${file} has a relative import without .js`);
    assert.doesNotMatch(source, /import\(['"]\.\.?\/[^'"]+(?<!\.js)['"]\)/u, `${file} has a relative dynamic import without .js`);
  }
});

test('manifest remains submitted input', () => {
  assert.match(manifest, /manifest_role: submitted-input/);
  assert.match(manifest, /declared_nimi_api_scopes/);
  assert.match(manifest, /scope: file\.read\.scoped/);
  assert.match(manifest, /scope: file\.write\.scoped/);
  assert.doesNotMatch(manifest, /scope: app\.local\.drafts/);
});

test('validate script consumes SDK canonical permission scope names', () => {
  const validateSource = readFileSync(new URL('../scripts/validate.mjs', import.meta.url), 'utf8');
  assert.match(validateSource, /from ['"]@nimiplatform\/sdk\/app['"]/);
  assert.match(validateSource, /isCanonicalPermissionScopeName/);
  assert.doesNotMatch(validateSource, /CLOSED_PERMISSION_SCOPES/);
});

test('local audit accepts the monorepo tester reference source without generated scaffold lock', () => {
  const result = spawnSync(process.execPath, ['scripts/local-audit.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /tester-reference source self-check passed/);
});

test('admission request remains submitted input', () => {
  assert.match(admission, /developer-submitted listing request/);
  assert.match(admission, /not an approval, release descriptor, permission grant, or install truth/);
  assert.match(admission, /Nimi Platform review owns final admission/);
});
