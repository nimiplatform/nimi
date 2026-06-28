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
  assert.match(source, /STATIC_TESTER_SHELL_COMMANDS/);
  assert.match(source, /NIMI_STANDARD_SHELL_COMMANDS/);
  assert.match(source, /src-electron\/main\.ts/);
  assert.match(source, /src-tauri\/src\/main\.rs/);
  assert.match(source, /createTesterElectronCommandHandlers/);
  assert.match(source, /nimi_shell_tauri_runtime_bridge_handler/);
  assert.match(source, /tester_run_history_load/);
  assert.match(source, /open_world_tour_window/);
  assert.equal(existsSync(path.join(root, 'scripts/run-tauri-acceptance.mjs')), true);
  const tauriAcceptance = read('scripts/run-tauri-acceptance.mjs');
  assert.match(tauriAcceptance, /commandMatrix/);
  for (const expectedCommand of [
    'runtime_bridge_status',
    'runtime_defaults',
    'runtime_bridge_config_get',
    'tester_run_history_load',
    'auth_session_load',
    'unsupported-standard-command',
  ]) {
    assert.match(tauriAcceptance, new RegExp(expectedCommand));
  }
  const tauriMain = read('src-tauri/src/main.rs');
  assert.match(tauriMain, /commandChecks/);
  assert.match(tauriMain, /storageRoot/);
  assert.match(tauriMain, /expectError/);
});
