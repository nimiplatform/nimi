#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  requireWindowsDevSignedFiles,
  requireWindowsDevSigningIdentity,
} from './lib/windows-dev-signing.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, '..');
const desktopRoot = path.join(repoRoot, 'apps', 'desktop');
const localRoot = path.join(repoRoot, '.nimi', 'local');
const outputBase = path.join(repoRoot, 'dist', 'windows-desktop-installer');
const windowsInstallerInclude = path.join(desktopRoot, 'windows', 'installer.nsh');
const windowsIcon = path.join(
  desktopRoot,
  'src',
  'shell',
  'renderer',
  'assets',
  'favicon.ico',
);
const corepackPnpm = path.join(
  path.dirname(process.execPath),
  'node_modules',
  'corepack',
  'dist',
  'pnpm.js',
);

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Windows Nimi installer candidates must be built natively on Windows x64');
}
requireFile(corepackPnpm, 'project Node.js Corepack pnpm launcher');
if (process.argv.length !== 3 || process.argv[2] !== '--local-development-candidate') {
  throw new Error(
    'Windows production installer is unavailable until the admitted production signing/import contract exists; use --local-development-candidate',
  );
}

const identity = requireWindowsDevSigningIdentity({ cwd: repoRoot });
mkdirSync(localRoot, { recursive: true });
const transactionRoot = mkdtempSync(path.join(localRoot, '.windows-desktop-installer-'));
let outputRoot;
let completed = false;

