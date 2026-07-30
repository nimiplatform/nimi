#!/usr/bin/env node
import {
  cp,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { notarize } from '@electron/notarize';
import { sign } from '@electron/osx-sign';
import { packager } from '@electron/packager';

import { withSdkDistLock } from '../../../scripts/lib/sdk-dist-lock.mjs';
import {
  requireMacOSSigningIdentity,
  runReleaseCommand,
  verifySignedMacOSCode,
  verifySignedMacOSApplication,
  verifySignedMacOSInstaller,
} from './lib/macos-release-process.mjs';
import { MACOS_LOCAL_DEVELOPMENT_PROFILE } from './generated/macos-local-development-profile.mjs';
import {
  finalizeMacOSLocalDevelopmentCandidate,
} from './lib/macos-local-development-release.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptRoot, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const avatarRoot = path.join(repoRoot, 'apps', 'avatar');
const localRoot = path.join(repoRoot, '.nimi', 'local');
const layoutOnly = process.argv.includes('--layout-only');
const localDevelopment = process.argv.includes('--local-development-candidate');
if (layoutOnly && localDevelopment) {
  throw new Error('macOS production layout and local-development candidate modes are mutually exclusive');
}
if (!layoutOnly && !localDevelopment) {
  throw new Error('macOS production release is unavailable until the native production service installation path is implemented');
}
if (process.argv.slice(2).some((value) => value !== '--layout-only' && value !== '--local-development-candidate')) {
  throw new Error('macOS Electron release accepts only --layout-only or --local-development-candidate');
}
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('macOS Electron release must be built natively on Apple Silicon');
}
const desktopPackage = JSON.parse(await readFile(path.join(desktopRoot, 'package.json'), 'utf8'));
const electronPackage = JSON.parse(await readFile(path.join(desktopRoot, 'node_modules', 'electron', 'package.json'), 'utf8'));
const version = exactVersion(desktopPackage.version);
const electronVersion = exactVersion(electronPackage.version);
const release = layoutOnly || localDevelopment ? undefined : readMacOSProductionInputs(process.env);
const outputName = layoutOnly ? `layout-${Date.now()}` : localDevelopment ? `local-development-${Date.now()}` : release.releaseId;
const outputRoot = resolveOutputRoot(process.env.NIMI_MACOS_RELEASE_OUTPUT, outputName);
await assertAbsent(outputRoot);
await mkdir(localRoot, { recursive: true, mode: 0o700 });
const transactionRoot = await mkdtemp(path.join(localRoot, '.macos-electron-release-'));

