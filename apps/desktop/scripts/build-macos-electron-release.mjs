#!/usr/bin/env node
import { createHash, createPublicKey } from 'node:crypto';
import { cp, chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { notarize } from '@electron/notarize';
import { sign } from '@electron/osx-sign';
import { packager } from '@electron/packager';

import {
  createMacOSReleaseTrustRecord,
  MACOS_RELEASE_RECORDS,
  readMacOSProductionReleaseInputs,
  verifyMacOSReleaseTrustRecordSignature,
} from './lib/macos-release-contract.mjs';
import {
  inspectSignedMacOSCode,
  requireMacOSSigningIdentity,
  runReleaseCommand,
  sha256File,
  signMacOSReleaseRecord,
  verifySignedMacOSApplication,
  verifySignedMacOSInstaller,
} from './lib/macos-release-process.mjs';
import { MACOS_LOCAL_DEVELOPMENT_PROFILE } from './generated/macos-local-development-profile.mjs';
import { exactDevelopmentIdentities, finalizeMacOSLocalDevelopmentCandidate } from './lib/macos-local-development-release.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptRoot, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const localRoot = path.join(repoRoot, '.nimi', 'local');
const localDevelopmentSigningProfilePath = path.join(process.env.HOME ?? '', '.nimi', 'macos-dev-signing', 'public-profile.json');
const layoutOnly = process.argv.includes('--layout-only');
const localDevelopment = process.argv.includes('--local-development-candidate');
if (layoutOnly && localDevelopment) {
  throw new Error('macOS production layout and local-development candidate modes are mutually exclusive');
}
if (process.argv.slice(2).some((value) => value !== '--layout-only' && value !== '--local-development-candidate')) {
  throw new Error('macOS Electron release accepts only --layout-only or --local-development-candidate');
}
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('macOS Electron release must be built natively on Apple Silicon');
}
if (Object.hasOwn(process.env, 'NIMI_PLATFORM_RELEASE_ROOT_PRIVATE_KEY_PKCS8_B64URL')) {
  throw new Error('Platform release private keys are forbidden in the build environment');
}

