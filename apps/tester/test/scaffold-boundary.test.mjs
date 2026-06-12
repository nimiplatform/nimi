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
const testerRuntimeSource = readFileSync(new URL('../src/tester/tester-runtime.ts', import.meta.url), 'utf8');
const appSource = [authSource, runtimeLoginSource, productSource, demoSource, testerRuntimeSource].join('\n');
const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');
const admission = readFileSync(new URL('../ADMISSION.md', import.meta.url), 'utf8');

test('auth glue uses explicit vNext NimiClient runtime projection', () => {
  assert.match(authSource, /createNimiClient/);
  assert.match(authSource, /'local-first-party'/);
  assert.match(authSource, /'third-party-nimi-app'/);
  assert.doesNotMatch(authSource, /dev-standalone/);
  assert.match(runtimeLoginSource, /DesktopShellAuthPage/);
  assert.doesNotMatch(authSource, /createNimiAppRuntimePlatformClient/);
  assert.doesNotMatch(authSource, /createPlatformClient\s*\(/);
  assert.doesNotMatch(authSource, /getPlatformClient\(/);
});

test('single login model requires runtime account login (no dev-standalone bypass)', () => {
  // The app connects exactly like a shipped app: through runtime account login.
  // There is no standalone developer-session bypass; the runtime
  // developer-registration gate admits a not-yet-admitted local app instead.
  assert.doesNotMatch(authGateSource, /dev-standalone/);
  assert.doesNotMatch(authGateSource, /runtime-developer-session/);
  assert.doesNotMatch(authSource, /VITE_NIMI_RUNTIME_DEVELOPER_SESSION/);
  assert.match(authSource, /createNimiRuntimeFullAppRegistration/);
  assert.match(authSource, /runtimeAccountCaller/);
  assert.match(authSource, /registerLocalFirstPartyRuntimeAccountCaller/);
  assert.match(authSource, /const runtimeDeveloperRegistrationRequested = true/);
  assert.match(authSource, /developerRegistration:\s*runtimeDeveloperRegistrationRequested/);
  assert.doesNotMatch(authSource, /import\.meta[^;\n]*env|env\.DEV|metadata:\s*[^,\n]*developerRegistration/);
  assert.match(authSource, /await client\.runtime\.ready\(\);\s*await registerLocalFirstPartyRuntimeAccountCaller\(client\);/s);
  assert.match(authGateSource, /loadRuntimeAccountUser/);
  assert.match(authGateSource, /clearRuntimePlatformProjection/);
  assert.match(authGateSource, /clearRuntimePlatformProjection\(\);\s*setReloadKey/s);
  assert.match(runtimeAccountAuthSource, /createRuntimeAccountBrowserBroker/);
  assert.match(authSource, /createNimiLocalFirstPartyRuntimeAccountCaller/);
  assert.doesNotMatch(runtimeAccountAuthSource, /getPlatformClient\(/);
  assert.match(runtimeAccountAuthSource, /from '@nimiplatform\/kit\/auth'/);
  assert.doesNotMatch(runtimeAccountAuthSource, /runtime\.account\.beginLogin\(/);
  assert.doesNotMatch(runtimeAccountAuthSource, /runtime\.account\.completeLogin\(/);
  assert.doesNotMatch(runtimeAccountAuthSource, /ACCOUNT_CALLER_MODE|deviceId:\s*['"`]local-first-party-device|mode:\s*1|appInstanceId:\s*`\$\{appId\}\.local-first-party`/);
  assert.doesNotMatch(runtimeAccountAuthSource, /desktop-runtime-oauth-url|#\/login|desktop_callback/);
});

test('renderer bootstrap installs the Kit runtime-transport bridge before render', () => {
  // The runtime-transport hook is a Kit platform contract: the app consumes the
  // single Kit bootstrap and must not install or even know the hook details.
  assert.match(
    mainSource,
    /import \{[^}]*installNimiShellRuntimeBridge[^}]*\} from '@nimiplatform\/kit\/shell\/renderer\/bridge'/,
  );
  // It must run before the React tree renders (and therefore before any runtime
  // /platform client construction), so the first stream subscription resolves.
  const bootstrapAt = mainSource.indexOf('installNimiShellRuntimeBridge()');
  const renderAt = mainSource.indexOf('.render(');
  assert.ok(bootstrapAt > -1, 'main.tsx must call installNimiShellRuntimeBridge()');
  assert.match(mainSource, /createRendererEntryModuleLoader/);
  assert.match(mainSource, /from '@nimiplatform\/kit\/shell\/renderer\/bootstrap'/);
  assert.match(mainSource, /entry:tester-app/);
  assert.ok(renderAt > -1, 'main.tsx must render the app');
  assert.ok(bootstrapAt < renderAt, 'bootstrap must run before render');
  // The app must not reach into the hook global itself — that is Kit-owned glue.
  assert.doesNotMatch(mainSource, /__NIMI_TAURI_RUNTIME__/);
  assert.doesNotMatch(mainSource, /Failed to fetch dynamically imported module|Importing a module script failed|function isRetryable/);
});

test('Tauri scaffold consumes the Kit shared command-registration macro', () => {
  assert.match(
    tauriMainSource,
    /nimi_shell_tauri::nimi_shell_tauri_runtime_bridge_handler!\[/,
  );
  assert.match(
    tauriMainSource,
    /@with_runtime_defaults nimi_shell_tauri::runtime_defaults::runtime_defaults;/,
  );
  assert.doesNotMatch(tauriMainSource, /tauri::generate_handler!\[/);
});

test('Tauri scaffold consumes the Kit renderer entry probe', () => {
  assert.match(
    tauriMainSource,
    /renderer_entry_probe::build_renderer_entry_probe_script/,
  );
  assert.match(
    tauriMainSource,
    /RendererEntryProbeScriptConfig/,
  );
  assert.match(
    tauriMainSource,
    /tester_renderer_probe_ping/,
  );
  assert.doesNotMatch(tauriMainSource, /desktop_macos_smoke_ping/);
  assert.doesNotMatch(tauriMainSource, /globalRecord\.__TAURI__\?\.core\?\.invoke/);
});

test('runtime readiness consumes Kit runtime defaults and daemon bridge', () => {
  assert.match(
    testerRuntimeSource,
    /import \{[^}]*getDaemonStatus[^}]*getRuntimeDefaults[^}]*\} from '@nimiplatform\/kit\/shell\/renderer\/bridge'/,
  );
  assert.match(
    testerRuntimeSource,
    /import \{[^}]*checkRuntimeDaemonVersion[^}]*\} from '@nimiplatform\/kit\/shell\/renderer\/bootstrap'/,
  );
  assert.match(testerRuntimeSource, /await getRuntimeDefaults\(\)/);
  assert.match(testerRuntimeSource, /await getDaemonStatus\(\)/);
  assert.match(testerRuntimeSource, /checkRuntimeDaemonVersion\(/);
  assert.doesNotMatch(
    testerRuntimeSource,
    /function\s+(readEnv|resolveRealmBaseUrlFallback|readRuntimeDefaultsFallback|applyEnvOverrides)\b/,
  );
  assert.doesNotMatch(
    testerRuntimeSource,
    /deriveDefaultJwksUrl|deriveDefaultRevocationUrl|normalizeLoopbackHttpUrl/,
  );
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
