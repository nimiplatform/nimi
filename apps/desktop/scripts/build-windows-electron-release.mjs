#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractFile, listPackage } from '@electron/asar';
import { packager } from '@electron/packager';

import { withSdkDistLock } from '../../../scripts/lib/sdk-dist-lock.mjs';
import {
  requireWindowsDevSignedFiles,
  requireWindowsDevSigningIdentity,
  signWindowsDevFiles,
} from '../../../scripts/lib/windows-dev-signing.mjs';
import {
  WINDOWS_ELECTRON_LAYOUT_APP_NAME,
  WINDOWS_ELECTRON_LAYOUT_NOTICE,
  assertNativeWindowsX64,
  assertWindowsElectronAsarInventory,
  assertWindowsX64Pe,
  exactReleaseVersion,
  resolveWindowsElectronLayoutOutput,
  windowsElectronCandidateNotice,
  windowsElectronPackagerOptions,
} from './lib/windows-electron-release-layout.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptRoot, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const avatarRoot = path.join(repoRoot, 'apps', 'avatar');
const localRoot = path.join(repoRoot, '.nimi', 'local');
const corepackCli = path.join(path.dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js');

if (process.argv.length > 2) {
  throw new Error('Windows Electron layout build accepts no command-line arguments');
}
assertNativeWindowsX64(process.platform, process.arch);

const desktopPackage = JSON.parse(await readFile(path.join(desktopRoot, 'package.json'), 'utf8'));
const electronPackage = JSON.parse(await readFile(path.join(desktopRoot, 'node_modules', 'electron', 'package.json'), 'utf8'));
const version = exactReleaseVersion(desktopPackage.version);
const electronVersion = exactReleaseVersion(electronPackage.version);
const outputRoot = resolveWindowsElectronLayoutOutput(desktopRoot);

await mkdir(localRoot, { recursive: true });
const transactionRoot = await mkdtemp(path.join(localRoot, '.windows-electron-layout-'));

try {
  const sourceRoot = path.join(transactionRoot, 'desktop-app');
  const packageRoot = path.join(transactionRoot, 'package-output');
  await Promise.all([
    mkdir(sourceRoot, { recursive: true }),
    mkdir(packageRoot, { recursive: true }),
  ]);

  await withSdkDistLock('Windows Electron release layout inputs', async () => {
    await buildLayoutInputs();
    await stageApplicationSource(sourceRoot, version);
  });

  const developmentIdentity = requireWindowsDevSigningIdentity({ cwd: repoRoot });
  const stagedNativeCode = await collectNativeCode(path.join(sourceRoot, 'node_modules'));
  if (stagedNativeCode.length === 0) {
    throw new Error('Windows Electron layout source contains no native code to sign');
  }
  const nativeSigning = signWindowsDevFiles(stagedNativeCode, { cwd: repoRoot });
  if (nativeSigning.certificateSha256 !== developmentIdentity.certificateSha256) {
    throw new Error('Windows Electron layout development signer changed while signing native code');
  }
  requireWindowsDevSignedFiles(stagedNativeCode, developmentIdentity.certificateSha256, { cwd: repoRoot });

  const packagedPaths = await packager(windowsElectronPackagerOptions({
    dir: sourceRoot,
    electronVersion,
    icon: path.join(desktopRoot, 'src', 'shell', 'renderer', 'assets', 'favicon.ico'),
    out: packageRoot,
    resource: path.join(desktopRoot, 'src', 'shell', 'renderer', 'assets', 'favicon-32x32.png'),
    version,
  }));
  if (!Array.isArray(packagedPaths) || packagedPaths.length !== 1) {
    throw new Error('Electron packager returned an ambiguous Windows application layout');
  }
  const packagedRoot = packagedPaths[0];
  await requireDirectory(packagedRoot);

  const executable = path.join(packagedRoot, `${WINDOWS_ELECTRON_LAYOUT_APP_NAME}.exe`);
  await assertWindowsX64PeFile(executable, 'Nimi Desktop executable');
  const executableSigning = signWindowsDevFiles([executable], { cwd: repoRoot });
  if (executableSigning.certificateSha256 !== developmentIdentity.certificateSha256) {
    throw new Error('Windows Electron layout development signer changed while signing the application');
  }

  const packagedNativeCode = await collectNativeCode(
    path.join(packagedRoot, 'resources', 'app.asar.unpacked', 'node_modules'),
  );
  assertSameNativeInventory(sourceRoot, stagedNativeCode, packagedRoot, packagedNativeCode);
  for (const nativePath of packagedNativeCode) {
    await assertWindowsX64PeFile(nativePath, path.basename(nativePath));
  }
  requireWindowsDevSignedFiles(
    [executable, ...packagedNativeCode],
    developmentIdentity.certificateSha256,
    { cwd: repoRoot },
  );

  const asarPath = path.join(packagedRoot, 'resources', 'app.asar');
  const mainSource = extractFile(asarPath, 'dist-electron/main.js').toString('utf8');
  assertWindowsElectronAsarInventory(listPackage(asarPath, { isPack: false }), mainSource);
  await requireFile(path.join(packagedRoot, 'resources', 'favicon-32x32.png'));
  await writeFile(
    path.join(packagedRoot, WINDOWS_ELECTRON_LAYOUT_NOTICE),
    windowsElectronCandidateNotice({ electronVersion, version }),
    { encoding: 'utf8', flag: 'wx' },
  );

  await replaceOutput(packagedRoot, outputRoot);
  process.stdout.write(`${JSON.stringify({
    status: 'built',
    layoutPath: outputRoot,
    executablePath: path.join(outputRoot, `${WINDOWS_ELECTRON_LAYOUT_APP_NAME}.exe`),
    version,
    candidateKind: 'windows-electron-local-development-layout',
    promotable: false,
    signerCertificateSha256: developmentIdentity.certificateSha256,
  })}\n`);
} finally {
  await rm(transactionRoot, { recursive: true, force: true });
}

async function buildLayoutInputs() {
  await requireFile(corepackCli);
  runPnpm(['--filter', '@nimiplatform/sdk', 'build']);
  runPnpm(['--filter', '@nimiplatform/kit', 'build']);
  runPnpm(['--dir', desktopRoot, 'run', 'build:renderer']);
  runPnpm(['--dir', avatarRoot, 'run', 'build:renderer']);
  runPnpm(['--dir', desktopRoot, 'exec', 'tsc', '-p', 'tsconfig.electron.json', '--noEmit']);
  runLayoutCommand(process.execPath, [
    path.join(scriptRoot, 'bundle-electron-main.mjs'),
    '--release',
  ], { cwd: repoRoot, inherit: true });
  runLayoutCommand(process.execPath, [
    path.join(scriptRoot, 'bundle-electron-preload.mjs'),
  ], { cwd: repoRoot, inherit: true });
  runLayoutCommand(process.execPath, [
    path.join(repoRoot, 'kit', 'shell', 'protected-local-node', 'scripts', 'build-windows-x64-package.mjs'),
  ], { cwd: repoRoot, inherit: true });
}

function runPnpm(args) {
  runLayoutCommand(process.execPath, [corepackCli, 'pnpm', ...args], { cwd: repoRoot, inherit: true });
}

async function stageApplicationSource(sourceRoot, packageVersion) {
  await mkdir(path.join(sourceRoot, 'dist-electron'), { recursive: true });
  await Promise.all([
    cp(path.join(desktopRoot, 'dist'), path.join(sourceRoot, 'dist'), { recursive: true, force: false }),
    cp(path.join(avatarRoot, 'dist'), path.join(sourceRoot, 'avatar', 'dist'), { recursive: true, force: false }),
    cp(path.join(desktopRoot, 'assets'), path.join(sourceRoot, 'assets'), { recursive: true, force: false }),
    cp(path.join(desktopRoot, 'dist-electron', 'main.js'), path.join(sourceRoot, 'dist-electron', 'main.js')),
    cp(
      path.join(desktopRoot, 'dist-electron', 'chat-ai-store-worker.js'),
      path.join(sourceRoot, 'dist-electron', 'chat-ai-store-worker.js'),
    ),
    cp(path.join(desktopRoot, 'dist-electron', 'preload.cjs'), path.join(sourceRoot, 'dist-electron', 'preload.cjs')),
  ]);
  await Promise.all([
    stageSharpRuntime(sourceRoot),
    stageProtectedLocalCarrier(sourceRoot),
  ]);
  await writeFile(path.join(sourceRoot, 'package.json'), `${JSON.stringify({
    description: 'Nimi Desktop',
    main: 'dist-electron/main.js',
    name: 'nimi-desktop',
    private: true,
    type: 'module',
    version: packageVersion,
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

async function stageSharpRuntime(sourceRoot) {
  const sharpRoot = await realpath(path.join(repoRoot, 'kit', 'node_modules', 'sharp'));
  const sharpNodeModules = path.dirname(sharpRoot);
  const packages = [
    ['sharp', sharpRoot],
    ['detect-libc', await realpath(path.join(sharpNodeModules, 'detect-libc'))],
    ['semver', await realpath(path.join(sharpNodeModules, 'semver'))],
    ['@img/colour', await realpath(path.join(sharpNodeModules, '@img', 'colour'))],
    ['@img/sharp-win32-x64', await realpath(path.join(sharpNodeModules, '@img', 'sharp-win32-x64'))],
  ];
  for (const [packageName, packageSource] of packages) {
    await stageNodePackage(sourceRoot, packageName, packageSource);
  }
}

async function stageProtectedLocalCarrier(sourceRoot) {
  const carrierRoot = path.join(
    repoRoot,
    'kit',
    'shell',
    'protected-local-node',
    'npm',
    'win32-x64',
  );
  await stageNodePackage(sourceRoot, '@nimiplatform/kit-protected-local-win32-x64', carrierRoot);
}

async function stageNodePackage(sourceRoot, packageName, packageSource) {
  const destination = path.join(sourceRoot, 'node_modules', ...packageName.split('/'));
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(packageSource, destination, { recursive: true, force: false, dereference: true });
}

async function collectNativeCode(root) {
  const result = [];
  const visit = async (candidate) => {
    const entries = await readdir(candidate, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(candidate, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && /\.(?:dll|node)$/iu.test(entry.name)) {
        result.push(entryPath);
      }
    }
  };
  await visit(root);
  return result;
}

async function assertWindowsX64PeFile(file, label) {
  assertWindowsX64Pe(await readFile(file), label);
}

function assertSameNativeInventory(sourceRoot, stagedNativeCode, packagedRoot, packagedNativeCode) {
  const sourceNodeModules = path.join(sourceRoot, 'node_modules');
  const packagedNodeModules = path.join(packagedRoot, 'resources', 'app.asar.unpacked', 'node_modules');
  const staged = stagedNativeCode.map((candidate) => path.relative(sourceNodeModules, candidate)).sort();
  const packaged = packagedNativeCode.map((candidate) => path.relative(packagedNodeModules, candidate)).sort();
  if (staged.length !== packaged.length || staged.some((candidate, index) => candidate !== packaged[index])) {
    throw new Error('Windows Electron layout native code inventory changed during packaging');
  }
}

async function replaceOutput(source, destination) {
  const expected = resolveWindowsElectronLayoutOutput(desktopRoot);
  if (destination !== expected) {
    throw new Error('refusing to replace an unexpected Windows Electron layout path');
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await rename(source, destination);
}

async function requireDirectory(candidate) {
  const metadata = await stat(candidate);
  if (!metadata.isDirectory()) throw new Error(`required Windows Electron layout directory is missing: ${candidate}`);
}

async function requireFile(candidate) {
  const metadata = await stat(candidate);
  if (!metadata.isFile()) throw new Error(`required Windows Electron layout file is missing: ${candidate}`);
}

function runLayoutCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024,
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const diagnostic = `${result.stderr || ''}\n${result.stdout || ''}`
      .replaceAll(/[\r\n\t]+/gu, ' ')
      .replaceAll(/\s+/gu, ' ')
      .trim()
      .slice(0, 500);
    throw new Error(`${path.basename(command)} failed with status ${result.status ?? 'unavailable'}${diagnostic ? `: ${diagnostic}` : ''}`, {
      cause: result.error,
    });
  }
}
