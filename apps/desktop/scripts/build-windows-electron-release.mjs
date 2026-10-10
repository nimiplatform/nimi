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
import { PRODUCT_UPDATE_POLICY } from '../../../config/product-update-policy.mjs';
import { createWindowsProductIdentity, windowsNsisScript, verifyWindowsUnsignedInstaller } from '../../../scripts/lib/windows-product-release.mjs';
import { hashProductFile, hashProductTree } from '../../../scripts/lib/product-update-manifest.mjs';

import { extractFile, listPackage } from '@electron/asar';
import { packager } from '@electron/packager';

import { flipElectronFuses, HOME_WINDOWS_FUSES, requireElectronFuses } from '../../../scripts/lib/electron-fuses.mjs';
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

const args = process.argv.slice(2);
const production = args[0] === '--production' && args[1] === '--identity-signing-key' && args.length === 3;
if (args.length && !production) throw new Error('Required: --production --identity-signing-key <file>, or no arguments for non-product layout');
if (production && !PRODUCT_UPDATE_POLICY.publicKey) throw new Error('UPDATE_TRUST_NOT_CONFIGURED');
assertNativeWindowsX64(process.platform, process.arch);

const desktopPackage = JSON.parse(await readFile(path.join(desktopRoot, 'package.json'), 'utf8'));
const electronPackage = JSON.parse(await readFile(path.join(desktopRoot, 'node_modules', 'electron', 'package.json'), 'utf8'));
const version = exactReleaseVersion(desktopPackage.version);
const electronVersion = exactReleaseVersion(electronPackage.version);
const outputRoot = resolveWindowsElectronLayoutOutput(desktopRoot);
const developmentIdentity = production ? null : requireWindowsDevSigningIdentity({ cwd: repoRoot });
const sourceRevision = production ? runLayoutCommand('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).stdout.trim() : null;
if (production && runLayoutCommand('git', ['status', '--porcelain=v1'], { cwd: repoRoot }).stdout.trim()) throw new Error('UPDATE_SOURCE_NOT_RELEASEABLE');

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
    await buildLayoutInputs(developmentIdentity);
    await stageApplicationSource(sourceRoot, version);
  });

  const stagedNativeCode = await collectNativeCode(path.join(sourceRoot, 'node_modules'));
  if (stagedNativeCode.length === 0) {
    throw new Error('Windows Electron layout source contains no native code to sign');
  }
  if (!production) {
  const nativeSigning = signWindowsDevFiles(stagedNativeCode, { cwd: repoRoot });
  if (nativeSigning.certificateSha256 !== developmentIdentity.certificateSha256) {
    throw new Error('Windows Electron layout development signer changed while signing native code');
  }
  requireWindowsDevSignedFiles(stagedNativeCode, developmentIdentity.certificateSha256, { cwd: repoRoot });
  }

  const packagedPaths = await packager({
    ...windowsElectronPackagerOptions({
      dir: sourceRoot,
      electronVersion,
      icon: path.join(desktopRoot, 'assets', 'nimi-home-symbol.ico'),
      out: packageRoot,
      resource: path.join(desktopRoot, 'assets', 'nimi-home-symbol.ico'),
      version,
    }),
    // Fuses are sealed by the Authenticode signature, so they are set on the
    // extracted Electron before signing.
    afterExtract: [async ({ buildPath }) => {
      await flipElectronFuses(path.join(buildPath, 'electron.exe'), HOME_WINDOWS_FUSES);
    }],
  });
  if (!Array.isArray(packagedPaths) || packagedPaths.length !== 1) {
    throw new Error('Electron packager returned an ambiguous Windows application layout');
  }
  const packagedRoot = packagedPaths[0];
  await requireDirectory(packagedRoot);

  const executable = path.join(packagedRoot, `${WINDOWS_ELECTRON_LAYOUT_APP_NAME}.exe`);
  await assertWindowsX64PeFile(executable, 'Nimi Desktop executable');
  await requireElectronFuses(executable, HOME_WINDOWS_FUSES);
  if (!production) {
  const executableSigning = signWindowsDevFiles([executable], { cwd: repoRoot });
  if (executableSigning.certificateSha256 !== developmentIdentity.certificateSha256) {
    throw new Error('Windows Electron layout development signer changed while signing the application');
  }
  }

  const packagedNativeCode = await collectNativeCode(
    path.join(packagedRoot, 'resources', 'app.asar.unpacked', 'node_modules'),
  );
  assertSameNativeInventory(sourceRoot, stagedNativeCode, packagedRoot, packagedNativeCode);
  for (const nativePath of packagedNativeCode) {
    await assertWindowsX64PeFile(nativePath, path.basename(nativePath));
  }
  if (!production) requireWindowsDevSignedFiles(
    [executable, ...packagedNativeCode],
    developmentIdentity.certificateSha256,
    { cwd: repoRoot },
  );

  const asarPath = path.join(packagedRoot, 'resources', 'app.asar');
  const mainSource = extractFile(asarPath, 'dist-electron/main.js').toString('utf8');
  assertWindowsElectronAsarInventory(listPackage(asarPath, { isPack: false }), mainSource);
  await requireFile(path.join(packagedRoot, 'resources', 'nimi-home-symbol.ico'));
  if (production) {
    await buildFormalProduct(packagedRoot, sourceRoot, version, sourceRevision, transactionRoot, args[2]);
  } else {
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
  }
} finally {
  await rm(transactionRoot, { recursive: true, force: true });
}

