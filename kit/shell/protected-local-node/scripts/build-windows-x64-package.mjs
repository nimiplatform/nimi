import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const crateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`protected-local Node binding is not admitted for ${process.platform}/${process.arch}`);
}

const unsupportedArguments = process.argv.slice(2);
if (unsupportedArguments.length > 0) {
  throw new Error(`protected-local Windows package build accepts no arguments: ${unsupportedArguments.join(' ')}`);
}

const productionSignerSpkiSha256 = process.env.NIMI_WINDOWS_PRODUCTION_SIGNER_SPKI_SHA256 ?? '';
if (!SHA256_PATTERN.test(productionSignerSpkiSha256)) {
  throw new Error(
    'NIMI_WINDOWS_PRODUCTION_SIGNER_SPKI_SHA256 must be an exact lowercase SHA-256 SubjectPublicKeyInfo identity',
  );
}

const childEnv = { ...process.env };
const cargoTargetRoot = path.join(
  crateRoot,
  'target',
  'windows-production',
);
childEnv.CARGO_TARGET_DIR = cargoTargetRoot;
childEnv.NIMI_WINDOWS_PRODUCTION_SIGNER_SPKI_SHA256 = productionSignerSpkiSha256;
const cargoArgs = [
  'build',
  '--locked',
  '--release',
  '--manifest-path',
  path.join(crateRoot, 'Cargo.toml'),
];

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
process.stdout.write(`${target}\n`);