let completed = false;
try {
  const sourceRoot = path.join(transactionRoot, 'sources');
  const packageRoot = path.join(transactionRoot, 'packages');
  const electronZipRoot = path.join(transactionRoot, 'electron-zip');
  const candidateRoot = path.join(transactionRoot, 'candidate-output');
  await Promise.all([
    mkdir(sourceRoot, { recursive: true }),
    mkdir(packageRoot, { recursive: true }),
    mkdir(electronZipRoot, { recursive: true }),
    mkdir(candidateRoot, { recursive: true, mode: 0o700 }),
  ]);

  await withSdkDistLock('macOS Electron release inputs', () => (
    buildReleaseInputs({ localDevelopment, release, sourceRoot })
  ));
  await prepareElectronZip(electronVersion, electronZipRoot);
  const localHostApp = await packageLocalAppHost({ electronVersion, electronZipRoot, localDevelopment, packageRoot, sourceRoot, version });
  await stageNativeCarrier(localHostApp);
  if (release) {
    requireMacOSSigningIdentity(release.applicationIdentity);
    requireMacOSSigningIdentity(release.installerIdentity);
    await signMacOSApplication(localHostApp, release, { ignore: undefined });
    await notarizeAndStaple(localHostApp, release);
    verifySignedMacOSApplication(localHostApp, [localHostExecutable(localHostApp)]);
  }

  const desktopApp = await packageDesktop({ electronVersion, electronZipRoot, localDevelopment, packageRoot, sourceRoot, version });
  const embeddedLocalHost = path.join(desktopApp, 'Contents', 'Frameworks', localDevelopment ? 'Nimi Local App Host Dev.app' : 'Nimi Local App Host.app');
  await runDittoCopy(localHostApp, embeddedLocalHost);
  await stageDesktopNativeAssets(desktopApp, sourceRoot, localDevelopment);

  if (!release) {
    const applicationName = localDevelopment ? 'Nimi Dev.app' : 'Nimi.app';
    await runDittoCopy(desktopApp, path.join(candidateRoot, applicationName));
    if (localDevelopment) {
      await finalizeMacOSLocalDevelopmentCandidate({
        candidateRoot,
        sourceRoot,
      });
    }
    await chmod(candidateRoot, 0o700);
    await rename(candidateRoot, outputRoot);
    completed = true;
    process.stdout.write(`macOS Electron output: ${outputRoot}\n`);
  } else {
    await signMacOSApplication(desktopApp, release, {
      ignore: (candidate) => candidate === embeddedLocalHost || candidate.startsWith(`${embeddedLocalHost}${path.sep}`),
    });
    await notarizeAndStaple(desktopApp, release);
    const rolePaths = resolveRolePaths(desktopApp);
    verifySignedMacOSApplication(desktopApp, Object.values(rolePaths));
    verifySignedMacOSApplication(embeddedLocalHost, [rolePaths.nimi_local_app_host]);
    for (const [role, executable] of Object.entries(rolePaths)) {
      verifySignedMacOSCode(executable, productionSigningIdentifier(role), release.teamId);
    }
    const pkgPath = await buildSignedInstaller({
      candidateRoot,
      desktopApp,
      release,
      transactionRoot,
      version,
    });
    await notarizeAndStaple(pkgPath, release);
    verifySignedMacOSInstaller(pkgPath);
    await rename(candidateRoot, outputRoot);
    completed = true;
    process.stdout.write(`macOS Electron release output: ${outputRoot}\n`);
  }
} finally {
  await rm(transactionRoot, { recursive: true, force: true });
  if (!completed) await rm(outputRoot, { recursive: true, force: true });
}

