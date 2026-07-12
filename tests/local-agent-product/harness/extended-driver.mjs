import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { persistResultEvidence } from './artifact-writer.mjs';
import {
  buildCheckpointResults,
  buildLeafResults,
  pointRowsForJourney,
} from './cross-app-driver.mjs';
import { extendedCommandPlans, validateExtendedCommandPlan } from './extended-plan.mjs';
import { repoRoot } from './registry.mjs';
import { assertSourceState } from './source-state.mjs';
import { validateJourneyResult } from './validation.mjs';
import { journeyIdentityEnv } from './trial-root.mjs';
import { resolvePortableProcessInvocation } from './process-command.mjs';

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
      code,
      signal,
      stdout,
      stderr,
      durationMs: Math.round(performance.now() - started),
    }));
  });
}

function filesUnder(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push(file);
    }
  };
  visit(root);
  return files.sort();
}

function artifactIdForProduct(journeyId, root, file) {
  const relative = path.relative(root, file)
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .toLowerCase();
  return `${journeyId}-${relative || 'artifact'}`;
}

function productArtifactFiles(journeyId, root, summaryPath) {
  return filesUnder(root).filter((file) => {
    if (path.resolve(file) === path.resolve(summaryPath)) return false;
    const extension = path.extname(file).toLowerCase();
    const basename = path.basename(file);
    if (journeyId === 'turn-media-recovery') return extension === '.png' || extension === '.json';
    if (journeyId === 'pre-materialization-offline') {
      return basename === 'acceptance-result.json'
        || /^realm-offline-before-materialize\.(?:json|png)$/u.test(basename)
        || /^runtime-offline-before-materialize\.(?:json|png)$/u.test(basename);
    }
    if (journeyId === 'native-macos-input') {
      const relative = path.relative(root, file);
      if (relative.startsWith(`desktop${path.sep}`)) {
        return extension === '.png' || basename === 'acceptance-result.json';
      }
      return extension === '.png' || extension === '.json';
    }
    return false;
  });
}

function recoveryProductSpec(trial) {
  const artifactsRoot = path.join(trial.paths.artifacts, 'zhiyu-recovery');
  return {
    artifactsRoot,
    summaryPath: path.join(trial.paths.control, 'zhiyu-recovery-summary.json'),
    command: process.execPath,
    args: [
      '--import', 'tsx', '--test',
      path.join(repoRoot, 'apps/zhiyu/test/e2e/electron-local-agent-recovery-journey.test.mjs'),
    ],
    cwd: repoRoot,
    env: {
      ...journeyIdentityEnv(trial),
      NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_ID: trial.identity.journeyId,
      NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ID: trial.identity.journeyTrialId,
      NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_ARTIFACTS_ROOT: artifactsRoot,
      NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_SUMMARY_PATH: path.join(trial.paths.control, 'zhiyu-recovery-summary.json'),
      NIMI_LOCAL_AGENT_PRODUCT_RUNTIME_DATA_ROOT: trial.paths.runtimeData,
      NIMI_LOCAL_AGENT_PRODUCT_STANDARD_DATA_ROOT: trial.paths.standardShellData,
      NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT: trial.paths.zhiyuUserData,
    },
    schemaVersion: 'nimi.local-agent-product-zhiyu-recovery-summary/v2',
  };
}

function desktopOfflineProductSpec(trial) {
  const artifactsRoot = path.join(trial.paths.artifacts, 'desktop-offline');
  return {
    artifactsRoot,
    summaryPath: path.join(artifactsRoot, 'acceptance-result.json'),
    command: process.execPath,
    args: [path.join(repoRoot, 'apps/desktop/scripts/run-electron-explore-materialization-acceptance.mjs')],
    cwd: repoRoot,
    env: {
      ...journeyIdentityEnv(trial),
      NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_ID: trial.identity.journeyId,
      NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ID: trial.identity.journeyTrialId,
      NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_ARTIFACTS_ROOT: artifactsRoot,
      NIMI_LOCAL_AGENT_PRODUCT_RUNTIME_DATA_ROOT: trial.paths.runtimeData,
      NIMI_LOCAL_AGENT_PRODUCT_STANDARD_DATA_ROOT: trial.paths.standardShellData,
      NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_USER_DATA_ROOT: trial.paths.desktopUserData,
    },
    schemaVersion: 'nimi.local-agent-product-desktop-offline-summary/v2',
  };
}

