import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const authSource = readFileSync(new URL('../src/shell/auth/runtime-platform.ts', import.meta.url), 'utf8');
const authGateSource = readFileSync(new URL('../src/shell/auth/auth-gate.tsx', import.meta.url), 'utf8');
const localAppClientSource = readFileSync(new URL('../src/shell/auth/local-app-client.ts', import.meta.url), 'utf8');
const productSource = readFileSync(new URL('../src/shell/routes/product-area.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const tauriMainSource = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
const electronMainSource = readFileSync(new URL('../src-electron/main.ts', import.meta.url), 'utf8');
const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');

test('generated app uses one typed local-app carrier for Electron and Tauri development', () => {
  assert.match(authSource, /getNimiLocalAppClient/);
  assert.match(authSource, /\.auth\.status\(\)/);
  assert.match(authSource, /status\.state !== 'session-bound'/);
  assert.match(authSource, /'local-app'/);
  assert.doesNotMatch(authSource, /DeveloperRegistered|developerRegistration|AppSessionMetadataProvider/);
  assert.match(localAppClientSource, /createNimiClient/);
  assert.match(localAppClientSource, /createNimiLocalAppStandardShellSurface/);
  assert.doesNotMatch(localAppClientSource, /InstalledNimiApp|bootstrapArtifact|trustClass/);
  assert.match(authGateSource, /projection\.status !== 'ready'/);
  assert.doesNotMatch(authGateSource, /RuntimeLoginPage|loadRuntimeAccountUser/);
});

test('generated app removes app-owned credential and generic Runtime transport glue', () => {
  for (const relativePath of [
    '../src/shell/auth/runtime-account-auth.ts',
    '../src/shell/auth/runtime-login-page.tsx',
    '../src/shell/auth/runtime-transport.ts',
    '../src/shell/account/account-panel.tsx',
  ]) {
    assert.equal(existsSync(new URL(relativePath, import.meta.url)), false, `${relativePath} must not exist`);
  }
  const combined = [authSource, authGateSource, electronMainSource, tauriMainSource].join('\n');
  assert.doesNotMatch(combined, /sessionProof|launchTicket|runtimeBootEpoch|accessToken|refreshToken/);
  assert.doesNotMatch(electronMainSource, /runtimeEndpoint|NIMI_RUNTIME_GRPC_ADDR|createGrpcClient/);
});

test('both shell hosts use Kit-owned narrowed app-host registration', () => {
  assert.match(electronMainSource, /registerNimiElectronAppBridge/);
  assert.match(electronMainSource, /--nimi-dev-renderer-url=/);
  assert.match(tauriMainSource, /RuntimeBridgeAppHost::platform_default\(\)/);
  assert.match(tauriMainSource, /app\.manage\(/);
  assert.match(tauriMainSource, /nimi_shell_tauri_local_app_standard_shell_handler!\[/);
  assert.doesNotMatch(tauriMainSource, /nimi_shell_tauri_runtime_bridge_handler!\[/);
  assert.doesNotMatch(tauriMainSource, /tauri::generate_handler!\[/);
});

test('renderer installs the Kit bridge before render and exposes real session posture', () => {
  const bootstrapAt = mainSource.indexOf('installNimiShellRuntimeBridge()');
  const renderAt = mainSource.indexOf('.render(');
  assert.ok(bootstrapAt > -1 && renderAt > bootstrapAt);
  assert.match(productSource, /data-testid="nimi-app-host-status"/);
  assert.match(productSource, /data-testid="nimi-app-host-authority-status"/);
  assert.match(productSource, /app-private-base-entitlement-ready/);
});

test('manifest requests no permission while the admitted public set is empty', () => {
  assert.match(manifest, /manifest_role: submitted-input/);
  assert.match(manifest, /permissions:\s*\[\]/);
  assert.doesNotMatch(manifest, /scope:|qualifier:|grant|session|token/);
});
