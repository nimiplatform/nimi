import { copyFileSync, existsSync, mkdirSync, renameSync, realpathSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const crateRoot = path.resolve(scriptDir, '..');
const workspaceRoot = path.resolve(crateRoot, '../../..');

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('darwin-arm64 protected-local package must be built natively on Apple Silicon');
}

const localDevelopment = process.argv.includes('--local-development');
const sourceLocalDevelopment = process.argv.includes('--source-local-development');
const layoutOnly = process.argv.includes('--layout-only');
const knownArguments = new Set(['--local-development', '--source-local-development', '--layout-only']);
const unknownArgument = process.argv.slice(2).find((value) => !knownArguments.has(value));
if (unknownArgument) throw new Error(`unsupported protected-local macOS build argument: ${unknownArgument}`);
if ([localDevelopment, sourceLocalDevelopment, layoutOnly].filter(Boolean).length > 1) {
  throw new Error('local-development, source-local-development, and layout-only builds are mutually exclusive');
}

const exactTeamId = (value) => /^[A-Z0-9]{10}$/.test(value);
if (!layoutOnly && !localDevelopment && !sourceLocalDevelopment) {
  const teamId = String(process.env.NIMI_MACOS_TEAM_ID || '').trim();
  if (!exactTeamId(teamId)) {
    throw new Error('production macOS build requires exact NIMI_MACOS_TEAM_ID');
  }
}

const cargoArguments = ['build', '--locked', '--release', '--manifest-path', path.join(crateRoot, 'Cargo.toml')];
if (localDevelopment) cargoArguments.push('--features', 'macos-local-development');
if (sourceLocalDevelopment) cargoArguments.push('--features', 'macos-source-local-development');
const cargoEnvironment = {
  ...process.env,
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '1',
};
if (layoutOnly || localDevelopment || sourceLocalDevelopment) {
  delete cargoEnvironment.NIMI_MACOS_TEAM_ID;
}
if (sourceLocalDevelopment) {
  const requireDesktop = createRequire(path.join(workspaceRoot, 'apps/desktop/package.json'));
  cargoEnvironment.NIMI_SUPERVISOR_SOURCE_HOME = realpathSync(requireDesktop('electron'));
}
const supervisorArgs = [...cargoArguments, '--bin', 'nimi-app-supervisor', '--target-dir', path.join(crateRoot, 'target')];
supervisorArgs[supervisorArgs.indexOf('--manifest-path') + 1] = path.resolve(crateRoot, '../protected-local/Cargo.toml');
const supervisor = spawnSync('cargo', supervisorArgs, { cwd: workspaceRoot, env: cargoEnvironment, stdio: 'inherit' });
if (supervisor.status !== 0) throw new Error('macOS App Supervisor build failed');
if (sourceLocalDevelopment) {
  const output = path.join(workspaceRoot, '.nimi/local/imp3/runtime-local-development/nimi-app-supervisor');
  mkdirSync(path.dirname(output), {recursive:true});
  const built = path.join(crateRoot, 'target/release/nimi-app-supervisor');
  if (!existsSync(output) || !readFileSync(built).equals(readFileSync(output))) {
    const staging = output + '.' + process.pid;
    copyFileSync(built, staging);
    renameSync(staging, output);
  }
}
const cargo = spawnSync('cargo', cargoArguments, {
  cwd: workspaceRoot,
  env: cargoEnvironment,
  stdio: 'inherit',
});
if (cargo.status !== 0) {
  throw new Error(`protected-local macOS native build failed with status ${cargo.status ?? 'unknown'}`);
}

const source = path.join(crateRoot, 'target', 'release', 'libnimi_shell_protected_local_node.dylib');
const target = path.join(crateRoot, 'npm', 'darwin-arm64', 'nimi_shell_protected_local.node');
if (!existsSync(source)) throw new Error(`native Node-API output is missing: ${source}`);
const prepared = target + '.' + process.pid;
copyFileSync(source, prepared);
const installName = spawnSync('/usr/bin/install_name_tool', [
  '-id', '@rpath/nimi_shell_protected_local.node', prepared,
], { cwd: workspaceRoot, encoding: 'utf8' });
if (installName.status !== 0) {
  unlinkSync(prepared);
  throw new Error(`normalizing macOS native module install name failed: ${installName.stderr.trim()}`);
}
if (existsSync(target) && readFileSync(target).equals(readFileSync(prepared))) unlinkSync(prepared);
else renameSync(prepared, target);
console.log(
  `[protected-local] wrote ${path.relative(workspaceRoot, target)}${
    localDevelopment
      ? ' (local-development)'
      : sourceLocalDevelopment
        ? ' (source-local-development)'
        : layoutOnly
        ? ' (layout-only; direct trust disabled)'
        : ' (production)'
  }`,
);
