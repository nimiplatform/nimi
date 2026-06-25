#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tauriBin = process.platform === 'win32' ? 'tauri.cmd' : 'tauri';
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = ['dev', '--config', 'src-tauri/tauri.conf.json'];
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

function buildSdkDistForDesktopDev() {
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

buildSdkDistForDesktopDev();

for (const signal of SIGNAL_EXIT_CODES.keys()) {
  process.on(signal, () => exitFromSignal(signal));
}

const child = spawn(command, commandArgs, {
  cwd: process.cwd(),
  env: childEnv,
  stdio: 'inherit',
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
