import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const modelIdentity = Object.freeze({
  providerId: 'runtime-catalog-provider',
  modelId: 'runtime-catalog-model',
  modelRevisionOrFingerprint: 'f'.repeat(64),
  parameters: { temperature: 0.7, maxOutputTokens: 1024 },
});

const pointLocations = Object.freeze({
  'P-01-C': ['stream-a-turn-01'],
  'P-02-C': ['stream-a-turn-02'],
  'P-03-C': ['stream-a-turn-01', 'stream-a-turn-03'],
  'P-04-C': ['stream-a-turn-04'],
  'P-05-CU': ['stream-a-turn-04'],
  'P-05-CC': ['stream-a-turn-05'],
  'P-06-CR': ['stream-a-turn-07'],
  'P-06-CRS': ['stream-a-turn-09'],
  'P-01-P': ['stream-b-turn-01'],
  'P-02-P': ['stream-b-turn-01'],
  'P-03-P': ['stream-b-turn-02', 'stream-b-turn-03'],
  'P-04-P': ['stream-b-turn-04'],
  'P-05-PU': ['stream-b-turn-04'],
  'P-05-PC': ['stream-b-turn-05'],
  'P-06-PR': ['stream-b-turn-07'],
  'P-06-PRS': ['stream-b-turn-09'],
  'P-06-X': ['stream-a-turn-08', 'stream-b-turn-08'],
  'P-07-I': ['review:identity-consistency'],
  'P-07-W': ['review:world-understanding'],
  'P-07-S': ['review:tone-style'],
  'P-07-B': ['review:privacy-boundary'],
  'P-07-U': ['review:unknown-handling'],
  'P-07-R': ['review:relationship-memory'],
  'P-07-X': ['review:cross-agent-isolation'],
});

function sourceProvenance(sourceKind) {
  const suffix = sourceKind === 'worldCharacter' ? 'a' : 'b';
  const sourceRef = sourceKind === 'worldCharacter'
    ? {
        kind: sourceKind,
        id: `source-${suffix}`,
        worldId: `world-${suffix}`,
        worldEntityRef: { kind: 'worldEntity', worldId: `world-${suffix}`, entityId: `entity-${suffix}` },
        sourceHash: suffix.repeat(64),
      }
    : {
        kind: 'personaCharacter',
        id: `source-${suffix}`,
        worldId: `world-${suffix}`,
        ownerAccountId: 'account-baseline',
        sourceHash: suffix.repeat(64),
      };
  return {
    sourceKind,
    sourceRef,
    sourceRevision: sourceKind === 'worldCharacter' ? 7 : 4,
    sourceHash: suffix.repeat(64),
    snapshotRef: `runtime-source-ref-${suffix}`,
    snapshotHash: (sourceKind === 'worldCharacter' ? 'c' : 'd').repeat(64),
    frozenAt: '2026-07-12T00:00:00.000Z',
  };
}

function streamIdentity(alias) {
  const isA = alias === 'local-agent-a';
  const suffix = isA ? 'a' : 'b';
  const sourceKind = isA ? 'worldCharacter' : 'personaCharacter';
  const localAgentRef = `opaque-local-agent-${suffix}`;
  return {
    streamId: `stream-${suffix}`,
    title: isA
      ? 'WorldCharacter-source LocalAgent A 完整多轮对话'
      : 'PersonaCharacter-source LocalAgent B 完整多轮对话',
    sourceProvenance: sourceProvenance(sourceKind),
    localAgentIdentity: { localAgentRef, ownerAccountId: 'account-baseline' },
    conversationIdentity: { conversationAnchorId: `runtime-anchor-${suffix}`, threadId: `runtime-thread-${suffix}`, localAgentRef },
    memoryScope: `agent-dyadic:${localAgentRef}:account-baseline`,
    turnIds: Array.from({ length: 10 }, (_, index) => `stream-${suffix}-turn-${String(index + 1).padStart(2, '0')}`),
  };
}

