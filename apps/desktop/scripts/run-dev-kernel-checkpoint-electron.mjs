#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolvePortableProcessInvocation } from '../../../scripts/lib/portable-process-command.mjs';
import {
  requireWindowsDevSignedFiles,
  requireWindowsDevSigningIdentity,
} from '../../../scripts/lib/windows-dev-signing.mjs';
import {
  requireFreshPreparedElectronArtifacts,
  requireReusableElectronArtifacts,
  resolveDevKernelElectronBuildMode,
  writeReusableElectronArtifactBinding,
} from './lib/electron-build-mode.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`dev-kernel Desktop Electron candidate is not admitted for ${process.platform}/${process.arch}`);
}

const require = createRequire(import.meta.url);
const desktopRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const trialRoot = requiredDirectory('NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ROOT');
const desktopUserDataRoot = requiredDirectory('NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_USER_DATA_ROOT');
requireDescendant(trialRoot, desktopUserDataRoot, 'NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_USER_DATA_ROOT');
const cdpPort = requiredPort('NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_CDP_PORT');
const rendererUrl = `${pathToFileURL(path.join(desktopRoot, 'dist', 'index.html')).toString()}?nimiDevKernelCheckpoint=1`;
const buildMode = resolveDevKernelElectronBuildMode();

if (buildMode === 'fresh') {
  run('pnpm', [
    '--filter', '@nimiplatform/desktop', 'build:renderer',
  ]);
  run('pnpm', [
    '--filter', '@nimiplatform/desktop', 'build:electron',
  ]);
  run(process.execPath, ['kit/shell/protected-local-node/scripts/build-windows-x64-package.mjs']);
  run(process.execPath, ['apps/desktop/product-control-node/scripts/build-windows-x64-package.mjs']);
  run(process.execPath, ['apps/desktop/scripts/prepare-signed-electron-runtime.mjs']);
}

const electronVersion = String(require('electron/package.json').version || '').trim();
const executablePath = path.join(
  repoRoot, '.nimi', 'local', 'electron-desktop-runtime', electronVersion, 'Nimi Desktop Runtime.exe',
);
if (!fs.existsSync(executablePath)) throw new Error(`signed Desktop Electron executable is missing: ${executablePath}`);
const signingIdentity = requireWindowsDevSigningIdentity({ cwd: repoRoot });
const mainEntry = path.join(desktopRoot, 'dist-electron', 'main.js');
const sourceDigest = requiredSourceDigest('NIMI_LOCAL_AGENT_PRODUCT_SOURCE_DIGEST');
const artifactBindingPath = path.join(
  repoRoot, '.nimi', 'local', 'electron-desktop-runtime', electronVersion, 'diagnostic-artifact-binding.json',
);
const freshPreparedBindingPath = path.join(
  repoRoot, '.nimi', 'local', 'electron-desktop-runtime', electronVersion, 'fresh-prepared-artifact-binding.json',
);
const artifactFiles = [
  path.join(desktopRoot, 'dist', 'index.html'),
  mainEntry,
  path.join(repoRoot, 'kit', 'shell', 'protected-local-node', 'npm', 'win32-x64', 'nimi_shell_protected_local.node'),
  path.join(desktopRoot, 'product-control-node', 'npm', 'win32-x64', 'nimi_desktop_product_control.node'),
  executablePath,
];
if (buildMode === 'reuse') {
  requireReusableElectronArtifacts(artifactFiles, {
    manifestPath: artifactBindingPath,
    repoRoot,
    sourceDigest,
  });
} else if (buildMode === 'fresh-prepared') {
  requireFreshPreparedElectronArtifacts(artifactFiles, {
    manifestPath: freshPreparedBindingPath,
    repoRoot,
    sourceDigest,
    preparationId: process.env.NIMI_DEV_KERNEL_ELECTRON_PREPARATION_ID,
  });
} else {
  requireReusableElectronArtifacts(artifactFiles);
  writeReusableElectronArtifactBinding(artifactFiles, {
    manifestPath: artifactBindingPath,
    repoRoot,
    sourceDigest,
  });
}
requireWindowsDevSignedFiles([executablePath], signingIdentity.certificateSha256, { cwd: repoRoot });
if (buildMode === 'reuse') {
  process.stderr.write('[dev-kernel Electron] diagnostic build mode=reuse; output is not final acceptance evidence\n');
}
const child = spawn(executablePath, [
  '--remote-debugging-address=127.0.0.1',
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${desktopUserDataRoot}`,
  mainEntry,
], {
  cwd: desktopRoot,
  env: {
    ...process.env,
    NIMI_DEV_KERNEL_CHECKPOINT: '1',
    NIMI_DESKTOP_ELECTRON_RENDERER_URL: rendererUrl,
    NIMI_DESKTOP_ELECTRON_STANDARD_DATA_ROOT: path.join(desktopUserDataRoot, 'standard-shell-data'),
    NIMI_DESKTOP_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS: path.join(desktopUserDataRoot, 'standard-shell-data'),
  },
  stdio: 'inherit',
  windowsHide: false,
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (child.exitCode === null) child.kill(signal);
  });
}

child.once('error', (error) => {
  process.stderr.write(`[dev-kernel Electron] launch failed: ${error.message}\n`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});

function run(command, args) {
  const invocation = resolvePortableProcessInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with ${result.status ?? result.signal}`);
}

function requiredDirectory(name) {
  const value = String(process.env[name] || '').trim();
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute directory`);
  fs.mkdirSync(value, { recursive: true });
  return fs.realpathSync.native(value);
}

function requiredSourceDigest(name) {
  const value = String(process.env[name] || '').trim();
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(`${name} must be an exact source digest`);
  return value;
}

function requiredPort(name) {
  const value = Number.parseInt(String(process.env[name] || ''), 10);
  if (!Number.isSafeInteger(value) || value < 1024 || value > 65535) {
    throw new Error(`${name} must be an unprivileged TCP port`);
  }
  return value;
}

function requireDescendant(root, candidate, name) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${name} must be a strict descendant of the isolated trial root`);
  }
}
