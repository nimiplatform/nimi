#!/usr/bin/env node
/* global console, process */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const rendererPort = 1420;

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

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const nextChar = line[index + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function readProcessImageWindows(pid) {
  const output = runCommand('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
  const normalized = output.trim();
  if (!normalized || normalized.startsWith('INFO:')) {
    return '';
  }
  const values = parseCsvLine(normalized.split(/\r?\n/)[0] || '');
  return values[0] || '';
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

function isDesktopRendererProcess(commandLine) {
  const normalized = normalizeForMatch(commandLine);
  const normalizedDesktopRoot = normalizeForMatch(desktopRoot);
  return normalized.includes(normalizedDesktopRoot)
    && normalized.includes('vite')
    && normalized.includes('--port 1420');
}

function getListeningPids(port) {
  if (process.platform === 'win32') {
    return listListeningPidsWindows(port);
  }
  return listListeningPidsPosix(port);
}

function readProcessCommandLine(pid) {
  return readProcessCommandLinePosix(pid);
}

function canStopWindowsProcess(pid) {
  const imageName = String(readProcessImageWindows(pid) || '').trim().toLowerCase();
  return imageName === 'node.exe';
}

function ensureRendererPortAvailable() {
  const pids = getListeningPids(rendererPort);
  if (pids.length === 0) {
    console.log(`[dev-renderer-port] Port ${rendererPort} is available.`);
    return;
  }

  for (const pid of pids) {
    if (process.platform === 'win32') {
      if (!canStopWindowsProcess(pid)) {
        throw new Error(
          `Port ${rendererPort} is already in use by PID ${pid}. ` +
          'It is not a recognized Node-based renderer process, so cleanup was skipped.',
        );
      }

      console.log(`[dev-renderer-port] Stopping stale desktop renderer on port ${rendererPort} (PID ${pid}).`);
      process.kill(pid);
      continue;
    }

    const commandLine = readProcessCommandLine(pid);
    if (!isDesktopRendererProcess(commandLine)) {
      throw new Error(
        `Port ${rendererPort} is already in use by PID ${pid}. ` +
        'It is not a recognized desktop renderer process, so cleanup was skipped.',
      );
    }

    console.log(`[dev-renderer-port] Stopping stale desktop renderer on port ${rendererPort} (PID ${pid}).`);
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