function turn(stream, order) {
  const turnId = stream.turnIds[order - 1];
  const suffix = stream.streamId.at(-1);
  const surface = suffix === 'a' && order <= 4 ? 'desktop' : 'zhiyu';
  const timestamp = `2026-07-12T00:${String((suffix === 'a' ? 0 : 20) + order).padStart(2, '0')}:00.000Z`;
  const observationPointIds = Object.entries(pointLocations)
    .filter(([, refs]) => refs.includes(turnId))
    .map(([pointId]) => pointId);
  return {
    turnId,
    streamId: stream.streamId,
    order,
    surface,
    continuationRequired: true,
    sourceProvenanceRef: `source:${suffix}`,
    user: { content: `User message ${turnId}`, submittedAt: timestamp },
    assistant: { status: 'completed', content: `Assistant response ${turnId}`, receivedAt: timestamp, transportFailure: null },
    latencyMs: 1000 + order,
    correlation: {
      accountId: 'account-baseline',
      sourceRef: stream.sourceProvenance.sourceRef,
      snapshotRef: stream.sourceProvenance.snapshotRef,
      snapshotHash: stream.sourceProvenance.snapshotHash,
      localAgentRef: stream.localAgentIdentity.localAgentRef,
      conversationAnchorId: stream.conversationIdentity.conversationAnchorId,
      threadId: stream.conversationIdentity.threadId,
      turnId: `runtime-${turnId}`,
      requestId: `request-${turnId}`,
      providerId: modelIdentity.providerId,
      modelId: modelIdentity.modelId,
      modelRevisionOrFingerprint: modelIdentity.modelRevisionOrFingerprint,
    },
    contextSummary: {
      capturedAt: timestamp,
      ready: true,
      promptHash: 'e'.repeat(64),
      lanes: [{ laneId: 'source_identity', state: 'included' }, { laneId: 'conversation_history', state: 'included' }],
    },
    memorySnapshot: { capturedAt: timestamp, scope: stream.memoryScope, records: [] },
    relationshipSnapshot: { capturedAt: timestamp, scope: stream.memoryScope, records: [] },
    presentationOutput: {
      capturedAt: timestamp,
      voice: { observed: false, events: [] },
      emotion: { observed: false, events: [] },
      activity: { observed: false, events: [] },
      apml: { observed: true, structured: { schemaId: 'nimi.apml.message/v1', messageId: `message-${turnId}` } },
      hooks: [],
    },
    providerCaptureRef: `provider-captures/${turnId}.json`,
    runtimeStateRef: `runtime-state/${turnId}.json`,
    screenshotCheckpoint: true,
    screenshotRefs: [`screenshots/${turnId}.png`],
    observationPointIds,
  };
}

