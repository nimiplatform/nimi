import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { startProcess, terminateProcessTree } from './cross-app-driver.mjs';
import { P4HarnessError, safeHarnessFailure } from './p4-errors.mjs';

const defaultWorkerPath = path.join(import.meta.dirname, 'run-first-party-product-gate-worker.mjs');

function withTelemetry(code, message, telemetry, cause) {
  const error = new P4HarnessError(code, message, cause ? { cause } : undefined);
  error.telemetry = telemetry;
  return error;
}

function readWorkerResult(resultPath) {
  try {
    return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch (error) {
    throw new P4HarnessError('P4_GATE_RESULT_INVALID', 'P4 worker did not return valid result JSON', { cause: error });
  }
}

export async function executeP4WorkerGate({
  definition,
  repoRoot,
  outputDir,
  prerequisite,
  workerPath = defaultWorkerPath,
  terminate = terminateProcessTree,
}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-p4-worker-'));
  const requestPath = path.join(controlRoot, 'request.json');
  const resultPath = path.join(controlRoot, 'result.json');
  fs.writeFileSync(requestPath, `${JSON.stringify({
    gate: definition.gate,
    repoRoot,
    outputDir,
    prerequisite,
  })}\n`, { encoding: 'utf8', mode: 0o600 });

  const launchedAt = performance.now();
  const handle = startProcess(process.execPath, [workerPath, '--request', requestPath, '--result', resultPath], {
    cwd: repoRoot,
    env: process.env,
    stdoutPath: path.join(outputDir, 'worker.stdout.log'),
    stderrPath: path.join(outputDir, 'worker.stderr.log'),
  });
  let timer = null;
  let childResult = null;
  const telemetry = {
    defaultBudgetMs: definition.defaultBudgetMs,
    effectiveBudgetMs: definition.effectiveBudgetMs,
    budgetSource: definition.budgetSource,
    durationMs: 0,
    harnessFailure: null,
    childExitCode: null,
    childSignal: null,
    deadline: { exceeded: false, failure: null },
    termination: { attempted: false, outcome: 'not_needed', failure: null },
  };

  try {
    const completion = handle.completed.then(
      (value) => ({ kind: 'completed', value }),
      (error) => ({ kind: 'completion_error', error }),
    );
    const remainingMs = Math.max(0, definition.effectiveBudgetMs - (performance.now() - launchedAt));
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'deadline' }), remainingMs);
    });
    const winner = await Promise.race([completion, deadline]);
    const elapsedMs = performance.now() - launchedAt;
    telemetry.durationMs = Math.round(elapsedMs);

    if (winner.kind === 'deadline') {
      const deadlineError = new P4HarnessError(
        'P4_GATE_DEADLINE_EXCEEDED',
        `${definition.label} (${definition.journeyId}) exceeded its effective time budget: ${telemetry.durationMs}ms >= ${definition.effectiveBudgetMs}ms`,
      );
      telemetry.deadline = { exceeded: true, failure: safeHarnessFailure(deadlineError) };
      telemetry.termination.attempted = true;
      try {
        await terminate(handle);
        telemetry.termination.outcome = 'terminated';
      } catch (error) {
        telemetry.termination.outcome = 'failed';
        telemetry.termination.failure = safeHarnessFailure(error, 'P4_GATE_TERMINATION_FAILED');
        telemetry.harnessFailure = telemetry.termination.failure;
        const snapshot = handle.snapshot();
        telemetry.childExitCode = snapshot.code;
        telemetry.childSignal = snapshot.signal;
        throw withTelemetry(
          'P4_GATE_TERMINATION_FAILED',
          `termination failed after ${definition.label} exceeded its deadline: ${telemetry.termination.failure.message}`,
          telemetry,
          error,
        );
      }
      childResult = await completion;
      const snapshot = handle.snapshot();
      telemetry.childExitCode = snapshot.code;
      telemetry.childSignal = snapshot.signal;
      telemetry.durationMs = Math.round(performance.now() - launchedAt);
      telemetry.harnessFailure = safeHarnessFailure(deadlineError);
      throw withTelemetry(deadlineError.code, deadlineError.message, telemetry, deadlineError);
    }

    if (winner.kind === 'completion_error') {
      telemetry.harnessFailure = safeHarnessFailure(winner.error, 'P4_GATE_WORKER_EXIT_FAILED');
      throw withTelemetry(
        telemetry.harnessFailure.code,
        telemetry.harnessFailure.message,
        telemetry,
        winner.error,
      );
    }

    childResult = winner.value;
    telemetry.childExitCode = childResult.code;
    telemetry.childSignal = childResult.signal;
    telemetry.durationMs = Math.round(performance.now() - launchedAt);

    // Keep the post-return comparison: timer dispatch can be delayed while the
    // event loop is busy, but a late successful return still violates budget.
    if (performance.now() - launchedAt > definition.effectiveBudgetMs) {
      const deadlineError = new P4HarnessError(
        'P4_GATE_DEADLINE_EXCEEDED',
        `${definition.label} (${definition.journeyId}) returned after its effective time budget: ${telemetry.durationMs}ms > ${definition.effectiveBudgetMs}ms`,
      );
      telemetry.deadline = { exceeded: true, failure: safeHarnessFailure(deadlineError) };
      telemetry.termination.outcome = 'already_exited';
      telemetry.harnessFailure = safeHarnessFailure(deadlineError);
      throw withTelemetry(deadlineError.code, deadlineError.message, telemetry, deadlineError);
    }

    let result;
    try {
      result = readWorkerResult(resultPath);
    } catch (error) {
      telemetry.harnessFailure = safeHarnessFailure(error, 'P4_GATE_RESULT_INVALID');
      throw withTelemetry(telemetry.harnessFailure.code, telemetry.harnessFailure.message, telemetry, error);
    }
    if (!result?.ok) {
      telemetry.harnessFailure = {
        code: String(result?.error?.code || 'P4_GATE_WORKER_FAILED'),
        name: String(result?.error?.name || 'Error'),
        message: String(result?.error?.message || 'P4 worker returned a structured failure').slice(0, 4_096),
      };
      throw withTelemetry(
        telemetry.harnessFailure.code,
        telemetry.harnessFailure.message,
        telemetry,
      );
    }
    if (childResult.code !== 0 || childResult.signal !== null) {
      const failure = new P4HarnessError(
        'P4_GATE_WORKER_EXIT_FAILED',
        `P4 worker exited unexpectedly: code=${String(childResult.code)} signal=${String(childResult.signal)}`,
      );
      telemetry.harnessFailure = safeHarnessFailure(failure);
      throw withTelemetry(failure.code, failure.message, telemetry, failure);
    }
    return { observations: result.observations, telemetry };
  } finally {
    if (timer !== null) clearTimeout(timer);
    for (const file of [requestPath, resultPath]) {
      try {
        fs.unlinkSync(file);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    fs.rmdirSync(controlRoot);
  }
}