function nativeMacosProductSpec(trial) {
  const artifactsRoot = path.join(trial.paths.artifacts, 'native-cross-app');
  const summaryPath = path.join(trial.paths.control, 'zhiyu-native-macos-summary.json');
  return {
    artifactsRoot,
    summaryPath,
    command: process.execPath,
    args: [path.join(repoRoot, 'tests/local-agent-product/harness/native-macos-product.mjs')],
    cwd: repoRoot,
    env: {
      ...journeyIdentityEnv(trial),
      NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_ID: trial.identity.journeyId,
      NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ID: trial.identity.journeyTrialId,
      NIMI_LOCAL_AGENT_PRODUCT_NATIVE_ARTIFACTS_ROOT: artifactsRoot,
      NIMI_LOCAL_AGENT_PRODUCT_HANDOFF_PATH: path.join(trial.paths.control, 'desktop-handoff.json'),
      NIMI_LOCAL_AGENT_PRODUCT_RELEASE_PATH: path.join(trial.paths.control, 'release-desktop'),
      NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_SUMMARY_PATH: summaryPath,
      NIMI_LOCAL_AGENT_PRODUCT_CONTROL_ROOT: trial.paths.control,
      NIMI_LOCAL_AGENT_PRODUCT_RUNTIME_DATA_ROOT: trial.paths.runtimeData,
      NIMI_LOCAL_AGENT_PRODUCT_STANDARD_DATA_ROOT: trial.paths.standardShellData,
      NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_USER_DATA_ROOT: trial.paths.desktopUserData,
      NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT: trial.paths.zhiyuUserData,
    },
    schemaVersion: 'nimi.local-agent-product-zhiyu-native-macos-summary/v2',
  };
}

function productSpecForJourney(journey, trial) {
  if (journey.journey_id === 'turn-media-recovery') return recoveryProductSpec(trial);
  if (journey.journey_id === 'pre-materialization-offline') return desktopOfflineProductSpec(trial);
  if (journey.journey_id === 'native-macos-input') return nativeMacosProductSpec(trial);
  return null;
}

function checkpointCorrelations(evidence) {
  const chat = evidence?.dom?.evidence?.chat || {};
  const conversation = evidence?.dom?.evidence?.conversation || {};
  return {
    requestId: chat.requestId || null,
    runtimeTurnId: chat.runtimeTurnId || null,
    runtimeStreamId: chat.runtimeStreamId || null,
    localAgentRef: chat.localAgentRef || conversation.localAgentRef || null,
    conversationAnchorId: chat.conversationAnchorId || conversation.conversationAnchorId || null,
  };
}