export function createValidConversationReport() {
  const streamA = streamIdentity('local-agent-a');
  const streamB = streamIdentity('local-agent-b');
  const turns = [
    ...streamA.turnIds.map((_, index) => turn(streamA, index + 1)),
    ...streamB.turnIds.map((_, index) => turn(streamB, index + 1)),
  ];
  const reviewDimensions = [
    ['identity-consistency', 'Identity consistency', 'P-07-I', ['stream-a-turn-01', 'stream-a-turn-05', 'stream-b-turn-01', 'stream-b-turn-05']],
    ['world-understanding', 'World understanding', 'P-07-W', ['stream-a-turn-02', 'stream-a-turn-05', 'stream-a-turn-10', 'stream-b-turn-01']],
    ['context-continuity', 'Context continuity', null, ['stream-a-turn-03', 'stream-a-turn-05', 'stream-a-turn-06', 'stream-a-turn-09', 'stream-b-turn-03', 'stream-b-turn-09']],
    ['unknown-handling', 'Unknown handling', 'P-07-U', ['stream-a-turn-04', 'stream-b-turn-04']],
    ['privacy-boundary', 'Privacy boundary', 'P-07-B', ['stream-a-turn-04', 'stream-a-turn-08', 'stream-b-turn-04', 'stream-b-turn-08']],
    ['contradiction-resistance', 'Contradiction resistance', null, ['stream-a-turn-05', 'stream-b-turn-05']],
    ['tone-style', 'Tone / style', 'P-07-S', ['stream-a-turn-01', 'stream-a-turn-03', 'stream-b-turn-02', 'stream-b-turn-03', 'stream-b-turn-05', 'stream-b-turn-10']],
    ['relationship-memory', 'Relationship memory', 'P-07-R', ['stream-a-turn-06', 'stream-a-turn-07', 'stream-a-turn-09', 'stream-b-turn-06', 'stream-b-turn-07', 'stream-b-turn-09']],
    ['cross-agent-isolation', 'Cross-agent isolation', 'P-07-X', ['stream-a-turn-08', 'stream-b-turn-08']],
    ['restart-continuity', 'Restart continuity', null, ['stream-a-turn-09', 'stream-b-turn-09']],
    ['realm-offline-continuity', 'Realm offline continuity', null, ['stream-a-turn-10', 'stream-b-turn-10']],
    ['voice-emotion-apml', 'Voice / Emotion / Activity / APML / hook effect', null, ['stream-a-turn-01', 'stream-a-turn-05', 'stream-a-turn-09', 'stream-a-turn-10', 'stream-b-turn-01', 'stream-b-turn-02', 'stream-b-turn-05', 'stream-b-turn-09', 'stream-b-turn-10']],
  ].map(([id, title, pointId, turnRefs]) => ({
    id,
    title,
    turnRefs,
    observationPointIds: pointId ? [pointId] : [],
    reviewStatus: 'unreviewed',
    notes: '',
  }));
  return {
    schemaVersion: 'nimi.local-agent-conversation-report/v1',
    runId: 'conversation-report-test-run',
    scenarioRegistry: { scenarioId: 'conversation-report-baseline', version: 1, digest: '9'.repeat(64) },
    sourceState: {
      nimiHead: '1'.repeat(40),
      nimiSourceDigest: '2'.repeat(64),
      realmHead: '3'.repeat(40),
    },
    modelIdentity,
    environmentIdentity: {
      rootId: 'root-test-run',
      ownerAccountId: 'account-baseline',
      runtimeVersion: 'test-runtime',
      desktopVersion: 'test-desktop',
      zhiyuVersion: 'test-zhiyu',
      processStarts: { provider: 1, realm: 1, runtime: 2, desktop: 1, zhiyu: 1 },
      materializations: { worldCharacter: 1, personaCharacter: 1 },
    },
    execution: {
      status: 'completed',
      startedAt: '2026-07-12T00:00:00.000Z',
      completedAt: '2026-07-12T00:40:00.000Z',
      durationMs: 2_400_000,
      timeBudgetMs: 2_700_000,
    },
    conversationStreams: [streamA, streamB],
    turns,
    lifecycleTimeline: {
      timelineId: 'baseline-lifecycle',
      kind: 'cross_surface_cross_agent_lifecycle_timeline',
      streamIds: [streamA.streamId, streamB.streamId],
      events: [
        ['materialize-local-agent-a', 'materialization', streamA.streamId],
        ['desktop-start-stream-a', 'desktop_conversation_started', streamA.streamId],
        ['continue-stream-a-in-zhiyu', 'desktop_to_zhiyu_continuation', streamA.streamId],
        ['materialize-local-agent-b', 'materialization', streamB.streamId],
        ['switch-to-stream-b', 'agent_switch', streamB.streamId],
        ['switch-back-to-stream-a', 'agent_switch', streamA.streamId],
        ['cross-agent-isolation', 'cross_agent_isolation', null],
        ['runtime-restart', 'runtime_restart', null],
        ['post-restart-stream-a', 'post_restart_turn', streamA.streamId],
        ['post-restart-stream-b', 'post_restart_turn', streamB.streamId],
        ['realm-offline', 'realm_offline', null],
        ['post-offline-stream-a', 'post_offline_turn', streamA.streamId],
        ['post-offline-stream-b', 'post_offline_turn', streamB.streamId],
      ].map(([eventId, kind, streamId], index) => ({
        eventId,
        kind,
        streamId,
        occurredAt: `2026-07-12T00:${String(index + 1).padStart(2, '0')}:30.000Z`,
        correlation: streamId === streamA.streamId
          ? { localAgentRef: streamA.localAgentIdentity.localAgentRef, conversationAnchorId: streamA.conversationIdentity.conversationAnchorId, threadId: streamA.conversationIdentity.threadId }
          : streamId === streamB.streamId
            ? { localAgentRef: streamB.localAgentIdentity.localAgentRef, conversationAnchorId: streamB.conversationIdentity.conversationAnchorId, threadId: streamB.conversationIdentity.threadId }
            : { localAgentRef: null, conversationAnchorId: null, threadId: null },
        artifactRefs: [],
      })),
    },
    artifacts: turns.flatMap((row) => [row.providerCaptureRef, row.runtimeStateRef, ...row.screenshotRefs]),
    executionFindings: {
      processErrors: [],
      pageErrors: [],
      consoleErrors: [],
      transportFailures: [],
      timeBudgetExceeded: false,
    },
    privacy: {
      ok: true,
      findings: [],
      canaryChecks: [
        { checkId: 'stream-a-does-not-leak-stream-b', turnId: 'stream-a-turn-08', forbiddenCanary: 'BLUE_TRACK_TEST_CANARY', leaked: false },
        { checkId: 'stream-b-does-not-leak-stream-a', turnId: 'stream-b-turn-08', forbiddenCanary: 'INK_COVENANT_TEST_CANARY', leaked: false },
      ],
    },
    observationMappings: Object.entries(pointLocations).map(([pointId, refs]) => ({
      pointId,
      locations: refs.map((ref) => ({ kind: ref.startsWith('review:') ? 'report_section' : 'turn', ref })),
    })),
    reviewDimensions,
    reviewStatus: 'unreviewed',
  };
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function writeValidConversationReportBundle(root, report, renderHtml) {
  fs.mkdirSync(root, { recursive: true });
  for (const turnRecord of report.turns) {
    for (const relative of [turnRecord.providerCaptureRef, turnRecord.runtimeStateRef, ...turnRecord.screenshotRefs]) {
      const absolute = path.join(root, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      if (relative.endsWith('.png')) fs.writeFileSync(absolute, Buffer.from('fixture-image'));
      else fs.writeFileSync(absolute, `${JSON.stringify({ turnId: turnRecord.turnId, correlation: turnRecord.correlation }, null, 2)}\n`);
    }
  }
  for (const relative of report.artifacts) {
    const absolute = path.join(root, relative);
    if (fs.existsSync(absolute)) continue;
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (relative.endsWith('.png')) fs.writeFileSync(absolute, Buffer.from('fixture-image'));
    else fs.writeFileSync(absolute, `${JSON.stringify({ orphanedByNegativeFixture: true }, null, 2)}\n`);
  }
  fs.mkdirSync(path.join(root, 'transcripts'), { recursive: true });
  for (const stream of report.conversationStreams) {
    const transcript = {
      schemaVersion: 'nimi.local-agent-conversation-transcript/v1',
      streamId: stream.streamId,
      localAgentRef: stream.localAgentIdentity.localAgentRef,
      conversationAnchorId: stream.conversationIdentity.conversationAnchorId,
      turns: report.turns.filter((row) => row.streamId === stream.streamId).map((row) => ({
        turnId: row.turnId,
        order: row.order,
        surface: row.surface,
        user: row.user,
        assistant: row.assistant,
        correlation: row.correlation,
      })),
    };
    fs.writeFileSync(path.join(root, 'transcripts', `${stream.streamId}.json`), `${JSON.stringify(transcript, null, 2)}\n`);
  }
  fs.writeFileSync(path.join(root, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'report.html'), renderHtml(report));
  const files = [];
  for (const relative of [
    'report.json', 'report.html',
    ...report.conversationStreams.map((stream) => `transcripts/${stream.streamId}.json`),
    ...report.artifacts,
  ]) {
    const absolute = path.join(root, relative);
    files.push({ path: relative, sha256: sha256(absolute), bytes: fs.statSync(absolute).size });
  }
  const manifest = {
    schemaVersion: 'nimi.local-agent-conversation-run-manifest/v1',
    runId: report.runId,
    scenarioId: report.scenarioRegistry.scenarioId,
    processStarts: report.environmentIdentity.processStarts,
    materializations: report.environmentIdentity.materializations,
    noRetry: true,
    modelCount: 1,
    repeatCount: 1,
    files,
  };
  fs.writeFileSync(path.join(root, 'run-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { report, manifest };
}