async function buildReleaseInputs({
  localDevelopment: localDevelopmentBuild,
  release: releaseInput,
  sourceRoot,
}) {
  runReleaseCommand('corepack', ['pnpm', '--filter', '@nimiplatform/sdk', 'build'], { cwd: repoRoot, inherit: true });
  runReleaseCommand('corepack', ['pnpm', '--filter', '@nimiplatform/kit', 'build'], { cwd: repoRoot, inherit: true });
  runReleaseCommand('corepack', ['pnpm', '--dir', desktopRoot, 'run', 'build:renderer'], { cwd: repoRoot, inherit: true });
  runReleaseCommand('corepack', ['pnpm', '--dir', avatarRoot, 'run', 'build:renderer'], { cwd: repoRoot, inherit: true });
  runReleaseCommand('corepack', ['pnpm', '--dir', desktopRoot, 'exec', 'tsc', '-p', 'tsconfig.electron.json', '--noEmit'], { cwd: repoRoot, inherit: true });
  runReleaseCommand(process.execPath, [
    path.join(scriptRoot, 'bundle-electron-main.mjs'),
    '--release',
    ...(localDevelopmentBuild ? ['--macos-local-development'] : []),
  ], { cwd: repoRoot, inherit: true });
  runReleaseCommand(process.execPath, [path.join(scriptRoot, 'bundle-electron-preload.mjs')], { cwd: repoRoot, inherit: true });

  const nativeBuildEnvironment = releaseCompileEnvironment({ release: releaseInput });
  runReleaseCommand(process.execPath, [
    path.join(desktopRoot, 'product-control-node', 'scripts', 'build-darwin-arm64-package.mjs'),
  ], { cwd: repoRoot, env: nativeBuildEnvironment, inherit: true });
  runReleaseCommand(process.execPath, [
    path.join(repoRoot, 'kit', 'shell', 'protected-local-node', 'scripts', 'build-darwin-arm64-package.mjs'),
    ...(localDevelopmentBuild ? ['--local-development'] : releaseInput ? [] : ['--layout-only']),
  ], { cwd: repoRoot, env: nativeBuildEnvironment, inherit: true });

  const runtimeOutput = path.join(sourceRoot, 'nimi-runtime');
  const goArguments = ['build', '-trimpath', '-buildvcs=true', '-o', runtimeOutput];
  if (localDevelopmentBuild) {
    goArguments.push('-tags', 'nimi_macos_local_development');
    goArguments.push(
      '-ldflags',
      `-X github.com/nimiplatform/nimi/runtime/cmd/nimi.Version=${version}`,
    );
  } else if (releaseInput) {
    goArguments.push('-ldflags', [
      `-X github.com/nimiplatform/nimi/runtime/cmd/nimi.Version=${version}`,
      `-X github.com/nimiplatform/nimi/runtime/internal/protectedlocal.MacOSTeamID=${releaseInput.teamId}`,
    ].join(' '));
  } else {
    goArguments.push('-ldflags', `-X github.com/nimiplatform/nimi/runtime/cmd/nimi.Version=${version}`);
  }
  goArguments.push('./cmd/nimi');
  runReleaseCommand('go', goArguments, {
    cwd: path.join(repoRoot, 'runtime'),
    env: { ...nativeBuildEnvironment, CGO_ENABLED: '1', GOARCH: 'arm64', GOOS: 'darwin' },
    inherit: true,
  });
  await chmod(runtimeOutput, 0o755);
}

async function prepareElectronZip(electronVersionValue, electronZipRoot) {
  const sourceApp = path.join(desktopRoot, 'node_modules', 'electron', 'dist', 'Electron.app');
  await requireDirectory(sourceApp);
  const zipPath = path.join(electronZipRoot, `electron-v${electronVersionValue}-darwin-arm64.zip`);
  runReleaseCommand('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', sourceApp, zipPath]);
}

async function packageDesktop(input) {
  const source = path.join(input.sourceRoot, 'desktop-app');
  await mkdir(path.join(source, 'dist-electron'), { recursive: true });
  await Promise.all([
    cp(path.join(desktopRoot, 'dist'), path.join(source, 'dist'), { recursive: true, force: false }),
    cp(path.join(avatarRoot, 'dist'), path.join(source, 'avatar', 'dist'), { recursive: true, force: false }),
    cp(path.join(desktopRoot, 'assets'), path.join(source, 'assets'), { recursive: true, force: false }),
    cp(path.join(desktopRoot, 'dist-electron', 'main.js'), path.join(source, 'dist-electron', 'main.js')),
    cp(
      path.join(desktopRoot, 'dist-electron', 'chat-ai-store-worker.js'),
      path.join(source, 'dist-electron', 'chat-ai-store-worker.js'),
    ),
    cp(path.join(desktopRoot, 'dist-electron', 'preload.cjs'), path.join(source, 'dist-electron', 'preload.cjs')),
  ]);
  await stageSharpRuntime(source);
  await stageDesktopProductControlRuntime(source);
  await writeManifest(path.join(source, 'package.json'), {
    main: 'dist-electron/main.js',
    name: 'nimi-desktop',
    type: 'module',
    version: input.version,
  });
  return packageElectronApplication({
    appBundleId: input.localDevelopment ? MACOS_LOCAL_DEVELOPMENT_PROFILE.desktopSigningIdentifier : 'ai.nimi.apps.nimi.desktop',
    appCategoryType: 'public.app-category.social-networking',
    dir: source,
    electronVersion: input.electronVersion,
    electronZipDir: input.electronZipRoot,
    executableName: input.localDevelopment ? 'Nimi Dev' : 'Nimi',
    extraResource: path.join(desktopRoot, 'src', 'shell', 'renderer', 'assets', 'favicon-32x32.png'),
    icon: path.join(desktopRoot, 'assets', 'icon.icns'),
    name: input.localDevelopment ? 'Nimi Dev' : 'Nimi',
    out: path.join(input.packageRoot, 'desktop'),
    version: input.version,
  });
}

