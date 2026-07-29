import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const crateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error(`Desktop product-control Node binding is not admitted for ${process.platform}/${process.arch}`);
}
if (process.argv.length !== 2) {
  throw new Error('Desktop product-control macOS build does not accept arguments');
}

const targetRoot = path.join(crateRoot, 'target', 'darwin-arm64');
const result = spawnSync('cargo', [
  'build',
  '--release',
  '--locked',
  '--manifest-path',
  path.join(crateRoot, 'Cargo.toml'),
], {
  cwd: crateRoot,
  env: {
    ...process.env,
    CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '1',
    CARGO_TARGET_DIR: targetRoot,
  },
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const source = path.join(targetRoot, 'release', 'libnimi_desktop_product_control_node.dylib');
const target = path.join(crateRoot, 'npm', 'darwin-arm64', 'nimi_desktop_product_control.node');
if (!existsSync(source)) throw new Error(`Desktop product-control native output is missing: ${source}`);
copyFileSync(source, target);
const installName = spawnSync('/usr/bin/install_name_tool', [
  '-id',
  '@rpath/nimi_desktop_product_control.node',
  target,
], {
  cwd: crateRoot,
  encoding: 'utf8',
});
if (installName.error) throw installName.error;
if (installName.status !== 0) {
  throw new Error(`Normalizing Desktop product-control install name failed: ${installName.stderr.trim()}`);
}
process.stdout.write(`${target}\n`);
