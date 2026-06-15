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
let activeTauriChild = null;
let shuttingDown = false;

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

function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
    });
    return;
  }
  child.kill('SIGTERM');
}

function exitFromSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  terminateProcessTree(activeTauriChild);
  process.exit(SIGNAL_EXIT_CODES.get(signal) ?? 1);
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
  process.stderr.write(`[run-tauri-dev] failed to start ${tauriBin}: ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  activeTauriChild = null;
  if (signal) {
    process.exit(SIGNAL_EXIT_CODES.get(signal) ?? 1);
    return;
  }
  process.exit(code ?? 0);
});