try {
  const layout = runJson(
    process.execPath,
    [corepackPnpm, '--filter', '@nimiplatform/desktop', 'run', 'build:windows:electron:layout'],
    { cwd: repoRoot },
  );
  assertLayoutResult(layout, identity.certificateSha256);

  runChecked(process.execPath, [path.join(scriptRoot, 'build-runtime.mjs')], { cwd: repoRoot });
  const runtimeInstaller = runJson(
    process.execPath,
    [path.join(scriptRoot, 'build-windows-runtime-service-installer.mjs')],
    { cwd: repoRoot },
  );
  assertRuntimeInstallerResult(runtimeInstaller, identity.certificateSha256);

  const layoutPath = requireDirectory(layout.layoutPath, 'Windows Electron layout');
  const executablePath = requireFile(layout.executablePath, 'Windows Electron executable');
  const runtimeBinary = requireFile(
    path.join(repoRoot, 'dist', 'nimi.exe'),
    'signed Windows Runtime binary',
  );
  const runtimeInstallerPath = requireFile(
    runtimeInstaller.installerPath,
    'signed Windows Runtime service installer',
  );
  const runtimeResourceRoot = requireDirectory(
    path.join(path.dirname(runtimeInstallerPath), 'resources'),
    'Windows Runtime service installer resources',
  );
  const nativeCarriers = findFiles(
    path.join(
      layoutPath,
      'resources',
      'app.asar.unpacked',
      'node_modules',
      '@nimiplatform',
    ),
    (candidate) => /\.(?:dll|node)$/iu.test(candidate),
  );
  if (nativeCarriers.length === 0) {
    throw new Error('Windows Electron layout contains no admitted packaged native carrier');
  }
  requireWindowsDevSignedFiles(
    [executablePath, runtimeBinary, runtimeInstallerPath, ...nativeCarriers],
    identity.certificateSha256,
    { cwd: repoRoot },
  );

  const version = exactVersion(layout.version);
  const commit = capture('git', ['rev-parse', 'HEAD'], repoRoot);
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error('Windows installer source commit is invalid');
  const releaseId = createReleaseId({
    commit,
    desktopLayoutSha256: directorySha256(layoutPath),
    runtimeBinarySha256: fileSha256(runtimeBinary),
    runtimeInstallerSha256: fileSha256(runtimeInstallerPath),
    version,
  });
  outputRoot = path.join(outputBase, `nimi-${version}-windows-x64-local-development-${releaseId}`);
  prepareOutputRoot(outputRoot);

  const buildResources = path.join(transactionRoot, 'build-resources');
  const runtimeServiceResources = path.join(buildResources, 'runtime-service');
  mkdirSync(runtimeServiceResources, { recursive: true });
  copyFileSync(runtimeBinary, path.join(runtimeServiceResources, 'nimi.exe'));
  copyFileSync(runtimeInstallerPath, path.join(runtimeServiceResources, 'install-nimi-runtime.ps1'));
  cpSync(runtimeResourceRoot, path.join(runtimeServiceResources, 'resources'), {
    recursive: true,
    force: false,
  });

  const artifactName = `Nimi-${version}-windows-x64-local-development-${releaseId}-setup.\${ext}`;
  const configPath = path.join(transactionRoot, 'electron-builder.json');
  const config = windowsBuilderConfig({
    artifactName,
    buildResources,
    identity,
    outputRoot,
    version,
  });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const builderEnvironment = { ...process.env };
  for (const name of [
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'WIN_CSC_LINK',
    'WIN_CSC_KEY_PASSWORD',
  ]) {
    delete builderEnvironment[name];
  }
  runChecked(
    process.execPath,
    [
      corepackPnpm,
      '--dir', desktopRoot,
      'exec', 'electron-builder',
      '--win', 'nsis',
      '--x64',
      '--prepackaged', layoutPath,
      '--config', configPath,
    ],
    { cwd: repoRoot, env: builderEnvironment },
  );

  for (const generatedDiagnostic of ['builder-debug.yml', 'builder-effective-config.yaml']) {
    rmSync(path.join(outputRoot, generatedDiagnostic), { force: true });
  }
  const elevateHelper = requireFile(
    path.join(layoutPath, 'resources', 'elevate.exe'),
    'electron-builder per-machine elevation helper',
  );
  requireWindowsDevSignedFiles([elevateHelper], identity.certificateSha256, { cwd: repoRoot });

  const setupCandidates = findFiles(
    outputRoot,
    (candidate) => /-setup\.exe$/iu.test(candidate),
  );
  if (setupCandidates.length !== 1) {
    throw new Error(
      `electron-builder must create exactly one Windows setup executable; found ${setupCandidates.join(', ')}`,
    );
  }
  const setupPath = setupCandidates[0];
  requireWindowsDevSignedFiles([setupPath], identity.certificateSha256, { cwd: repoRoot });

  const sourceDirty = capture('git', ['status', '--porcelain', '--untracked-files=no'], repoRoot).length > 0;
  writeFileSync(
    path.join(outputRoot, 'WINDOWS-LOCAL-DEVELOPMENT-CANDIDATE.txt'),
    [
      'WINDOWS LOCAL DEVELOPMENT CANDIDATE — NOT PROMOTABLE',
      `version=${version}`,
      `commit=${commit}`,
      `releaseId=${releaseId}`,
      `sourceDirty=${String(sourceDirty)}`,
      'platform=windows/x64',
      'The setup executable and its executable payloads use the Nimi local-development signing identity.',
      'The Runtime remains a separately signed service payload invoked by the outer Nimi installer.',
      'This candidate has no SignPath production signature and cannot be used for RC or Stable.',
      'Normal uninstall preserves Product Control, ProgramData protected state, account data, models, dependencies, environments, and Electron user data.',
      '',
    ].join('\n'),
    'utf8',
  );

  completed = true;
  process.stdout.write(`${JSON.stringify({
    status: 'built',
    candidateKind: 'local-development',
    promotable: false,
    version,
    commit,
    releaseId,
    setupPath,
    signerCertificateSha256: identity.certificateSha256,
    runtimeCandidateId: runtimeInstaller.runtimeCandidateId,
  })}\n`);
} finally {
  rmSync(transactionRoot, { recursive: true, force: true });
  if (!completed && outputRoot) rmSync(outputRoot, { recursive: true, force: true });
}

