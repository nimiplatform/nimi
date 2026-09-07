#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { spawnSyncCommand } from '../lib/command-runner.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const outputRoot = path.join(repoRoot, 'dist', 'component-release');
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const COMPONENTS = new Set(['sdk', 'kit', 'app-tools']);

function run(command, args, { cwd = repoRoot, stdio = 'inherit' } = {}) {
  const result = spawnSyncCommand(command, args, { cwd, stdio, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`);
  }
  return result;
}

function capture(command, args) {
  return String(run(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }).stdout || '').trim();
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
    values[token.slice(2)] = value;
    index += 1;
  }
  const component = String(values.component || '');
  if (!COMPONENTS.has(component)) {
    throw new Error(`--component must be one of ${[...COMPONENTS].join(', ')}`);
  }
  const outputDir = path.resolve(repoRoot, String(values['output-dir'] || ''));
  const relativeOutput = path.relative(outputRoot, outputDir);
  if (!relativeOutput || relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
    throw new Error('--output-dir must be a component directory under dist/component-release');
  }
  return { component, outputDir };
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function packageVersion(relativePath) {
  const version = String(readJson(relativePath).version || '');
  if (!STABLE_VERSION.test(version)) {
    throw new Error(`${relativePath} must contain a final stable SemVer; found ${version}`);
  }
  return version;
}

function copyPackage(sourceRoot, destinationRoot) {
  cpSync(sourceRoot, destinationRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(sourceRoot, source);
      if (!relative) return true;
      return !relative.split(path.sep).some((part) => part === 'node_modules' || part === 'target');
    },
  });
}

function stageAndPack(sourceRoot, outputDir, mutate) {
  const stagingRoot = mkdtempSync(path.join(tmpdir(), 'nimi-component-package-'));
  const packageRoot = path.join(stagingRoot, 'package');
  try {
    copyPackage(sourceRoot, packageRoot);
    const manifestPath = path.join(packageRoot, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    mutate(manifest);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const before = new Set(readdirSync(outputDir));
    run('npm', ['pack', packageRoot, '--pack-destination', outputDir, '--ignore-scripts']);
    const created = readdirSync(outputDir).filter((name) => name.endsWith('.tgz') && !before.has(name));
    if (created.length !== 1) {
      throw new Error(`npm pack must create exactly one tarball; found ${created.join(', ')}`);
    }
    return path.join(outputDir, created[0]);
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function buildSdk(outputDir) {
  const version = packageVersion('sdks/typescript/package.json');
  run('pnpm', ['--filter', '@nimiplatform/sdk', 'build']);
  const tarball = stageAndPack(path.join(repoRoot, 'sdks', 'typescript'), outputDir, (manifest) => {
    manifest.version = version;
  });
  run(process.execPath, [
    path.join(repoRoot, 'scripts', 'check-sdk-kit-pack-audit.mjs'),
    '--package', 'sdk',
    '--tarball', tarball,
  ]);
  return { version, tarball };
}

function buildKit(outputDir) {
  const version = packageVersion('kit/package.json');
  const sdkVersion = packageVersion('sdks/typescript/package.json');
  const nativeManifest = readJson('kit/shell/protected-local-node/npm/win32-x64/package.json');
  if (nativeManifest.name !== '@nimiplatform/kit-protected-local-win32-x64' || nativeManifest.version !== version) {
    throw new Error('Windows native package identity must match the Kit component version');
  }
  run('pnpm', ['--filter', '@nimiplatform/sdk', 'build']);
  run('pnpm', ['--filter', '@nimiplatform/kit', 'build']);
  const tarball = stageAndPack(path.join(repoRoot, 'kit'), outputDir, (manifest) => {
    manifest.version = version;
    manifest.dependencies['@nimiplatform/sdk'] = `^${sdkVersion}`;
    manifest.optionalDependencies = {
      '@nimiplatform/kit-protected-local-win32-x64': `^${version}`,
    };
  });
  run(process.execPath, [
    path.join(repoRoot, 'scripts', 'check-sdk-kit-pack-audit.mjs'),
    '--package', 'kit',
    '--tarball', tarball,
  ]);
  return { version, tarball };
}

function smokeAppTools(tarball) {
  const sdkVersion = packageVersion('sdks/typescript/package.json');
  const kitVersion = packageVersion('kit/package.json');
  const appToolsVersion = packageVersion('app-tools/package.json');
  const smokeRoot = mkdtempSync(path.join(tmpdir(), 'nimi-app-tools-package-'));
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
    const appRoot = path.join(smokeRoot, 'component-release-smoke');
    run(command, [
      'create', '--dir', appRoot, '--profile', 'standalone', '--title', 'Component Release Smoke',
    ], { cwd: smokeRoot });
    const scaffold = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
    const expected = {
      '@nimiplatform/sdk': `^${sdkVersion}`,
      '@nimiplatform/kit': `^${kitVersion}`,
      '@nimiplatform/app-tools': `^${appToolsVersion}`,
    };
    for (const [name, version] of Object.entries(expected)) {
      const actual = scaffold.dependencies?.[name] ?? scaffold.devDependencies?.[name];
      if (actual !== version) throw new Error(`scaffold emitted ${name}=${String(actual)}; expected ${version}`);
    }
  } finally {
    rmSync(smokeRoot, { recursive: true, force: true });
  }
}

function buildAppTools(outputDir) {
  const version = packageVersion('app-tools/package.json');
  run('pnpm', ['--filter', '@nimiplatform/app-tools', 'build']);
  const tarball = stageAndPack(path.join(repoRoot, 'app-tools'), outputDir, (manifest) => {
    manifest.version = version;
  });
  smokeAppTools(tarball);
  return { version, tarball };
}

function main(argv) {
  const { component, outputDir } = parseArgs(argv);
  const statusBefore = capture('git', ['status', '--porcelain', '--untracked-files=all']);
  if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const result = component === 'sdk'
    ? buildSdk(outputDir)
    : component === 'kit'
      ? buildKit(outputDir)
      : buildAppTools(outputDir);

  const statusAfter = capture('git', ['status', '--porcelain', '--untracked-files=all']);
  if (statusAfter !== statusBefore) {
    throw new Error('component package build changed tracked or untracked source files');
  }
  process.stdout.write(`${JSON.stringify({ component, version: result.version, tarball: result.tarball })}\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`[build-component-package] ${error.stack ?? error.message ?? String(error)}\n`);
  process.exit(1);
}
