#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  requireWindowsDevSigningIdentity,
  signWindowsDevFiles,
} from './lib/windows-dev-signing.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.join(repoRoot, 'runtime');
const outputRoot = path.join(repoRoot, 'dist', 'windows-e2e', 'runtime');
const outputPath = path.join(outputRoot, 'nimi-runtime-e2e.exe');
const signerVariable = 'github.com/nimiplatform/nimi/runtime/internal/protectedlocal.WindowsRuntimeSignerCertSHA256';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`Windows protected E2E Runtime is not admitted for ${process.platform}/${process.arch}`);
}

const identity = requireWindowsDevSigningIdentity({ cwd: repoRoot });
mkdirSync(outputRoot, { recursive: true });
const ldflags = [
  `-X=${signerVariable}=${identity.certificateSha256}`,
  '-X=main.Version=0.1.0-windows-e2e',
].join(' ');
const build = spawnSync(
  'go',
  [
    'build',
    '-trimpath',
    '-tags',
    'nimi_runtime_e2e',
    '-ldflags',
    ldflags,
    '-o',
    outputPath,
    './cmd/nimi',
  ],
  {
    cwd: runtimeRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  },
);
if (build.error) {
  throw new Error(`failed to start Go E2E Runtime build: ${build.error.message}`);
}
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const signed = signWindowsDevFiles([outputPath], { cwd: repoRoot });
if (signed.certificateSha256 !== identity.certificateSha256) {
  throw new Error('Windows E2E Runtime signer changed between build and signing');
}
process.stdout.write(`${outputPath}\n`);
