#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';

const tauriBin = process.platform === 'win32' ? 'tauri.cmd' : 'tauri';
const args = ['dev', '--config', 'src-tauri/tauri.conf.json'];

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

const child = spawn(command, commandArgs, {
  cwd: process.cwd(),
  env: childEnv,
  stdio: 'inherit',
});

child.on('error', (error) => {
  process.stderr.write(`[run-tauri-dev] failed to start ${tauriBin}: ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
