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

const productionPolicy = [
  'NIMI_PLATFORM_RELEASE_ROOT_KEY_ID',
  'NIMI_PLATFORM_RELEASE_ROOT_PUBLIC_KEY_B64URL',
];
const localDevelopmentPolicy = [
  'NIMI_MACOS_LOCAL_DEVELOPMENT_RELEASE_ROOT_KEY_ID',
  'NIMI_MACOS_LOCAL_DEVELOPMENT_RELEASE_ROOT_PUBLIC_KEY_B64URL',
];
const localDevelopment = process.argv.includes('--local-development');
const failClosedCandidate = process.argv.includes('--fail-closed-candidate');
const knownArguments = new Set(['--local-development', '--fail-closed-candidate']);
const unknownArgument = process.argv.slice(2).find((value) => !knownArguments.has(value));
if (unknownArgument) throw new Error(`unsupported protected-local macOS build argument: ${unknownArgument}`);
if (localDevelopment && failClosedCandidate) {
  throw new Error('local-development and fail-closed candidate profiles are mutually exclusive');
}
const releasePolicy = localDevelopment ? localDevelopmentPolicy : productionPolicy;
const missingPolicy = releasePolicy.filter((key) => !String(process.env[key] || '').trim());
if (missingPolicy.length > 0 && !failClosedCandidate) {
  throw new Error(`macOS release policy is incomplete: ${missingPolicy.join(', ')}`);
}

const cargoArguments = ['build', '--release', '--manifest-path', path.join(crateRoot, 'Cargo.toml')];
if (localDevelopment) cargoArguments.push('--features', 'macos-local-development');
const cargo = spawnSync('cargo', cargoArguments, {
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
console.log(`[protected-local] wrote ${path.relative(workspaceRoot, target)}${localDevelopment ? ' (local-development non-product)' : missingPolicy.length > 0 ? ' (fail-closed candidate)' : ''}`);
