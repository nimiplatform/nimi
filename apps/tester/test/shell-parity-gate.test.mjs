import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

test('tester exposes a first-class shell parity gate', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.scripts['check:shell-static-parity'], 'node scripts/check-shell-parity.mjs');
  assert.equal(packageJson.scripts.dev, 'nimi-app dev --shell electron');
  assert.equal(packageJson.scripts['dev:tauri'], 'nimi-app dev --shell tauri');
  assert.equal(packageJson.scripts['test:e2e:tauri'], 'corepack pnpm run test:e2e:tauri:plain-negative');
  assert.equal(packageJson.scripts['test:e2e:tauri:plain-negative'], 'corepack pnpm run build && node scripts/run-tauri-acceptance.mjs');
  assert.equal(packageJson.scripts['check:shell-parity'], 'pnpm run check:shell-static-parity && pnpm run test:e2e:electron && pnpm run test:e2e:tauri');
  assert.equal(existsSync(path.join(root, 'scripts/check-shell-parity.mjs')), true);
  const source = read('scripts/check-shell-parity.mjs');
  assert.match(source, /registerNimiElectronAppBridge/);
  assert.match(source, /createNimiClient/);
  assert.match(source, /createNimiLocalAppStandardShellSurface/);
  assert.match(source, /local_app_session_status/);
  assert.match(source, /storage_write_json/);
  assert.match(source, /src-electron\/main\.ts/);
  assert.match(source, /src-tauri\/src\/main\.rs/);
  assert.match(source, /nimi_shell_tauri_local_app_standard_shell_handler/);
  assert.match(source, /electron-local-app-ordinary-grpc-forbidden/);
  assert.equal(existsSync(path.join(root, 'scripts/run-tauri-acceptance.mjs')), true);
  const tauriAcceptance = read('scripts/run-tauri-acceptance.mjs');
  assert.match(tauriAcceptance, /commandMatrix/);
  assert.match(tauriAcceptance, /local_app_session_status/);
  assert.match(tauriAcceptance, /storage_write_json/);
  assert.match(tauriAcceptance, /tester\.tauri\.plain-negative/);
  assert.doesNotMatch(tauriAcceptance, /officialLauncher|NIMI_RUNTIME_GRPC_ADDR|NIMI_TESTER_TAURI_ACCEPTANCE_STORAGE_ROOT/);
  for (const expectedCommand of [
    'local_app_permission_status',
    'local_app_permission_request',
    'ai_config_get',
    'storage_read_json',
    'storage_write_json',
    'storage_remove_json',
    'unsupported-standard-command',
  ]) {
    assert.match(tauriAcceptance, new RegExp(expectedCommand));
  }
  const tauriMain = read('src-tauri/src/main.rs');
  const tauriProduct = tauriMain.split('#[cfg(test)]')[0];
  assert.match(tauriProduct, /nimi_shell_tauri_local_app_standard_shell_handler/);
  assert.match(tauriProduct, /RuntimeBridgeLocalAppHost::platform_default/);
  assert.doesNotMatch(tauriProduct, /runtime_bridge_unary|nimi_shell_tauri_runtime_bridge_handler/);
});
