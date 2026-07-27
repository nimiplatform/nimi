import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const authSource = readFileSync(new URL('../src/shell/auth/runtime-platform.ts', import.meta.url), 'utf8');
const authGateSource = readFileSync(new URL('../src/shell/auth/auth-gate.tsx', import.meta.url), 'utf8');
const localAppPlatformSource = readFileSync(new URL('../src/shell/local-app-runtime-platform.ts', import.meta.url), 'utf8');
const productSource = readFileSync(new URL('../src/shell/routes/product-area.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const tauriMainSource = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
const appSource = [authSource, productSource].join('\n');
const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');

test('auth glue exposes only the final local-app projection', () => {
  assert.match(authSource, /'local-app'/);
  assert.match(authSource, /runtimeAccountLoginEnabled = false/);
  assert.match(authSource, /testerLocalAppClient\.auth\.status\(\)/);
  assert.match(authSource, /status\.sessionBound/);
  assert.match(localAppPlatformSource, /createNimiClient/);
  assert.match(localAppPlatformSource, /createNimiLocalAppStandardShellSurface/);
  assert.doesNotMatch(authSource, /new Runtime|new Realm/);
  assert.doesNotMatch(authSource, /readonly client:|readonly auth:/);
  assert.doesNotMatch(authSource, /DeveloperRegistered|FullAppRegistration|AppSessionMetadataProvider/);
  assert.doesNotMatch(authSource, /getRuntimeAccountCaller|getRuntimeNimiClient|getRuntimeSubjectUserId/);
  assert.doesNotMatch(authSource, /developer-registration|local-developer|developer-registered-local-app/i);
});

test('local-app renderer does not select or self-assert a Runtime transport', () => {
  assert.equal(existsSync(new URL('../src/shell/auth/runtime-transport.ts', import.meta.url)), false);
  assert.doesNotMatch(localAppPlatformSource, /electron-ipc|tauri-ipc|commandNamespace|eventNamespace|runtimeEndpoint/);
  assert.doesNotMatch(localAppPlatformSource, /__NIMI_TAURI_RUNTIME__|__TAURI__/);
});

test('local-app auth gate keeps account control and embedded login out of the app', () => {
  assert.equal(existsSync(new URL('../src/shell/auth/runtime-account-auth.ts', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/shell/auth/runtime-login-page.tsx', import.meta.url)), false);
  assert.match(authGateSource, /clearRuntimePlatformProjection/);
  assert.match(authGateSource, /clearRuntimePlatformProjection\(\);\s*setReloadKey/s);
  assert.match(authGateSource, /<RuntimeUnavailablePage/);
  assert.doesNotMatch(authGateSource, /RuntimeLoginPage|loadRuntimeAccountUser|login-required/);
  assert.doesNotMatch(appSource, /beginLogin|completeLogin|logout|switchAccount|refreshAccountSession|getAccessToken/);
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

test('Tauri scaffold consumes Kit shared command registration', () => {
  assert.match(tauriMainSource, /nimi_shell_tauri::nimi_shell_tauri_local_app_standard_shell_handler!\[/);
  assert.match(tauriMainSource, /RuntimeBridgeLocalAppHost::platform_default/);
  assert.doesNotMatch(tauriMainSource, /@with_runtime_defaults/);
  assert.doesNotMatch(tauriMainSource, /tauri::generate_handler!\[/);
  assert.doesNotMatch(tauriMainSource, /desktop_macos_smoke_ping/);
  assert.doesNotMatch(tauriMainSource, /globalRecord\.__TAURI__\?\.core\?\.invoke/);
  assert.doesNotMatch(tauriMainSource, /local_developer_app|local-developer-app|developer_registration/);
  assert.doesNotMatch(tauriMainSource, /RuntimeBridgeHostAppSessionProvider|set_runtime_bridge_host_hooks/);
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
  assert.match(manifest, /permissions:\s*\[\]/);
  assert.match(manifest, /local_development:\s+electron:\s+renderer_origin: http:\/\/127\.0\.0\.1:1468/);
  assert.doesNotMatch(manifest, /execution_profile_ref/);
  assert.doesNotMatch(manifest, /declared_nimi_api_scopes|scope:|qualifier:/);
});

test('validate script enforces the empty admitted public permission set', () => {
  const validateSource = readFileSync(new URL('../scripts/validate.mjs', import.meta.url), 'utf8');
  assert.match(validateSource, /parsed\.permissions\.length !== 0/);
  assert.match(validateSource, /admitted public permission set is empty/);
  assert.doesNotMatch(validateSource, /isCanonicalPermissionScopeName|RUNTIME_ARTIFACT_SCOPES/);
});
