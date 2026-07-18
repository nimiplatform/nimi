import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';

import { readTestPointCatalog, repoRoot } from '../harness/registry.mjs';
import {
  readConversationScenarioRegistry,
  validateConversationScenarioRegistry,
} from './registry.mjs';

const expectedProcessStarts = Object.freeze({ provider: 1, realm: 1, runtime: 2, desktop: 1, zhiyu: 1 });
const expectedMaterializations = Object.freeze({ worldCharacter: 1, personaCharacter: 1 });
const forbiddenReportKeys = new Set([
  'semanticVerdict',
  'semanticScore',
  'styleScore',
  'averageStyleScore',
  'minimumPassesPerBatch',
  'automaticAccepted',
  'characterConversationId',
  'personaConversationId',
  'characterThread',
  'personaThread',
  'realmPersona',
  'realm_persona',
  'sourceId',
  'source_id',
  'sourceContentHash',
  'source_content_hash',
]);
const sha256Pattern = /^[a-f0-9]{64}$/u;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasExactKeys(value, expected) {
  return object(value)
    && same(Object.keys(value).sort(), [...expected].sort());
}

function validateCharacterSourceRefV3(value, expectedKind, failures, label) {
  if (!object(value)) {
    failures.push(`${label}: CharacterSourceRefV3 must be an object`);
    return false;
  }
  const kind = value.kind;
  if (kind !== expectedKind || !['worldCharacter', 'personaCharacter'].includes(kind)) {
    failures.push(`${label}: CharacterSourceRefV3 kind must equal sourceKind`);
    return false;
  }
  const commonValid = text(value.id)
    && text(value.worldId)
    && sha256Pattern.test(String(value.sourceHash || ''));
  if (!commonValid) failures.push(`${label}: CharacterSourceRefV3 id/worldId/sourceHash is invalid`);

  if (kind === 'worldCharacter') {
    if (!hasExactKeys(value, ['kind', 'id', 'worldId', 'worldEntityRef', 'sourceHash'])) {
      failures.push(`${label}: WorldCharacterSourceRefV3 has missing or additional fields`);
    }
    const entityRef = value.worldEntityRef;
    if (!hasExactKeys(entityRef, ['kind', 'worldId', 'entityId'])
      || entityRef?.kind !== 'worldEntity'
      || !text(entityRef?.entityId)
      || entityRef?.worldId !== value.worldId) {
      failures.push(`${label}: WorldCharacterSourceRefV3 worldEntityRef/worldId binding is invalid`);
    }
  } else {
    if (!hasExactKeys(value, ['kind', 'id', 'worldId', 'ownerAccountId', 'sourceHash'])) {
      failures.push(`${label}: PersonaCharacterSourceRefV3 has missing or additional fields`);
    }
    if (!text(value.ownerAccountId)) {
      failures.push(`${label}: PersonaCharacterSourceRefV3 ownerAccountId is missing`);
    }
  }
  return Boolean(commonValid);
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file, failures, label) {
  if (!fs.existsSync(file)) {
    failures.push(`missing ${label} ${file}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    failures.push(`invalid ${label} JSON ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function walkKeys(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, visit);
    return;
  }
  if (!object(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    visit(key, nested);
    walkKeys(nested, visit);
  }
}

function resolveBundleFile(bundleRoot, relative, failures, label) {
  if (!text(relative)) {
    failures.push(`${label} path is missing`);
    return null;
  }
  const root = path.resolve(bundleRoot);
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${root}${path.sep}`)) {
    failures.push(`${label} escapes the report bundle: ${relative}`);
    return null;
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    failures.push(`missing ${label}: ${relative}`);
    return null;
  }
  return absolute;
}

function validateManifest(bundleRoot, report, failures) {
  const manifestPath = path.join(bundleRoot, 'run-manifest.json');
  const manifest = readJson(manifestPath, failures, 'run manifest');
  if (!manifest) return null;
  if (manifest.schemaVersion !== 'nimi.local-agent-conversation-run-manifest/v1') failures.push('run manifest schemaVersion must be v1');
  if (manifest.runId !== report?.runId || manifest.scenarioId !== report?.scenarioRegistry?.scenarioId) failures.push('run manifest/report identity drift');
  if (manifest.noRetry !== true || manifest.modelCount !== 1 || manifest.repeatCount !== 1) failures.push('baseline run manifest must declare one model/one repeat/no retry');
  if (!same(manifest.processStarts, expectedProcessStarts) || !same(manifest.materializations, expectedMaterializations)) failures.push('run manifest process start/materialization counts violate one baseline environment');
  const seen = new Set();
  for (const file of array(manifest.files)) {
    if (!text(file?.path) || seen.has(file.path)) {
      failures.push(`run manifest file path is missing or duplicate: ${file?.path || '<missing>'}`);
      continue;
    }
    seen.add(file.path);
    const absolute = resolveBundleFile(bundleRoot, file.path, failures, 'manifest artifact');
    if (!absolute) continue;
    if (sha256(absolute) !== file.sha256 || fs.statSync(absolute).size !== file.bytes) failures.push(`manifest artifact hash/size drift: ${file.path}`);
  }
  for (const required of [
    'report.html',
    'report.json',
    ...array(report?.conversationStreams).map((stream) => `transcripts/${stream.streamId}.json`),
  ]) {
    if (!seen.has(required)) failures.push(`run manifest missing required file ${required}`);
  }
  return manifest;
}

function validateLocalHtmlLinks(bundleRoot, failures) {
  const htmlPath = path.join(bundleRoot, 'report.html');
  if (!fs.existsSync(htmlPath)) {
    failures.push('missing report.html');
    return;
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const links = [...html.matchAll(/(?:href|src)="([^"]+)"/gu)].map((match) => match[1]);
  for (const ref of links) {
    if (!ref || ref.startsWith('#') || ref.startsWith('data:') || /^[a-z]+:\/\//iu.test(ref)) continue;
    resolveBundleFile(bundleRoot, ref, failures, 'report.html local link');
  }
}

function expectedObservationIds() {
  const catalog = readTestPointCatalog();
  const points = array(catalog.points);
  return points.filter((point) => point.point_kind === 'behavior_observation_point').map((point) => point.point_id).sort();
}

function validateObservationMappings(report, turnIds, eventIds, failures) {
  const mappings = array(report.observationMappings);
  const expected = expectedObservationIds();
  const actual = mappings.map((mapping) => text(mapping?.pointId)).sort();
  if (mappings.length !== 24 || new Set(actual).size !== 24 || !same(actual, expected)) failures.push(`report must contain exactly 24 mapped behavior observation points, got ${new Set(actual).size}`);
  const reviewSections = new Set(array(report.reviewDimensions).map((dimension) => `review:${dimension.id}`));
  for (const mapping of mappings) {
    if (Object.hasOwn(mapping || {}, 'outcome') || Object.hasOwn(mapping || {}, 'status') || Object.hasOwn(mapping || {}, 'passed')) failures.push(`${mapping?.pointId}: observation mapping cannot carry semantic outcome/status`);
    if (array(mapping?.locations).length === 0) failures.push(`${mapping?.pointId}: observation mapping has no report location`);
    for (const location of array(mapping?.locations)) {
      if (location.kind === 'turn' && !turnIds.has(location.ref)) failures.push(`${mapping?.pointId}: observation turn mapping is missing ${location.ref}`);
      else if (location.kind === 'lifecycle_event' && !eventIds.has(location.ref)) failures.push(`${mapping?.pointId}: observation lifecycle mapping is missing ${location.ref}`);
      else if (location.kind === 'report_section' && !reviewSections.has(location.ref)) failures.push(`${mapping?.pointId}: observation report section is missing ${location.ref}`);
      else if (!['turn', 'lifecycle_event', 'report_section'].includes(location.kind)) failures.push(`${mapping?.pointId}: invalid observation location kind ${location.kind}`);
    }
  }
}

function validateTranscript(bundleRoot, stream, reportTurns, failures) {
  const file = path.join(bundleRoot, 'transcripts', `${stream.streamId}.json`);
  const transcript = readJson(file, failures, `${stream.streamId} transcript`);
  if (!transcript) return;
  if (transcript.schemaVersion !== 'nimi.local-agent-conversation-transcript/v1'
    || transcript.streamId !== stream.streamId
    || transcript.localAgentRef !== stream.localAgentIdentity?.localAgentRef
    || transcript.conversationAnchorId !== stream.conversationIdentity?.conversationAnchorId) failures.push(`${stream.streamId} transcript identity drift`);
  const expectedTurns = reportTurns.map((row) => ({
    turnId: row.turnId,
    order: row.order,
    surface: row.surface,
    user: row.user,
    assistant: row.assistant,
    correlation: row.correlation,
  }));
  if (!same(transcript.turns, expectedTurns)) failures.push(`${stream.streamId} raw transcript/report turn drift`);
}

function validateTurn(turn, stream, bundleRoot, failures) {
  const label = turn?.turnId || '<missing-turn>';
  if (!text(turn?.user?.content) || !text(turn?.user?.submittedAt)) failures.push(`${label}: user input/timestamp is missing`);
  const hasResponse = turn?.assistant?.status === 'completed' && text(turn?.assistant?.content) && text(turn?.assistant?.receivedAt);
  const hasTransportFailure = turn?.assistant?.status === 'transport_failure'
    && object(turn?.assistant?.transportFailure)
    && text(turn.assistant.transportFailure.reasonCode)
    && text(turn.assistant.transportFailure.message)
    && text(turn?.assistant?.receivedAt);
  if (!hasResponse && !hasTransportFailure) failures.push(`${label}: every turn requires an assistant response or explicit transport failure`);
  const transportStage = turn?.assistant?.transportFailure?.stage;
  const runtimeTurnId = text(turn?.correlation?.turnId);
  if (hasResponse && !runtimeTurnId) failures.push(`${label}: completed response requires a current Runtime turn id`);
  if (hasTransportFailure && transportStage === 'runtime_turn' && !runtimeTurnId) failures.push(`${label}: Runtime-turn transport failure requires its current Runtime turn id`);
  if (hasTransportFailure && transportStage === 'before_runtime_turn' && runtimeTurnId) failures.push(`${label}: failure before Runtime turn reservation must not carry a Runtime turnId`);
  if (hasTransportFailure && !['before_runtime_turn', 'runtime_turn'].includes(transportStage)) failures.push(`${label}: transport failure stage is missing or invalid`);
  if (!['desktop', 'zhiyu'].includes(turn?.surface)) failures.push(`${label}: surface must be Desktop or Zhiyu`);
  if (turn?.continuationRequired !== true) failures.push(`${label}: continuation requirement must be explicit`);
  const correlation = turn?.correlation;
  if (!hasExactKeys(correlation, [
    'accountId',
    'sourceRef',
    'snapshotRef',
    'snapshotHash',
    'localAgentRef',
    'conversationAnchorId',
    'threadId',
    'turnId',
    'requestId',
    'providerId',
    'modelId',
    'modelRevisionOrFingerprint',
  ])) failures.push(`${label}: turn correlation has missing or additional transport/source identity fields`);
  for (const field of ['accountId', 'snapshotRef', 'snapshotHash', 'localAgentRef', 'conversationAnchorId', 'threadId', 'providerId', 'modelId', 'modelRevisionOrFingerprint']) {
    if (!text(correlation?.[field])) failures.push(`${label}: correlation/model revision field ${field} is missing`);
  }
  validateCharacterSourceRefV3(
    correlation?.sourceRef,
    stream.sourceProvenance?.sourceKind,
    failures,
    `${label} correlation`,
  );
  if (correlation?.accountId !== stream.localAgentIdentity?.ownerAccountId
    || correlation?.localAgentRef !== stream.localAgentIdentity?.localAgentRef
    || correlation?.conversationAnchorId !== stream.conversationIdentity?.conversationAnchorId
    || correlation?.threadId !== stream.conversationIdentity?.threadId
    || !same(correlation?.sourceRef, stream.sourceProvenance?.sourceRef)
    || correlation?.snapshotRef !== stream.sourceProvenance?.snapshotRef
    || correlation?.snapshotHash !== stream.sourceProvenance?.snapshotHash) failures.push(`${label}: account/source/snapshot/LocalAgent/conversation correlation drift`);
  if (!Number.isInteger(turn?.latencyMs) || turn.latencyMs < 0) failures.push(`${label}: latency is invalid`);
  if (!object(turn?.contextSummary) || !text(turn.contextSummary.capturedAt) || !Array.isArray(turn.contextSummary.lanes)) failures.push(`${label}: context summary capture is missing`);
  if (!object(turn?.memorySnapshot) || !text(turn.memorySnapshot.capturedAt) || turn.memorySnapshot.scope !== stream.memoryScope) failures.push(`${label}: agent-scoped memory snapshot is missing or mis-correlated`);
  if (!object(turn?.relationshipSnapshot) || !text(turn.relationshipSnapshot.capturedAt) || turn.relationshipSnapshot.scope !== stream.memoryScope) failures.push(`${label}: dyadic relationship snapshot is missing or mis-correlated`);
  const presentation = turn?.presentationOutput;
  if (!object(presentation) || !text(presentation.capturedAt)) failures.push(`${label}: presentation output capture is missing`);
  for (const field of ['voice', 'emotion', 'activity', 'apml', 'hooks']) if (!Object.hasOwn(presentation || {}, field)) failures.push(`${label}: presentation capture ${field} is missing`);
  resolveBundleFile(bundleRoot, turn?.providerCaptureRef, failures, `${label} provider capture`);
  resolveBundleFile(bundleRoot, turn?.runtimeStateRef, failures, `${label} Runtime state`);
  if (turn?.screenshotCheckpoint === true && array(turn?.screenshotRefs).length === 0) {
    failures.push(`${label}: declared screenshot checkpoint/artifact is missing`);
  }
  for (const screenshot of array(turn?.screenshotRefs)) resolveBundleFile(bundleRoot, screenshot, failures, `${label} screenshot`);
}

function validateExecutionFindings(report, turnMap, failures) {
  const findings = array(report?.executionFindings?.transportFailures);
  const failedTurns = array(report?.turns).filter((turn) => turn?.assistant?.status === 'transport_failure');
  const expectedStatus = failedTurns.length > 0 ? 'completed_with_transport_failure' : 'completed';
  if (report?.execution?.status !== expectedStatus) failures.push('execution status does not match captured transport failures');
  if (findings.length !== failedTurns.length) failures.push('transport failure finding count does not match failed turns');
  const findingByTurn = new Map();
  for (const finding of findings) {
    if (!text(finding?.turnId) || findingByTurn.has(finding.turnId)) {
      failures.push('transport failure finding turn correlation is missing or duplicate');
      continue;
    }
    findingByTurn.set(finding.turnId, finding);
    const turn = turnMap.get(finding.turnId);
    if (!turn
      || finding.surface !== turn.surface
      || finding.stage !== turn.assistant?.transportFailure?.stage
      || finding.reasonCode !== turn.assistant?.transportFailure?.reasonCode
      || finding.message !== turn.assistant?.transportFailure?.message) {
      failures.push(`${finding.turnId}: transport failure finding/turn correlation drift`);
    }
  }
  for (const turn of failedTurns) {
    if (!findingByTurn.has(turn.turnId)) failures.push(`${turn.turnId}: transport failure finding is missing`);
  }
}

function validateLifecycle(report, streamMap, failures) {
  const timeline = report?.lifecycleTimeline;
  if (timeline?.kind !== 'cross_surface_cross_agent_lifecycle_timeline') failures.push('report requires one cross-surface/cross-agent/lifecycle timeline');
  if (Object.hasOwn(timeline || {}, 'turns')) failures.push('lifecycle timeline cannot become a third conversation stream');
  const events = array(timeline?.events);
  const kinds = events.map((event) => event.kind);
  if (kinds.filter((kind) => kind === 'materialization').length !== 2) failures.push('lifecycle timeline must record two one-time materializations');
  if (kinds.filter((kind) => kind === 'runtime_restart').length !== 1) failures.push('lifecycle timeline must record exactly one Runtime restart');
  if (kinds.filter((kind) => kind === 'realm_offline').length !== 1) failures.push('lifecycle timeline must record exactly one Realm offline transition');
  for (const required of ['desktop_to_zhiyu_continuation', 'agent_switch', 'cross_agent_isolation', 'post_restart_turn', 'post_offline_turn']) {
    if (!kinds.includes(required)) failures.push(`lifecycle timeline missing ${required}`);
  }
  const eventIds = new Set();
  for (const [index, event] of events.entries()) {
    if (!text(event?.eventId) || eventIds.has(event.eventId)) failures.push(`lifecycle event ID is missing or duplicate: ${event?.eventId || '<missing>'}`);
    eventIds.add(event.eventId);
    if (!text(event?.occurredAt) || !Number.isFinite(Date.parse(event.occurredAt))) failures.push(`${event?.eventId}: lifecycle timestamp is invalid`);
    if (event.streamId) {
      const stream = streamMap.get(event.streamId);
      if (!stream) failures.push(`${event.eventId}: lifecycle event references unknown stream ${event.streamId}`);
      else if (event.correlation?.localAgentRef !== stream.localAgentIdentity.localAgentRef
        || event.correlation?.conversationAnchorId !== stream.conversationIdentity.conversationAnchorId
        || event.correlation?.threadId !== stream.conversationIdentity.threadId) failures.push(`${event.eventId}: lifecycle LocalAgent/conversation correlation drift`);
    }
    if (index > 0 && Date.parse(event.occurredAt) < Date.parse(events[index - 1].occurredAt)) failures.push(`${event.eventId}: lifecycle order is not chronological`);
  }
  return eventIds;
}

function validatePrivacy(report, turnMap, failures) {
  const findings = array(report?.privacy?.findings);
  if (report?.privacy?.ok !== (findings.length === 0)) failures.push('privacy ok/findings projection is inconsistent');
  for (const check of array(report?.privacy?.canaryChecks)) {
    const turn = turnMap.get(check?.turnId);
    if (!turn || !text(check?.forbiddenCanary)) {
      failures.push(`${check?.checkId || '<canary-check>'}: exact canary check correlation is incomplete`);
      continue;
    }
    const leaked = String(turn.assistant?.content || '').includes(check.forbiddenCanary);
    if (leaked !== check.leaked) failures.push(`${check.checkId}: exact cross-agent canary leakage result is inaccurate`);
    if (leaked) failures.push(`${check.checkId}: cross-agent canary leaked from LocalAgent-scoped memory`);
  }
}

function validateReviewDimensions(report, turnMap, failures) {
  const dimensions = array(report?.reviewDimensions);
  const registry = readConversationScenarioRegistry();
  const scenario = array(registry?.scenarios).find((candidate) => candidate?.scenario_id === report?.scenarioRegistry?.scenarioId);
  const expectedIds = array(scenario?.review_dimensions).map((dimension) => text(dimension?.dimension_id)).sort();
  const actualIds = dimensions.map((dimension) => text(dimension?.id)).sort();
  if (!same(actualIds, expectedIds) || new Set(actualIds).size !== actualIds.length) {
    failures.push('report human review dimensions are missing, duplicated, or drifted from the scenario registry');
  }
  for (const dimension of dimensions) {
    const refs = array(dimension?.turnRefs);
    if (refs.length === 0) failures.push(`${dimension?.id || '<review-dimension>'}: human review dimension has no related turn/raw response`);
    if (new Set(refs).size !== refs.length) failures.push(`${dimension?.id || '<review-dimension>'}: human review turn links are duplicated`);
    for (const turnId of refs) {
      if (!turnMap.has(turnId)) failures.push(`${dimension?.id || '<review-dimension>'}: human review references missing turn ${turnId}`);
    }
  }
}

export function validateConversationReportBundle({ bundleRoot }) {
  const failures = [];
  const root = path.resolve(bundleRoot || '');
  const report = readJson(path.join(root, 'report.json'), failures, 'report');
  if (!report) return { failures, report: null, manifest: null };
  if (report.schemaVersion !== 'nimi.local-agent-conversation-report/v1') failures.push('report schemaVersion must be v1');
  walkKeys(report, (key) => {
    if (forbiddenReportKeys.has(key)) failures.push(`report contains forbidden semantic/source-owned truth key ${key}`);
  });
  if (report.reviewStatus !== 'unreviewed') failures.push('generated report reviewStatus must be unreviewed');
  if (array(report.reviewDimensions).some((dimension) => dimension.reviewStatus !== 'unreviewed' || dimension.notes !== '')) failures.push('every generated semantic review dimension must be unreviewed with empty notes');
  if (!text(report.modelIdentity?.providerId) || !text(report.modelIdentity?.modelId) || !text(report.modelIdentity?.modelRevisionOrFingerprint) || !object(report.modelIdentity?.parameters)) failures.push('report provider/model/revision/parameters identity is incomplete');
  if (!same(report.environmentIdentity?.processStarts, expectedProcessStarts)) failures.push('process start counts violate one baseline environment');
  if (!same(report.environmentIdentity?.materializations, expectedMaterializations)) failures.push('each declared Realm source must materialize exactly once');
  if (!Number.isInteger(report.execution?.durationMs) || !Number.isInteger(report.execution?.timeBudgetMs) || report.execution.durationMs < 0 || report.execution.durationMs > report.execution.timeBudgetMs) failures.push('baseline execution exceeded or omitted its time budget');
  for (const field of ['processErrors', 'pageErrors', 'consoleErrors', 'transportFailures']) {
    if (!Array.isArray(report.executionFindings?.[field])) failures.push(`execution findings ${field} must be recorded`);
  }
  if (report.executionFindings?.timeBudgetExceeded !== (report.execution.durationMs > report.execution.timeBudgetMs)) failures.push('time budget finding is inaccurate');

  const streams = array(report.conversationStreams);
  if (streams.length !== 2) failures.push(`report requires exactly two Runtime-owned LocalAgent conversation streams, got ${streams.length}`);
  const streamMap = new Map();
  const localAgentRefs = new Set();
  const anchorIds = new Set();
  const memoryScopes = new Set();
  const threadIds = new Set();
  const sourceKinds = new Set();
  for (const stream of streams) {
    if (!text(stream?.streamId) || streamMap.has(stream.streamId)) failures.push(`stream ID is missing or duplicate: ${stream?.streamId || '<missing>'}`);
    streamMap.set(stream.streamId, stream);
    const source = stream?.sourceProvenance;
    if (!hasExactKeys(source, [
      'sourceKind',
      'sourceRef',
      'sourceRevision',
      'sourceHash',
      'snapshotRef',
      'snapshotHash',
      'frozenAt',
    ])) failures.push(`${stream?.streamId}: source provenance has missing or additional fields`);
    if (!['worldCharacter', 'personaCharacter'].includes(source?.sourceKind)
      || !text(source?.snapshotRef)
      || !sha256Pattern.test(String(source?.snapshotHash || ''))
      || !sha256Pattern.test(String(source?.sourceHash || ''))) {
      failures.push(`${stream?.streamId}: source provenance/frozen snapshot is incomplete`);
    }
    validateCharacterSourceRefV3(
      source?.sourceRef,
      source?.sourceKind,
      failures,
      `${stream?.streamId} source provenance`,
    );
    if (source?.sourceHash !== source?.sourceRef?.sourceHash) {
      failures.push(`${stream?.streamId}: provenance sourceHash drifted from CharacterSourceRefV3`);
    }
    sourceKinds.add(source?.sourceKind);
    const localAgentRef = text(stream?.localAgentIdentity?.localAgentRef);
    const anchorId = text(stream?.conversationIdentity?.conversationAnchorId);
    const threadId = text(stream?.conversationIdentity?.threadId);
    if (!localAgentRef || stream?.conversationIdentity?.localAgentRef !== localAgentRef) failures.push(`${stream?.streamId}: opaque LocalAgent/conversation identity is incomplete`);
    if (!anchorId) failures.push(`${stream?.streamId}: Runtime-owned conversationAnchorId is missing`);
    if (!threadId) failures.push(`${stream?.streamId}: Runtime-owned conversation threadId is missing`);
    localAgentRefs.add(localAgentRef);
    anchorIds.add(anchorId);
    threadIds.add(threadId);
    memoryScopes.add(text(stream?.memoryScope));
    if (array(stream?.turnIds).length < 9) failures.push(`${stream?.streamId}: continuous stream requires at least nine declared turns`);
  }
  if (localAgentRefs.size !== 2) failures.push('the two streams require distinct localAgentRef identities; identity collision detected');
  if (anchorIds.size !== 2) failures.push('the two streams require distinct conversationAnchorId identities; anchor collision detected');
  if (threadIds.size !== 2 || threadIds.has('')) failures.push('the two streams require distinct Runtime-owned conversation thread identities');
  if (memoryScopes.size !== 2 || memoryScopes.has('')) failures.push('the two streams require distinct non-empty agent/dyadic memory scopes');
  if (!same([...sourceKinds].sort(), ['personaCharacter', 'worldCharacter'])) failures.push('WorldCharacter/PersonaCharacter may appear only as the two source provenance kinds');
  if (new Set(streams.map((stream) => stream.localAgentIdentity?.ownerAccountId)).size !== 1) failures.push('both LocalAgents must share one baseline account');

  const turnMap = new Map();
  const runtimeTurnIds = new Set();
  const requestIds = new Set();
  for (const stream of streams) {
    const streamTurns = array(report.turns).filter((turn) => turn.streamId === stream.streamId);
    if (!same(streamTurns.map((turn) => turn.turnId), stream.turnIds)) failures.push(`${stream.streamId}: missing declared turn or stream turn count/order drift`);
    if (!same(streamTurns.map((turn) => turn.order), streamTurns.map((_, index) => index + 1))) failures.push(`${stream.streamId}: turn order is not contiguous/chronological`);
    for (const turn of streamTurns) {
      if (!text(turn.turnId) || turnMap.has(turn.turnId)) failures.push(`turn ID is missing or duplicate: ${turn.turnId || '<missing>'}`);
      turnMap.set(turn.turnId, turn);
      validateTurn(turn, stream, root, failures);
      const runtimeTurnId = text(turn.correlation?.turnId);
      if (runtimeTurnId && runtimeTurnIds.has(runtimeTurnId)) failures.push(`${turn.turnId}: Runtime turn correlation is reused or duplicate (${runtimeTurnId})`);
      if (runtimeTurnId) runtimeTurnIds.add(runtimeTurnId);
      const requestId = text(turn.correlation?.requestId);
      if (requestId && requestIds.has(requestId)) failures.push(`${turn.turnId}: request correlation is reused or duplicate (${requestId})`);
      if (requestId) requestIds.add(requestId);
      if (turn.correlation?.providerId !== report.modelIdentity?.providerId
        || turn.correlation?.modelId !== report.modelIdentity?.modelId
        || turn.correlation?.modelRevisionOrFingerprint !== report.modelIdentity?.modelRevisionOrFingerprint) failures.push(`${turn.turnId}: turn model correlation drifted from the run identity`);
    }
    validateTranscript(root, stream, streamTurns, failures);
  }
  if (turnMap.size !== array(report.turns).length) failures.push('report has orphan or duplicate turns');
  validateReviewDimensions(report, turnMap, failures);
  validateExecutionFindings(report, turnMap, failures);
  const worldStream = streams.find((stream) => stream.sourceProvenance?.sourceKind === 'worldCharacter');
  const worldTurns = array(report.turns).filter((turn) => turn.streamId === worldStream?.streamId);
  const firstZhiyu = worldTurns.findIndex((turn) => turn.surface === 'zhiyu');
  if (firstZhiyu <= 0 || worldTurns.slice(0, firstZhiyu).some((turn) => turn.surface !== 'desktop')
    || worldTurns.slice(firstZhiyu).some((turn) => turn.correlation?.localAgentRef !== worldStream?.localAgentIdentity?.localAgentRef
      || turn.correlation?.conversationAnchorId !== worldStream?.conversationIdentity?.conversationAnchorId)) failures.push('Desktop → Zhiyu continuation did not preserve the same LocalAgent stream/anchor correlation');
  if (!array(report.turns).some((turn) => turn.streamId !== worldStream?.streamId && turn.surface === 'zhiyu')) failures.push('Zhiyu did not execute the second LocalAgent stream');

  const eventIds = validateLifecycle(report, streamMap, failures);
  validateObservationMappings(report, new Set(turnMap.keys()), eventIds, failures);
  validatePrivacy(report, turnMap, failures);
  for (const relative of array(report.artifacts)) resolveBundleFile(root, relative, failures, 'report artifact');
  validateLocalHtmlLinks(root, failures);
  const manifest = validateManifest(root, report, failures);
  return { failures: [...new Set(failures)], report, manifest };
}

function loadArchitecture() {
  return {
    packageScripts: JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts,
    executionPolicy: YAML.parse(fs.readFileSync(path.join(repoRoot, 'config', 'local-agent-product-execution-policy.yaml'), 'utf8')),
    scenarioRegistry: readConversationScenarioRegistry(),
  };
}

export function validateConversationReportArchitecture(input = null) {
  const architecture = input || loadArchitecture();
  const failures = [];
  const scripts = architecture.packageScripts || {};
  if (Object.hasOwn(scripts, 'test:e2e:local-agent-product:live-behavior')
    || Object.hasOwn(scripts, 'check:local-agent-live-behavior')) failures.push('old live behavior required path/runner is still registered');
  if (Object.hasOwn(scripts, 'test:e2e:local-agent-conversation-report')) failures.push('retired direct-daemon conversation report execution command is still registered');
  if (scripts['check:local-agent-conversation-report'] !== 'node scripts/check-local-agent-conversation-report.mjs') failures.push('conversation report checker command is missing or drifted');
  const activePolicy = structuredClone(architecture.executionPolicy || {});
  delete activePolicy.forbidden_active_paths;
  const serializedPolicy = JSON.stringify(activePolicy);
  if (/live_behavior|live-behavior|calibration|minimum_passes|product_journey_repeats_per_batch|"batches":2|two_batches|2x10/iu.test(serializedPolicy)) failures.push('old 2x10/calibration live behavior policy remains in an active or required path');
  if (Object.hasOwn(architecture.executionPolicy?.gates || {}, 'conversation_report')) failures.push('retired conversation report remains an executable gate');
  if (Object.hasOwn(architecture.executionPolicy?.repeat_policies || {}, 'conversation_report')) failures.push('retired conversation report remains an executable repeat policy');
  if (array(architecture.executionPolicy?.suites).some((suite) => suite?.suite_id === 'conversation-report-i8')) failures.push('retired conversation report remains an executable suite');
  if (array(architecture.executionPolicy?.required_local_pr_composition).includes('conversation_report')) failures.push('retired conversation report entered the ordinary required regression composition');
  const registryFailures = validateConversationScenarioRegistry(architecture.scenarioRegistry || {});
  failures.push(...registryFailures);
  const serializedRegistry = JSON.stringify(architecture.scenarioRegistry || {});
  if (/characterConversationId|personaConversationId|characterThread|personaThread/iu.test(serializedRegistry)) failures.push('source-owned Character/Persona conversation identity is forbidden');
  return [...new Set(failures)];
}