async function packageLocalAppHost(input) {
  const source = path.join(input.sourceRoot, 'local-app-host');
  await mkdir(source, { recursive: true });
  const mainSource = await readFile(path.join(desktopRoot, 'macos', 'local-app-host', 'main.mjs'), 'utf8');
  await writeFile(
    path.join(source, 'main.mjs'),
    mainSource,
    { encoding: 'utf8', flag: 'wx', mode: 0o644 },
  );
  const contractSource = await readFile(path.join(desktopRoot, 'macos', 'local-app-host', 'contract.mjs'), 'utf8');
  const productionPathLiteral = "'/Applications/Nimi.app/Contents/Frameworks/Nimi Local App Host.app/Contents/MacOS/Nimi Local App Host'";
  const expectedOccurrenceCount = contractSource.split(productionPathLiteral).length - 1;
  if (expectedOccurrenceCount !== 1) {
    throw new Error('macOS local-app host executable contract is ambiguous');
  }
  const packagedContract = input.localDevelopment
    ? contractSource.replace(productionPathLiteral, JSON.stringify(MACOS_LOCAL_DEVELOPMENT_PROFILE.localAppHostPath))
    : contractSource;
  await writeFile(path.join(source, 'contract.mjs'), packagedContract, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
  await writeManifest(path.join(source, 'package.json'), {
    main: 'main.mjs',
    name: 'nimi-local-app-host',
    type: 'module',
    version: input.version,
  });
  return packageElectronApplication({
    appBundleId: input.localDevelopment ? MACOS_LOCAL_DEVELOPMENT_PROFILE.localAppHostSigningIdentifier : 'ai.nimi.apps.nimi.local-app-host',
    appCategoryType: 'public.app-category.developer-tools',
    dir: source,
    electronVersion: input.electronVersion,
    electronZipDir: input.electronZipRoot,
    executableName: input.localDevelopment ? 'Nimi Local App Host Dev' : 'Nimi Local App Host',
    icon: path.join(desktopRoot, 'assets', 'icon.icns'),
    name: input.localDevelopment ? 'Nimi Local App Host Dev' : 'Nimi Local App Host',
    out: path.join(input.packageRoot, 'local-host'),
    version: input.version,
  });
}

async function packageElectronApplication(input) {
  const paths = await packager({
    appBundleId: input.appBundleId,
    appCategoryType: input.appCategoryType,
    appVersion: input.version,
    arch: 'arm64',
    asar: { unpack: '**/*.{node,dylib}' },
    buildVersion: input.version,
    dir: input.dir,
    electronVersion: input.electronVersion,
    electronZipDir: input.electronZipDir,
    executableName: input.executableName,
    extraResource: input.extraResource,
    extendInfo: { LSMinimumSystemVersion: '13.0', NSHighResolutionCapable: true },
    icon: input.icon,
    name: input.name,
    out: input.out,
    overwrite: false,
    platform: 'darwin',
    prune: false,
    quiet: true,
  });
  if (!Array.isArray(paths) || paths.length !== 1) throw new Error('Electron packager returned an ambiguous macOS application');
  const appPath = path.join(paths[0], `${input.name}.app`);
  await requireDirectory(appPath);
  hardenElectronInfoPlist(appPath);
  return appPath;
}

async function stageSharpRuntime(sourceRoot) {
  const sharpRoot = await realpath(path.join(repoRoot, 'kit', 'node_modules', 'sharp'));
  const sharpNodeModules = path.dirname(sharpRoot);
  const packages = [
    ['sharp', sharpRoot],
    ['detect-libc', await realpath(path.join(sharpNodeModules, 'detect-libc'))],
    ['semver', await realpath(path.join(sharpNodeModules, 'semver'))],
    ['@img/colour', await realpath(path.join(sharpNodeModules, '@img', 'colour'))],
    ['@img/sharp-darwin-arm64', await realpath(path.join(sharpNodeModules, '@img', 'sharp-darwin-arm64'))],
    ['@img/sharp-libvips-darwin-arm64', await realpath(path.join(sharpNodeModules, '@img', 'sharp-libvips-darwin-arm64'))],
  ];
  for (const [packageName, source] of packages) {
    const destination = path.join(sourceRoot, 'node_modules', ...packageName.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, force: false, dereference: true });
  }
}

