#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const args = process.argv.slice(2);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    env: process.env,
    encoding: 'utf8',
  });
  if (result.error) {
    fail(`[check-npm-binary-smoke] failed to start ${command}: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    fail(`[check-npm-binary-smoke] ${command} exited with code ${result.status ?? 1}`);
  }
  return result;
}

function resolveOption(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  if (index === args.length - 1) {
    fail(`[check-npm-binary-smoke] missing value for ${name}`);
  }
  return path.resolve(repoRoot, args[index + 1]);
}

const targetMap = {
  'darwin:arm64': { packageDir: 'nimi-darwin-arm64', binaryName: 'nimi' },
  'darwin:x64': { packageDir: 'nimi-darwin-x64', binaryName: 'nimi' },
  'linux:arm64': { packageDir: 'nimi-linux-arm64', binaryName: 'nimi' },
  'linux:x64': { packageDir: 'nimi-linux-x64', binaryName: 'nimi' },
  'win32:arm64': { packageDir: 'nimi-win32-arm64', binaryName: 'nimi.exe' },
  'win32:x64': { packageDir: 'nimi-win32-x64', binaryName: 'nimi.exe' },
};

const target = targetMap[`${process.platform}:${process.arch}`];
if (!target) {
  fail(`[check-npm-binary-smoke] unsupported platform ${process.platform}/${process.arch}`);
}

const packagesRoot = resolveOption('--packages-root', path.join(repoRoot, 'npm-packages'));
const launcherSource = path.join(packagesRoot, 'nimi');
const platformSource = path.join(packagesRoot, target.packageDir);
if (!fs.existsSync(launcherSource)) {
  fail(`[check-npm-binary-smoke] missing launcher package at ${launcherSource}`);
}
if (!fs.existsSync(platformSource)) {
  fail(`[check-npm-binary-smoke] missing platform package at ${platformSource}`);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-npm-binary-smoke-'));
const stagedRoot = path.join(tempRoot, 'staged');
const appRoot = path.join(tempRoot, 'app');
fs.mkdirSync(stagedRoot, { recursive: true });
fs.mkdirSync(appRoot, { recursive: true });

const stagedLauncher = path.join(stagedRoot, 'nimi');
const stagedPlatform = path.join(stagedRoot, target.packageDir);
fs.cpSync(launcherSource, stagedLauncher, { recursive: true });
fs.cpSync(platformSource, stagedPlatform, { recursive: true });

const stagedBinaryPath = path.join(stagedPlatform, 'bin', target.binaryName);
if (!fs.existsSync(stagedBinaryPath)) {
  const distBinary = path.join(repoRoot, 'dist', target.binaryName);
  if (!fs.existsSync(distBinary)) {
    fail(`[check-npm-binary-smoke] missing ${path.relative(repoRoot, distBinary)}; run 'pnpm build:runtime' first or stage platform binaries before this check`);
  }
  fs.mkdirSync(path.dirname(stagedBinaryPath), { recursive: true });
  fs.copyFileSync(distBinary, stagedBinaryPath);
  if (process.platform !== 'win32') {
    fs.chmodSync(stagedBinaryPath, 0o755);
  }
}

fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({
  name: 'nimi-npm-binary-smoke',
  private: true,
  version: '0.0.0',
}, null, 2) + '\n');

run('pnpm', [
  'add',
  '--no-optional',
  path.relative(appRoot, stagedLauncher),
  path.relative(appRoot, stagedPlatform),
], appRoot);

const launcherBinary = process.platform === 'win32'
  ? path.join(appRoot, 'node_modules', '.bin', 'nimi.cmd')
  : path.join(appRoot, 'node_modules', '.bin', 'nimi');

if (!fs.existsSync(launcherBinary)) {
  fail(`[check-npm-binary-smoke] missing installed launcher binary at ${launcherBinary}`);
}

const versionResult = run(launcherBinary, ['version'], appRoot);
const combined = `${versionResult.stdout}\n${versionResult.stderr}`;
if (!/nimi\s+/i.test(combined)) {
  fail(`[check-npm-binary-smoke] unexpected version output: ${combined.trim()}`);
}

process.stdout.write(`npm binary smoke ok (${target.packageDir})\n`);
