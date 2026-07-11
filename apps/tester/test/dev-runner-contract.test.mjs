import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..', '..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const launcher = readFileSync(path.join(repoRoot, 'app-tools/scripts/dev-shell.mjs'), 'utf8');
const supervisor = readFileSync(
  path.join(repoRoot, 'apps/desktop/src-tauri/src/desktop_local_development/supervisor.rs'),
  'utf8',
);

test('Tester uses the same official one-command launcher as generated third-party apps', () => {
  assert.equal(packageJson.scripts.dev, 'nimi-app dev --shell tauri');
  assert.equal(packageJson.scripts['dev:shell'], 'nimi-app dev');
  assert.equal(packageJson.scripts['dev:electron'], 'nimi-app dev --shell electron');
  for (const removed of [
    'scripts/run-tauri-dev.mjs',
    'scripts/run-electron-dev.mjs',
    'scripts/tauri-dev-runner.mjs',
    'scripts/tauri-dev-runner.cmd',
  ]) {
    assert.equal(existsSync(path.join(root, removed)), false, `${removed} must not duplicate the launcher`);
  }
});

test('official launcher carries only project intent while Desktop owns build and host supervision', () => {
  assert.match(launcher, /schemaVersion:\s*1,[\s\S]*appId,[\s\S]*projectRoot,[\s\S]*shell/);
  assert.doesNotMatch(launcher, /sessionProof|launchTicket|runtimeBootEpoch|credential|Authorization:\s*`Bearer/);
  assert.match(supervisor, /run_package_script\(run\.clone\(\), "build:electron"\)/);
  assert.match(supervisor, /build_tauri_host\(run\.clone\(\)\)/);
  assert.match(supervisor, /launch_local_development_host/);
  assert.match(supervisor, /terminate_local_development_host/);
});

test('Desktop directly owns Tauri build output and host launch without project-visible control material', () => {
  assert.match(supervisor, /Command::new\(if cfg!\(windows\) \{ "cargo\.exe" \}/);
  assert.match(supervisor, /\.env\("CARGO_TARGET_DIR", &target_dir\)/);
  assert.match(supervisor, /launch_tauri_host\(run\.clone\(\)\)/);
  assert.doesNotMatch(supervisor, /NIMI_DEV_CONTROL|control_nonce|tauri-host-ready|tauri-host-stopped/);
  assert.equal(existsSync(path.join(repoRoot, 'app-tools/scripts/tauri-dev-runner.mjs')), false);
  assert.equal(existsSync(path.join(repoRoot, 'app-tools/bin/nimi-tauri-dev-runner.mjs')), false);
});