async function stageDesktopProductControlRuntime(sourceRoot) {
  const packageRoot = path.join(desktopRoot, 'product-control-node', 'npm', 'darwin-arm64');
  const destination = path.join(
    sourceRoot,
    'node_modules',
    '@nimiplatform',
    'desktop-product-control-darwin-arm64',
  );
  await mkdir(destination, { recursive: true });
  for (const [name, mode] of [
    ['index.cjs', 0o644],
    ['nimi_desktop_product_control.node', 0o755],
    ['package.json', 0o644],
  ]) {
    const target = path.join(destination, name);
    await cp(path.join(packageRoot, name), target, { force: false });
    await chmod(target, mode);
  }
}

function hardenElectronInfoPlist(appPath) {
  const infoPlist = path.join(appPath, 'Contents', 'Info.plist');
  for (const key of [
    'NSAudioCaptureUsageDescription',
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
    'NSCameraUsageDescription',
  ]) {
    runReleaseCommand('/usr/bin/plutil', ['-remove', key, infoPlist]);
  }
  runReleaseCommand('/usr/bin/plutil', [
    '-replace',
    'NSMicrophoneUsageDescription',
    '-string',
    'Nimi uses the microphone when you record audio for speech transcription or voice reference workflows.',
    infoPlist,
  ]);
  runReleaseCommand('/usr/bin/plutil', [
    '-replace', 'NSAppTransportSecurity', '-json',
    '{"NSAllowsArbitraryLoads":false,"NSAllowsLocalNetworking":true}',
    infoPlist,
  ]);
  runReleaseCommand('/usr/bin/plutil', ['-lint', infoPlist]);
}

async function stageNativeCarrier(appPath) {
  const source = path.join(repoRoot, 'kit', 'shell', 'protected-local-node', 'npm', 'darwin-arm64');
  const destination = path.join(appPath, 'Contents', 'Resources', 'nimi-native', 'protected-local');
  await mkdir(destination, { recursive: true, mode: 0o755 });
  for (const name of ['index.cjs', 'nimi_shell_protected_local.node', 'package.json']) {
    await cp(path.join(source, name), path.join(destination, name), { force: false });
    await chmod(path.join(destination, name), 0o644);
  }
}

async function stageDesktopNativeAssets(desktopApp, sourceRoot, localDevelopmentBuild) {
  await stageNativeCarrier(desktopApp);
  if (localDevelopmentBuild) return;
  const launchServices = path.join(desktopApp, 'Contents', 'Library', 'LaunchServices');
  const launchDaemons = path.join(desktopApp, 'Contents', 'Library', 'LaunchDaemons');
  await Promise.all([
    mkdir(launchServices, { recursive: true, mode: 0o755 }),
    mkdir(launchDaemons, { recursive: true, mode: 0o755 }),
  ]);
  await cp(path.join(sourceRoot, 'nimi-runtime'), path.join(launchServices, 'nimi-runtime'), { force: false });
  await chmod(path.join(launchServices, 'nimi-runtime'), 0o755);
  await cp(
    path.join(desktopRoot, 'macos', 'LaunchDaemons', 'ai.nimi.runtime.plist'),
    path.join(launchDaemons, 'ai.nimi.runtime.plist'),
    { force: false },
  );
  await chmod(path.join(launchDaemons, 'ai.nimi.runtime.plist'), 0o644);
}

