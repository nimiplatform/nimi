import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_UPDATE_POLICY } from '../../../../config/product-update-policy.mjs';

const crateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`protected-local Node binding is not admitted for ${process.platform}/${process.arch}`);
}

const unsupportedArguments = process.argv.slice(2);
const nonProductLayout = unsupportedArguments.length === 1 && unsupportedArguments[0] === '--local-development-layout';
if (unsupportedArguments.length > 0 && !nonProductLayout) {
  throw new Error(`protected-local Windows package build accepts no arguments: ${unsupportedArguments.join(' ')}`);
}

const productionPublicKey = nonProductLayout ? '' : PRODUCT_UPDATE_POLICY.publicKey;
if (!nonProductLayout && (!productionPublicKey || Buffer.from(productionPublicKey, 'base64').length !== 32)) {
  throw new Error(
    'UPDATE_TRUST_NOT_CONFIGURED: Platform Windows product public key is required',
  );
}

const childEnv = { ...process.env };
const cargoTargetRoot = path.join(
  crateRoot,
  'target',
  'windows-production',
);
childEnv.CARGO_TARGET_DIR = cargoTargetRoot;
delete childEnv.NIMI_WINDOWS_PRODUCTION_SIGNER_SPKI_SHA256;
childEnv.NIMI_WINDOWS_PRODUCT_PUBLIC_KEY = productionPublicKey;
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
