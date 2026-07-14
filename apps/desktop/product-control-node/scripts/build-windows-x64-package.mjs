import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  requireWindowsDevSigningIdentity,
  signWindowsDevFiles,
} from '../../../../scripts/lib/windows-dev-signing.mjs';

const crateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`Desktop product-control Node binding is not admitted for ${process.platform}/${process.arch}`);
}

const identity = requireWindowsDevSigningIdentity({ cwd: crateRoot });
const targetRoot = path.join(crateRoot, 'target', 'windows-production');
const result = spawnSync('cargo', [
  'build',
  '--release',
  '--locked',
  '--manifest-path',
  path.join(crateRoot, 'Cargo.toml'),
], {
  cwd: crateRoot,
  env: { ...process.env, CARGO_TARGET_DIR: targetRoot },
  encoding: 'utf8',
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const source = path.join(targetRoot, 'release', 'nimi_desktop_product_control_node.dll');
const target = path.join(crateRoot, 'npm', 'win32-x64', 'nimi_desktop_product_control.node');
if (!existsSync(source)) throw new Error(`Desktop product-control native output is missing: ${source}`);
copyFileSync(source, target);
const signed = signWindowsDevFiles([target], { cwd: crateRoot });
if (signed.certificateSha256 !== identity.certificateSha256) {
  throw new Error('Desktop product-control Node binding signer changed during build');
}
process.stdout.write(`${target}\n`);
