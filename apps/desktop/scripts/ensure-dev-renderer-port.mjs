#!/usr/bin/env node
/* global AbortSignal, console, fetch, process, setInterval, setTimeout */

import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  planRendererCommand,
  planRendererPortResolution,
} from './dev-renderer-port-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const rendererPort = 1420;
const rendererProbeTimeoutMs = 1200;
const shutdownGraceMs = 5000;
const signalForceKillGraceMs = 1500;
const signalHardExitMs = 5000;
const SIGNAL_EXIT_CODES = new Map([
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
]);
const inheritedChildStdio = process.platform === 'win32'
  ? ['ignore', 'inherit', 'inherit']
  : 'inherit';

let activeRendererChild = null;
let shutdownSignal = null;
let signalForceKillTimer = null;
let signalHardExitTimer = null;

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: desktopRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
    const details = stderr || stdout || error?.message || String(error);
    throw new Error(details, { cause: error });
  }
}

function listListeningPidsWindows(port) {
  const output = runCommand('netstat', ['-ano', '-p', 'tcp']);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 5)
    .filter((parts) => parts[0].toUpperCase() === 'TCP')
    .filter((parts) => parts[1].endsWith(`:${port}`))
    .filter((parts) => parts[3].toUpperCase() === 'LISTENING')
    .map((parts) => Number.parseInt(parts[4], 10))
    .filter((value) => Number.isInteger(value) && value > 0)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function listListeningPidsPosix(port) {
  try {
    const output = runCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
    return output
      .split(/\r?\n/)
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

function readProcessCommandLinePosix(pid) {
  try {
    return runCommand('ps', ['-p', String(pid), '-o', 'command=']);
  } catch {
    return '';
  }
}

function readProcessCommandLineWindows(pid) {
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$ProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
    'if ($null -ne $ProcessInfo) { [Console]::Out.Write($ProcessInfo.CommandLine) }',
  ].join('; ');
  try {
    return runCommand('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ]);
  } catch {
    return '';
  }
}

function getListeningPids(port) {
  if (process.platform === 'win32') {
    return listListeningPidsWindows(port);
  }
  return listListeningPidsPosix(port);
}

function readProcessCommandLine(pid) {
  if (process.platform === 'win32') {
    return readProcessCommandLineWindows(pid);
  }
  return readProcessCommandLinePosix(pid);
}

function getRendererPortProcesses() {
  return getListeningPids(rendererPort).map((pid) => ({
    pid,
    commandLine: readProcessCommandLine(pid),
  }));
}

async function isRendererReachable() {
  try {
    const response = await fetch(`http://127.0.0.1:${rendererPort}/`, {
      signal: AbortSignal.timeout(rendererProbeTimeoutMs),
    });
    return response.status >= 200 && response.status < 600;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForRendererPortRelease() {
  const deadline = Date.now() + shutdownGraceMs;
  while (Date.now() < deadline) {
    if (getListeningPids(rendererPort).length === 0) {
      return true;
    }
    await sleep(100);
  }
  return getListeningPids(rendererPort).length === 0;
}

async function stopRendererProcesses(pids) {
  for (const pid of pids) {
    console.log(`[dev-renderer-port] Stopping stale desktop renderer on port ${rendererPort} (PID ${pid}).`);
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        throw error;
      }
    }
  }

  if (pids.length > 0 && !(await waitForRendererPortRelease())) {
    throw new Error(`Port ${rendererPort} is still in use after stopping desktop renderer process(es): ${pids.join(', ')}`);
  }
}

function exitCodeForShutdownSignal(signal) {
  if (signal === 'SIGTERM') {
    return 0;
  }
  return SIGNAL_EXIT_CODES.get(signal) ?? 1;
}

function isRendererChildRunning(child) {
  return Boolean(child?.pid && child.exitCode === null && child.signalCode === null);
}

function forceKillRendererProcessTree(child) {
  if (!isRendererChildRunning(child)) {
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

function requestRendererShutdown(child, signal) {
  if (!isRendererChildRunning(child)) {
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
    forceKillRendererProcessTree(child);
  }, signalForceKillGraceMs);
  signalHardExitTimer = setTimeout(() => {
    process.exit(exitCodeForShutdownSignal(signal));
  }, signalHardExitMs);
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
  if (shutdownSignal) {
    return;
  }
  shutdownSignal = signal;
  if (!requestRendererShutdown(activeRendererChild, signal)) {
    process.exit(exitCodeForShutdownSignal(signal));
  }
}

function runIdleRendererReuseProcess() {
  setInterval(() => undefined, 2147483647);
}

function spawnRenderer(command, args) {
  const spawnPlan = planRendererCommand(command, args, {
    platform: process.platform,
  });
  const child = spawn(spawnPlan.command, spawnPlan.args, {
    cwd: desktopRoot,
    env: process.env,
    stdio: inheritedChildStdio,
  });
  activeRendererChild = child;

  child.on('error', (error) => {
    activeRendererChild = null;
    clearSignalShutdownTimers();
    if (shutdownSignal) {
      process.exit(exitCodeForShutdownSignal(shutdownSignal));
    }
    process.stderr.write(`[dev-renderer-port] failed to start renderer command: ${error.message}\n`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    activeRendererChild = null;
    clearSignalShutdownTimers();
    if (shutdownSignal) {
      process.exit(exitCodeForShutdownSignal(shutdownSignal));
      return;
    }
    if (signal) {
      process.exit(SIGNAL_EXIT_CODES.get(signal) ?? 1);
      return;
    }
    process.exit(code ?? 0);
  });
}

async function resolveRendererPort() {
  const processes = getRendererPortProcesses();
  const plan = planRendererPortResolution({
    desktopRoot,
    rendererPort,
    processes,
    isRendererReachable: await isRendererReachable(),
    forceRestart: process.env.NIMI_DESKTOP_DEV_RENDERER_RESTART === '1',
  });

  if (plan.action === 'fail') {
    throw new Error(plan.message);
  }

  if (plan.action === 'reuse') {
    console.log(`[dev-renderer-port] ${plan.message}`);
    return plan;
  }

  if (plan.action === 'start') {
    console.log(`[dev-renderer-port] ${plan.message}`);
    return plan;
  }

  await stopRendererProcesses(plan.pidsToStop);
  return plan;
}

async function main() {
  const separatorIndex = process.argv.indexOf('--');
  const childArgs = separatorIndex === -1 ? [] : process.argv.slice(separatorIndex + 1);
  const plan = await resolveRendererPort();

  if (childArgs.length === 0 || plan.action === 'reuse') {
    if (childArgs.length === 0) {
      return;
    }
    runIdleRendererReuseProcess();
    return;
  }

  const [command, ...args] = childArgs;
  spawnRenderer(command, args);
}

for (const signal of SIGNAL_EXIT_CODES.keys()) {
  process.on(signal, () => exitFromSignal(signal));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[dev-renderer-port] ${message}`);
  process.exit(1);
});
