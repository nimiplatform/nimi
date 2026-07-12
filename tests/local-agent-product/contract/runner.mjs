import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { persistResultEvidence } from '../harness/artifact-writer.mjs';
import { scanText } from '../harness/privacy-scan.mjs';
import { readLocalAgentTestArchitecture } from '../harness/registry.mjs';
import { assertSourceState, captureSourceState } from '../harness/source-state.mjs';
import { createIsolatedSuiteRoot, removeIsolatedTrialRoot } from '../harness/trial-root.mjs';
import { validateArchitecture, validateSuiteResult } from '../harness/validation.mjs';
import { resolvePortableProcessInvocation } from '../harness/process-command.mjs';
import { contractPlanByLeaf, exhaustiveRepeatByLeaf } from './plan.mjs';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stepKey(step) {
  return digest(JSON.stringify([step.owner, step.command, step.args, step.cwd]));
}

function runProcess(step) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const invocation = resolvePortableProcessInvocation(step.command, step.args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: step.cwd,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({
      code,
      signal,
      stdout,
      stderr,
      durationMs: Math.round(performance.now() - started),
    }));
  });
}

async function runWithConcurrency(values, concurrency, worker) {
  let cursor = 0;
  const results = new Array(values.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }));
  return results;
}

export async function runContractSuite({ outputDir, mode = 'contract' }) {
  if (!['contract', 'exhaustive'].includes(mode)) throw new Error(`unsupported contract suite mode ${mode}`);
  const exhaustive = mode === 'exhaustive';
  const suiteId = exhaustive ? 'deterministic-exhaustive' : 'contract-smoke';
  const layers = exhaustive ? ['L0', 'L1', 'L4'] : ['L0', 'L1'];
  const architecture = readLocalAgentTestArchitecture();
  const architectureFailures = validateArchitecture(architecture);
  if (architectureFailures.length > 0) throw new Error(`invalid LocalAgent test architecture: ${architectureFailures.join('; ')}`);
  const points = architecture.points.points.filter((point) => ['L0', 'L1'].includes(point.minimum_sufficient_layer));
  const missingPlans = points.filter((point) => !contractPlanByLeaf.has(point.point_id)).map((point) => point.point_id);
  const orphanPlans = [...contractPlanByLeaf.keys()].filter((leafId) => !points.some((point) => point.point_id === leafId));
  if (missingPlans.length > 0 || orphanPlans.length > 0) throw new Error(`contract plan mismatch missing=${missingPlans.join(',')} orphan=${orphanPlans.join(',')}`);
  const orphanExhaustiveRepeats = [...exhaustiveRepeatByLeaf.keys()].filter((leafId) => !points.some((point) => point.point_id === leafId));
  if (orphanExhaustiveRepeats.length > 0) throw new Error(`exhaustive repeat plan has orphan leaves ${orphanExhaustiveRepeats.join(',')}`);
  const exhaustiveLogicalLeafTrialCount = points.reduce((count, point) => count + (exhaustiveRepeatByLeaf.get(point.point_id) || 1), 0);
  const logicalLeafTrialCount = exhaustive ? exhaustiveLogicalLeafTrialCount : points.length;
  if (exhaustive && (exhaustiveRepeatByLeaf.size !== 32 || exhaustiveLogicalLeafTrialCount !== 3239)) {
    throw new Error(`exhaustive logical coverage must preserve 32x100 + 39x1 = 3239, got repeated=${exhaustiveRepeatByLeaf.size} logical=${logicalLeafTrialCount}`);
  }

  const trial = createIsolatedSuiteRoot({ suiteId, layers });
  const sourceState = captureSourceState(path.resolve(import.meta.dirname, '..', '..', '..'));
  const stepByKey = new Map();
  const repeatCountByKey = new Map();
  const keysByLeaf = new Map();
  for (const point of points) {
    const keys = [];
    const leafRepeatCount = exhaustive ? (exhaustiveRepeatByLeaf.get(point.point_id) || 1) : 1;
    for (const step of contractPlanByLeaf.get(point.point_id)) {
      const key = stepKey(step);
      keys.push(key);
      if (!stepByKey.has(key)) stepByKey.set(key, step);
      repeatCountByKey.set(key, Math.max(repeatCountByKey.get(key) || 0, leafRepeatCount));
    }
    keysByLeaf.set(point.point_id, keys);
  }

  const startedAt = new Date();
  const started = performance.now();
  try {
    const entries = [...stepByKey.entries()];
    const executed = await runWithConcurrency(entries, 4, async ([key, step], index) => {
      const requiredRepeatCount = repeatCountByKey.get(key) || 1;
      const repetitions = [];
      const outputParts = [];
      for (let repeatIndex = 1; repeatIndex <= requiredRepeatCount; repeatIndex += 1) {
        const result = await runProcess(step);
        const output = `${result.stdout}\n${result.stderr}`;
        const markerObserved = !step.expectedMarker || output.includes(step.expectedMarker);
        const privacyFindings = scanText(output, `${mode}:${key}:repeat-${repeatIndex}`);
        outputParts.push(`=== repeat ${repeatIndex}/${requiredRepeatCount} ===\n${output}`);
        repetitions.push({
          repeatIndex,
          exitCode: result.code,
          signal: result.signal,
          durationMs: result.durationMs,
          markerObserved,
          privacyFindings,
          outputSha256: digest(output),
          passed: result.code === 0 && !result.signal && markerObserved && privacyFindings.length === 0,
        });
      }
      const output = outputParts.join('\n');
      const markerObserved = repetitions.every((row) => row.markerObserved);
      const privacyFindings = repetitions.flatMap((row) => row.privacyFindings);
      const passed = repetitions.length === requiredRepeatCount && repetitions.every((row) => row.passed);
      const logPath = path.join(trial.paths.artifacts, `${String(index + 1).padStart(3, '0')}-${step.owner}-${key.slice(0, 12)}.log`);
      fs.writeFileSync(logPath, output);
      return {
        key,
        owner: step.owner,
        commandDigest: key,
        outputSha256: digest(output),
        requiredRepeatCount,
        observedRepeatCount: repetitions.length,
        repetitions,
        exitCode: repetitions.find((row) => !row.passed)?.exitCode ?? 0,
        signal: repetitions.find((row) => !row.passed)?.signal ?? null,
        markerObserved,
        privacyFindings,
        passed,
        logPath,
        artifactId: `contract-step-${key.slice(0, 16)}`,
      };
    });
    const executionByKey = new Map(executed.map((row) => [row.key, row]));
    const proofPath = path.join(trial.paths.artifacts, 'contract-executions.json');
    fs.writeFileSync(proofPath, `${JSON.stringify({
      schemaVersion: 'nimi.local-agent-product-contract-executions/v2',
      suiteTrialId: trial.identity.suiteTrialId,
      suiteId,
      executionMode: mode,
      logicalLeafTrialCount,
      uniqueCommandCount: executed.length,
      groupedProcessCount: executed.reduce((count, row) => count + row.observedRepeatCount, 0),
      executions: executed.map(({ logPath: _logPath, ...row }) => row),
    }, null, 2)}\n`);
    const checkpoints = points.map((point) => {
      const executions = keysByLeaf.get(point.point_id).map((key) => executionByKey.get(key));
      const requiredRepeatCount = exhaustive ? (exhaustiveRepeatByLeaf.get(point.point_id) || 1) : 1;
      const passed = executions.every((row) => row.passed && row.observedRepeatCount >= requiredRepeatCount);
      return {
        checkpointId: point.execution_binding.checkpoint_ids[0],
        leafIds: [point.point_id],
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        correlations: {
          commandDigests: executions.map((row) => row.commandDigest),
          outputDigests: executions.map((row) => row.outputSha256),
          owners: [...new Set(executions.map((row) => row.owner))],
          requiredRepeatCount,
          observedRepeatCounts: executions.map((row) => row.observedRepeatCount),
        },
        assertions: point.assertion_ids.map((assertionId) => ({ assertionId, outcome: passed ? 'passed' : 'failed' })),
        artifactRefs: ['contract-executions', ...executions.map((row) => row.artifactId)],
        outcome: passed ? 'passed' : 'failed',
      };
    });
    const checkpointByLeaf = new Map(checkpoints.map((checkpoint) => [checkpoint.leafIds[0], checkpoint]));
    const leafResults = points.map((point) => {
      const checkpoint = checkpointByLeaf.get(point.point_id);
      return {
        leafId: point.point_id,
        suiteTrialId: trial.identity.suiteTrialId,
        checkpointIds: [checkpoint.checkpointId],
        assertionIds: point.assertion_ids,
        evidenceRefs: checkpoint.artifactRefs,
        outcome: checkpoint.outcome,
        failureClass: checkpoint.outcome === 'passed' ? null : 'contract_process_failure',
      };
    });
    const processProblems = executed.filter((row) => !row.passed).map((row) => ({
      commandDigest: row.commandDigest,
      owner: row.owner,
      exitCode: row.exitCode,
      signal: row.signal,
      markerObserved: row.markerObserved,
      privacyFindings: row.privacyFindings,
    }));
    const result = {
      schemaVersion: 'nimi.local-agent-product-suite-result/v2',
      suiteTrialId: trial.identity.suiteTrialId,
      suiteId,
      layers,
      sourceState,
      durationMs: Math.round(performance.now() - started),
      checkpoints,
      leafResults,
      artifacts: [],
      processProblems,
      privacy: { ok: true, findings: [] },
      outcome: processProblems.length === 0 ? 'passed' : 'failed',
      executionPolicy: {
        mode,
        logicalLeafTrialCount,
        groupedProcessCount: executed.reduce((count, row) => count + row.observedRepeatCount, 0),
        fullEnvironmentPerLeaf: false,
      },
    };
    assertSourceState(sourceState, path.resolve(import.meta.dirname, '..', '..', '..'));
    const artifactInputs = [
      { artifactId: 'contract-executions', file: proofPath },
      ...executed.map((row) => ({ artifactId: row.artifactId, file: row.logPath })),
    ];
    const persisted = persistResultEvidence({ outputDir, result, artifactInputs });
    if (persisted.result.outcome === 'passed') {
      const validationFailures = validateSuiteResult({ architecture, result: persisted.result, expectedSourceState: sourceState });
      if (validationFailures.length > 0) throw new Error(`contract result validation failed: ${validationFailures.join('; ')}`);
    }
    return persisted;
  } finally {
    removeIsolatedTrialRoot(trial);
  }
}
