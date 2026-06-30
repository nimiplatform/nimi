#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(desktopRoot, '../..');
const sdkPackageRoot = path.join(workspaceRoot, 'sdks', 'typescript');
const sdkDistRoot = path.join(workspaceRoot, 'sdks', 'typescript', 'dist');
const viteOptimizerCacheRoot = path.join(desktopRoot, 'node_modules', '.vite');
const tauriBin = path.join(desktopRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');
const args = ['dev', '--config', 'src-tauri/tauri.conf.json'];
const SDK_DIST_FRESHNESS_INPUT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.json']);
const SDK_DIST_FRESHNESS_SKIP_DIRS = new Set(['dist', 'node_modules']);
const REQUIRED_SDK_DIST_FILES = [
  'index.js',
  'runtime/index.js',
  'runtime/generated.js',
  'realm/index.js',
  'realm/generated.js',
  'types/index.js',
  'core/ai/index.js',
  'core/app/index.js',
  'core/contracts/index.js',
  'core/testing/index.js',
  'features/conversation/index.js',
  'features/knowledge-context/index.js',
  'features/memory-context/index.js',
  'features/generation/index.js',
  'features/workflow/index.js',
  'features/evaluation/index.js',
  'features/toolkits/index.js',
];
const SIGNAL_EXIT_CODES = new Map([
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
]);
const SIGNAL_FORCE_KILL_GRACE_MS = 1500;
const SIGNAL_HARD_EXIT_MS = 5000;
let activeTauriChild = null;
let shuttingDown = false;
let shutdownExitCode = null;
let signalForceKillTimer = null;
let signalHardExitTimer = null;

if (process.platform === 'win32') {
  args.push('--config', 'src-tauri/tauri.dev.windows.conf.json');
}

args.push(...process.argv.slice(2));

function quoteCmdArg(value) {
  const raw = String(value);
  if (!/[\s"&|<>^]/.test(raw)) {
    return raw;
  }
  return `"${raw.replaceAll('"', '\\"')}"`;
}

function collectNewestSdkInputMtimeMs(rootDir) {
  let newestMtimeMs = 0;
  const entries = existsSync(rootDir) ? readdirSync(rootDir, { withFileTypes: true }) : [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SDK_DIST_FRESHNESS_SKIP_DIRS.has(entry.name)) {
        continue;
      }
      newestMtimeMs = Math.max(newestMtimeMs, collectNewestSdkInputMtimeMs(path.join(rootDir, entry.name)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const filePath = path.join(rootDir, entry.name);
    if (!SDK_DIST_FRESHNESS_INPUT_EXTENSIONS.has(path.extname(filePath))) {
      continue;
    }
    newestMtimeMs = Math.max(newestMtimeMs, statSync(filePath).mtimeMs);
  }
  return newestMtimeMs;
}

let command = tauriBin;
let commandArgs = args;
if (process.platform === 'win32') {
  spawnSync('cmd.exe', ['/d', '/s', '/c', 'chcp 65001 >nul'], { stdio: 'ignore' });
  command = 'cmd.exe';
  commandArgs = ['/d', '/s', '/c', [tauriBin, ...args].map(quoteCmdArg).join(' ')];
}

const childEnv = {
  ...process.env,
  CARGO_TERM_PROGRESS_WHEN: process.env.CARGO_TERM_PROGRESS_WHEN || 'never',
};
const inheritedChildStdio = process.platform === 'win32'
  ? ['ignore', 'inherit', 'inherit']
  : 'inherit';

function isSdkDistReadyForDesktopDev() {
  if (process.env.NIMI_DESKTOP_DEV_REBUILD_SDK === '1') {
    return false;
  }
  let oldestDistMtimeMs = Number.POSITIVE_INFINITY;
  for (const relativePath of REQUIRED_SDK_DIST_FILES) {
    const distPath = path.join(sdkDistRoot, ...relativePath.split('/'));
    if (!existsSync(distPath)) {
      return false;
    }
    oldestDistMtimeMs = Math.min(oldestDistMtimeMs, statSync(distPath).mtimeMs);
  }

  const newestSdkInputMtimeMs = collectNewestSdkInputMtimeMs(sdkPackageRoot);
  return newestSdkInputMtimeMs <= oldestDistMtimeMs;
}

function ensureSdkDistForDesktopDev() {
  if (isSdkDistReadyForDesktopDev()) {
    return false;
  }
  const pnpmArgs = ['--dir', workspaceRoot, '--filter', '@nimiplatform/sdk', 'build'];
  const buildCommand = process.platform === 'win32' ? 'cmd.exe' : pnpmBin;
  const buildArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', [pnpmBin, ...pnpmArgs].map(quoteCmdArg).join(' ')]
    : pnpmArgs;
  const result = spawnSync(buildCommand, buildArgs, {
    cwd: workspaceRoot,
    env: childEnv,
    stdio: 'inherit',
  });
  if (result.error) {
    process.stderr.write(`[run-tauri-dev] failed to start SDK dist build: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`[run-tauri-dev] SDK dist build failed with status ${result.status ?? 'unknown'}\n`);
    process.exit(result.status ?? 1);
  }
  return true;
}

function refreshRendererOptimizerAfterSdkRebuild() {
  rmSync(viteOptimizerCacheRoot, { recursive: true, force: true });
  childEnv.NIMI_DESKTOP_DEV_RENDERER_RESTART = '1';
}

function isChildRunning(child) {
  return Boolean(child?.pid && child.exitCode === null && child.signalCode === null);
}

function forceKillProcessTree(child) {
  if (!isChildRunning(child)) {
    return;
  }
  if (process.platform === 'win32') {
    const taskkill = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    taskkill.on('error', () => {});
    taskkill.unref();
    return;
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // The child may have exited between the running check and forced cleanup.
  }
}

function requestProcessTreeShutdown(child, signal) {
  if (!isChildRunning(child)) {
    return false;
  }
  try {
    if (process.platform === 'win32') {
      if (signal !== 'SIGINT') {
        child.kill('SIGTERM');
      }
    } else {
      child.kill(signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
    }
  } catch {
    return false;
  }
  signalForceKillTimer = setTimeout(() => {
    forceKillProcessTree(child);
  }, SIGNAL_FORCE_KILL_GRACE_MS);
  signalHardExitTimer = setTimeout(() => {
    process.exit(shutdownExitCode ?? SIGNAL_EXIT_CODES.get(signal) ?? 1);
  }, SIGNAL_HARD_EXIT_MS);
  return true;
}

function clearSignalShutdownTimers() {
  if (signalForceKillTimer) {
    clearTimeout(signalForceKillTimer);
    signalForceKillTimer = null;
  }
  if (signalHardExitTimer) {
    clearTimeout(signalHardExitTimer);
    signalHardExitTimer = null;
  }
}

function exitFromSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  shutdownExitCode = SIGNAL_EXIT_CODES.get(signal) ?? 1;
  if (!requestProcessTreeShutdown(activeTauriChild, signal)) {
    process.exit(shutdownExitCode);
  }
}

if (ensureSdkDistForDesktopDev()) {
  refreshRendererOptimizerAfterSdkRebuild();
}

for (const signal of SIGNAL_EXIT_CODES.keys()) {
  process.on(signal, () => exitFromSignal(signal));
}

const child = spawn(command, commandArgs, {
  cwd: desktopRoot,
  env: childEnv,
  stdio: inheritedChildStdio,
});
activeTauriChild = child;

child.on('error', (error) => {
  activeTauriChild = null;
  clearSignalShutdownTimers();
  if (shuttingDown) {
    process.exit(shutdownExitCode ?? 1);
  }
  process.stderr.write(`[run-tauri-dev] failed to start ${tauriBin}: ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  activeTauriChild = null;
  clearSignalShutdownTimers();
  if (shuttingDown) {
    process.exit(shutdownExitCode ?? SIGNAL_EXIT_CODES.get(signal) ?? code ?? 0);
    return;
  }
  if (signal) {
    process.exit(SIGNAL_EXIT_CODES.get(signal) ?? 1);
    return;
  }
  process.exit(code ?? 0);
});
