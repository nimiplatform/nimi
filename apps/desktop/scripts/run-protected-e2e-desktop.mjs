#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireWindowsDevSigningIdentity } from '../../../scripts/lib/windows-dev-signing.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`protected Desktop E2E is not admitted for ${process.platform}/${process.arch}`);
}

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const identity = requireWindowsDevSigningIdentity({ cwd: repoRoot });
const childEnv = {
  ...process.env,
  NIMI_WINDOWS_E2E_SIGNER_CERT_SHA256: identity.certificateSha256,
};
const nodeCarrierBuilder = path.join(
  repoRoot,
  'kit',
  'shell',
  'protected-local-node',
  'scripts',
  'build-windows-x64-package.mjs',
);
const nodeCarrier = spawnSync(process.execPath, [nodeCarrierBuilder, '--e2e-fixture'], {
  cwd: repoRoot,
  env: childEnv,
  stdio: 'inherit',
});
if (nodeCarrier.error) {
  throw new Error(`failed to start protected Electron carrier build: ${nodeCarrier.error.message}`);
}
if (nodeCarrier.status !== 0) {
  process.exit(nodeCarrier.status ?? 1);
}
const runner = path.join(desktopRoot, 'scripts', 'run-tauri-dev.mjs');
const result = spawnSync(
  process.execPath,
  [runner, '--features', 'protected-local-e2e-fixture', ...process.argv.slice(2)],
  {
    cwd: desktopRoot,
    env: childEnv,
    stdio: 'inherit',
  },
);
if (result.error) {
  throw new Error(`failed to start protected Desktop E2E runner: ${result.error.message}`);
}
process.exit(result.status ?? (result.signal ? 1 : 0));
