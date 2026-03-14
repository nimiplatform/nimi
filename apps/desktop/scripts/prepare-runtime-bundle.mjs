#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const runtimeRoot = path.join(repoRoot, 'runtime');
const resourcesRoot = path.join(desktopRoot, 'src-tauri', 'resources');
const runtimeResourcesRoot = path.join(resourcesRoot, 'runtime');

function parseArgs(argv) {
  const args = {
    version: '',
    channel: 'stable',
    commit: '',
    builtAt: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--version') {
      args.version = String(argv[index + 1] || '').trim();
      index += 1;
    } else if (arg === '--channel') {
      args.channel = String(argv[index + 1] || '').trim() || 'stable';
      index += 1;
    } else if (arg === '--commit') {
      args.commit = String(argv[index + 1] || '').trim();
      index += 1;
    } else if (arg === '--built-at') {
      args.builtAt = String(argv[index + 1] || '').trim();
      index += 1;
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveVersion(input) {
  if (input.version) {
    return input.version;
  }
  const pkg = readJson(path.join(desktopRoot, 'package.json'));
  return String(pkg.version || '').trim();
}

function resolveCommit(input) {
  if (input.commit) {
    return input.commit;
  }
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    return String(result.stdout || '').trim();
  }
  return 'dev';
}

export function normalizePlatformKey() {
  const platformMap = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'windows',
  };
  const archMap = {
    arm64: 'arm64',
    x64: 'amd64',
  };
  const platform = platformMap[process.platform] || process.platform;
  const arch = archMap[process.arch] || process.arch;
  return `${platform}-${arch}`;
}

export function runtimeBinaryName() {
  return process.platform === 'win32' ? 'nimi.exe' : 'nimi';
}

export function createRuntimeManifest(input) {
  return {
    version: input.version,
    platform: input.platform,
    archivePath: input.archivePath,
    binaryPath: input.binaryPath,
    sha256: input.sha256,
    builtAt: input.builtAt,
    commit: input.commit,
  };
}

export function createDesktopReleaseManifest(input) {
  return {
    desktopVersion: input.version,
    runtimeVersion: input.version,
    channel: input.channel,
    commit: input.commit,
    runtimeArchivePath: input.runtimeArchivePath,
    runtimeSha256: input.runtimeSha256,
    runtimeBinaryPath: input.runtimeBinaryPath,
    builtAt: input.builtAt,
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function pythonCommands() {
  return process.platform === 'win32'
    ? [['py', ['-3']], ['python', []], ['python3', []]]
    : [['python3', []], ['python', []]];
}

function runPythonZip(archivePath, sourceRoot, relativeFilePath) {
  const script = [
    'import os, sys, zipfile',
    'archive_path, source_root, relative_path = sys.argv[1], sys.argv[2], sys.argv[3]',
    'source_path = os.path.join(source_root, relative_path)',
    'with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:',
    '    zf.write(source_path, relative_path)',
  ].join('\n');

  for (const [command, prefixArgs] of pythonCommands()) {
    const result = spawnSync(command, [...prefixArgs, '-c', script, archivePath, sourceRoot, relativeFilePath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (result.status === 0) {
      return;
    }
  }
  throw new Error('failed to locate python runtime for zip creation');
}

function sha256Hex(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function buildRuntimeBinary(outputPath) {
  ensureDir(path.dirname(outputPath));
  const result = spawnSync('go', ['build', '-o', outputPath, './cmd/nimi'], {
    cwd: runtimeRoot,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`go build failed with status ${result.status}`);
  }
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function main() {
  const input = parseArgs(process.argv.slice(2));
  const version = resolveVersion(input);
  const commit = resolveCommit(input);
  const builtAt = input.builtAt || new Date().toISOString();
  const channel = input.channel || 'stable';
  const platformKey = normalizePlatformKey();
  const binaryName = runtimeBinaryName();
  const binaryRelativePath = path.join('bin', binaryName);
  const bundleDir = path.join(runtimeResourcesRoot, platformKey);
  const binaryPath = path.join(bundleDir, binaryRelativePath);
  const archivePath = path.join(bundleDir, 'nimi-runtime.zip');
  const runtimeManifestPath = path.join(bundleDir, 'manifest.json');
  const topLevelRuntimeManifestPath = path.join(runtimeResourcesRoot, 'manifest.json');
  const releaseManifestPath = path.join(resourcesRoot, 'desktop-release-manifest.json');

  removePath(bundleDir);
  ensureDir(bundleDir);

  buildRuntimeBinary(binaryPath);
  runPythonZip(archivePath, bundleDir, binaryRelativePath);
  const archiveSha = sha256Hex(archivePath);

  const runtimeManifest = createRuntimeManifest({
    version,
    platform: platformKey,
    archivePath: path.relative(resourcesRoot, archivePath).replaceAll(path.sep, '/'),
    binaryPath: binaryRelativePath.replaceAll(path.sep, '/'),
    sha256: archiveSha,
    builtAt,
    commit,
  });

  writeJson(runtimeManifestPath, runtimeManifest);
  writeJson(topLevelRuntimeManifestPath, runtimeManifest);

  writeJson(releaseManifestPath, createDesktopReleaseManifest({
    version,
    channel,
    commit,
    runtimeArchivePath: path.relative(resourcesRoot, archivePath).replaceAll(path.sep, '/'),
    runtimeSha256: archiveSha,
    runtimeBinaryPath: binaryRelativePath.replaceAll(path.sep, '/'),
    builtAt,
  }));

  process.stdout.write(
    `[prepare-runtime-bundle] version=${version} platform=${platformKey} archive=${path.relative(repoRoot, archivePath)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
