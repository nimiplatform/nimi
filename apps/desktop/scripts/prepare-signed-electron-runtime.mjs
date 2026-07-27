#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  requireWindowsDevSigningIdentity,
  requireWindowsDevSignedFiles,
  signWindowsDevFiles,
} from '../../../scripts/lib/windows-dev-signing.mjs';
import { publishPreparedElectronRuntime } from './lib/atomic-electron-runtime.mjs';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const workspaceRoot = path.resolve(appRoot, '../..');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`signed Desktop Electron runtime is not admitted for ${process.platform}/${process.arch}`);
}
if (process.argv.length > 2) {
  throw new Error('prepare-signed-electron-runtime does not accept command-line arguments');
}

const electronExecutable = path.resolve(require('electron'));
const electronRuntimeRoot = path.dirname(electronExecutable);
const electronVersion = String(require('electron/package.json').version || '').trim();
if (!electronVersion || !existsSync(electronExecutable)) {
  throw new Error('Electron runtime package is incomplete');
}

const candidateRoot = path.resolve(
  workspaceRoot,
  '.nimi',
  'local',
  'electron-desktop-runtime',
  electronVersion,
);
const stagingRoot = path.join(
  path.dirname(candidateRoot),
  `.${path.basename(candidateRoot)}.staging-${process.pid}-${randomUUID()}`,
);
const admittedLocalRoot = path.resolve(workspaceRoot, '.nimi', 'local') + path.sep;
if (!candidateRoot.startsWith(admittedLocalRoot)) {
  throw new Error(`refusing to prepare Electron runtime outside .nimi/local: ${candidateRoot}`);
}

const roleExecutableName = 'Nimi Desktop Runtime.exe';
rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagingRoot, { recursive: true });
let desktopExecutable;
let identity;
let signed;
try {
  cpSync(electronRuntimeRoot, stagingRoot, { recursive: true, force: true });
  const sourceExecutable = path.join(stagingRoot, path.basename(electronExecutable));
  const stagedDesktopExecutable = path.join(stagingRoot, roleExecutableName);
  cpSync(sourceExecutable, stagedDesktopExecutable, { force: true });
  identity = requireWindowsDevSigningIdentity({ cwd: workspaceRoot });
  signed = signWindowsDevFiles([stagedDesktopExecutable], { cwd: workspaceRoot });
  if (signed.certificateSha256 !== identity.certificateSha256) {
    throw new Error('Desktop Electron signer changed during preparation');
  }
  requireWindowsDevSignedFiles([stagedDesktopExecutable], identity.certificateSha256, {
    cwd: workspaceRoot,
  });
  desktopExecutable = publishPreparedElectronRuntime({
    stagingRoot,
    candidateRoot,
    roleExecutableName,
  });
  requireWindowsDevSignedFiles([desktopExecutable], identity.certificateSha256, {
    cwd: workspaceRoot,
  });
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  electronVersion,
  executablePath: desktopExecutable,
  signerCertificateSha256: signed.certificateSha256,
  nonProductCandidate: true,
  protectedRuntimeProfile: 'windows-production-v1',
}, null, 2)}\n`);