const desktopPackage = JSON.parse(await readFile(path.join(desktopRoot, 'package.json'), 'utf8'));
const electronPackage = JSON.parse(await readFile(path.join(desktopRoot, 'node_modules', 'electron', 'package.json'), 'utf8'));
const version = exactVersion(desktopPackage.version);
const electronVersion = exactVersion(electronPackage.version);
const release = layoutOnly || localDevelopment ? undefined : readMacOSProductionReleaseInputs();
const localDevelopmentTrust = localDevelopment ? await readMacOSLocalDevelopmentPublicProfile() : undefined;
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

  await buildReleaseInputs({ localDevelopment, localDevelopmentTrust, release, sourceRoot });
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
      await finalizeMacOSLocalDevelopmentCandidate({ candidateRoot, trust: localDevelopmentTrust, sourceRoot, outputName });
    }
    await writeManifest(path.join(candidateRoot, 'layout-manifest.json'), {
      acceptanceEligible: false,
      architecture: 'arm64',
      compileTimeProfile: localDevelopment ? 'macos_local_development_v1' : 'production_fail_closed_layout',
      desktopApplicationTreeSha256: localDevelopment
        ? await applicationTreeSha256(path.join(candidateRoot, 'Nimi Dev.app'))
        : undefined,
      electronVersion,
      launchDaemonSha256: localDevelopment
        ? await sha256File(path.join(candidateRoot, 'launchd', 'ai.nimi.runtime.dev.plist'))
        : undefined,
      posture: localDevelopment
        ? 'signed_local_development_candidate_pending_independent_verifier'
        : 'requirements_only_fail_closed_unsigned_unnotarized_layout',
      productionRoleRecords: false,
      releaseRootKeyId: localDevelopmentTrust?.rootKeyId,
      runtimeSha256: localDevelopment ? await sha256File(path.join(sourceRoot, 'nimi-runtime')) : undefined,
      schemaVersion: localDevelopment ? 'nimi.macos-local-development-candidate/v1' : 'nimi.macos-electron-layout/v1',
      version,
    });
    await chmod(candidateRoot, 0o700);
    await rename(candidateRoot, outputRoot);
    completed = true;
    process.stdout.write(`${JSON.stringify({
      outputRoot,
      posture: localDevelopment
        ? 'signed_local_development_candidate_pending_independent_verifier'
        : 'requirements_only_fail_closed_unsigned_unnotarized_layout',
    })}\n`);
  } else {
    await signMacOSApplication(desktopApp, release, {
      ignore: (candidate) => candidate === embeddedLocalHost || candidate.startsWith(`${embeddedLocalHost}${path.sep}`),
    });
    await notarizeAndStaple(desktopApp, release);
    const rolePaths = resolveRolePaths(desktopApp);
    verifySignedMacOSApplication(desktopApp, Object.values(rolePaths));
    verifySignedMacOSApplication(embeddedLocalHost, [rolePaths.nimi_local_app_host]);
    const records = await emitRoleRecords(path.join(transactionRoot, 'records'), rolePaths, release);
    const pkgPath = await buildSignedInstaller({
      candidateRoot,
      desktopApp,
      records,
      release,
      transactionRoot,
      version,
    });
    await notarizeAndStaple(pkgPath, release);
    verifySignedMacOSInstaller(pkgPath);
    const evidence = {
      acceptanceEligible: false,
      architecture: 'arm64',
      buildId: release.buildId,
      electronVersion,
      packageSha256: await sha256File(pkgPath),
      posture: 'signed_notarized_candidate_pending_installed_live_admission',
      releaseId: release.releaseId,
      roleRecords: Object.fromEntries(records.map((row) => [row.role.executableRole, {
        artifactSha256: row.record.record.artifact_sha256,
        cdhash: row.record.record.macos_cdhash,
        designatedRequirement: row.record.record.macos_designated_requirement,
        generation: row.record.record.generation,
        recordSha256: row.recordSha256,
        signingIdentifier: row.role.signingIdentifier,
        teamId: row.record.record.macos_team_id,
      }])),
      schemaVersion: 'nimi.macos-electron-release-evidence/v1',
      version,
    };
    await writeManifest(path.join(candidateRoot, 'release-evidence.json'), evidence);
    await rename(candidateRoot, outputRoot);
    completed = true;
    process.stdout.write(`${JSON.stringify({ outputRoot, posture: evidence.posture })}\n`);
  }
} finally {
  await rm(transactionRoot, { recursive: true, force: true });
  if (!completed) await rm(outputRoot, { recursive: true, force: true });
}

