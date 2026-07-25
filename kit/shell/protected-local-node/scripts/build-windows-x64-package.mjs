import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  requireWindowsDevSigningIdentity,
  signWindowsDevFiles,
} from '../../../../scripts/lib/windows-dev-signing.mjs';

const crateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`protected-local Node binding is not admitted for ${process.platform}/${process.arch}`);
}

const e2eFixture = process.argv.slice(2).includes('--e2e-fixture');
const childEnv = { ...process.env };
const identity = requireWindowsDevSigningIdentity({ cwd: crateRoot });
const cargoTargetRoot = path.join(
  crateRoot,
  'target',
  e2eFixture ? 'windows-e2e-fixture' : 'windows-production',
);
childEnv.CARGO_TARGET_DIR = cargoTargetRoot;
const cargoArgs = [
  'build',
  '--locked',
  '--release',
  '--manifest-path',
  path.join(crateRoot, 'Cargo.toml'),
];
if (e2eFixture) {
  childEnv.NIMI_WINDOWS_E2E_SIGNER_CERT_SHA256 = identity.certificateSha256;
  cargoArgs.push('--features', 'windows-e2e-fixture');
} else {
  childEnv.NIMI_WINDOWS_PRODUCTION_SIGNER_CERT_SHA256 = identity.certificateSha256;
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

const source = path.join(cargoTargetRoot, 'release', 'nimi_shell_protected_local_node.dll');
const target = path.join(crateRoot, 'npm', 'win32-x64', 'nimi_shell_protected_local.node');
if (!existsSync(source)) {
  throw new Error(`native binding output is missing: ${source}`);
}
copyFileSync(source, target);
const signed = signWindowsDevFiles([target], { cwd: crateRoot });
if (signed.certificateSha256 !== identity.certificateSha256) {
  throw new Error('protected-local Node binding signer changed during build');
}
process.stdout.write(`${target}\n`);
