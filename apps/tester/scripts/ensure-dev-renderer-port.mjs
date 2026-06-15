#!/usr/bin/env node
/* global console, process */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testerRoot = path.resolve(__dirname, '..');
const rendererPort = 1468;

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: testerRoot,
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

function readProcessCommandLineWindows(pid) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$Process = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'`,
    'if ($null -ne $Process) { [Console]::Out.Write($Process.CommandLine) }',
  ].join('\n');
  return runCommand('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]);
}

function readProcessCommandLinePosix(pid) {
  try {
    return runCommand('ps', ['-p', String(pid), '-o', 'command=']);
  } catch {
    return '';
  }
}

function normalizeForMatch(value) {
  return String(value || '').replaceAll('\\', '/').toLowerCase();
}

function isTesterRendererProcess(commandLine) {
  const normalized = normalizeForMatch(commandLine);
  const normalizedTesterRoot = normalizeForMatch(testerRoot);
  return normalized.includes(normalizedTesterRoot)
    && normalized.includes('vite')
    && normalized.includes('--port 1468');
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

function ensureRendererPortAvailable() {
  const pids = getListeningPids(rendererPort);
  if (pids.length === 0) {
    console.log(`[dev-renderer-port] Port ${rendererPort} is available.`);
    return;
  }

  for (const pid of pids) {
    const commandLine = readProcessCommandLine(pid);
    if (!isTesterRendererProcess(commandLine)) {
      throw new Error(
        `Port ${rendererPort} is already in use by PID ${pid}. ` +
        'It is not a recognized tester renderer process, so cleanup was skipped.',
      );
    }

    console.log(`[dev-renderer-port] Stopping stale tester renderer on port ${rendererPort} (PID ${pid}).`);
    process.kill(pid);
  }
}

try {
  ensureRendererPortAvailable();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[dev-renderer-port] ${message}`);
  process.exit(1);
}
