import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { persistResultEvidence } from './artifact-writer.mjs';
import {
  buildCheckpointResults,
  buildLeafResults,
  pointRowsForJourney,
} from './cross-app-driver.mjs';
import { extendedCommandPlans, validateExtendedCommandPlan } from './extended-plan.mjs';
import { repoRoot } from './registry.mjs';
import { resolvePortableProcessInvocation } from './process-command.mjs';
import { assertSourceState } from './source-state.mjs';
import { validateJourneyResult } from './validation.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const invocation = resolvePortableProcessInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({
      pid: child.pid,
      code,
      signal,
      stdout,
      stderr,
      durationMs: Math.round(performance.now() - started),
    }));
  });
}

function emptyProcessStarts() {
  return { provider: 0, realm: 0, runtime: 0, desktop: 0, zhiyu: 0 };
}

export async function runCommandExtendedJourneyTrial({ architecture, journey, trial, sourceState, outputDir }) {
  const plan = extendedCommandPlans[journey.journey_id];
  const planFailures = validateExtendedCommandPlan(journey, plan);
  if (planFailures.length > 0) throw new Error(`invalid ${journey.journey_id} command plan: ${planFailures.join('; ')}`);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const checkpointFacts = new Map();
  const executions = [];
  const artifactInputs = [];
  const artifactRefs = [];
  const processStarts = emptyProcessStarts();

  for (const step of plan.steps) {
    if (step.kind || typeof step.command !== 'string' || !Array.isArray(step.args)) {
      throw new Error(`${journey.journey_id} contains a non-command product step that is historical-only`);
    }
    const result = await runProcess(step.command, step.args, { cwd: step.cwd, env: step.env });
    if (!Object.hasOwn(processStarts, step.owner)) {
      throw new Error(`${journey.journey_id} command step ${step.stepId} has unsupported owner ${step.owner}`);
    }
    processStarts[step.owner] += 1;
    const combined = `${result.stdout}\n${result.stderr}`;
    const logPath = path.join(trial.paths.artifacts, `${step.stepId}.log`);
    fs.writeFileSync(logPath, combined);
    const artifactId = `step-${step.stepId}-log`;
    artifactInputs.push({ artifactId, file: logPath });
    artifactRefs.push(artifactId);
    const markerEvidence = {};
    for (const [checkpointId, markers] of Object.entries(step.checkpointMarkers)) {
      const observed = markers.filter((marker) => combined.includes(marker));
      markerEvidence[checkpointId] = { required: markers, observed };
      checkpointFacts.set(checkpointId, {
        passed: result.code === 0 && !result.signal && observed.length === markers.length,
        correlations: { stepId: step.stepId, owner: step.owner, processId: result.pid },
      });
    }
    executions.push({
      stepId: step.stepId,
      owner: step.owner,
      processId: result.pid,
      command: path.basename(step.command),
      argumentDigest: sha256(JSON.stringify(step.args)),
      durationMs: result.durationMs,
      exitCode: result.code,
      signal: result.signal,
      outputSha256: sha256(combined),
      checkpoints: markerEvidence,
    });
    if (result.code !== 0 || result.signal) {
      throw new Error(`${journey.journey_id} step ${step.stepId} failed (${result.code ?? result.signal}): ${result.stderr || result.stdout}`);
    }
  }

  if (JSON.stringify(processStarts) !== JSON.stringify(plan.processStarts)) {
    throw new Error(`${journey.journey_id} observed command starts drift from the command plan`);
  }
  const completedAt = new Date().toISOString();
  const proofPath = path.join(trial.paths.artifacts, 'extended-checkpoint-proof.json');
  fs.writeFileSync(proofPath, `${JSON.stringify({
    schemaVersion: 'nimi.local-agent-product-extended-proof/v3-observed-processes',
    journeyTrialId: trial.identity.journeyTrialId,
    journeyId: journey.journey_id,
    processStarts,
    executions,
  }, null, 2)}\n`);
  artifactInputs.push({ artifactId: 'extended-checkpoint-proof', file: proofPath });
  artifactRefs.push('extended-checkpoint-proof');
  const environmentPath = path.join(trial.paths.artifacts, 'environment.json');
  fs.writeFileSync(environmentPath, `${JSON.stringify({
    schemaVersion: 'nimi.local-agent-product-environment/v3-observed-processes',
    journeyTrialId: trial.identity.journeyTrialId,
    rootId: sha256(trial.paths.root),
    sourceState,
    processStarts,
    observedCommandProcesses: executions.map((execution) => ({
      stepId: execution.stepId,
      owner: execution.owner,
      processId: execution.processId,
    })),
    acceptanceLeafCount: pointRowsForJourney(architecture, journey.journey_id).length,
  }, null, 2)}\n`);
  artifactInputs.push({ artifactId: 'journey-environment', file: environmentPath });
  artifactRefs.push('journey-environment');

  const points = pointRowsForJourney(architecture, journey.journey_id);
  const { checkpoints, checkpointById } = buildCheckpointResults({
    journey,
    points,
    facts: checkpointFacts,
    correlations: { journeyTrialId: trial.identity.journeyTrialId },
    artifactRefs,
    startedAt,
    completedAt,
  });
  const leafResults = buildLeafResults({
    points,
    checkpointById,
    journeyTrialId: trial.identity.journeyTrialId,
    artifactRefs,
  });
  const outcome = checkpoints.every((checkpoint) => checkpoint.outcome === 'passed')
    && leafResults.every((leaf) => leaf.outcome === 'passed') ? 'passed' : 'failed';
  const result = {
    schemaVersion: 'nimi.local-agent-product-journey-result/v2',
    journeyTrialId: trial.identity.journeyTrialId,
    journeyId: journey.journey_id,
    tier: journey.applicable_layer,
    batch: trial.identity.batch,
    repeatIndex: trial.identity.repeatIndex,
    sourceState,
    environmentIdentity: { rootId: sha256(trial.paths.root), processStarts },
    durationMs: Math.round(performance.now() - started),
    checkpoints,
    leafResults,
    artifacts: [],
    processProblems: [],
    privacy: { ok: true, findings: [] },
    outcome,
  };
  assertSourceState(sourceState, repoRoot);
  const persisted = persistResultEvidence({ outputDir, result, artifactInputs });
  const failures = validateJourneyResult({ architecture, journey, result: persisted.result, expectedSourceState: sourceState });
  if (failures.length > 0) throw new Error(`${journey.journey_id} result validation failed: ${failures.join('; ')}`);
  if (persisted.result.outcome !== 'passed') {
    const failed = persisted.result.checkpoints
      .filter((checkpoint) => checkpoint.outcome !== 'passed')
      .map((checkpoint) => checkpoint.checkpointId);
    throw new Error(`${journey.journey_id} checkpoints failed: ${failed.join(', ')}`);
  }
  return persisted;
}
