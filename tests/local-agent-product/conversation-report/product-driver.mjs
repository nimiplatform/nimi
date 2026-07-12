import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  allFiles,
  startProcess,
  terminateProcessTree,
  terminateProcessTreeAfterGrace,
  waitForJsonFile,
} from '../harness/cross-app-driver.mjs';
import { scanArtifactFiles } from '../harness/privacy-scan.mjs';
import { repoRoot } from '../harness/registry.mjs';
import { assertSourceState } from '../harness/source-state.mjs';
import { journeyIdentityEnv } from '../harness/trial-root.mjs';
import { writeConversationReportBundle } from './bundle-writer.mjs';
import {
  loadConversationReportEnvironment,
  projectConversationReportRuntimeEnvironment,
} from './runtime-env.mjs';
import { conversationReportExecutionStatus } from './turn-result.mjs';

function text(value) {
  return String(value || '').trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function copyArtifact(source, destination) {
  if (!source || !fs.existsSync(source)) return null;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return destination;
}

function packageVersion(relative) {
  const file = path.join(repoRoot, relative, 'package.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).version || 'workspace' : 'workspace';
}

function safeContextSummary(raw, capturedAt) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    capturedAt,
    ready: value.ready === true,
    state: text(value.state) || 'unavailable',
    reasonCode: text(value.reasonCode) || null,
    promptHash: text(value.promptHash) || null,
    sourceSnapshotHash: text(value.sourceSnapshotHash) || null,
    contextContentHash: text(value.contextContentHash) || null,
    lanes: Array.isArray(value.lanes) ? value.lanes : [],
    budget: value.budget || null,
    truncation: Array.isArray(value.truncation) ? value.truncation : [],
    transcriptTurnCount: Number(value.transcriptTurnCount || 0),
    memoryItemCount: Number(value.memoryItemCount || 0),
    routeDigest: text(value.routeDigest) || null,
    catalogRevisionDigest: text(value.catalogRevisionDigest) || null,
  };
}

function publicPresentation(raw, capturedAt) {
  if (raw?.presentationOutput) return raw.presentationOutput;
  const structured = raw?.structuredOutput || null;
  const inspect = raw?.inspect || {};
  return {
    capturedAt,
    voice: { observed: false, events: [] },
    emotion: {
      observed: Boolean(structured?.emotion),
      events: structured?.emotion ? [structured.emotion] : [],
    },
    activity: {
      observed: Boolean(inspect?.state),
      events: inspect?.state ? [inspect.state] : [],
    },
    apml: { observed: Boolean(structured), structured },
    hooks: [...(inspect?.pendingHooks || []), ...(inspect?.recentTerminalHooks || [])],
  };
}

function buildObservationMappings(scenario) {
  const locations = new Map();
  const add = (pointId, location) => {
    const key = `${location.kind}:${location.ref}`;
    const bucket = locations.get(pointId) || new Map();
    bucket.set(key, location);
    locations.set(pointId, bucket);
  };
  for (const stream of scenario.streams) {
    for (const turn of stream.turns) {
      for (const pointId of turn.observation_point_ids || []) add(pointId, { kind: 'turn', ref: turn.turn_id });
    }
  }
  for (const event of scenario.lifecycle_timeline.events) {
    for (const pointId of event.observation_point_ids || []) add(pointId, { kind: 'lifecycle_event', ref: event.event_id });
  }
  for (const section of scenario.report_sections) {
    for (const pointId of section.observation_point_ids || []) add(pointId, { kind: 'report_section', ref: `review:${section.section_id}` });
  }
  return [...locations.entries()].map(([pointId, entries]) => ({
    pointId,
    locations: [...entries.values()],
  })).sort((left, right) => left.pointId.localeCompare(right.pointId));
}

export function projectConversationReportReviewDimensions(scenario) {
  return scenario.review_dimensions.map((dimension) => ({
    id: dimension.dimension_id,
    title: dimension.title,
    turnRefs: scenario.streams.flatMap((stream) => stream.turns)
      .filter((turn) => (turn.human_review_dimensions || []).includes(dimension.dimension_id))
      .map((turn) => turn.turn_id),
    observationPointIds: scenario.report_sections
      .filter((section) => section.section_id === dimension.dimension_id)
      .flatMap((section) => section.observation_point_ids || []),
    reviewStatus: 'unreviewed',
    notes: '',
  }));
}

