import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const crateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`protected-local source binding is not admitted for ${process.platform}/${process.arch}`);
}

const unsupportedArguments = process.argv.slice(2);
if (unsupportedArguments.length > 0) {
  throw new Error(`protected-local Windows source package build accepts no arguments: ${unsupportedArguments.join(' ')}`);
}

const cargoTargetRoot = path.join(crateRoot, 'target', 'windows-source-local-development');
const cargo = spawnSync('cargo', [
  'build',
  '--locked',
  '--release',
  '--features',
  'windows-source-local-development',
  '--manifest-path',
  path.join(crateRoot, 'Cargo.toml'),
], {
  cwd: crateRoot,
  env: {
    ...process.env,
    CARGO_TARGET_DIR: cargoTargetRoot,
  },
  encoding: 'utf8',
  stdio: 'inherit',
});
if (cargo.status !== 0) {
  process.exit(cargo.status ?? 1);
}

const source = path.join(cargoTargetRoot, 'release', 'nimi_shell_protected_local_node.dll');
const target = path.join(crateRoot, 'npm', 'win32-x64', 'nimi_shell_protected_local.node');
if (!existsSync(source)) {
  throw new Error(`native binding output is missing: ${source}`);
}
copyFileSync(source, target);
process.stdout.write(`${target}\n`);
