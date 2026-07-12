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
const virtualAccount = process.argv.slice(2).includes('--virtual-account');
const unknownArguments = process.argv.slice(2).filter((value) => value !== '--virtual-account');
if (unknownArguments.length > 0) {
  throw new Error(`unknown Windows protected E2E build argument: ${unknownArguments[0]}`);
}
const variant = virtualAccount ? 'virtual-account' : 'local-system';
const outputRoot = path.join(repoRoot, 'dist', 'windows-e2e', variant);
const outputPath = path.join(outputRoot, virtualAccount ? 'nimi-runtime-e2e-virtual.exe' : 'nimi-runtime-e2e.exe');
const peerProbeRoot = path.join(outputRoot, 'peer-probe');
const peerProbePath = path.join(peerProbeRoot, 'nimiplatform-desktop-dev-run.exe');
const signerVariable = 'github.com/nimiplatform/nimi/runtime/internal/protectedlocal.WindowsRuntimeSignerCertSHA256';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`Windows protected E2E Runtime is not admitted for ${process.platform}/${process.arch}`);
}

const identity = requireWindowsDevSigningIdentity({ cwd: repoRoot });
mkdirSync(outputRoot, { recursive: true });
mkdirSync(peerProbeRoot, { recursive: true });
const buildTags = virtualAccount ? 'nimi_runtime_e2e,nimi_runtime_e2e_virtual' : 'nimi_runtime_e2e';
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
    buildTags,
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

const peerBuild = spawnSync(
  'go',
  [
    'build',
    '-trimpath',
    '-tags',
    buildTags,
    '-ldflags',
    `-X=${signerVariable}=${identity.certificateSha256}`,
    '-o',
    peerProbePath,
    './cmd/windows-protected-peer-probe',
  ],
  {
    cwd: runtimeRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  },
);
if (peerBuild.error) {
  throw new Error(`failed to start Windows protected peer probe build: ${peerBuild.error.message}`);
}
if (peerBuild.status !== 0) {
  process.exit(peerBuild.status ?? 1);
}

const signedRuntime = signWindowsDevFiles([outputPath], { cwd: repoRoot });
const signedPeerProbe = signWindowsDevFiles([peerProbePath], { cwd: repoRoot });
if (
  signedRuntime.certificateSha256 !== identity.certificateSha256
  || signedPeerProbe.certificateSha256 !== identity.certificateSha256
) {
  throw new Error('Windows E2E Runtime signer changed between build and signing');
}
process.stdout.write(`${JSON.stringify({ variant, runtime: outputPath, peerProbe: peerProbePath })}\n`);