function windowsBuilderConfig(input) {
  return {
    appId: 'ai.nimi.apps.nimi.desktop',
    productName: 'Nimi',
    artifactName: input.artifactName,
    buildVersion: input.version,
    compression: 'normal',
    forceCodeSigning: true,
    npmRebuild: false,
    extraMetadata: {
      name: 'nimi',
      version: input.version,
      description: 'Nimi — local-first personal AI',
      author: 'Nimi Network Limited',
    },
    directories: {
      buildResources: input.buildResources,
      output: input.outputRoot,
    },
    win: {
      target: ['nsis'],
      icon: windowsIcon,
      requestedExecutionLevel: 'requireAdministrator',
      verifyUpdateCodeSignature: false,
      signtoolOptions: {
        certificateSubjectName: input.identity.subject.replace(/^CN=/u, ''),
        publisherName: [input.identity.subject],
        signingHashAlgorithms: ['sha256'],
      },
    },
    nsis: {
      oneClick: false,
      perMachine: true,
      allowElevation: true,
      allowToChangeInstallationDirectory: false,
      createDesktopShortcut: false,
      createStartMenuShortcut: true,
      shortcutName: 'Nimi',
      uninstallDisplayName: 'Nimi',
      deleteAppDataOnUninstall: false,
      differentialPackage: false,
      include: windowsInstallerInclude,
      installerIcon: windowsIcon,
      uninstallerIcon: windowsIcon,
      installerHeaderIcon: windowsIcon,
      license: path.join(repoRoot, 'LICENSE'),
      runAfterFinish: false,
      warningsAsErrors: true,
    },
  };
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`);
  }
  return result;
}

function runJson(command, args, options = {}) {
  const result = runChecked(command, args, options);
  const lines = String(result.stdout || '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const payload = JSON.parse(lines[index]);
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
    } catch {
      // Earlier child output is ordinary build logging; only a final JSON object is contractual.
    }
  }
  throw new Error(`${command} did not emit a final JSON object`);
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${String(result.stderr || '').trim()}`);
  }
  return String(result.stdout || '').trim();
}

function assertLayoutResult(payload, expectedSigner) {
  if (payload?.status !== 'built'
      || payload?.candidateKind !== 'windows-electron-local-development-layout'
      || payload?.promotable !== false
      || payload?.signerCertificateSha256 !== expectedSigner) {
    throw new Error('Windows Electron layout did not return an admitted local-development candidate');
  }
}

function assertRuntimeInstallerResult(payload, expectedSigner) {
  if (payload?.status !== 'signed'
      || payload?.signerCertificateSha256 !== expectedSigner
      || !/^runtime-[0-9a-f]{32}$/u.test(String(payload?.runtimeCandidateId || ''))) {
    throw new Error('Windows Runtime service installer did not return the admitted signed candidate');
  }
}

function requireFile(candidate, label) {
  const resolved = path.resolve(String(candidate || ''));
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error(`${label} is missing: ${resolved}`);
  }
  return resolved;
}

function requireDirectory(candidate, label) {
  const resolved = path.resolve(String(candidate || ''));
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`${label} is missing: ${resolved}`);
  }
  return resolved;
}

function findFiles(root, predicate) {
  if (!existsSync(root)) return [];
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...findFiles(candidate, predicate));
    if (entry.isFile() && predicate(candidate)) found.push(candidate);
  }
  return found.sort((left, right) => left.localeCompare(right));
}

function prepareOutputRoot(candidate) {
  const resolvedBase = path.resolve(outputBase);
  const resolved = path.resolve(candidate);
  const relative = path.relative(resolvedBase, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Windows installer output must be one candidate directory under ${resolvedBase}`);
  }
  rmSync(resolved, { recursive: true, force: true });
  mkdirSync(resolved, { recursive: true });
}

function exactVersion(value) {
  const version = String(value || '');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version)) {
    throw new Error(`Windows Desktop package version must be an exact stable SemVer: ${version}`);
  }
  return version;
}

function fileSha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function directorySha256(root) {
  const digest = createHash('sha256');
  const files = findFiles(root, () => true);
  if (files.length === 0) throw new Error(`Cannot identify an empty Windows layout: ${root}`);
  for (const filePath of files) {
    const relative = path.relative(root, filePath).replaceAll('\\', '/');
    digest.update(relative);
    digest.update('\0');
    digest.update(fileSha256(filePath));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function createReleaseId(input) {
  const digest = createHash('sha256');
  for (const value of [
    input.version,
    input.commit,
    input.desktopLayoutSha256,
    input.runtimeBinarySha256,
    input.runtimeInstallerSha256,
  ]) {
    digest.update(value);
    digest.update('\0');
  }
  return digest.digest('hex').slice(0, 24);
}