async function buildLayoutInputs(identity) {
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
    ...(!production ? ['--local-development-layout'] : []),
  ], {
    cwd: repoRoot,
    inherit: true,
    env: process.env,
  });
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
    cp(
      path.join(desktopRoot, 'dist-electron', 'local-development-process-guardian.js'),
      path.join(sourceRoot, 'dist-electron', 'local-development-process-guardian.js'),
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
  return result;
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-pkgrel-010
async function buildFormalProduct(packagedRoot, sourceRoot, version, sourceRevision, transactionRoot, keyFile) {
  const runtimeRoot = path.join(packagedRoot, 'runtime'); await mkdir(runtimeRoot);
  for (const [name, owner] of [['desktop', desktopRoot], ['avatar', avatarRoot]]) {
    const resource = path.join(runtimeRoot, 'resources/nimi-apps', name); await mkdir(resource, { recursive: true });
    await cp(path.join(owner, 'nimi.app.yaml'), path.join(resource, 'nimi.app.yaml'));
  }
  const overlaySource = path.join(transactionRoot, 'product-policy.go');
  await writeFile(overlaySource, `package productrelease\nconst PublicKey = ${JSON.stringify(PRODUCT_UPDATE_POLICY.publicKey)}\n`);
  const overlayPath = path.join(transactionRoot, 'go-overlay.json');
  await writeFile(overlayPath, JSON.stringify({ Replace: { [path.join(repoRoot, 'runtime/internal/productrelease/policy.go')]: overlaySource } }));
  for (const [relative, pkg, flags] of [['runtime/nimi.exe', './cmd/nimi', `-s -w -X main.Version=${version}`], ['NimiProductUpdater.exe', './tools/windows-product-updater', '-s -w']]) {
    runLayoutCommand('go', ['build', '-trimpath', '-overlay', overlayPath, '-ldflags', flags, '-o', path.join(packagedRoot, relative), pkg], { cwd: path.join(repoRoot, 'runtime'), inherit: true, env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' } });
  }
  for (const relative of ['Nimi.exe', 'runtime/nimi.exe', 'NimiProductUpdater.exe']) {
    await assertWindowsX64PeFile(path.join(packagedRoot, relative), relative);
    await verifyWindowsUnsignedInstaller(path.join(packagedRoot, relative));
  }
  const avatarVersion = JSON.parse(await readFile(path.join(avatarRoot, 'package.json'), 'utf8')).version;
  await writeFile(path.join(packagedRoot, 'Recovery.txt'), 'Nimi Windows recovery\nDownload the formal Nimi product installer from https://github.com/nimiplatform/nimi/releases and allow the required Windows administrator authorization. Use an admitted forward repair release. Preserve the Runtime-owned data under ProgramData\\Nimi\\Runtime\\Protected; do not move, delete, restore or migrate it with Desktop tools. If Home cannot start, this instruction and the standalone formal installer remain available.\n', { flag: 'wx' });
  const components = { desktop: { version, sha256: await hashProductFile(path.join(packagedRoot, 'resources/app.asar')) },
    runtime: { version, sha256: await hashProductFile(path.join(packagedRoot, 'runtime/nimi.exe')) },
    avatar: { version: avatarVersion, sha256: await hashProductTree(path.join(sourceRoot, 'avatar/dist')) } };
  const admission = await createWindowsProductIdentity({ root: packagedRoot, version, sourceRevision, components, privateKey: await readFile(keyFile) });
  await writeFile(path.join(packagedRoot, 'nimi-product-identity.json'), `${JSON.stringify(admission.envelope)}\n`, { flag: 'wx' });
  const name = `Nimi-${version}-windows-amd64.exe`, installer = path.join(transactionRoot, name);
  const script = path.join(transactionRoot, 'product.nsi');
  await writeFile(script, windowsNsisScript({ root: packagedRoot, output: installer, version }));
  runLayoutCommand('makensis', ['/NOCONFIG', '/V2', script], { cwd: repoRoot, inherit: true });
  await verifyWindowsUnsignedInstaller(installer);
  if (runLayoutCommand('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).stdout.trim() !== sourceRevision
    || runLayoutCommand('git', ['status', '--porcelain=v1'], { cwd: repoRoot }).stdout.trim()) throw new Error('UPDATE_SOURCE_CHANGED_DURING_BUILD');
  const formalOutput = path.join(desktopRoot, 'dist/windows/product');
  await mkdir(formalOutput, { recursive: true });
  const destination = path.join(formalOutput, name); await rename(installer, destination);
  const identity = { schema: 'nimi-product-build/v1', version, target: 'windows-amd64', sourceRevision, dirtyInput: [],
    minimumOsVersion: '10.0.19041', components, asset: { name, size: (await stat(destination)).size, sha256: await hashProductFile(destination) } };
  await writeFile(path.join(formalOutput, `${name}.identity.json`), `${JSON.stringify(identity,null,2)}\n`, { flag: 'wx' });
  await cp(path.join(packagedRoot,'nimi-product-identity.json'), path.join(formalOutput,'nimi-installed-windows-amd64.json'), { errorOnExist: true, force: false });
  process.stdout.write(`${JSON.stringify({ status: 'built', installerPath: destination, identityPath: `${destination}.identity.json`, releaseId: admission.identity.releaseId, target: 'windows-amd64', posture: 'unsigned-beta' })}\n`);
}