async function signMacOSApplication(appPath, releaseInput, options) {
  const electronEntitlements = path.join(desktopRoot, 'macos', 'entitlements', 'electron.plist');
  const runtimeEntitlements = path.join(desktopRoot, 'macos', 'entitlements', 'runtime.plist');
  const runtimePath = path.join(appPath, 'Contents', 'Library', 'LaunchServices', 'nimi-runtime');
  await sign({
    app: appPath,
    identity: releaseInput.applicationIdentity,
    ignore: options.ignore,
    optionsForFile: (candidate) => {
      if (candidate === runtimePath) {
        return {
          additionalArguments: ['--identifier', 'ai.nimi.runtime'],
          entitlements: runtimeEntitlements,
          hardenedRuntime: true,
          signatureFlags: 'runtime',
        };
      }
      const isElectronExecutable = candidate === appPath || candidate.endsWith('.app')
        || candidate.includes(`${path.sep}Contents${path.sep}MacOS${path.sep}`);
      return {
        entitlements: isElectronExecutable ? electronEntitlements : runtimeEntitlements,
        hardenedRuntime: true,
        signatureFlags: 'runtime',
      };
    },
    platform: 'darwin',
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    strictVerify: true,
  });
}

async function notarizeAndStaple(candidate, releaseInput) {
  await notarize({
    appPath: candidate,
    keychain: releaseInput.notaryKeychain,
    keychainProfile: releaseInput.notaryProfile,
  });
  runReleaseCommand('/usr/bin/xcrun', ['stapler', 'staple', candidate]);
  runReleaseCommand('/usr/bin/xcrun', ['stapler', 'validate', candidate]);
}

async function buildSignedInstaller(input) {
  const payloadRoot = path.join(input.transactionRoot, 'installer-payload');
  const applicationTarget = path.join(payloadRoot, 'Applications', 'Nimi.app');
  await mkdir(path.dirname(applicationTarget), { recursive: true });
  await runDittoCopy(input.desktopApp, applicationTarget);
  const component = path.join(input.transactionRoot, 'Nimi.component.pkg');
  const product = path.join(input.candidateRoot, `Nimi-${input.version}-macos-arm64.pkg`);
  runReleaseCommand('/usr/bin/pkgbuild', [
    '--root', payloadRoot,
    '--scripts', path.join(desktopRoot, 'macos', 'installer'),
    '--identifier', 'ai.nimi.installer',
    '--version', input.version,
    '--install-location', '/',
    '--ownership', 'recommended',
    '--min-os-version', '13.0',
    component,
  ]);
  const productArguments = ['--package', component, '--sign', input.release.installerIdentity];
  if (input.release.notaryKeychain) productArguments.push('--keychain', input.release.notaryKeychain);
  productArguments.push(product);
  runReleaseCommand('/usr/bin/productbuild', productArguments);
  return product;
}

function resolveRolePaths(desktopApp) {
  return Object.freeze({
    nimi_desktop: path.join(desktopApp, 'Contents', 'MacOS', 'Nimi'),
    nimi_local_app_host: localHostExecutable(path.join(desktopApp, 'Contents', 'Frameworks', 'Nimi Local App Host.app')),
    nimi_runtime_service: path.join(desktopApp, 'Contents', 'Library', 'LaunchServices', 'nimi-runtime'),
  });
}

function localHostExecutable(appPath) {
  return path.join(appPath, 'Contents', 'MacOS', 'Nimi Local App Host');
}

