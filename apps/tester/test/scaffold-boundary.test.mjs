import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authSource = readFileSync(new URL('../src/shell/auth/runtime-platform.ts', import.meta.url), 'utf8');
const authGateSource = readFileSync(new URL('../src/shell/auth/auth-gate.tsx', import.meta.url), 'utf8');
const runtimeAccountAuthSource = readFileSync(new URL('../src/shell/auth/runtime-account-auth.ts', import.meta.url), 'utf8');
const runtimeLoginSource = readFileSync(new URL('../src/shell/auth/runtime-login-page.tsx', import.meta.url), 'utf8');
const productSource = readFileSync(new URL('../src/shell/routes/product-area.tsx', import.meta.url), 'utf8');
const demoSource = readFileSync(new URL('../src/shell/routes/demo-surfaces.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const tauriMainSource = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
const appSource = [authSource, runtimeLoginSource, productSource, demoSource].join('\n');
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
  assert.doesNotMatch(authSource, /createNimiAppRuntimePlatformClient/);
  assert.doesNotMatch(authSource, /createPlatformClient\s*\(/);
  assert.doesNotMatch(authSource, /getPlatformClient\(/);
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
  assert.match(tauriMainSource, /@with_runtime_defaults nimi_shell_tauri::runtime_defaults::runtime_defaults;/);
  assert.match(tauriMainSource, /renderer_entry_probe::build_renderer_entry_probe_script/);
  assert.match(tauriMainSource, /RendererEntryProbeScriptConfig/);
  assert.doesNotMatch(tauriMainSource, /tauri::generate_handler!\[/);
  assert.doesNotMatch(tauriMainSource, /desktop_macos_smoke_ping/);
  assert.doesNotMatch(tauriMainSource, /globalRecord\.__TAURI__\?\.core\?\.invoke/);
});

test('generated shell rejects placeholder and private Desktop imports', () => {
  assert.doesNotMatch(appSource, /Replace this route with app product behavior/);
  assert.doesNotMatch(appSource, /Open product action/);
  assert.doesNotMatch(appSource, /Add app-owned surfaces/);
  assert.doesNotMatch(appSource, /from ['\"]@renderer\//);
  assert.doesNotMatch(appSource, /from ['\"]@runtime\//);
});

test('manifest remains submitted input', () => {
  assert.match(manifest, /manifest_role: submitted-input/);
  assert.match(manifest, /declared_nimi_api_scopes/);
  assert.match(manifest, /scope: file\.read\.scoped/);
  assert.match(manifest, /scope: file\.write\.scoped/);
  assert.doesNotMatch(manifest, /scope: app\.local\.drafts/);
});

test('admission request remains submitted input', () => {
  assert.match(admission, /developer-submitted listing request/);
  assert.match(admission, /not an approval, release descriptor, permission grant, or install truth/);
  assert.match(admission, /Nimi Platform review owns final admission/);
});
