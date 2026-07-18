import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const crateRoot = path.resolve(scriptDir, '..');
const workspaceRoot = path.resolve(crateRoot, '../../..');

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('darwin-arm64 protected-local package must be built natively on Apple Silicon');
}

const releasePolicy = [
  'NIMI_PLATFORM_RELEASE_ROOT_KEY_ID',
  'NIMI_PLATFORM_RELEASE_ROOT_PUBLIC_KEY_B64URL',
];
const missingPolicy = releasePolicy.filter((key) => !String(process.env[key] || '').trim());
const failClosedCandidate = process.argv.includes('--fail-closed-candidate');
if (missingPolicy.length > 0 && !failClosedCandidate) {
  throw new Error(`macOS release policy is incomplete: ${missingPolicy.join(', ')}`);
}

const cargo = spawnSync('cargo', ['build', '--release', '--manifest-path', path.join(crateRoot, 'Cargo.toml')], {
  cwd: workspaceRoot,
  env: process.env,
  stdio: 'inherit',
});
if (cargo.status !== 0) {
  throw new Error(`protected-local macOS native build failed with status ${cargo.status ?? 'unknown'}`);
}

const source = path.join(crateRoot, 'target', 'release', 'libnimi_shell_protected_local_node.dylib');
const target = path.join(crateRoot, 'npm', 'darwin-arm64', 'nimi_shell_protected_local.node');
if (!existsSync(source)) throw new Error(`native Node-API output is missing: ${source}`);
copyFileSync(source, target);
const installName = spawnSync('/usr/bin/install_name_tool', [
  '-id', '@rpath/nimi_shell_protected_local.node', target,
], { cwd: workspaceRoot, encoding: 'utf8' });
if (installName.status !== 0) {
  throw new Error(`normalizing macOS native module install name failed: ${installName.stderr.trim()}`);
}
console.log(`[protected-local] wrote ${path.relative(workspaceRoot, target)}${missingPolicy.length > 0 ? ' (fail-closed candidate)' : ''}`);