async function runDittoCopy(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  runReleaseCommand('/usr/bin/ditto', [source, destination]);
}

function releaseCompileEnvironment({ release: releaseInput }) {
  const env = { ...process.env };
  delete env.NIMI_MACOS_TEAM_ID;
  if (releaseInput) {
    env.NIMI_MACOS_TEAM_ID = releaseInput.teamId;
  }
  return env;
}

function readMacOSProductionInputs(env) {
  const releaseId = releaseText(requireEnv(env, 'NIMI_MACOS_RELEASE_ID'), 'release id');
  const teamId = requireEnv(env, 'NIMI_MACOS_TEAM_ID');
  if (!/^[A-Z0-9]{10}$/u.test(teamId)) throw new Error('macOS Team ID is invalid');
  const applicationIdentity = signingIdentity(
    requireEnv(env, 'NIMI_MACOS_APPLICATION_SIGNING_IDENTITY'),
    'Developer ID Application:',
  );
  const installerIdentity = signingIdentity(
    requireEnv(env, 'NIMI_MACOS_INSTALLER_SIGNING_IDENTITY'),
    'Developer ID Installer:',
  );
  const notaryProfile = releaseText(
    requireEnv(env, 'NIMI_NOTARYTOOL_KEYCHAIN_PROFILE'),
    'notary keychain profile',
  );
  const notaryKeychain = env.NIMI_NOTARYTOOL_KEYCHAIN
    ? path.resolve(env.NIMI_NOTARYTOOL_KEYCHAIN)
    : undefined;
  if (notaryKeychain && notaryKeychain !== env.NIMI_NOTARYTOOL_KEYCHAIN) {
    throw new Error('notary keychain must be an absolute canonical path');
  }
  return Object.freeze({
    applicationIdentity,
    installerIdentity,
    notaryKeychain,
    notaryProfile,
    releaseId,
    teamId,
  });
}

function productionSigningIdentifier(role) {
  const identifiers = {
    nimi_desktop: 'ai.nimi.apps.nimi.desktop',
    nimi_local_app_host: 'ai.nimi.apps.nimi.local-app-host',
    nimi_runtime_service: 'ai.nimi.runtime',
  };
  const identifier = identifiers[role];
  if (!identifier) throw new Error(`unknown macOS protected-local role: ${role}`);
  return identifier;
}

function requireEnv(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing required macOS release input: ${name}`);
  }
  return value;
}

function releaseText(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128
    || value.trim() !== value || !/^[\x21-\x7E]+$/u.test(value) || /[\\/]/u.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function signingIdentity(value, prefix) {
  if (typeof value !== 'string' || value.length > 256 || value.trim() !== value
    || !/^[\x20-\x7E]+$/u.test(value) || !value.startsWith(prefix)
    || !value.includes('(') || !value.endsWith(')')) {
    throw new Error(`signing identity must be an exact ${prefix} identity name`);
  }
  return value;
}

function resolveOutputRoot(value, fallbackName) {
  const candidate = path.resolve(value || path.join(localRoot, 'macos-electron-release', fallbackName));
  const relative = path.relative(localRoot, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('macOS release output must be a new child of .nimi/local');
  }
  return candidate;
}

async function assertAbsent(candidate) {
  const metadata = await stat(candidate).catch((error) => {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  });
  if (metadata) throw new Error(`refusing to overwrite existing macOS release output: ${candidate}`);
  await mkdir(path.dirname(candidate), { recursive: true, mode: 0o700 });
}

async function requireDirectory(candidate) {
  const metadata = await stat(candidate);
  if (!metadata.isDirectory()) throw new Error(`required release directory is missing: ${candidate}`);
}

async function writeManifest(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

function exactVersion(value) {
  if (typeof value !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/u.test(value)) {
    throw new Error('release package version is invalid');
  }
  return value;
}
