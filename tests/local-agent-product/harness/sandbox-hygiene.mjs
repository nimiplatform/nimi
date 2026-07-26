import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TRIAL_ROOT_PREFIX = 'nimi-local-agent-';
export const HARNESS_OWNER_MARKER = 'harness-owner.json';
export const TRIAL_IDENTITY_FILE = 'trial-identity.json';
export const TRIAL_PROCESS_IDENTITY_FILE = 'trial-process-identities.json';
// Retained as a forbidden-symbol compatibility constant for static checks. A bare
// PID file is intentionally never trusted as authority to terminate a process.
export const RUNTIME_DAEMON_PID_FILE = 'runtime-daemon.pid';
const DEFAULT_STALE_ROOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function canonicalRoot(root) {
  const resolved = path.resolve(root);
  let canonical = resolved;
  try {
    canonical = fs.realpathSync.native(resolved);
  } catch {
    // The root may be observed between directory removal and cleanup. The
    // resolved path is still stable input for the fail-closed identity check.
  }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function rootHash(root) {
  return createHash('sha256').update(canonicalRoot(root)).digest('hex');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeExecutable(value) {
  const normalized = String(value || '').trim();
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function windowsProcessIdentity(pid) {
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\"`,
    'if ($null -ne $p) {',
    `  $started = (Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
    '  [ordered]@{',
    '    pid = [int]$p.ProcessId',
    '    creationTime = $started',
    '    executablePath = [string]$p.ExecutablePath',
    '    commandLine = [string]$p.CommandLine',
    '  } | ConvertTo-Json -Compress',
    '}',
  ].join('\n');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0 || !String(result.stdout || '').trim()) return null;
  try {
    return JSON.parse(String(result.stdout).trim());
  } catch {
    return null;
  }
}

function linuxProcessIdentity(pid) {
  const procRoot = path.join('/proc', String(pid));
  try {
    const stat = fs.readFileSync(path.join(procRoot, 'stat'), 'utf8');
    const closingParen = stat.lastIndexOf(')');
    if (closingParen < 0) return null;
    const statFieldsAfterName = stat.slice(closingParen + 2).trim().split(/\s+/u);
    const startTicks = statFieldsAfterName[19];
    const commandLine = fs.readFileSync(path.join(procRoot, 'cmdline'), 'utf8').replace(/\0/gu, ' ').trim();
    return {
      pid,
      creationTime: `linux-proc-start-ticks:${startTicks}`,
      executablePath: fs.readlinkSync(path.join(procRoot, 'exe')),
      commandLine,
    };
  } catch {
    return null;
  }
}

function posixProcessIdentity(pid) {
  const result = spawnSync('ps', ['-ww', '-p', String(pid), '-o', 'lstart=', '-o', 'comm=', '-o', 'args='], {
    encoding: 'utf8',
  });
  const output = String(result.stdout || '').trim();
  if (result.status !== 0 || !output) return null;
  const match = output.match(/^(\S+\s+\S+\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(\S+)\s+([\s\S]+)$/u);
  if (!match) return null;
  return { pid, creationTime: `ps-lstart:${match[1]}`, executablePath: match[2], commandLine: match[3] };
}

export function captureProcessIdentity(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return null;
  const identity = process.platform === 'win32'
    ? windowsProcessIdentity(numericPid)
    : process.platform === 'linux' ? linuxProcessIdentity(numericPid) : posixProcessIdentity(numericPid);
  if (!identity) return null;
  return {
    pid: numericPid,
    creationTime: String(identity.creationTime || ''),
    executablePath: String(identity.executablePath || ''),
    commandLine: String(identity.commandLine || ''),
  };
}

function sameProcessIdentity(expected, observed) {
  return Boolean(expected && observed
    && Number(expected.pid) === Number(observed.pid)
    && String(expected.creationTime || '') === String(observed.creationTime || '')
    && normalizeExecutable(expected.executablePath) === normalizeExecutable(observed.executablePath)
    && String(expected.commandLine || '') === String(observed.commandLine || ''));
}

function readTrialIdentity(root) {
  return readJson(path.join(root, TRIAL_IDENTITY_FILE));
}

function candidateIdFor(identity) {
  return String(identity?.candidateId || identity?.journeyTrialId || identity?.suiteTrialId || '');
}

export function writeHarnessOwnerMarker(root, { candidateId = candidateIdFor(readTrialIdentity(root)) } = {}) {
  const owner = captureProcessIdentity(process.pid);
  if (!owner) throw new Error(`cannot capture harness owner process identity for pid ${process.pid}`);
  if (!candidateId) throw new Error(`trial root ${root} is missing a candidate identity`);
  const marker = {
    schemaVersion: 'nimi.local-agent-harness-owner/v2',
    ...owner,
    startedAt: new Date().toISOString(),
    trialRoot: canonicalRoot(root),
    trialRootHash: rootHash(root),
    candidateId,
  };
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
  return readJson(path.join(root, HARNESS_OWNER_MARKER));
}

function markerMatchesRoot(root, marker) {
  const identity = readTrialIdentity(root);
  return marker?.schemaVersion === 'nimi.local-agent-harness-owner/v2'
    && marker.trialRoot === canonicalRoot(root)
    && marker.trialRootHash === rootHash(root)
    && marker.candidateId === candidateIdFor(identity);
}

function assessTrialRootStaleness(root, { maxAgeMs, now, marker = readOwnerMarker(root) }) {
  if (marker) {
    if (marker.schemaVersion !== 'nimi.local-agent-harness-owner/v2') {
      if (processAlive(Number(marker.pid))) return { stale: false, warning: null };
      return { stale: rootAgeMs(root, marker, now) > maxAgeMs, warning: null };
    }
    if (!markerMatchesRoot(root, marker)) {
      return {
        stale: false,
        warning: {
          code: 'TRIAL_OWNER_MARKER_IDENTITY_MISMATCH',
          message: 'v2 owner marker does not match the trial root/hash/candidate',
        },
      };
    }
    const pid = Number(marker.pid);
    const observedOwner = captureProcessIdentity(pid);
    if (!observedOwner && processAlive(pid)) {
      return {
        stale: false,
        warning: {
          code: 'TRIAL_OWNER_IDENTITY_QUERY_FAILED',
          message: `owner process ${pid} is alive but its identity could not be queried`,
        },
      };
    }
    if (!sameProcessIdentity(marker, observedOwner)) return { stale: true, warning: null };
  }
  return { stale: rootAgeMs(root, marker, now) > maxAgeMs, warning: null };
}

export function isStaleTrialRoot(root, { maxAgeMs = DEFAULT_STALE_ROOT_MAX_AGE_MS, now = Date.now() } = {}) {
  try {
    return assessTrialRootStaleness(root, { maxAgeMs, now }).stale;
  } catch {
    return false;
  }
}

function readProcessLedger(root) {
  const file = path.join(root, TRIAL_PROCESS_IDENTITY_FILE);
  if (!fs.existsSync(file)) return { exists: false, ledger: null };
  return { exists: true, ledger: readJson(file) };
}

function emptyProcessLedger(root, candidateId) {
  return {
    schemaVersion: 'nimi.local-agent-trial-process-identities/v1',
    trialRoot: canonicalRoot(root),
    trialRootHash: rootHash(root),
    candidateId,
    processes: [],
  };
}

export function registerTrialProcessIdentity(trial, handleOrPid, role) {
  const root = trial?.paths?.root || trial;
  const pid = Number(handleOrPid?.child?.pid || handleOrPid?.pid || handleOrPid);
  const identity = captureProcessIdentity(pid);
  if (!identity) throw new Error(`cannot capture ${role || 'trial'} process identity for pid ${pid}`);
  const trialIdentity = readTrialIdentity(root);
  const candidateId = candidateIdFor(trialIdentity);
  if (!candidateId) throw new Error(`trial root ${root} is missing a candidate identity`);
  const existing = readProcessLedger(root);
  const ledger = existing.exists ? existing.ledger : emptyProcessLedger(root, candidateId);
  if (!ledger
    || ledger.schemaVersion !== 'nimi.local-agent-trial-process-identities/v1'
    || ledger.trialRoot !== canonicalRoot(root)
    || ledger.trialRootHash !== rootHash(root)
    || ledger.candidateId !== candidateId
    || !Array.isArray(ledger.processes)) {
    throw new Error(`trial process ledger identity mismatch for ${root}`);
  }
  const registration = { role: String(role || 'trial-process'), ...identity, registeredAt: new Date().toISOString() };
  const duplicate = ledger.processes.some((entry) => sameProcessIdentity(entry, registration) && entry.role === registration.role);
  if (!duplicate) ledger.processes.push(registration);
  fs.writeFileSync(path.join(root, TRIAL_PROCESS_IDENTITY_FILE), `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  return registration;
}

function killProcessTree(pid) {
  if (pid === process.pid || !processAlive(pid)) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process exited between the exact identity check and termination.
    }
  }
}

export function terminateTrialRootProcesses(root) {
  const killed = [];
  const refused = [];
  const failed = [];
  const trialIdentity = readTrialIdentity(root);
  const candidateId = candidateIdFor(trialIdentity);
  const { exists, ledger } = readProcessLedger(root);
  if (!exists) return { killed, refused, failed };
  if (!ledger
    || ledger.schemaVersion !== 'nimi.local-agent-trial-process-identities/v1'
    || ledger.trialRoot !== canonicalRoot(root)
    || ledger.trialRootHash !== rootHash(root)
    || ledger.candidateId !== candidateId
    || !candidateId
    || !Array.isArray(ledger.processes)) {
    failed.push({ code: 'TRIAL_PROCESS_LEDGER_IDENTITY_MISMATCH', message: 'process ledger does not belong to this trial root/candidate' });
    return { killed, refused, failed };
  }
  for (const expected of ledger.processes) {
    const pid = Number(expected?.pid);
    if (!processAlive(pid)) continue;
    const observed = captureProcessIdentity(pid);
    if (!sameProcessIdentity(expected, observed)) {
      refused.push({ pid, role: expected?.role || 'unknown', code: 'PROCESS_IDENTITY_MISMATCH' });
      continue;
    }
    killProcessTree(pid);
    killed.push(pid);
  }
  return { killed, refused, failed };
}

export function sweepStaleIsolatedTrialRoots({ maxAgeMs = DEFAULT_STALE_ROOT_MAX_AGE_MS, tmpDir = os.tmpdir(), now = Date.now() } = {}) {
  const swept = [];
  const active = [];
  const failed = [];
  let entries = [];
  try {
    entries = fs.readdirSync(tmpDir, { withFileTypes: true });
  } catch (error) {
    failed.push({ root: tmpDir, code: error?.code || 'TRIAL_ROOT_ENUMERATION_FAILED', message: String(error?.message || error) });
    return { swept, active, failed };
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TRIAL_ROOT_PREFIX)) continue;
    const root = path.join(tmpDir, entry.name);
    try {
      const marker = readOwnerMarker(root);
      const assessment = assessTrialRootStaleness(root, { maxAgeMs, now, marker });
      if (assessment.warning) {
        failed.push({ root, ...assessment.warning });
        continue;
      }
      if (!assessment.stale) {
        active.push(root);
        continue;
      }
      const termination = terminateTrialRootProcesses(root);
      if (termination.failed.length > 0 || termination.refused.length > 0) {
        failed.push({
          root,
          code: termination.failed[0]?.code || termination.refused[0]?.code || 'PROCESS_CLEANUP_REFUSED',
          message: termination.failed[0]?.message || `refused to terminate ${termination.refused.length} process identity mismatch(es)`,
        });
        continue;
      }
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
      swept.push(root);
    } catch (error) {
      failed.push({
        root,
        code: error?.code || 'STALE_TRIAL_ROOT_UNDETERMINED',
        message: String(error?.message || error),
      });
    }
  }
  return { swept, active, failed };
}

const RETAINED_DATA_ROOT_KEEP = new Set(['logs', 'audit']);

export function pruneRetainedTrialRootPayload(trial) {
  const dataRoot = trial?.paths?.freshDataRootSelection;
  const pruned = [];
  const failed = [];
  if (!dataRoot || !fs.existsSync(dataRoot)) return { pruned, failed };
  for (const entry of fs.readdirSync(dataRoot, { withFileTypes: true })) {
    if (RETAINED_DATA_ROOT_KEEP.has(entry.name)) continue;
    const target = path.join(dataRoot, entry.name);
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
      pruned.push(entry.name);
    } catch (error) {
      failed.push({ target, code: error?.code || 'UNKNOWN' });
    }
  }
  return { pruned, failed };
}
