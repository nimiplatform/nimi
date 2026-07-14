import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const activeProcessHandles = new Set();
const DEFAULT_PROCESS_CAPTURE_LIMIT_BYTES = 1024 * 1024;

function createProcessCapture(file, maximumBytes) {
  const resolvedPath = file ? path.resolve(file) : '';
  let descriptor = null;
  let tail = Buffer.alloc(0);
  let truncated = false;
  let writeError = null;
  if (resolvedPath) {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    descriptor = fs.openSync(resolvedPath, 'w', 0o600);
  }
  return {
    append(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (descriptor !== null && writeError === null) {
        try {
          fs.writeSync(descriptor, buffer);
        } catch (error) {
          writeError = error;
        }
      }
      const combined = Buffer.concat([tail, buffer]);
      if (combined.length > maximumBytes) {
        truncated = true;
        tail = combined.subarray(combined.length - maximumBytes);
      } else {
        tail = combined;
      }
    },
    close() {
      if (descriptor === null) return;
      try {
        fs.closeSync(descriptor);
      } finally {
        descriptor = null;
      }
    },
    snapshot() {
      return {
        text: tail.toString('utf8'),
        truncated,
        path: resolvedPath,
        writeError,
      };
    },
  };
}

function killProcessTreeSync(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // The process exited between the liveness check and the kill.
    }
  }
}

// Last-resort teardown so product subprocess trees (desktop/zhiyu, and the runtime
// daemon inside them) do not outlive a crashed or interrupted harness process.
process.on('exit', () => {
  for (const handle of activeProcessHandles) killProcessTreeSync(handle.child);
});

export function startProcess(command, args, options = {}) {
  const {
    stdoutPath = '',
    stderrPath = '',
    maxCapturedBytes = DEFAULT_PROCESS_CAPTURE_LIMIT_BYTES,
    ...spawnOptions
  } = options;
  if (!Number.isSafeInteger(maxCapturedBytes) || maxCapturedBytes < 1) {
    throw new TypeError('maxCapturedBytes must be a positive safe integer');
  }
  const stdoutCapture = createProcessCapture(stdoutPath, maxCapturedBytes);
  const stderrCapture = createProcessCapture(stderrPath, maxCapturedBytes);
  let child;
  try {
    child = spawn(command, args, {
      ...spawnOptions,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    stdoutCapture.close();
    stderrCapture.close();
    throw error;
  }
  const snapshot = () => {
    const stdout = stdoutCapture.snapshot();
    const stderr = stderrCapture.snapshot();
    return {
      code: child.exitCode,
      signal: child.signalCode,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutPath: stdout.path,
      stderrPath: stderr.path,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
    };
  };
  let settled = false;
  const finish = () => {
    stdoutCapture.close();
    stderrCapture.close();
  };
  const completed = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => stdoutCapture.append(chunk));
    child.stderr.on('data', (chunk) => stderrCapture.append(chunk));
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      finish();
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      finish();
      const stdout = stdoutCapture.snapshot();
      const stderr = stderrCapture.snapshot();
      const captureError = stdout.writeError || stderr.writeError;
      if (captureError) {
        reject(new Error(`failed to persist process output: ${captureError.message}`, { cause: captureError }));
        return;
      }
      resolve({
        code,
        signal,
        stdout: stdout.text,
        stderr: stderr.text,
        stdoutPath: stdout.path,
        stderrPath: stderr.path,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      });
    });
  });
  const handle = { child, completed, snapshot };
  activeProcessHandles.add(handle);
  completed.then(() => activeProcessHandles.delete(handle), () => activeProcessHandles.delete(handle));
  return handle;
}

export async function terminateProcessTree(handle) {
  if (!handle?.child?.pid) return;
  const { child, completed } = handle;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    await completed.catch(() => undefined);
    return;
  }
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error?.code !== 'ESRCH') child.kill(signal);
    }
  };
  signalGroup('SIGTERM');
  const exited = await Promise.race([
    completed.then(() => true, () => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!exited) {
    signalGroup('SIGKILL');
    await completed.catch(() => undefined);
  }
}

export async function terminateProcessTreeAfterGrace(handle, graceMs = 10_000) {
  if (!handle?.child?.pid) return;
  const exited = await Promise.race([
    handle.completed.then(() => true, () => true),
    new Promise((resolve) => setTimeout(() => resolve(false), graceMs)),
  ]);
  if (!exited) await terminateProcessTree(handle);
}

export async function waitForJsonFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastParseError = null;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (error) {
        if (!(error instanceof SyntaxError) && error?.code !== 'ENOENT') throw error;
        lastParseError = error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for complete JSON at ${file}`, { cause: lastParseError });
}

export function allFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) files.push(path.join(entry.parentPath, entry.name));
  }
  return files.sort();
}

export function artifactIdFor(prefix, root, file, index) {
  const relative = path.relative(root, file).replace(/[^a-zA-Z0-9]+/gu, '-').replace(/^-|-$/gu, '').toLowerCase();
  return `${prefix}-${String(index + 1).padStart(2, '0')}-${relative || 'artifact'}`;
}

export function pointRowsForJourney(architecture, journeyId) {
  return architecture.points.points.filter((point) => point.execution_binding?.journey_id === journeyId);
}

export function buildCheckpointResults({ journey, points, facts, correlations, artifactRefs, startedAt, completedAt }) {
  const assertionsByCheckpoint = new Map(journey.checkpoints.map((checkpoint) => [checkpoint.checkpoint_id, []]));
  for (const point of points) {
    const checkpointId = point.execution_binding.checkpoint_ids[0];
    assertionsByCheckpoint.get(checkpointId).push(...point.assertion_ids);
  }
  const checkpointById = new Map();
  const checkpoints = journey.checkpoints.map((checkpoint) => {
    const failedPrerequisite = checkpoint.prerequisite_ids.some((id) => checkpointById.get(id)?.outcome !== 'passed');
    const fact = facts.get(checkpoint.checkpoint_id);
    const outcome = failedPrerequisite
      ? 'blocked_by_failed_prerequisite'
      : fact?.passed === true ? 'passed' : 'failed';
    const assertionIds = assertionsByCheckpoint.get(checkpoint.checkpoint_id);
    const assertions = (assertionIds.length > 0 ? assertionIds : [`${checkpoint.checkpoint_id}:product_fact`])
      .map((assertionId) => ({ assertionId, outcome }));
    const result = {
      checkpointId: checkpoint.checkpoint_id,
      prerequisiteIds: checkpoint.prerequisite_ids,
      startedAt,
      completedAt,
      correlations: { ...correlations, ...(fact?.correlations || {}) },
      assertions,
      artifactRefs,
      outcome,
    };
    checkpointById.set(checkpoint.checkpoint_id, result);
    return result;
  });
  return { checkpoints, checkpointById };
}

export function buildLeafResults({ points, checkpointById, journeyTrialId, artifactRefs }) {
  return points.map((point) => {
    const outcomes = point.execution_binding.checkpoint_ids.map((id) => checkpointById.get(id)?.outcome || 'failed');
    const outcome = outcomes.includes('failed')
      ? 'failed'
      : outcomes.includes('blocked_by_failed_prerequisite') ? 'blocked_by_failed_prerequisite' : 'passed';
    return {
      leafId: point.point_id,
      journeyTrialId,
      checkpointIds: point.execution_binding.checkpoint_ids,
      assertionIds: point.assertion_ids,
      evidenceRefs: artifactRefs,
      outcome,
      failureClass: outcome === 'passed' ? null : outcome === 'failed' ? 'product_checkpoint_failure' : 'blocked_by_failed_prerequisite',
    };
  });
}