export async function runProductSummaryExtendedJourneyTrial({ architecture, journey, trial, sourceState, outputDir }) {
  const spec = productSpecForJourney(journey, trial);
  if (!spec) throw new Error(`missing product summary driver for ${journey.journey_id}`);
  fs.mkdirSync(spec.artifactsRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const execution = await runProcess(spec.command, spec.args, { cwd: spec.cwd, env: spec.env });
  if (execution.code !== 0 || execution.signal) {
    const diagnostic = `${execution.stderr}\n${execution.stdout}`.trim().slice(-12_000);
    throw new Error(`${journey.journey_id} product Journey failed (${execution.code ?? execution.signal}): ${diagnostic}`);
  }
  if (!fs.existsSync(spec.summaryPath)) throw new Error(`${journey.journey_id} product summary is missing`);
  const summary = JSON.parse(fs.readFileSync(spec.summaryPath, 'utf8'));
  if (summary.schemaVersion !== spec.schemaVersion
    || summary.journeyId !== journey.journey_id
    || summary.outcome !== 'passed') {
    throw new Error(`${journey.journey_id} product summary identity/outcome is invalid`);
  }
  if (JSON.stringify(summary.processStarts) !== JSON.stringify(journey.environment.start_limits)) {
    throw new Error(`${journey.journey_id} product process starts drift from Journey registry`);
  }
  if (!Array.isArray(summary.pageProblems) || summary.pageProblems.length > 0) {
    throw new Error(`${journey.journey_id} product page problems: ${JSON.stringify(summary.pageProblems)}`);
  }

  const artifactInputs = [
    { artifactId: `${journey.journey_id}-summary`, file: spec.summaryPath },
    ...productArtifactFiles(journey.journey_id, spec.artifactsRoot, spec.summaryPath).map((file) => ({
      artifactId: artifactIdForProduct(journey.journey_id, spec.artifactsRoot, file),
      file,
    })),
  ];
  const checkpointFacts = new Map();
  for (const checkpoint of journey.checkpoints) {
    const observed = summary.checkpoints?.[checkpoint.checkpoint_id];
    const evidencePath = observed?.evidencePath
      ? path.join(spec.artifactsRoot, observed.evidencePath)
      : '';
    const screenshot = observed?.screenshot
      ? path.join(spec.artifactsRoot, observed.screenshot)
      : '';
    let evidence = null;
    if (evidencePath && fs.existsSync(evidencePath)) {
      evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    }
    checkpointFacts.set(checkpoint.checkpoint_id, {
      passed: observed?.passed === true
        && evidence?.checkpointId === checkpoint.checkpoint_id
        && screenshot !== ''
        && fs.existsSync(screenshot)
        && Array.isArray(evidence.pageProblems)
        && evidence.pageProblems.length === 0,
      correlations: checkpointCorrelations(evidence),
    });
  }

  const environmentPath = path.join(trial.paths.artifacts, 'environment.json');
  fs.writeFileSync(environmentPath, `${JSON.stringify({
    schemaVersion: 'nimi.local-agent-product-environment/v2',
    journeyTrialId: trial.identity.journeyTrialId,
    rootId: sha256(trial.paths.root),
    sourceState,
    processStarts: summary.processStarts,
    commandProcessCount: 1,
    acceptanceLeafCount: pointRowsForJourney(architecture, journey.journey_id).length,
  }, null, 2)}\n`);
  artifactInputs.push({ artifactId: 'journey-environment', file: environmentPath });
  const executionPath = path.join(trial.paths.artifacts, 'product-execution-proof.json');
  fs.writeFileSync(executionPath, `${JSON.stringify({
    schemaVersion: 'nimi.local-agent-product-execution-proof/v2',
    journeyTrialId: trial.identity.journeyTrialId,
    journeyId: journey.journey_id,
    exitCode: execution.code,
    signal: execution.signal,
    durationMs: execution.durationMs,
    processStarts: summary.processStarts,
    outputSha256: sha256(`${execution.stdout}\n${execution.stderr}`),
  }, null, 2)}\n`);
  artifactInputs.push({ artifactId: 'product-execution-proof', file: executionPath });
  const artifactRefs = artifactInputs.map((artifact) => artifact.artifactId);
  const points = pointRowsForJourney(architecture, journey.journey_id);
  const completedAt = new Date().toISOString();
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
    environmentIdentity: { rootId: sha256(trial.paths.root), processStarts: summary.processStarts },
    durationMs: Math.round(performance.now() - started),
    checkpoints,
    leafResults,
    artifacts: [],
    processProblems: summary.pageProblems,
    privacy: { ok: true, findings: [] },
    outcome,
  };
  assertSourceState(sourceState, repoRoot);
  const persisted = persistResultEvidence({ outputDir, result, artifactInputs });
  const failures = validateJourneyResult({ architecture, journey, result: persisted.result, expectedSourceState: sourceState });
  if (failures.length > 0) throw new Error(`${journey.journey_id} result validation failed: ${failures.join('; ')}`);
  if (persisted.result.outcome !== 'passed') {
    const failed = persisted.result.checkpoints.filter((checkpoint) => checkpoint.outcome !== 'passed').map((checkpoint) => checkpoint.checkpointId);
    throw new Error(`${journey.journey_id} checkpoints failed: ${failed.join(', ')}`);
  }
  return persisted;
}

function desktopDisabledActionStep(step, trial) {
  const artifactsRoot = path.join(trial.paths.artifacts, 'desktop-disabled-action');
  return {
    ...step,
    command: process.execPath,
    args: [path.join(repoRoot, 'apps/desktop/scripts/run-electron-explore-materialization-acceptance.mjs')],
    cwd: repoRoot,
    env: {
      ...journeyIdentityEnv(trial),
      NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_ID: trial.identity.journeyId,
      NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ID: trial.identity.journeyTrialId,
      NIMI_LOCAL_AGENT_PRODUCT_DISABLED_ACTION_ONLY: '1',
      NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_ARTIFACTS_ROOT: artifactsRoot,
      NIMI_LOCAL_AGENT_PRODUCT_RUNTIME_DATA_ROOT: trial.paths.runtimeData,
      NIMI_LOCAL_AGENT_PRODUCT_STANDARD_DATA_ROOT: trial.paths.standardShellData,
      NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_USER_DATA_ROOT: trial.paths.desktopUserData,
    },
    productResultPath: path.join(artifactsRoot, 'acceptance-result.json'),
  };
}

