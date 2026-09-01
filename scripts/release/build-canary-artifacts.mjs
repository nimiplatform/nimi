#!/usr/bin/env node

import {
  copyFileSync,
  closeSync,
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createReleaseManifest } from './release-artifact-manifest.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const canaryRoot = path.join(repoRoot, 'dist', 'release-canary');
const FULL_COMMIT = /^[0-9a-f]{40}$/;
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const COMPONENTS = Object.freeze({
  runtime: { versionSource: null },
  sdk: { versionSource: ['json', 'sdks/typescript/package.json'] },
  kit: { versionSource: ['json', 'kit/package.json'] },
  'app-tools': { versionSource: ['json', 'app-tools/package.json'] },
  'nimi-shell-tauri': { versionSource: ['cargo', 'kit/shell/tauri/Cargo.toml'] },
  'nimi-shell-protected-local': {
    versionSource: ['cargo', 'kit/shell/protected-local/Cargo.toml'],
  },
  proto: { versionSource: null },
});

function run(command, args, options = {}) {
  const pinnedPnpm = command === 'pnpm' && process.env.npm_execpath && existsSync(process.env.npm_execpath)
    ? process.env.npm_execpath
    : null;
  const bundledNpm = command === 'npm'
    ? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : null;
  const nodeCli = pinnedPnpm || (bundledNpm && existsSync(bundledNpm) ? bundledNpm : null);
  const executable = nodeCli ? process.execPath : command;
  const childArgs = nodeCli ? [nodeCli, ...args] : args;
  const result = spawnSync(executable, childArgs, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: options.encoding,
    stdio: options.stdio ?? 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status ?? 'unknown')}`);
  }
  return result;
}

function capture(command, args, cwd = repoRoot) {
  return String(run(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).stdout || '').trim();
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
    if (values[key] !== undefined) throw new Error(`duplicate argument: ${token}`);
    values[key] = value;
    index += 1;
  }
  return values;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function cargoVersion(relativePath) {
  const source = readFileSync(path.join(repoRoot, relativePath), 'utf8');
  const match = source.match(/^version\s*=\s*"([^"]+)"\s*$/mu);
  if (!match) throw new Error(`Cargo package version is missing: ${relativePath}`);
  return match[1];
}

function finalPackageVersion(version, component) {
  const normalized = String(version || '');
  if (!STABLE_VERSION.test(normalized)) {
    throw new Error(
      `${component} source manifest must contain the final stable semver before canary build: ${normalized}`,
    );
  }
  return normalized;
}

function sourceVersion(component) {
  const source = COMPONENTS[component].versionSource;
  if (!source) return '';
  const [kind, relativePath] = source;
  if (kind === 'json') return String(readJson(relativePath).version || '');
  return cargoVersion(relativePath);
}

function releaseVersions() {
  return Object.freeze({
    sdk: finalPackageVersion(sourceVersion('sdk'), 'sdk'),
    kit: finalPackageVersion(sourceVersion('kit'), 'kit'),
    appTools: finalPackageVersion(sourceVersion('app-tools'), 'app-tools'),
    nimiShellTauri: finalPackageVersion(sourceVersion('nimi-shell-tauri'), 'nimi-shell-tauri'),
    nimiShellProtectedLocal: finalPackageVersion(
      sourceVersion('nimi-shell-protected-local'),
      'nimi-shell-protected-local',
    ),
  });
}

function resolveVersion(component, requestedVersion) {
  const derived = sourceVersion(component);
  if (!requestedVersion) {
    if (!derived) throw new Error(`--version is required for ${component}`);
    return finalPackageVersion(derived, component);
  }
  if (!STABLE_VERSION.test(requestedVersion)) {
    throw new Error(`--version must be the final stable semver without a v prefix: ${requestedVersion}`);
  }
  if (derived && finalPackageVersion(derived, component) !== requestedVersion) {
    throw new Error(
      `${component} source version ${derived} does not match requested version ${requestedVersion}`,
    );
  }
  return requestedVersion;
}

function assertCheckout(commit) {
  const head = capture('git', ['rev-parse', 'HEAD']).toLowerCase();
  const requested = String(commit || head).toLowerCase();
  if (!FULL_COMMIT.test(requested)) {
    throw new Error(`--commit must be a full 40-character Git SHA: ${commit}`);
  }
  if (head !== requested) {
    throw new Error(`checkout HEAD ${head} does not match requested commit ${requested}`);
  }
  const dirty = capture('git', ['status', '--porcelain']);
  if (dirty) {
    throw new Error('canary artifacts require a clean checkout with no non-ignored worktree or index changes');
  }
  return requested;
}

function prepareOutput(component, requestedPath) {
  const expected = path.join(canaryRoot, component);
  const outputDir = path.resolve(requestedPath || expected);
  const relative = path.relative(canaryRoot, outputDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error(`canary output must be one component directory under ${canaryRoot}`);
  }
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

function copyTree(source, destination) {
  const skipped = new Set(['.git', 'node_modules', 'target', '.tmp', '.cache']);
  cpSync(source, destination, {
    recursive: true,
    filter: (entry) => !skipped.has(path.basename(entry)),
  });
}

function patchJsonPackage(packageRoot, mutator) {
  const manifestPath = path.join(packageRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  mutator(manifest);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function packNpmDirectory(packageRoot, outputDir) {
  const before = new Set(readdirSync(outputDir));
  run('npm', ['pack', packageRoot, '--pack-destination', outputDir, '--ignore-scripts']);
  const created = readdirSync(outputDir)
    .filter((name) => name.endsWith('.tgz') && !before.has(name));
  if (created.length !== 1) {
    throw new Error(`npm pack must create exactly one tarball for ${packageRoot}; found ${created.join(', ')}`);
  }
  return path.join(outputDir, created[0]);
}

function stageAndPackNpm({ sourceRoot, outputDir, mutate }) {
  const stagingRoot = mkdtempSync(path.join(tmpdir(), 'nimi-canary-npm-'));
  const packageRoot = path.join(stagingRoot, 'package');
  try {
    copyTree(sourceRoot, packageRoot);
    patchJsonPackage(packageRoot, mutate);
    return packNpmDirectory(packageRoot, outputDir);
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function buildSdk(version, outputDir) {
  run('pnpm', ['--filter', '@nimiplatform/sdk', 'build']);
  const tarball = stageAndPackNpm({
    sourceRoot: path.join(repoRoot, 'sdks', 'typescript'),
    outputDir,
    mutate: (manifest) => { manifest.version = version; },
  });
  run(process.execPath, [
    path.join(repoRoot, 'scripts', 'check-sdk-kit-pack-audit.mjs'),
    '--package', 'sdk',
    '--tarball', tarball,
  ]);
}

function buildKit(version, outputDir, platform) {
  const versions = releaseVersions();
  if (!platform || platform === 'main') {
    run('pnpm', ['--filter', '@nimiplatform/sdk', 'build']);
    run('pnpm', ['--filter', '@nimiplatform/kit', 'build']);
    const tarball = stageAndPackNpm({
      sourceRoot: path.join(repoRoot, 'kit'),
      outputDir,
      mutate: (manifest) => {
        manifest.version = version;
        manifest.dependencies['@nimiplatform/sdk'] = `^${versions.sdk}`;
        delete manifest.optionalDependencies;
      },
    });
    run(process.execPath, [
      path.join(repoRoot, 'scripts', 'check-sdk-kit-pack-audit.mjs'),
      '--package', 'kit',
      '--tarball', tarball,
    ]);
    return;
  }

  const native = {
    'win32-x64': {
      requiredPlatform: 'win32',
      requiredArch: 'x64',
      buildScript: 'build-windows-x64-package.mjs',
    },
    'darwin-arm64': {
      requiredPlatform: 'darwin',
      requiredArch: 'arm64',
      buildScript: 'build-darwin-arm64-package.mjs',
    },
  }[platform];
  if (!native) throw new Error(`unsupported kit canary platform: ${platform}`);
  if (process.platform !== native.requiredPlatform || process.arch !== native.requiredArch) {
    throw new Error(`kit ${platform} canary must build on ${native.requiredPlatform}/${native.requiredArch}`);
  }
  run(process.execPath, [
    path.join(repoRoot, 'kit', 'shell', 'protected-local-node', 'scripts', native.buildScript),
  ]);
  const tarball = stageAndPackNpm({
    sourceRoot: path.join(repoRoot, 'kit', 'shell', 'protected-local-node', 'npm', platform),
    outputDir,
    mutate: (manifest) => { manifest.version = version; },
  });
  run(process.execPath, [
    path.join(repoRoot, 'scripts', 'check-release-package-payload.mjs'),
    '--family', 'kit-native',
    '--target', platform,
    '--tarball', tarball,
    '--expected-version', version,
  ]);
}

function buildAppTools(version, outputDir) {
  const versions = releaseVersions();
  run(process.execPath, [
    path.join(repoRoot, 'app-tools', 'scripts', 'sync-scaffold-versions.mjs'),
    '--check',
  ]);
  run(process.execPath, [
    path.join(repoRoot, 'app-tools', 'scripts', 'sync-app-source.mjs'),
    '--apply',
  ]);
  const tarball = stageAndPackNpm({
    sourceRoot: path.join(repoRoot, 'app-tools'),
    outputDir,
    mutate: (manifest) => {
      manifest.version = version;
      manifest.nimiScaffoldVersions.sdkVersion = `^${versions.sdk}`;
      manifest.nimiScaffoldVersions.kitVersion = `^${versions.kit}`;
      manifest.nimiScaffoldVersions.appToolsVersion = `^${versions.appTools}`;
      manifest.nimiScaffoldVersions.nimiShellTauriVersion = versions.nimiShellTauri;
    },
  });
  const smokeRoot = mkdtempSync(path.join(tmpdir(), 'nimi-canary-app-tools-smoke-'));
  try {
    writeFileSync(path.join(smokeRoot, 'package.json'), '{"private":true}\n', 'utf8');
    run('npm', ['install', '--ignore-scripts', '--no-package-lock', tarball], { cwd: smokeRoot });
    const command = path.join(
      smokeRoot,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'nimi-app.cmd' : 'nimi-app',
    );
    run(command, ['--help'], { cwd: smokeRoot });
    const scaffoldRoot = path.join(smokeRoot, 'release-smoke-app');
    run(command, [
      'create',
      '--dir', scaffoldRoot,
      '--profile', 'standalone',
      '--title', 'Release Smoke',
    ], { cwd: smokeRoot });

    const scaffoldPackage = JSON.parse(
      readFileSync(path.join(scaffoldRoot, 'package.json'), 'utf8'),
    );
    const expectedDependencies = {
      '@nimiplatform/sdk': `^${versions.sdk}`,
      '@nimiplatform/kit': `^${versions.kit}`,
      '@nimiplatform/app-tools': `^${versions.appTools}`,
    };
    for (const [name, expected] of Object.entries(expectedDependencies)) {
      const actual = scaffoldPackage.dependencies?.[name]
        ?? scaffoldPackage.devDependencies?.[name];
      if (actual !== expected) {
        throw new Error(`packed app-tools generated ${name}=${String(actual)}, expected ${expected}`);
      }
    }
    const scaffoldCargo = readFileSync(
      path.join(scaffoldRoot, 'src-tauri', 'Cargo.toml'),
      'utf8',
    );
    if (!scaffoldCargo.includes(`nimi-shell-tauri = "${versions.nimiShellTauri}"`)) {
      throw new Error(
        `packed app-tools did not generate nimi-shell-tauri ${versions.nimiShellTauri}`,
      );
    }
  } finally {
    rmSync(smokeRoot, { recursive: true, force: true });
  }
}

function buildCargoPackage(component, version, commit, outputDir) {
  if (component === 'nimi-shell-tauri') {
    const outputPath = path.join(outputDir, `nimi-shell-tauri-${version}-source.tar.gz`);
    const output = openSync(outputPath, 'w');
    try {
      run('git', [
        'archive',
        '--format=tar.gz',
        `--prefix=nimi-shell-tauri-${version}-source/`,
        commit,
        '--',
        'proto',
        'kit/shell/protected-local',
        'kit/shell/tauri',
      ], { stdio: ['ignore', output, 'inherit'] });
    } finally {
      closeSync(output);
    }
    return;
  }

  const packageRoot = path.join(repoRoot, 'kit', 'shell', 'protected-local');
  run('cargo', [
    'package',
    '--locked',
    '--no-verify',
    '--manifest-path',
    path.join(packageRoot, 'Cargo.toml'),
  ]);
  const crateName = `${component}-${version}.crate`;
  const cratePath = path.join(packageRoot, 'target', 'package', crateName);
  if (!existsSync(cratePath) || !lstatSync(cratePath).isFile()) {
    throw new Error(`cargo package output is missing: ${cratePath}`);
  }
  copyFileSync(cratePath, path.join(outputDir, crateName));
}

function buildProto(version, commit, outputDir) {
  const outputPath = path.join(outputDir, `nimi-proto-${version}.tar.gz`);
  const output = openSync(outputPath, 'w');
  try {
    run('git', [
      'archive',
      '--format=tar.gz',
      `--prefix=nimi-proto-${version}/`,
      `${commit}:proto`,
    ], { stdio: ['ignore', output, 'inherit'] });
  } finally {
    closeSync(output);
  }
}

function buildRuntime(version, outputDir) {
  const goreleaser = String(process.env.NIMI_GORELEASER_BIN || 'goreleaser').trim();
  run(goreleaser, [
    'release',
    '--clean',
    '--snapshot',
    '--skip=sign,sbom',
    '--config',
    path.join(repoRoot, '.goreleaser.yml'),
  ], {
    env: {
      ...process.env,
      NIMI_RELEASE_VERSION: version,
    },
  });
  const runtimeDist = path.join(repoRoot, 'dist', 'runtime');
  const files = readdirSync(runtimeDist)
    .filter((name) => name === 'checksums.txt' || name.endsWith('.tar.gz') || name.endsWith('.zip'));
  const archives = files.filter((name) => name.endsWith('.tar.gz') || name.endsWith('.zip'));
  if (archives.length !== 6 || !files.includes('checksums.txt')) {
    throw new Error(`runtime canary expected six archives plus checksums.txt; found ${files.join(', ')}`);
  }
  for (const name of files) copyFileSync(path.join(runtimeDist, name), path.join(outputDir, name));
  smokeRuntimeArchive(version, outputDir);
  buildNpmBinary(version, outputDir, outputDir);
}

function smokeRuntimeArchive(version, artifactsDir) {
  const goos = process.platform;
  const goarch = process.arch === 'x64' ? 'amd64' : process.arch;
  const releaseOs = goos === 'darwin' ? 'macos' : goos === 'win32' ? 'windows' : goos;
  const extension = goos === 'win32' ? 'zip' : 'tar.gz';
  const binaryName = goos === 'win32' ? 'nimi.exe' : 'nimi';
  const archivePath = path.join(
    artifactsDir,
    `nimi-runtime_${version}_${releaseOs}_${goarch}.${extension}`,
  );
  if (!['darwin', 'linux', 'win32'].includes(goos) || !['amd64', 'arm64'].includes(goarch)) {
    throw new Error(`runtime canary smoke does not support ${goos}/${goarch}`);
  }
  const smokeRoot = mkdtempSync(path.join(tmpdir(), 'nimi-canary-runtime-smoke-'));
  try {
    unpackRuntimeArchive(archivePath, smokeRoot, binaryName);
    const binaryPath = path.join(smokeRoot, binaryName);
    if (goos !== 'win32') chmodSync(binaryPath, 0o755);
    const payload = JSON.parse(capture(binaryPath, ['version', '--json'], smokeRoot));
    if (payload.nimi !== version || payload.osArch !== `${goos}/${goarch}`) {
      throw new Error(
        `runtime archive version smoke mismatch: ${JSON.stringify(payload)}`,
      );
    }
  } finally {
    rmSync(smokeRoot, { recursive: true, force: true });
  }
}

function unpackRuntimeArchive(archivePath, destination, binaryName) {
  mkdirSync(destination, { recursive: true });
  if (archivePath.endsWith('.zip')) {
    run('unzip', ['-q', archivePath, binaryName, '-d', destination]);
    return;
  }
  run('tar', ['-xzf', archivePath, '-C', destination, binaryName]);
}

function buildNpmBinary(version, outputDir, runtimeArtifactsDir) {
  if (!runtimeArtifactsDir) throw new Error('--runtime-artifacts-dir is required for npm-binary');
  const inputRoot = path.resolve(runtimeArtifactsDir);
  const platforms = [
    ['darwin-arm64', `nimi-runtime_${version}_macos_arm64.tar.gz`, 'nimi'],
    ['darwin-x64', `nimi-runtime_${version}_macos_amd64.tar.gz`, 'nimi'],
    ['linux-arm64', `nimi-runtime_${version}_linux_arm64.tar.gz`, 'nimi'],
    ['linux-x64', `nimi-runtime_${version}_linux_amd64.tar.gz`, 'nimi'],
    ['win32-arm64', `nimi-runtime_${version}_windows_arm64.zip`, 'nimi.exe'],
    ['win32-x64', `nimi-runtime_${version}_windows_amd64.zip`, 'nimi.exe'],
  ];
  for (const [platform, archiveName, binaryName] of platforms) {
    const archivePath = path.join(inputRoot, archiveName);
    if (!existsSync(archivePath) || !lstatSync(archivePath).isFile()) {
      throw new Error(`runtime archive is missing for npm package ${platform}: ${archivePath}`);
    }
    const stagingRoot = mkdtempSync(path.join(tmpdir(), 'nimi-canary-runtime-npm-'));
    try {
      const packageRoot = path.join(stagingRoot, 'package');
      copyTree(path.join(repoRoot, 'npm-packages', `nimi-${platform}`), packageRoot);
      const binDir = path.join(packageRoot, 'bin');
      mkdirSync(binDir, { recursive: true });
      unpackRuntimeArchive(archivePath, binDir, binaryName);
      if (!existsSync(path.join(binDir, binaryName))) {
        throw new Error(`runtime archive did not contain ${binaryName}: ${archiveName}`);
      }
      patchJsonPackage(packageRoot, (manifest) => { manifest.version = version; });
      const tarball = packNpmDirectory(packageRoot, outputDir);
      run(process.execPath, [
        path.join(repoRoot, 'scripts', 'check-release-package-payload.mjs'),
        '--family', 'runtime-native',
        '--target', platform,
        '--tarball', tarball,
        '--expected-version', version,
      ]);
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
  const launcherTarball = stageAndPackNpm({
    sourceRoot: path.join(repoRoot, 'npm-packages', 'nimi'),
    outputDir,
    mutate: (manifest) => {
      manifest.version = version;
      for (const dependency of Object.keys(manifest.optionalDependencies || {})) {
        manifest.optionalDependencies[dependency] = version;
      }
    },
  });
  run(process.execPath, [
    path.join(repoRoot, 'scripts', 'check-release-package-payload.mjs'),
    '--family', 'runtime-launcher',
    '--tarball', launcherTarball,
    '--expected-version', version,
  ]);
}

function ensureNoTrackedBuildWrites() {
  const dirty = capture('git', ['status', '--porcelain']);
  if (dirty) {
    throw new Error(`canary build left non-ignored worktree changes:\n${dirty}`);
  }
}

function main(argv) {
  const options = parseArgs(argv);
  const component = String(options.component || '');
  if (!Object.hasOwn(COMPONENTS, component)) {
    throw new Error(`--component must be one of ${Object.keys(COMPONENTS).join(', ')}`);
  }
  const version = resolveVersion(component, options.version);
  const commit = assertCheckout(options.commit);
  const outputDir = prepareOutput(component, options.outputDir);

  if (component === 'runtime') buildRuntime(version, outputDir);
  if (component === 'sdk') buildSdk(version, outputDir);
  if (component === 'kit') buildKit(version, outputDir, options.platform);
  if (component === 'app-tools') buildAppTools(version, outputDir);
  if (component === 'nimi-shell-tauri' || component === 'nimi-shell-protected-local') {
    buildCargoPackage(component, version, commit, outputDir);
  }
  if (component === 'proto') buildProto(version, commit, outputDir);

  ensureNoTrackedBuildWrites();
  const { outputPath } = createReleaseManifest({
    component,
    version,
    commit,
    channel: 'canary',
    artifactsDir: outputDir,
  });
  process.stdout.write(`[release-canary] ${component} ${version} at ${commit}\n`);
  process.stdout.write(`[release-canary] artifacts: ${outputDir}\n`);
  process.stdout.write(`[release-canary] manifest: ${outputPath}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[release-canary] ${error.stack ?? error.message ?? String(error)}\n`);
    process.exit(1);
  }
}
