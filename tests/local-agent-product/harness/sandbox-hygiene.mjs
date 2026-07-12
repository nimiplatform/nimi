import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TRIAL_ROOT_PREFIX = 'nimi-local-agent-';
export const HARNESS_OWNER_MARKER = 'harness-owner.json';
export const RUNTIME_DAEMON_PID_FILE = 'runtime-daemon.pid';
const DEFAULT_STALE_ROOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function writeHarnessOwnerMarker(root) {
  const marker = { schemaVersion: 'nimi.local-agent-harness-owner/v1', pid: process.pid, startedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(root, HARNESS_OWNER_MARKER), `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  return marker;
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function rootAgeMs(root, marker, now) {
  const startedAt = Date.parse(marker?.startedAt || '');
  if (Number.isFinite(startedAt)) return now - startedAt;
  try {
    return now - fs.statSync(root).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function readOwnerMarker(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, HARNESS_OWNER_MARKER), 'utf8'));
  } catch {
    return null;
  }
}

export function isStaleTrialRoot(root, { maxAgeMs = DEFAULT_STALE_ROOT_MAX_AGE_MS, now = Date.now() } = {}) {
  const marker = readOwnerMarker(root);
  if (marker && !processAlive(Number(marker.pid))) return true;
  return rootAgeMs(root, marker, now) > maxAgeMs;
}

function collectRuntimeDaemonPids(root) {
  const pids = new Set();
  let entries = [];
  try {
    entries = fs.readdirSync(root, { recursive: true, withFileTypes: true });
  } catch {
    return pids;
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.name !== RUNTIME_DAEMON_PID_FILE) continue;
    try {
      for (const line of fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8').split(/\r?\n/u)) {
        const pid = Number.parseInt(line.trim(), 10);
        if (Number.isInteger(pid) && pid > 0) pids.add(pid);
      }
    } catch {
      // Unreadable pid files fall through to the command-line based match below.
    }
  }
  return pids;
}

function runtimeProcessSignature(pid) {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").Name`,
    ], { encoding: 'utf8' });
    return String(result.stdout || '').trim().toLowerCase();
  }
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
  return String(result.stdout || '').trim().toLowerCase();
}

function isRuntimeDaemonSignature(signature) {
  return /(^|[\\/])(go|nimi[^\\/]*|node)(\.exe)?$/u.test(signature);
}

function windowsProcessIdsTouchingRoot(root) {
  const escaped = root.replace(/'/gu, "''");
  const script = [
    'Get-CimInstance Win32_Process | Where-Object {',
    `($_.ExecutablePath -and $_.ExecutablePath.StartsWith('${escaped}', [System.StringComparison]::OrdinalIgnoreCase))`,
    `-or ($_.CommandLine -and $_.CommandLine.IndexOf('${escaped}', [System.StringComparison]::OrdinalIgnoreCase) -ge 0)`,
    '} | Select-Object -ExpandProperty ProcessId',
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  return String(result.stdout || '')
    .split(/\r?\n/u)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function killProcessTree(pid) {
  if (pid === process.pid || !processAlive(pid)) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process exited between the liveness probe and the kill.
    }
  }
}

export function terminateTrialRootProcesses(root) {
  const killed = [];
  for (const pid of collectRuntimeDaemonPids(root)) {
    if (!processAlive(pid)) continue;
    if (!isRuntimeDaemonSignature(runtimeProcessSignature(pid))) continue;
    killProcessTree(pid);
    killed.push(pid);
  }
  if (process.platform === 'win32') {
    for (const pid of windowsProcessIdsTouchingRoot(root)) {
      killProcessTree(pid);
      killed.push(pid);
    }
  } else {
    spawnSync('pkill', ['-9', '-f', root], { stdio: 'ignore' });
  }
  return killed;
}

export function sweepStaleIsolatedTrialRoots({ maxAgeMs = DEFAULT_STALE_ROOT_MAX_AGE_MS, tmpDir = os.tmpdir(), now = Date.now() } = {}) {
  const swept = [];
  const active = [];
  const failed = [];
  let entries = [];
  try {
    entries = fs.readdirSync(tmpDir, { withFileTypes: true });
  } catch {
    return { swept, active, failed };
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TRIAL_ROOT_PREFIX)) continue;
    const root = path.join(tmpDir, entry.name);
    if (!isStaleTrialRoot(root, { maxAgeMs, now })) {
      active.push(root);
      continue;
    }
    terminateTrialRootProcesses(root);
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
      swept.push(root);
    } catch (error) {
      failed.push({ root, code: error?.code || 'UNKNOWN', message: String(error?.message || error) });
    }
  }
  return { swept, active, failed };
}

const RETAINED_RUNTIME_DATA_KEEP = new Set(['logs', 'audit']);

export function pruneRetainedTrialRootPayload(trial) {
  const runtimeData = trial?.paths?.runtimeData;
  const pruned = [];
  const failed = [];
  if (!runtimeData || !fs.existsSync(runtimeData)) return { pruned, failed };
  for (const entry of fs.readdirSync(runtimeData, { withFileTypes: true })) {
    if (RETAINED_RUNTIME_DATA_KEEP.has(entry.name)) continue;
    const target = path.join(runtimeData, entry.name);
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
      pruned.push(entry.name);
    } catch (error) {
      failed.push({ target, code: error?.code || 'UNKNOWN' });
    }
  }
  return { pruned, failed };
}
