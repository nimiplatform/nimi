import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { persistResultEvidence } from './artifact-writer.mjs';
import { repoRoot } from './registry.mjs';
import { assertSourceState } from './source-state.mjs';
import { validateJourneyResult } from './validation.mjs';
import { journeyIdentityEnv } from './trial-root.mjs';

const requiredProviderContextLanes = [
  'runtime_policy',
  'output_contract',
  'source_identity',
  'source_behavior',
  'world_context',
  'relationship_context',
  'source_knowledge',
  'canonical_memory',
  'conversation_history',
  'capability_context',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const activeProcessHandles = new Set();

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

export function startProcess(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const completed = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  const handle = { child, completed };
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

function providerContextLaneSequence(request) {
  if (request?.body?.stream !== true || !Array.isArray(request.body.messages)) return [];
  return request.body.messages.flatMap((message, index, messages) => {
    if (!['system', 'user', 'assistant'].includes(message?.role) || typeof message.content !== 'string') return [];
    const match = message.content.match(/(?:^|\n)lane=([a-z_]+)(?:\n|$)/u);
    if (match) return [match[1]];
    const committedTranscript = (message.role === 'user' && messages[index + 1]?.role === 'assistant')
      || (message.role === 'assistant' && messages[index - 1]?.role === 'user' && index < messages.length - 1);
    return committedTranscript ? ['conversation_history'] : [];
  });
}

function summarizeProviderContext(requests) {
  const sequences = requests.map(providerContextLaneSequence).filter((sequence) => sequence.length > 0);
  const laneIds = [...new Set(sequences.flat())].sort();
  const order = new Map(requiredProviderContextLanes.map((lane, index) => [lane, index]));
  const contextLaneOrderVerified = sequences.every((sequence) => sequence.every((lane, index) => index === 0
    || (order.get(sequence[index - 1]) ?? Number.MAX_SAFE_INTEGER) <= (order.get(lane) ?? Number.MAX_SAFE_INTEGER)));
  const missingLaneIds = requiredProviderContextLanes.filter((lane) => !laneIds.includes(lane));
  return {
    contextRequestCount: sequences.length,
    contextLaneIds: laneIds,
    contextLaneOrderVerified,
    missingLaneIds,
    complete: sequences.length >= 3 && contextLaneOrderVerified && missingLaneIds.length === 0,
  };
}

function deepString(input, keys, seen = new Set()) {
  if (!input || typeof input !== 'object' || seen.has(input)) return '';
  seen.add(input);
  for (const [key, value] of Object.entries(input)) {
    if (keys.has(key) && typeof value === 'string' && value.trim()) return value.trim();
    const nested = deepString(value, keys, seen);
    if (nested) return nested;
  }
  return '';
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

function coreFacts({ desktopEvidence, handoff, summary, providerSummary, providerRequests, artifactFileCount }) {
  const facts = new Map();
  const observations = desktopEvidence.observations || {};
  const packetRequests = desktopEvidence.observations?.packetRequest ? [desktopEvidence.observations.packetRequest] : [];
  const character = handoff.agents?.find((agent) => agent.sourceKind === 'worldCharacter');
  const persona = handoff.agents?.find((agent) => agent.sourceKind === 'realmPersona');
  const packet = packetRequests[0] || handoff.packetRequest;
  const desktopTurns = new Map((handoff.desktopCoreTurns || []).map((turn) => [turn.checkpointId, turn]));
  const zhiyu = summary.checkpoints || {};
  const providerCheckpointIds = new Set(providerRequests.map((request) => request.checkpointId));
  const snapshotHash = character?.snapshotHash || deepString(desktopEvidence, new Set(['snapshotHash', 'sourceSnapshotHash']));
  const pass = (id, passed, correlations = {}) => facts.set(id, { passed: passed === true, correlations });

  pass('provider-ready', providerRequests.length > 0, { providerRequestCount: providerRequests.length });
  pass('runtime-ready', observations.processStarts?.runtime >= 1, { runtimeStarts: observations.processStarts?.runtime || 0 });
  pass('realm-ready', Boolean(packet?.packetId), { packetId: packet?.packetId || null });
  pass('desktop-ready', desktopEvidence.ok === true);
  pass('runtime-account-login', observations.runtimeAccount?.stage === 'authenticated', { accountId: handoff.ownerUserId });
  pass('character-source-selected', handoff.sourceKind === 'worldCharacter' && Boolean(character));
  pass('materialization-challenge', Boolean(packet?.challengeId && /^[a-f0-9]{64}$/u.test(packet?.challengeDigest || '')), { challengeId: packet?.challengeId || null });
  pass('character-packet-v2', Boolean(packet?.packetId && packet?.runtimeSourceRef && packet?.intendedRuntimeAudience));
  pass('character-snapshot', /^[a-f0-9]{64}$/u.test(snapshotHash || ''), { snapshotHash: snapshotHash || null });
  pass('agent-center-safe-status', observations.agentCenterSourceContextStatus === 'ready'
    && typeof observations.agentCenterSourceContextText === 'string'
    && observations.agentCenterSourceContextText.length > 0);
  for (const id of ['desktop-chat-turn-1', 'desktop-chat-turn-2', 'desktop-chat-turn-3']) {
    const turn = desktopTurns.get(id);
    pass(id, turn?.providerRequestCount >= 1 && providerCheckpointIds.has(id), { inputMode: turn?.inputMode || null });
  }
  pass('provider-context-lanes', providerSummary.complete === true, { contextRequestCount: providerSummary.contextRequestCount });
  pass('zhiyu-ready', summary.outcome === 'passed' && Array.isArray(summary.pageProblems) && summary.pageProblems.length === 0);
  pass('zhiyu-character-selected', zhiyu.crossAppAnchor?.localAgentRef === character?.localAgentRef);
  pass('cross-app-anchor-continuity', zhiyu.crossAppAnchor?.passed === true
    && Boolean(zhiyu.crossAppAnchor?.conversationAnchorId)
    && providerCheckpointIds.has('core-zhiyu-initial'));
  pass('zhiyu-multiturn', zhiyu.crossAppAnchor?.messageCount >= 4
    && zhiyu.streamingReasoning?.passed === true
    && zhiyu.layoutAccessibility?.passed === true
    && providerCheckpointIds.has('core-zhiyu-follow-up'));
  pass('voice-emotion-apml', zhiyu.emotionApml?.passed === true
    && zhiyu.imageAction?.passed === true
    && zhiyu.nativeVoice?.passed === true
    && zhiyu.batchVoice?.passed === true
    && zhiyu.stt?.passed === true);
  pass('persona-materialized', Boolean(persona?.localAgentRef && persona?.runtimeSourceRef && persona?.snapshotHash));
  pass('character-persona-switch', zhiyu.personaAndIsolation?.passed === true
    && zhiyu.personaAndIsolation?.characterLocalAgentRef === character?.localAgentRef
    && zhiyu.personaAndIsolation?.personaLocalAgentRef === persona?.localAgentRef);
  pass('cross-agent-isolation', zhiyu.personaAndIsolation?.passed === true
    && JSON.stringify(providerRequests.find((request) => request.checkpointId === 'core-cross-agent-isolation')?.body || {}).includes('PERSONA_CANARY_B') === false);
  pass('runtime-restart', observations.processStarts?.runtime === 2, { runtimeStarts: observations.processStarts?.runtime || 0 });
  pass('continuity-after-restart', zhiyu.restart?.passed === true
    && zhiyu.restart?.messageCountAfter >= zhiyu.restart?.messageCountBefore);
  pass('realm-offline', zhiyu.offlineRecovery?.passed === true);
  pass('offline-local-chat', Boolean(zhiyu.offlineRecovery?.offlineRequestId)
    && providerCheckpointIds.has('core-realm-offline-turn'));
  pass('realm-recovery-no-duplication', zhiyu.offlineRecovery?.recoveredAgentCount === 2);
  pass('artifact-privacy-closeout', artifactFileCount >= 8
    && observations.tokenLeak?.passed === true
    && Array.isArray(summary.pageProblems)
    && summary.pageProblems.length === 0);
  return facts;
}

export async function runFullChainCoreTrial({ architecture, journey, trial, sourceState, outputDir }) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const handoffPath = path.join(trial.paths.control, 'desktop-handoff.json');
  const releasePath = path.join(trial.paths.control, 'release-desktop');
  const summaryPath = path.join(trial.paths.control, 'zhiyu-core-summary.json');
  const desktopArtifacts = path.join(trial.paths.artifacts, 'desktop');
  const zhiyuArtifacts = path.join(trial.paths.artifacts, 'zhiyu');
  const providerRawPath = path.join(trial.paths.providerRaw, 'provider-capture-local-sensitive.json');
  const desktopStdout = path.join(trial.paths.artifacts, 'desktop-stdout.log');
  const desktopStderr = path.join(trial.paths.artifacts, 'desktop-stderr.log');
  const zhiyuStdout = path.join(trial.paths.artifacts, 'zhiyu-stdout.log');
  const zhiyuStderr = path.join(trial.paths.artifacts, 'zhiyu-stderr.log');
  const evidenceCheckpoint = `full-chain-core-r${trial.identity.repeatIndex}-${sha256(trial.identity.journeyTrialId).slice(0, 10)}`;
  const baseEnv = {
    ...process.env,
    ...journeyIdentityEnv(trial),
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_ID: 'full-chain-core',
    NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_TIME_BUDGET_MS: String(journey.time_budget_ms),
    NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ID: trial.identity.journeyTrialId,
    NIMI_LOCAL_AGENT_PRODUCT_SOURCE_KIND: 'worldCharacter',
    NIMI_LOCAL_AGENT_PRODUCT_HANDOFF_PATH: handoffPath,
    NIMI_LOCAL_AGENT_PRODUCT_RELEASE_PATH: releasePath,
    NIMI_LOCAL_AGENT_PRODUCT_CONTROL_ROOT: trial.paths.control,
    NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_ARTIFACTS_ROOT: desktopArtifacts,
    NIMI_LOCAL_AGENT_PRODUCT_PROVIDER_RAW_PATH: providerRawPath,
    NIMI_LOCAL_AGENT_PRODUCT_RUNTIME_DATA_ROOT: trial.paths.runtimeData,
    NIMI_LOCAL_AGENT_PRODUCT_STANDARD_DATA_ROOT: trial.paths.standardShellData,
    NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_USER_DATA_ROOT: trial.paths.desktopUserData,
    NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT: trial.paths.zhiyuUserData,
    NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_SUMMARY_PATH: summaryPath,
    NIMI_ZHIYU_EVIDENCE_CHECKPOINT: evidenceCheckpoint,
  };

  const desktop = startProcess(process.execPath, [
    path.join(repoRoot, 'apps/desktop/scripts/run-electron-explore-materialization-acceptance.mjs'),
  ], { cwd: repoRoot, env: baseEnv });
  let handoff;
  let zhiyu = null;
  let zhiyuResult = null;
  let failure = null;
  try {
    handoff = await Promise.race([
      waitForJsonFile(handoffPath, 240_000),
      desktop.completed.then((result) => {
        throw new Error(`Desktop exited before Journey handoff (${result.code ?? result.signal}): ${result.stderr || result.stdout}`);
      }),
    ]);
    zhiyu = startProcess(process.execPath, [
      '--import', 'tsx', '--test',
      path.join(repoRoot, 'apps/zhiyu/test/e2e/electron-real-local-agent-acceptance.test.mjs'),
    ], {
      cwd: repoRoot,
      env: { ...baseEnv, NIMI_LOCAL_AGENT_PRODUCT_TARGET_DISPLAY_NAME: handoff.displayName },
    });
    zhiyuResult = await Promise.race([
      zhiyu.completed,
      desktop.completed.then((result) => {
        throw new Error(`Desktop exited before Zhiyu completed (${result.code ?? result.signal}): ${result.stderr || result.stdout}`);
      }),
    ]);
    fs.writeFileSync(zhiyuStdout, zhiyuResult.stdout);
    fs.writeFileSync(zhiyuStderr, zhiyuResult.stderr);
    if (zhiyuResult.code !== 0 || zhiyuResult.signal) {
      throw new Error(`Zhiyu Electron failed (${zhiyuResult.code ?? zhiyuResult.signal}): ${zhiyuResult.stderr || zhiyuResult.stdout}`);
    }
    await waitForJsonFile(summaryPath, 10_000);
    handoff = await waitForJsonFile(handoffPath, 10_000);
    const response = await fetch(`${handoff.providerFixtureBaseUrl}/__fixture/control/manifest`);
    if (!response.ok) throw new Error(`provider capture reload failed with ${response.status}`);
    fs.writeFileSync(providerRawPath, `${JSON.stringify(await response.json(), null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    failure = error;
  } finally {
    fs.writeFileSync(releasePath, 'released\n');
    if (failure) {
      await Promise.all([terminateProcessTree(zhiyu), terminateProcessTree(desktop)]);
      if (!zhiyuResult && zhiyu) zhiyuResult = await zhiyu.completed.catch(() => null);
      if (zhiyuResult) {
        fs.writeFileSync(zhiyuStdout, zhiyuResult.stdout);
        fs.writeFileSync(zhiyuStderr, zhiyuResult.stderr);
      }
    }
  }
  const desktopResult = await desktop.completed;
  fs.writeFileSync(desktopStdout, desktopResult.stdout);
  fs.writeFileSync(desktopStderr, desktopResult.stderr);
  if (failure) throw failure;
  if (desktopResult.code !== 0 || desktopResult.signal) {
    throw new Error(`Desktop Electron failed (${desktopResult.code ?? desktopResult.signal}): ${desktopResult.stderr || desktopResult.stdout}`);
  }

  const desktopResultPath = path.join(desktopArtifacts, 'acceptance-result.json');
  const desktopEvidence = JSON.parse(fs.readFileSync(desktopResultPath, 'utf8'));
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  if (desktopEvidence.ok !== true || summary.outcome !== 'passed') throw new Error('core product subprocess evidence is not successful');
  const zhiyuEvidenceRoot = path.join(repoRoot, '.nimi', 'local', 'evidence', 'zhiyu', evidenceCheckpoint);
  fs.mkdirSync(zhiyuArtifacts, { recursive: true });
  if (fs.existsSync(zhiyuEvidenceRoot)) fs.cpSync(zhiyuEvidenceRoot, zhiyuArtifacts, { recursive: true });
  const rawProvider = JSON.parse(fs.readFileSync(providerRawPath, 'utf8'));
  const providerRequests = rawProvider.realmFixture?.providerRequests || [];
  const processStarts = { ...handoff.processStarts, zhiyu: 1 };
  const actualLogicalIdentity = {
    accountIds: [handoff.ownerUserId].filter(Boolean),
    worldIds: [...new Set((handoff.agents || []).map((agent) => agent.sourceRef?.worldId).filter(Boolean))].sort(),
    sourceIds: [...new Set((handoff.agents || []).map((agent) => agent.sourceRef?.sourceId).filter(Boolean))].sort(),
    runtimeSourceRefs: [...new Set((handoff.agents || []).map((agent) => agent.runtimeSourceRef).filter(Boolean))].sort(),
    localAgentIds: [...new Set((handoff.agents || []).map((agent) => agent.localAgentRef).filter(Boolean))].sort(),
  };
  const declaredLogicalIdentity = trial.identity.logicalIdentity;
  if (!baseEnv.NIMI_LOCAL_AGENT_PRODUCT_REALM_BASE_URL) {
    const declaredSourceIds = [declaredLogicalIdentity.sourceId, declaredLogicalIdentity.personaSourceId].sort();
    if (actualLogicalIdentity.accountIds[0] !== declaredLogicalIdentity.accountId
      || actualLogicalIdentity.worldIds.length !== 1
      || actualLogicalIdentity.worldIds[0] !== declaredLogicalIdentity.worldId
      || JSON.stringify(actualLogicalIdentity.sourceIds) !== JSON.stringify(declaredSourceIds)) {
      throw new Error(`core Journey logical identity drift: declared=${JSON.stringify(declaredLogicalIdentity)} actual=${JSON.stringify(actualLogicalIdentity)}`);
    }
  }
  const providerContext = summarizeProviderContext(providerRequests);
  const providerSummaryPath = path.join(trial.paths.artifacts, 'provider-capture-summary.json');
  const providerCheckpointIds = [...new Set(providerRequests.map((request) => request.checkpointId))].sort();
  const providerSummary = {
    schemaVersion: 'nimi.local-agent-provider-capture-summary/v2',
    complete: providerContext.complete,
    providerRequestCount: providerRequests.length,
    contextRequestCount: providerContext.contextRequestCount,
    contextLaneIds: providerContext.contextLaneIds,
    requiredContextLaneIds: requiredProviderContextLanes,
    missingLaneIds: providerContext.missingLaneIds,
    contextLaneOrderVerified: providerContext.contextLaneOrderVerified,
    checkpointIds: providerCheckpointIds,
    rawCaptureSha256: sha256(fs.readFileSync(providerRawPath)),
    rawCaptureRetainedLocally: true,
  };
  fs.writeFileSync(providerSummaryPath, `${JSON.stringify(providerSummary, null, 2)}\n`);

  const processSummaryPath = path.join(trial.paths.artifacts, 'process-summary.json');
  fs.writeFileSync(processSummaryPath, `${JSON.stringify({
    schemaVersion: 'nimi.local-agent-product-process-summary/v2',
    processStarts,
    desktopExit: { code: desktopResult.code, signal: desktopResult.signal },
    zhiyuExit: { code: zhiyuResult.code, signal: zhiyuResult.signal },
    desktopConsoleErrors: desktopEvidence.consoleErrors || [],
    desktopPageErrors: desktopEvidence.pageErrors || [],
    zhiyuPageProblems: summary.pageProblems || [],
  }, null, 2)}\n`);
  const environmentPath = path.join(trial.paths.artifacts, 'environment.json');
  fs.writeFileSync(environmentPath, `${JSON.stringify({
    schemaVersion: 'nimi.local-agent-product-environment/v2',
    journeyTrialId: trial.identity.journeyTrialId,
    rootId: sha256(trial.paths.root),
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    sourceState,
    ...actualLogicalIdentity,
    processStarts,
  }, null, 2)}\n`);

  const desktopFiles = allFiles(desktopArtifacts).filter((file) => path.extname(file).toLowerCase() === '.png' || path.basename(file) === 'acceptance-result.json');
  const zhiyuFiles = allFiles(zhiyuArtifacts).filter((file) => ['.png', '.json'].includes(path.extname(file).toLowerCase()));
  const otherDesktop = desktopFiles.filter((file) => file !== desktopResultPath);
  const processLogs = [desktopStdout, desktopStderr, zhiyuStdout, zhiyuStderr];
  const artifactInputs = [
    { artifactId: 'desktop-product-result', file: desktopResultPath },
    { artifactId: 'zhiyu-core-summary', file: summaryPath },
    { artifactId: 'provider-capture-summary', file: providerSummaryPath },
    { artifactId: 'process-summary', file: processSummaryPath },
    { artifactId: 'journey-environment', file: environmentPath },
    ...otherDesktop.map((file, index) => ({ artifactId: artifactIdFor('desktop', desktopArtifacts, file, index), file })),
    ...zhiyuFiles.map((file, index) => ({ artifactId: artifactIdFor('zhiyu', zhiyuArtifacts, file, index), file })),
    ...processLogs.map((file, index) => ({ artifactId: `process-log-${index + 1}`, file })),
  ];
  const coreEvidenceRefs = ['desktop-product-result', 'zhiyu-core-summary', 'provider-capture-summary', 'process-summary', 'journey-environment'];
  const points = pointRowsForJourney(architecture, journey.journey_id);
  const facts = coreFacts({
    desktopEvidence,
    handoff,
    summary,
    providerSummary,
    providerRequests,
    artifactFileCount: artifactInputs.length,
  });
  const proofPath = path.join(trial.paths.artifacts, 'journey-checkpoint-proof.json');
  fs.writeFileSync(proofPath, `${JSON.stringify({
    schemaVersion: 'nimi.local-agent-product-checkpoint-proof/v2',
    journeyTrialId: trial.identity.journeyTrialId,
    facts: Object.fromEntries([...facts].map(([id, fact]) => [id, fact])),
    providerCheckpointIds,
    desktopCoreTurns: handoff.desktopCoreTurns,
    zhiyuCheckpoints: summary.checkpoints,
  }, null, 2)}\n`);
  artifactInputs.push({ artifactId: 'journey-checkpoint-proof', file: proofPath });
  coreEvidenceRefs.push('journey-checkpoint-proof');
  const completedAt = new Date().toISOString();
  const correlations = {
    ownerUserId: handoff.ownerUserId,
    sourceRef: handoff.sourceRef,
    runtimeSourceRef: handoff.runtimeSourceRef,
    localAgentRef: handoff.localAgentRef,
    conversationAnchorId: summary.checkpoints?.crossAppAnchor?.conversationAnchorId || null,
  };
  const { checkpoints, checkpointById } = buildCheckpointResults({
    journey,
    points,
    facts,
    correlations,
    artifactRefs: coreEvidenceRefs,
    startedAt,
    completedAt,
  });
  const leafResults = buildLeafResults({
    points,
    checkpointById,
    journeyTrialId: trial.identity.journeyTrialId,
    artifactRefs: coreEvidenceRefs,
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
    environmentIdentity: { rootId: sha256(trial.paths.root), ...actualLogicalIdentity, processStarts },
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
  if (failures.length > 0) throw new Error(`full-chain-core result validation failed: ${failures.join('; ')}`);
  if (persisted.result.outcome !== 'passed') {
    const failed = persisted.result.checkpoints.filter((checkpoint) => checkpoint.outcome !== 'passed').map((checkpoint) => checkpoint.checkpointId);
    throw new Error(`full-chain-core product checkpoints failed: ${failed.join(', ')}`);
  }
  return persisted;
}