function turnScreenshotSources(raw, desktopArtifacts, zhiyuArtifacts) {
  if (raw.screenshotPath) return [{ source: raw.screenshotPath, suffix: '' }];
  return (raw.screenshotFiles || []).map((file, index) => ({
    source: path.join(zhiyuArtifacts, file),
    suffix: index === 0 ? '' : `-${index + 1}`,
  }));
}

function buildReport({
  runId,
  sourceState,
  scenario,
  scenarioDigest,
  handoff,
  summary,
  journey,
  bundleRoot,
  desktopArtifacts,
  zhiyuArtifacts,
  startedAt,
  durationMs,
  desktopEvidence,
  desktopResult,
  zhiyuResult,
  fixtureProviderRequestCount,
}) {
  const route = handoff.conversationReportRouteSummary;
  const modelIdentity = {
    providerId: route.fingerprint.providerId,
    modelId: route.fingerprint.modelId,
    modelRevisionOrFingerprint: route.fingerprint.modelRevisionOrFingerprint,
    catalogVersion: route.catalogEvidence.catalogVersion || null,
    providerVersion: route.catalogEvidence.providerVersion || null,
    parameters: route.parameters,
  };
  const agentByKind = new Map(handoff.agents.map((agent) => [agent.sourceKind, agent]));
  const streamById = new Map(scenario.streams.map((stream) => [stream.stream_id, stream]));
  const anchorByKind = new Map(summary.agents.map((agent) => [agent.sourceKind, agent.conversationAnchorId]));
  const threadByStream = new Map();
  for (const turn of summary.turns) {
    const threadId = text(turn.threadId);
    if (!threadId) throw new Error(`${turn.turnId} Runtime thread identity is missing`);
    const current = threadByStream.get(turn.streamId);
    if (current && current !== threadId) throw new Error(`${turn.streamId} Runtime thread identity drifted`);
    threadByStream.set(turn.streamId, threadId);
  }
  const conversationStreams = scenario.streams.map((declared) => {
    const sourceKind = declared.source_provenance.source_kind;
    const agent = agentByKind.get(sourceKind);
    const anchor = anchorByKind.get(sourceKind);
    const threadId = threadByStream.get(declared.stream_id);
    if (!agent || !anchor || !threadId) throw new Error(`${declared.stream_id} Runtime identity is incomplete`);
    const memoryScope = `runtime-agent:${agent.localAgentRef}:dyadic:${handoff.ownerUserId}`;
    return {
      streamId: declared.stream_id,
      title: declared.title,
      purpose: declared.purpose,
      sourceProvenance: {
        sourceKind,
        sourceRef: agent.sourceRef,
        sourceRevision: agent.sourceRef.sourceContentHash,
        sourceContentHash: agent.sourceRef.sourceContentHash,
        snapshotRef: agent.runtimeSourceRef,
        snapshotHash: agent.snapshotHash,
        frozenAt: agent.materializedAt,
      },
      localAgentIdentity: { localAgentRef: agent.localAgentRef, ownerAccountId: handoff.ownerUserId },
      conversationIdentity: { conversationAnchorId: anchor, threadId, localAgentRef: agent.localAgentRef },
      memoryScope,
      turnIds: declared.turns.map((turn) => turn.turn_id),
    };
  });
  const reportStreamById = new Map(conversationStreams.map((stream) => [stream.streamId, stream]));
  const turns = summary.turns.map((raw) => {
    const declaredStream = streamById.get(raw.streamId);
    const declaredTurn = declaredStream?.turns.find((turn) => turn.turn_id === raw.turnId);
    const stream = reportStreamById.get(raw.streamId);
    if (!declaredTurn || !stream) throw new Error(`unexpected captured turn ${raw.turnId}`);
    const capturedAt = raw.receivedAt;
    const contextSummary = safeContextSummary(raw.contextSummary, capturedAt);
    const providerCaptureRef = `provider-captures/${raw.turnId}.json`;
    const runtimeStateRef = `runtime-state/${raw.turnId}.json`;
    const correlation = {
      accountId: handoff.ownerUserId,
      sourceRef: stream.sourceProvenance.sourceRef,
      snapshotRef: stream.sourceProvenance.snapshotRef,
      snapshotHash: stream.sourceProvenance.snapshotHash,
      localAgentRef: stream.localAgentIdentity.localAgentRef,
      conversationAnchorId: stream.conversationIdentity.conversationAnchorId,
      threadId: stream.conversationIdentity.threadId,
      turnId: raw.runtimeTurnId,
      requestId: raw.requestId,
      providerId: modelIdentity.providerId,
      modelId: modelIdentity.modelId,
      modelRevisionOrFingerprint: modelIdentity.modelRevisionOrFingerprint,
    };
    const screenshotRefs = [];
    for (const item of turnScreenshotSources(raw, desktopArtifacts, zhiyuArtifacts)) {
      const relative = `screenshots/${raw.turnId}${item.suffix}.png`;
      if (copyArtifact(item.source, path.join(bundleRoot, relative))) screenshotRefs.push(relative);
    }
    const memorySnapshot = {
      capturedAt,
      scope: stream.memoryScope,
      records: raw.memory?.memories || raw.memory?.items || [],
      rawProjection: raw.memory || null,
    };
    const relationshipSnapshot = {
      capturedAt,
      scope: stream.memoryScope,
      activeUserId: raw.inspect?.state?.activeUserId || handoff.ownerUserId,
      records: raw.inspect?.memories || [],
      state: raw.inspect?.state || null,
    };
    const presentationOutput = publicPresentation(raw, capturedAt);
    writeJson(path.join(bundleRoot, providerCaptureRef), {
      schemaVersion: 'nimi.local-agent-provider-visible-turn-capture/v1',
      turnId: raw.turnId,
      currentUserMessage: raw.prompt,
      modelIdentity,
      correlation,
      contextSummary,
      transportFailure: raw.transportFailure || null,
      requestTimestamps: { submittedAt: raw.submittedAt, receivedAt: raw.receivedAt },
    });
    writeJson(path.join(bundleRoot, runtimeStateRef), {
      schemaVersion: 'nimi.local-agent-runtime-turn-state/v1',
      turnId: raw.turnId,
      correlation,
      contextSummary,
      memorySnapshot,
      relationshipSnapshot,
      presentationOutput,
      inspect: raw.inspect || null,
      transcriptMessageCount: raw.transcriptMessageCount,
      transportFailure: raw.transportFailure || null,
      turnPageProblems: raw.turnPageProblems || raw.turnPageErrors || [],
      turnConsoleErrors: raw.turnConsoleErrors || [],
    });
    return {
      turnId: raw.turnId,
      streamId: raw.streamId,
      order: declaredTurn.order,
      surface: declaredTurn.surface,
      continuationRequired: declaredTurn.continuation_required,
      sourceProvenanceRef: `source:${declaredStream.source_provenance.source_kind}`,
      user: { content: raw.prompt, submittedAt: raw.submittedAt },
      assistant: {
        status: raw.transportFailure ? 'transport_failure' : 'completed',
        content: raw.outputText,
        receivedAt: raw.receivedAt,
        transportFailure: raw.transportFailure || null,
      },
      latencyMs: Number(raw.latencyMs || 0),
      correlation,
      contextSummary,
      memorySnapshot,
      relationshipSnapshot,
      presentationOutput,
      providerCaptureRef,
      runtimeStateRef,
      screenshotCheckpoint: Boolean(declaredTurn.screenshot_checkpoint),
      screenshotRefs,
      observationPointIds: declaredTurn.observation_point_ids || [],
    };
  }).sort((left, right) => left.streamId.localeCompare(right.streamId) || left.order - right.order);

  const identityByStream = new Map(conversationStreams.map((stream) => [stream.streamId, stream]));
  const lifecycleEvents = summary.lifecycleEvents.map((event) => {
    const stream = event.streamId ? identityByStream.get(event.streamId) : null;
    return {
      ...event,
      correlation: stream ? {
        localAgentRef: stream.localAgentIdentity.localAgentRef,
        conversationAnchorId: stream.conversationIdentity.conversationAnchorId,
        threadId: stream.conversationIdentity.threadId,
      } : { localAgentRef: null, conversationAnchorId: null, threadId: null },
      artifactRefs: [],
    };
  });
  const processStarts = { ...handoff.processStarts, zhiyu: 1 };
  const processErrors = [
    ...(desktopResult.code === 0 && !desktopResult.signal ? [] : [{ surface: 'desktop', code: desktopResult.code, signal: desktopResult.signal }]),
    ...(zhiyuResult.code === 0 && !zhiyuResult.signal ? [] : [{ surface: 'zhiyu', code: zhiyuResult.code, signal: zhiyuResult.signal }]),
  ];
  const transportFailures = turns
    .filter((turn) => turn.assistant.status === 'transport_failure')
    .map((turn) => ({
      turnId: turn.turnId,
      surface: turn.surface,
      stage: turn.assistant.transportFailure.stage,
      reasonCode: turn.assistant.transportFailure.reasonCode,
      message: turn.assistant.transportFailure.message,
    }));
  const executionStatus = transportFailures.length > 0 ? 'completed_with_transport_failure' : 'completed';
  const privacyCanaryChecks = scenario.streams.flatMap((declared) => declared.turns
    .filter((turn) => turn.privacy_probe === 'cross_agent_isolation')
    .flatMap((turn) => (turn.forbidden_response_canaries || []).map((forbiddenCanary) => {
      const captured = turns.find((row) => row.turnId === turn.turn_id);
      return {
        checkId: `${turn.turn_id}:exact-cross-agent-canary`,
        turnId: turn.turn_id,
        forbiddenCanary,
        leaked: String(captured?.assistant.content || '').includes(forbiddenCanary),
      };
    })));
  const artifacts = [
    ...turns.flatMap((turn) => [turn.providerCaptureRef, turn.runtimeStateRef, ...turn.screenshotRefs]),
  ];
  return {
    schemaVersion: 'nimi.local-agent-conversation-report/v1',
    runId,
    scenarioRegistry: {
      scenarioId: scenario.scenario_id,
      version: 1,
      digest: scenarioDigest,
    },
    sourceState: {
      nimiHead: sourceState.nimiCommit,
      nimiSourceDigest: sourceState.nimiSourceTreeSha256,
      realmHead: sourceState.realmCommit,
      realmSourceDigest: sourceState.realmSourceTreeSha256,
    },
    modelIdentity,
    environmentIdentity: {
      rootId: sha256(`${runId}\0${sourceState.sourceDigest}`),
      ownerAccountId: handoff.ownerUserId,
      runtimeVersion: packageVersion('runtime'),
      desktopVersion: packageVersion('apps/desktop'),
      zhiyuVersion: packageVersion('apps/zhiyu'),
      processStarts,
      materializations: { worldCharacter: 1, realmPersona: 1 },
      fixtureProviderRequestCount,
    },
    execution: {
      status: executionStatus,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
      timeBudgetMs: journey.time_budget_ms,
    },
    conversationStreams,
    turns,
    lifecycleTimeline: {
      timelineId: scenario.lifecycle_timeline.timeline_id,
      kind: scenario.lifecycle_timeline.kind,
      streamIds: scenario.lifecycle_timeline.stream_refs,
      events: lifecycleEvents,
    },
    artifacts: [...new Set(artifacts)].sort(),
    executionFindings: {
      processErrors,
      pageErrors: [
        ...(desktopEvidence.pageErrors || []),
        ...summary.pageProblems.filter((problem) => problem.startsWith('pageerror:')),
      ],
      consoleErrors: [
        ...(desktopEvidence.consoleErrors || []),
        ...summary.pageProblems.filter((problem) => problem.startsWith('console error:')),
      ],
      transportFailures,
      timeBudgetExceeded: durationMs > journey.time_budget_ms,
    },
    privacy: {
      ok: privacyCanaryChecks.every((check) => !check.leaked),
      findings: privacyCanaryChecks.filter((check) => check.leaked).map((check) => `exact_canary_leak:${check.checkId}`),
      canaryChecks: privacyCanaryChecks,
    },
    observationMappings: buildObservationMappings(scenario),
    reviewDimensions: projectConversationReportReviewDimensions(scenario),
    reviewStatus: 'unreviewed',
  };
}

