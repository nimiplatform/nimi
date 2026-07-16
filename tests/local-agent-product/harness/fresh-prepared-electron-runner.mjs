import fs from 'node:fs';
import path from 'node:path';

import { startProcess, terminateProcessTree } from './cross-app-driver.mjs';
import { findBlockingElectronCarriers } from '../../../scripts/lib/electron-carrier-processes.mjs';

export { findBlockingElectronCarriers };

const TERMINAL_SCHEMA = 'nimi.dev-kernel-fresh-prepared-terminal/v1';

export function createTerminalEvidenceWriter({
  evidenceRoot,
  target,
  sourceDigest,
  preparationId = null,
  startedAt = new Date().toISOString(),
}) {
  const root = path.resolve(evidenceRoot);
  const targetId = String(target || '').replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '').toLowerCase();
  if (!targetId || !/^[a-f0-9]{64}$/u.test(String(sourceDigest || ''))) {
    throw new Error('fresh-prepared terminal evidence identity is invalid');
  }
  fs.mkdirSync(root, { recursive: true });
  const evidencePath = path.join(root, 'sanitized-terminal-evidence.json');
  let record = {
    schemaVersion: TERMINAL_SCHEMA,
    acceptanceEligible: false,
    terminal: false,
    target: targetId,
    parentProcessId: process.pid,
    sourceDigest,
    preparationId,
    startedAt,
    updatedAt: startedAt,
    phase: 'preflight',
    outcome: 'running',
    child: null,
    exit: null,
  };
  const write = (updates) => {
    record = sanitizeTerminalValue({
      ...record,
      ...updates,
      updatedAt: new Date().toISOString(),
    });
    const temporary = `${evidencePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, evidencePath);
    return record;
  };
  write({});
  return {
    evidencePath,
    snapshot: () => record,
    phase(phase, updates = {}) {
      return write({ phase, ...updates });
    },
    terminal(outcome, updates = {}) {
      return write({ terminal: true, outcome, completedAt: new Date().toISOString(), ...updates });
    },
  };
}

export function recoverAbandonedTerminalEvidence(evidenceBaseRoot, {
  isProcessAlive = defaultProcessAlive,
  recoveredAt = new Date().toISOString(),
} = {}) {
  const base = path.resolve(evidenceBaseRoot);
  if (!fs.existsSync(base)) return [];
  const recovered = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const evidencePath = path.join(base, entry.name, 'sanitized-terminal-evidence.json');
    let record;
    try {
      record = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    } catch {
      continue;
    }
    if (record?.schemaVersion !== TERMINAL_SCHEMA || record?.terminal === true) continue;
    const parentPid = Number(record?.parentProcessId || 0);
    const childPid = Number(record?.child?.pid || 0);
    if ((parentPid > 0 && isProcessAlive(parentPid)) || (childPid > 0 && isProcessAlive(childPid))) continue;
    const next = sanitizeTerminalValue({
      ...record,
      acceptanceEligible: false,
      terminal: true,
      outcome: 'abandoned-parent',
      updatedAt: recoveredAt,
      completedAt: recoveredAt,
      child: null,
      exit: { code: null, signal: null },
      failure: {
        code: 'fresh-prepared-parent-disappeared',
        message: 'The fresh-prepared parent and owned child were no longer running when terminal evidence was reconciled.',
      },
    });
    const temporary = `${evidencePath}.${process.pid}.recovery.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, evidencePath);
    recovered.push(evidencePath);
  }
  return recovered;
}

export function createParentSignalLatch(signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  let received = null;
  const waiters = new Set();
  const handlers = new Map();
  for (const signal of signals) {
    const handler = () => {
      if (received) return;
      received = signal;
      for (const resolve of waiters) resolve(signal);
      waiters.clear();
    };
    try {
      process.on(signal, handler);
      handlers.set(signal, handler);
    } catch {
      // The host platform does not expose this signal.
    }
  }
  return {
    current: () => received,
    wait() {
      if (received) return Promise.resolve(received);
      return new Promise((resolve) => waiters.add(resolve));
    },
    dispose() {
      for (const [signal, handler] of handlers) process.off(signal, handler);
      handlers.clear();
      waiters.clear();
    },
  };
}

export async function runBoundedOwnedProcess(command, args, {
  cwd,
  env,
  timeoutMs,
  signalLatch = null,
  onStarted = undefined,
  captureOutput = false,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('bounded owned process timeout must be a positive safe integer');
  }
  const handle = startProcess(command, args, {
    cwd,
    env,
    windowsHide: true,
    maxCapturedBytes: captureOutput ? 1024 * 1024 : 1,
  });
  try {
    onStarted?.(handle.child.pid);
  } catch (error) {
    await terminateProcessTree(handle);
    const result = await handle.completed.catch(() => null);
    return { kind: 'owner-callback-error', error, result };
  }
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
  });
  const signal = signalLatch
    ? signalLatch.wait().then((value) => ({ kind: 'parent-signal', signal: value }))
    : new Promise(() => undefined);
  const completed = handle.completed.then(
    (result) => ({ kind: 'completed', result }),
    (error) => ({ kind: 'spawn-error', error }),
  );
  const winner = await Promise.race([completed, timeout, signal]);
  clearTimeout(timer);
  if (winner.kind === 'completed') return winner;
  await terminateProcessTree(handle);
  const result = await handle.completed.catch(() => null);
  return { ...winner, result };
}

export function projectOwnedProcessOutcome(outcome) {
  const exit = {
    code: Number.isInteger(outcome?.result?.code) ? outcome.result.code : null,
    signal: typeof outcome?.result?.signal === 'string' ? outcome.result.signal : null,
  };
  if (outcome?.kind === 'timeout') return { outcome: 'timed-out', exit };
  if (outcome?.kind === 'parent-signal') {
    return { outcome: 'parent-signal', exit: { ...exit, signal: outcome.signal || exit.signal } };
  }
  if (outcome?.kind === 'spawn-error') return { outcome: 'spawn-failed', exit };
  if (outcome?.kind === 'owner-callback-error') return { outcome: 'runner-failed', exit };
  if (exit.signal) return { outcome: 'child-signal', exit };
  return { outcome: exit.code === 0 ? 'completed' : 'failed', exit };
}

export function writeOwnedProcessTerminal(terminal, processOutcome, { outcomeOverride, ...updates } = {}) {
  if (!terminal || typeof terminal.terminal !== 'function') {
    throw new Error('fresh-prepared terminal writer is required');
  }
  const projection = projectOwnedProcessOutcome(processOutcome);
  return terminal.terminal(outcomeOverride || projection.outcome, {
    exit: projection.exit,
    ...updates,
  });
}

function defaultProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sanitizeTerminalValue(value, key = '') {
  if (/(?:password|token|cookie|credential|authorization|headers?|body|query)/iu.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    return value
      .replace(/(?:bearer\s+[a-z0-9._~+/=-]+|(?:access|refresh|id)[_-]?token\s*[:=]|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.)/giu, '[REDACTED]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[REDACTED]')
      .replace(/[A-Z]:\\Users\\[^\\\s]+/giu, '[LOCAL_USER_PATH]')
      .slice(0, 2_000);
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitizeTerminalValue(entry));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).slice(0, 100)
    .map(([entryKey, entryValue]) => [entryKey, sanitizeTerminalValue(entryValue, entryKey)]));
}

export { TERMINAL_SCHEMA };