function productMarkers(step, result) {
  if (step.kind !== 'desktop-disabled-action') return '';
  if (!fs.existsSync(step.productResultPath)) return '';
  const product = JSON.parse(fs.readFileSync(step.productResultPath, 'utf8'));
  if (product.ok !== true
    || product.mode !== 'disabled-action-only'
    || !(product.observations?.worldPreviewDisabledActions > 0)
    || (product.consoleErrors || []).length > 0
    || (product.pageErrors || []).length > 0) return '';
  if (result.code !== 0 || result.signal) return '';
  return 'CHECKPOINT nonconnectable-action-disabled';
}

function stepArtifactInputs(step, logPath) {
  const inputs = [{ artifactId: `step-${step.stepId}-log`, file: logPath }];
  if (step.productResultPath && fs.existsSync(step.productResultPath)) {
    inputs.push({ artifactId: `step-${step.stepId}-product-result`, file: step.productResultPath });
    const product = JSON.parse(fs.readFileSync(step.productResultPath, 'utf8'));
    for (const [name, file] of Object.entries(product.screenshots || {})) {
      if (typeof file === 'string' && fs.existsSync(file)) inputs.push({ artifactId: `step-${step.stepId}-${name}`, file });
    }
  }
  return inputs;
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
  for (const rawStep of plan.steps) {
    const step = rawStep.kind === 'desktop-disabled-action' ? desktopDisabledActionStep(rawStep, trial) : rawStep;
    const result = await runProcess(step.command, step.args, { cwd: step.cwd, env: step.env });
    const combined = `${result.stdout}\n${result.stderr}\n${productMarkers(step, result)}`;
    const logPath = path.join(trial.paths.artifacts, `${step.stepId}.log`);
    fs.writeFileSync(logPath, combined);
    const stepArtifacts = stepArtifactInputs(step, logPath);
    artifactInputs.push(...stepArtifacts);
    artifactRefs.push(...stepArtifacts.map((artifact) => artifact.artifactId));
    const markerEvidence = {};
    for (const [checkpointId, markers] of Object.entries(step.checkpointMarkers)) {
      const observed = markers.filter((marker) => combined.includes(marker));
      markerEvidence[checkpointId] = { required: markers, observed };
      checkpointFacts.set(checkpointId, {
        passed: result.code === 0 && !result.signal && observed.length === markers.length,
        correlations: { stepId: step.stepId, owner: step.owner },
      });
    }
    executions.push({
      stepId: step.stepId,
      owner: step.owner,
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
  const completedAt = new Date().toISOString();
  const proofPath = path.join(trial.paths.artifacts, 'extended-checkpoint-proof.json');
  fs.writeFileSync(proofPath, `${JSON.stringify({
    schemaVersion: 'nimi.local-agent-product-extended-proof/v2',
    journeyTrialId: trial.identity.journeyTrialId,
    journeyId: journey.journey_id,
    processStarts: plan.processStarts,
    executions,
  }, null, 2)}\n`);
  artifactInputs.push({ artifactId: 'extended-checkpoint-proof', file: proofPath });
  artifactRefs.push('extended-checkpoint-proof');
  const environmentPath = path.join(trial.paths.artifacts, 'environment.json');
  fs.writeFileSync(environmentPath, `${JSON.stringify({
    schemaVersion: 'nimi.local-agent-product-environment/v2',
    journeyTrialId: trial.identity.journeyTrialId,
    rootId: sha256(trial.paths.root),
    sourceState,
    processStarts: plan.processStarts,
    commandProcessCount: plan.steps.length,
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
    environmentIdentity: { rootId: sha256(trial.paths.root), processStarts: plan.processStarts },
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
    const failed = persisted.result.checkpoints.filter((checkpoint) => checkpoint.outcome !== 'passed').map((checkpoint) => checkpoint.checkpointId);
    throw new Error(`${journey.journey_id} checkpoints failed: ${failed.join(', ')}`);
  }
  return persisted;
}
