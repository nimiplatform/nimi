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
  assert.equal(packageJson.scripts['test:e2e:tauri'], 'corepack pnpm run test:e2e:tauri:plain-negative');
  assert.equal(packageJson.scripts['test:e2e:tauri:plain-negative'], 'corepack pnpm run build && node scripts/run-tauri-acceptance.mjs');
  assert.equal(packageJson.scripts['check:shell-parity'], 'pnpm run check:shell-static-parity && pnpm run test:e2e:electron && pnpm run test:e2e:tauri');
  assert.equal(existsSync(path.join(root, 'scripts/check-shell-parity.mjs')), true);
  const source = read('scripts/check-shell-parity.mjs');
  assert.match(source, /registerNimiElectronAppBridge/);
  assert.match(source, /createNimiAppRuntimePlatformClient/);
  assert.match(source, /createNimiLocalAppStandardShellSurface/);
  assert.match(source, /local_app_session_status/);
  assert.match(source, /local_app_artifacts_read_runtime_bytes/);
  assert.match(source, /src-electron\/main\.ts/);
  assert.match(source, /src-tauri\/src\/main\.rs/);
  assert.match(source, /nimi_shell_tauri_local_app_standard_shell_handler/);
  assert.match(source, /electron-local-app-ordinary-grpc-forbidden/);
  assert.equal(existsSync(path.join(root, 'scripts/run-tauri-acceptance.mjs')), true);
  const tauriAcceptance = read('scripts/run-tauri-acceptance.mjs');
  assert.match(tauriAcceptance, /commandMatrix/);
  assert.match(tauriAcceptance, /local_app_session_status/);
  assert.match(tauriAcceptance, /local_app_artifacts_read_runtime_bytes/);
  assert.match(tauriAcceptance, /tester\.tauri\.plain-negative/);
  assert.doesNotMatch(tauriAcceptance, /officialLauncher|NIMI_RUNTIME_GRPC_ADDR|NIMI_TESTER_TAURI_ACCEPTANCE_STORAGE_ROOT/);
  for (const expectedCommand of [
    'local_app_permission_posture',
    'local_app_permission_request',
    'local_app_agent_open_conversation',
    'local_app_agent_send_turn',
    'local_app_agent_subscribe_turn',
    'local_app_agent_get_conversation_snapshot',
    'ai_config_get',
    'storage_read_json',
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
