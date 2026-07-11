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
  assert.equal(packageJson.scripts['test:e2e:tauri'], 'corepack pnpm run build && node scripts/run-tauri-acceptance.mjs');
  assert.equal(packageJson.scripts['check:shell-parity'], 'pnpm run check:shell-static-parity && pnpm run test:e2e:electron && pnpm run test:e2e:tauri');
  assert.equal(existsSync(path.join(root, 'scripts/check-shell-parity.mjs')), true);
  const source = read('scripts/check-shell-parity.mjs');
  assert.match(source, /registerNimiElectronAppBridge/);
  assert.match(source, /app_host_bootstrap/);
  assert.match(source, /artifacts_read_runtime_bytes/);
  assert.match(source, /src-electron\/main\.ts/);
  assert.match(source, /src-tauri\/src\/main\.rs/);
  assert.match(source, /nimi_shell_tauri_installed_app_standard_shell_handler/);
  assert.match(source, /electron-app-host-ordinary-grpc-forbidden/);
  assert.equal(existsSync(path.join(root, 'scripts/run-tauri-acceptance.mjs')), true);
  const tauriAcceptance = read('scripts/run-tauri-acceptance.mjs');
  assert.match(tauriAcceptance, /commandMatrix/);
  for (const expectedCommand of [
    'ai_config_set',
    'ai_config_get',
    'runtime_bridge_config_get',
    'storage_write_json',
    'storage_read_json',
    'runtime_bridge_status',
    'runtime_defaults',
    'auth_session_load',
    'local_agent_identity',
    'unsupported-standard-command',
  ]) {
    assert.match(tauriAcceptance, new RegExp(expectedCommand));
  }
  const tauriMain = read('src-tauri/src/main.rs');
  const tauriProduct = tauriMain.split('#[cfg(test)]')[0];
  assert.match(tauriProduct, /nimi_shell_tauri_installed_app_standard_shell_handler/);
  assert.doesNotMatch(tauriProduct, /runtime_bridge_unary|nimi_shell_tauri_runtime_bridge_handler/);
});