async function buildReleaseInputs({ localDevelopment: localDevelopmentBuild, localDevelopmentTrust: developmentTrust, release: releaseInput, sourceRoot }) {
  runReleaseCommand('corepack', ['pnpm', '--filter', '@nimiplatform/sdk', 'build'], { cwd: repoRoot, inherit: true });
  runReleaseCommand('corepack', ['pnpm', '--filter', '@nimiplatform/kit', 'build'], { cwd: repoRoot, inherit: true });
  runReleaseCommand('corepack', ['pnpm', '--dir', desktopRoot, 'run', 'build:renderer'], { cwd: repoRoot, inherit: true });
  runReleaseCommand('corepack', ['pnpm', '--dir', desktopRoot, 'exec', 'tsc', '-p', 'tsconfig.electron.json', '--noEmit'], { cwd: repoRoot, inherit: true });
  runReleaseCommand(process.execPath, [
    path.join(scriptRoot, 'bundle-electron-main.mjs'),
    '--release',
    ...(localDevelopmentBuild ? ['--macos-local-development'] : []),
  ], { cwd: repoRoot, inherit: true });
  runReleaseCommand(process.execPath, [path.join(scriptRoot, 'bundle-electron-preload.mjs')], { cwd: repoRoot, inherit: true });

  const nativeBuildEnvironment = releaseCompileEnvironment({ localDevelopmentTrust: developmentTrust, release: releaseInput });
  runReleaseCommand(process.execPath, [
    path.join(repoRoot, 'kit', 'shell', 'protected-local-node', 'scripts', 'build-darwin-arm64-package.mjs'),
    ...(localDevelopmentBuild ? ['--local-development'] : releaseInput ? [] : ['--fail-closed-candidate']),
  ], { cwd: repoRoot, env: nativeBuildEnvironment, inherit: true });

  const runtimeOutput = path.join(sourceRoot, 'nimi-runtime');
  const goArguments = ['build', '-trimpath', '-buildvcs=true', '-o', runtimeOutput];
  if (localDevelopmentBuild) {
    goArguments.push('-tags', 'nimi_macos_local_development');
    goArguments.push('-ldflags', [
      `-X github.com/nimiplatform/nimi/runtime/cmd/nimi.Version=${version}`,
      `-X github.com/nimiplatform/nimi/runtime/internal/protectedlocal.MacOSLocalDevelopmentReleaseRootKeyID=${developmentTrust.rootKeyId}`,
      `-X github.com/nimiplatform/nimi/runtime/internal/protectedlocal.MacOSLocalDevelopmentReleaseRootPublicKeyB64=${developmentTrust.rootPublicKeyB64URL}`,
    ].join(' '));
  } else if (releaseInput) {
    goArguments.push('-ldflags', [
      `-X github.com/nimiplatform/nimi/runtime/cmd/nimi.Version=${version}`,
      `-X github.com/nimiplatform/nimi/runtime/internal/protectedlocal.MacOSPlatformReleaseRootKeyID=${releaseInput.rootKeyId}`,
      `-X github.com/nimiplatform/nimi/runtime/internal/protectedlocal.MacOSPlatformReleaseRootPublicKeyB64=${releaseInput.rootPublicKeyB64URL}`,
    ].join(' '));
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
    cp(path.join(desktopRoot, 'dist-electron', 'main.js'), path.join(source, 'dist-electron', 'main.js')),
    cp(path.join(desktopRoot, 'dist-electron', 'preload.cjs'), path.join(source, 'dist-electron', 'preload.cjs')),
  ]);
  await stageSharpRuntime(source);
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
    icon: path.join(desktopRoot, 'src-tauri', 'icons', 'icon.icns'),
    name: input.localDevelopment ? 'Nimi Dev' : 'Nimi',
    out: path.join(input.packageRoot, 'desktop'),
    version: input.version,
  });
}