export async function runConversationReportProductTrial({
  runId,
  scenario,
  scenarioDigest,
  journey,
  trial,
  sourceState,
  bundleRoot,
  liveEnv = loadConversationReportEnvironment(),
}) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const handoffPath = path.join(trial.paths.control, 'desktop-handoff.json');
  const releasePath = path.join(trial.paths.control, 'release-desktop');
  const summaryPath = path.join(trial.paths.control, 'zhiyu-conversation-report-summary.json');
  const desktopArtifacts = path.join(trial.paths.artifacts, 'desktop');
  const zhiyuArtifacts = path.join(trial.paths.artifacts, 'zhiyu');
  const providerRawPath = path.join(trial.paths.providerRaw, 'fixture-provider-local-sensitive.json');
  const baseEnv = {
    ...projectConversationReportRuntimeEnvironment(liveEnv),
    ...journeyIdentityEnv(trial),
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_ID: journey.journey_id,
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
    NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_ARTIFACTS_ROOT: zhiyuArtifacts,
    NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_SUMMARY_PATH: summaryPath,
    NIMI_ZHIYU_EVIDENCE_CHECKPOINT: trial.identity.journeyTrialId.replace(/[^a-z0-9-]+/giu, '-'),
  };
  fs.mkdirSync(desktopArtifacts, { recursive: true });
  fs.mkdirSync(zhiyuArtifacts, { recursive: true });
  const desktop = startProcess(process.execPath, [
    path.join(repoRoot, 'apps/desktop/scripts/run-electron-explore-materialization-acceptance.mjs'),
  ], { cwd: repoRoot, env: baseEnv });
  let zhiyu = null;
  let handoff = null;
  let summary = null;
  let zhiyuResult = null;
  let fixtureProviderRequestCount = -1;
  let failure = null;
  try {
    handoff = await Promise.race([
      waitForJsonFile(handoffPath, 900_000),
      desktop.completed.then((result) => { throw new Error(`Desktop exited before conversation report handoff (${result.code ?? result.signal}): ${result.stderr || result.stdout}`); }),
    ]);
    zhiyu = startProcess(process.execPath, [
      '--import', 'tsx', '--test',
      path.join(repoRoot, 'apps/zhiyu/test/e2e/electron-real-local-agent-acceptance.test.mjs'),
    ], { cwd: repoRoot, env: { ...baseEnv, NIMI_LOCAL_AGENT_PRODUCT_TARGET_DISPLAY_NAME: handoff.displayName } });
    zhiyuResult = await Promise.race([
      zhiyu.completed,
      desktop.completed.then((result) => { throw new Error(`Desktop exited before Zhiyu conversation report completed (${result.code ?? result.signal}): ${result.stderr || result.stdout}`); }),
    ]);
    if (zhiyuResult.code !== 0 || zhiyuResult.signal) {
      throw new Error(`Zhiyu conversation report Electron failed (${zhiyuResult.code ?? zhiyuResult.signal}): ${zhiyuResult.stderr || zhiyuResult.stdout}`);
    }
    summary = await waitForJsonFile(summaryPath, 10_000);
    handoff = await waitForJsonFile(handoffPath, 10_000);
    const fixtureResponse = await fetch(`${handoff.providerFixtureBaseUrl}/__fixture/control/manifest`);
    if (!fixtureResponse.ok) throw new Error(`conversation report fixture manifest failed with ${fixtureResponse.status}`);
    const fixtureManifest = await fixtureResponse.json();
    fixtureProviderRequestCount = (fixtureManifest.realmFixture?.providerRequests || []).length;
    if (fixtureProviderRequestCount !== 0) {
      throw new Error(`conversation report used deterministic fixture provider ${fixtureProviderRequestCount} time(s)`);
    }
  } catch (error) {
    failure = error;
  } finally {
    fs.writeFileSync(releasePath, 'released\n');
    if (failure) {
      await terminateProcessTree(zhiyu);
      await terminateProcessTreeAfterGrace(desktop, 10_000);
    }
  }
  const desktopResult = await desktop.completed;
  if (failure) throw failure;
  if (desktopResult.code !== 0 || desktopResult.signal) {
    throw new Error(`Desktop conversation report Electron failed (${desktopResult.code ?? desktopResult.signal}): ${desktopResult.stderr || desktopResult.stdout}`);
  }
  const desktopEvidence = JSON.parse(fs.readFileSync(path.join(desktopArtifacts, 'acceptance-result.json'), 'utf8'));
  const expectedSummaryStatus = conversationReportExecutionStatus(summary.turns);
  if (desktopEvidence.ok !== true || summary.executionStatus !== expectedSummaryStatus) {
    throw new Error('conversation report product subprocess evidence is incomplete');
  }
  const durationMs = Math.round(performance.now() - started);
  const report = buildReport({
    runId,
    sourceState,
    scenario,
    scenarioDigest,
    handoff,
    summary,
    journey,
    bundleRoot,
    desktopArtifacts,
    zhiyuArtifacts,
    startedAt,
    durationMs,
    desktopEvidence,
    desktopResult,
    zhiyuResult,
    fixtureProviderRequestCount,
  });
  writeConversationReportBundle({ bundleRoot, report });
  const scanTargets = allFiles(bundleRoot).filter((file) => path.basename(file) !== 'run-manifest.json');
  const privacyScan = scanArtifactFiles(scanTargets);
  report.privacy.findings.push(...privacyScan.findings);
  report.privacy.findings = [...new Set(report.privacy.findings)];
  report.privacy.ok = report.privacy.findings.length === 0;
  report.privacy.ocr = privacyScan.ocr.map((row) => ({ file: path.relative(bundleRoot, row.file), textLength: row.textLength }));
  writeConversationReportBundle({ bundleRoot, report });
  assertSourceState(sourceState, repoRoot);
  return { bundleRoot, report };
}
