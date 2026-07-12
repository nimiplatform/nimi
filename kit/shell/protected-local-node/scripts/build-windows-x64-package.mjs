import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireWindowsDevSigningIdentity } from '../../../../scripts/lib/windows-dev-signing.mjs';

const crateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`protected-local Node binding is not admitted for ${process.platform}/${process.arch}`);
}

const e2eFixture = process.argv.slice(2).includes('--e2e-fixture');
const childEnv = { ...process.env };
const cargoArgs = [
  'build',
  '--release',
  '--locked',
  '--manifest-path',
  path.join(crateRoot, 'Cargo.toml'),
];
if (e2eFixture) {
  const identity = requireWindowsDevSigningIdentity({ cwd: crateRoot });
  childEnv.NIMI_WINDOWS_E2E_SIGNER_CERT_SHA256 = identity.certificateSha256;
  cargoArgs.push('--features', 'windows-e2e-fixture');
}

const cargo = spawnSync('cargo', cargoArgs, {
  cwd: crateRoot,
  env: childEnv,
  encoding: 'utf8',
  stdio: 'inherit',
});
if (cargo.status !== 0) {
  process.exit(cargo.status ?? 1);
}

const source = path.join(crateRoot, 'target', 'release', 'nimi_shell_protected_local_node.dll');
const target = path.join(crateRoot, 'npm', 'win32-x64', 'nimi_shell_protected_local.node');
if (!existsSync(source)) {
  throw new Error(`native binding output is missing: ${source}`);
}
copyFileSync(source, target);
process.stdout.write(`${target}\n`);