async function packageLocalAppHost(input) {
  const source = path.join(input.sourceRoot, 'local-app-host');
  await mkdir(source, { recursive: true });
  const mainSource = await readFile(path.join(desktopRoot, 'macos', 'local-app-host', 'main.mjs'), 'utf8');
  const acceptanceBuildLiteral = 'const MACOS_LOCAL_DEVELOPMENT_ACCEPTANCE_BUILD = false;';
  if (mainSource.split(acceptanceBuildLiteral).length - 1 !== 1) {
    throw new Error('macOS local-app host acceptance build contract is ambiguous');
  }
  await writeFile(
    path.join(source, 'main.mjs'),
    input.localDevelopment
      ? mainSource.replace(acceptanceBuildLiteral, 'const MACOS_LOCAL_DEVELOPMENT_ACCEPTANCE_BUILD = true;')
      : mainSource,
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
    icon: path.join(desktopRoot, 'src-tauri', 'icons', 'icon.icns'),
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

function hardenElectronInfoPlist(appPath) {
  const infoPlist = path.join(appPath, 'Contents', 'Info.plist');
  for (const key of [
    'NSAudioCaptureUsageDescription',
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription',
  ]) {
    runReleaseCommand('/usr/bin/plutil', ['-remove', key, infoPlist]);
  }
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

async function emitRoleRecords(recordRoot, rolePaths, releaseInput) {
  await mkdir(recordRoot, { recursive: true, mode: 0o755 });
  const rows = [];
  for (const role of MACOS_RELEASE_RECORDS) {
    const codeIdentity = await inspectSignedMacOSCode(
      rolePaths[role.executableRole],
      role.signingIdentifier,
      releaseInput.teamId,
    );
    const record = createMacOSReleaseTrustRecord({
      buildId: releaseInput.buildId,
      codeIdentity,
      expiresAt: releaseInput.expiresAt,
      generation: releaseInput.generation,
      releaseId: releaseInput.releaseId,
      role,
      rootKeyId: releaseInput.rootKeyId,
      signRecord: (payload) => signMacOSReleaseRecord(
        payload,
        releaseInput.recordSignerPath,
        releaseInput.rootKeyId,
        releaseInput.teamId,
      ),
      validFrom: releaseInput.validFrom,
    });
    if (!verifyMacOSReleaseTrustRecordSignature(record.encoded, releaseInput.rootPublicKeyB64URL)) {
      throw new Error(`macOS release record signature self-check failed for ${role.executableRole}`);
    }
    const recordPath = path.join(recordRoot, role.recordFilename);
    await writeFile(recordPath, record.encoded, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
    rows.push(Object.freeze({ record, recordPath, recordSha256: await sha256File(recordPath), role }));
  }
  return rows;
}

async function buildSignedInstaller(input) {
  const payloadRoot = path.join(input.transactionRoot, 'installer-payload');
  const applicationTarget = path.join(payloadRoot, 'Applications', 'Nimi.app');
  const trustTarget = path.join(payloadRoot, 'Library', 'Application Support', 'Nimi', 'Runtime', 'trust', 'protected-local', 'v1');
  await mkdir(path.dirname(applicationTarget), { recursive: true });
  await mkdir(trustTarget, { recursive: true, mode: 0o755 });
  await runDittoCopy(input.desktopApp, applicationTarget);
  for (const row of input.records) {
    await cp(row.recordPath, path.join(trustTarget, row.role.recordFilename), { force: false });
    await chmod(path.join(trustTarget, row.role.recordFilename), 0o644);
  }
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

function releaseCompileEnvironment({ localDevelopmentTrust: developmentTrust, release: releaseInput }) {
  const env = { ...process.env };
  delete env.NIMI_PLATFORM_RELEASE_ROOT_KEY_ID;
  delete env.NIMI_PLATFORM_RELEASE_ROOT_PUBLIC_KEY_B64URL;
  delete env.NIMI_MACOS_LOCAL_DEVELOPMENT_RELEASE_ROOT_KEY_ID;
  delete env.NIMI_MACOS_LOCAL_DEVELOPMENT_RELEASE_ROOT_PUBLIC_KEY_B64URL;
  if (developmentTrust) {
    env.NIMI_MACOS_LOCAL_DEVELOPMENT_RELEASE_ROOT_KEY_ID = developmentTrust.rootKeyId;
    env.NIMI_MACOS_LOCAL_DEVELOPMENT_RELEASE_ROOT_PUBLIC_KEY_B64URL = developmentTrust.rootPublicKeyB64URL;
  } else if (releaseInput) {
    env.NIMI_PLATFORM_RELEASE_ROOT_KEY_ID = releaseInput.rootKeyId;
    env.NIMI_PLATFORM_RELEASE_ROOT_PUBLIC_KEY_B64URL = releaseInput.rootPublicKeyB64URL;
  }
  return env;
}

async function readMacOSLocalDevelopmentPublicProfile() {
  const metadata = await lstat(localDevelopmentSigningProfilePath).catch((error) => {
    if (error?.code === 'ENOENT') {
      throw structuredFailure(
        'dev-signing-profile-unprovisioned',
        'run pnpm provision:macos-dev-signing after reviewing and confirming the user-domain changes',
        'The macOS local-development signing profile has not been provisioned.',
      );
    }
    throw error;
  });
  const canonicalPath = await realpath(localDevelopmentSigningProfilePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.uid !== process.getuid() || metadata.gid !== process.getgid() || (metadata.mode & 0o777) !== 0o600
    || canonicalPath !== localDevelopmentSigningProfilePath || metadata.size < 2 || metadata.size > 64 * 1024) {
    throw structuredFailure(
      'runtime-service-repair-required',
      'reprovision the macOS local-development signing profile with the confirmed user-domain provisioner',
      'The installed macOS local-development signing profile has unsafe ownership, mode, link, path, or size metadata.',
    );
  }
  const value = JSON.parse(await readFile(localDevelopmentSigningProfilePath, 'utf8'));
  if (value?.schemaVersion !== MACOS_LOCAL_DEVELOPMENT_PROFILE.freshProfileSchemaVersion
    || value.profileId !== MACOS_LOCAL_DEVELOPMENT_PROFILE.profileId
    || value.carrier !== 4
    || value.environment !== MACOS_LOCAL_DEVELOPMENT_PROFILE.environment
    || value.identityClass !== MACOS_LOCAL_DEVELOPMENT_PROFILE.identityClass
    || value.signatureAlgorithm !== MACOS_LOCAL_DEVELOPMENT_PROFILE.signatureAlgorithm
    || value.teamId !== '' || value.notarized !== false
    || value.keychainPath !== path.join(process.env.HOME ?? '', MACOS_LOCAL_DEVELOPMENT_PROFILE.signingKeychainRelativePath)
    || typeof value.rootCertificateSHA256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.rootCertificateSHA256)
    || typeof value.rootKeyId !== 'string' || !/^[a-z0-9][a-z0-9._-]{7,127}$/u.test(value.rootKeyId)
    || typeof value.rootPublicKeyB64URL !== 'string' || !/^[A-Za-z0-9_-]{100,180}$/u.test(value.rootPublicKeyB64URL)
    || typeof value.profileSignature !== 'string' || !/^[A-Za-z0-9_-]{90,110}$/u.test(value.profileSignature)
    || !exactDevelopmentIdentities(value.identities)) {
    throw structuredFailure(
      'runtime-service-repair-required',
      'reprovision the macOS local-development signing profile with the confirmed user-domain provisioner',
      'The installed macOS local-development signing profile does not match the admitted schema and compile-time profile.',
    );
  }
  let rootPublicKey;
  try {
    const encoded = Buffer.from(value.rootPublicKeyB64URL, 'base64url');
    if (encoded.toString('base64url') !== value.rootPublicKeyB64URL) throw new Error('non-canonical base64url');
    rootPublicKey = createPublicKey({ key: encoded, format: 'der', type: 'spki' });
  } catch (error) {
    throw structuredFailure(
      'runtime-service-repair-required',
      'reprovision the macOS local-development signing profile from the root-owned helper',
      `The installed macOS local-development release root is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (rootPublicKey.asymmetricKeyType !== 'ec'
    || rootPublicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw structuredFailure(
      'runtime-service-repair-required',
      'reprovision the macOS local-development signing profile from the root-owned helper',
      'The installed macOS local-development release root is not an ECDSA P-256 public key.',
    );
  }
  return Object.freeze({
    identities: value.identities,
    keychainPath: value.keychainPath,
    profilePath: localDevelopmentSigningProfilePath,
    profileSignature: value.profileSignature,
    rootCertificateSHA256: value.rootCertificateSHA256,
    rootKeyId: value.rootKeyId,
    rootPublicKeyB64URL: value.rootPublicKeyB64URL,
  });
}

function structuredFailure(reasonCode, actionHint, message) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.actionHint = actionHint;
  return error;
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

async function applicationTreeSha256(root) {
  const rows = [];
  async function visit(directory, prefix = '') {
    const names = await readdir(directory);
    names.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    for (const name of names) {
      if (!name || name.includes('\0') || name.includes('/')) throw new Error('macOS application tree contains an invalid entry name');
      const relative = prefix ? `${prefix}/${name}` : name;
      const absolute = path.join(directory, name);
      const metadata = await lstat(absolute);
      if (metadata.isDirectory()) {
        rows.push({ kind: 'directory', relative, value: '' });
        await visit(absolute, relative);
      } else if (metadata.isFile()) {
        rows.push({ kind: 'file', relative, value: await sha256File(absolute) });
      } else if (metadata.isSymbolicLink()) {
        rows.push({ kind: 'symlink', relative, value: await readlink(absolute, 'utf8') });
      } else {
        throw new Error(`macOS application tree contains a forbidden filesystem node: ${relative}`);
      }
    }
  }
  await visit(root);
  rows.sort((left, right) => Buffer.from(left.relative).compare(Buffer.from(right.relative)));
  const digest = createHash('sha256');
  for (const row of rows) {
    digest.update(row.kind, 'utf8');
    digest.update(Buffer.from([0]));
    digest.update(row.relative, 'utf8');
    digest.update(Buffer.from([0]));
    digest.update(row.value, 'utf8');
    digest.update(Buffer.from([0]));
  }
  return digest.digest('hex');
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
