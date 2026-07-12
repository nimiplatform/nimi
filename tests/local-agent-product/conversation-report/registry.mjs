import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import YAML from 'yaml';

import { repoRoot } from '../harness/registry.mjs';

export const conversationScenarioRegistryPath = path.join(
  repoRoot,
  'config',
  'local-agent-product-conversation-scenarios.yaml',
);

const requiredCaptureIds = [
  'context_summary',
  'memory_snapshot',
  'relationship_snapshot',
  'presentation_output',
  'provider_capture',
  'runtime_state',
];
const requiredHumanReviewDimensionIds = [
  'identity-consistency',
  'world-understanding',
  'context-continuity',
  'unknown-handling',
  'privacy-boundary',
  'contradiction-resistance',
  'tone-style',
  'relationship-memory',
  'cross-agent-isolation',
  'restart-continuity',
  'realm-offline-continuity',
  'voice-emotion-apml',
];
const forbiddenSemanticKeys = new Set([
  'semantic_verdict',
  'semantic_outcome',
  'style_score',
  'minimum_passes_per_batch',
  'minimum_average_score',
  'automatic_accepted',
]);
const forbiddenOwnershipKeys = new Set([
  'characterConversationId',
  'personaConversationId',
  'characterThread',
  'personaThread',
  'localAgentRef',
  'conversationAnchorId',
]);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getPath(root, value) {
  return String(value || '').split('.').filter(Boolean).reduce((current, segment) => (
    current == null ? undefined : current[segment]
  ), root);
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

function resolveTemplate(template, truth, inputs) {
  return String(template || '').replace(/\{\{(truth|input)\.([^}]+)\}\}/gu, (_, owner, ref) => {
    const value = getPath(owner === 'truth' ? truth : inputs, ref);
    if (value == null || (typeof value === 'object' && !Array.isArray(value))) {
      throw new Error(`scenario template reference ${owner}.${ref} is not a scalar fixture/input value`);
    }
    return Array.isArray(value) ? value.join(', ') : String(value);
  });
}

export function readConversationScenarioRegistry(filePath = conversationScenarioRegistryPath) {
  return YAML.parse(fs.readFileSync(filePath, 'utf8'));
}

export async function resolveConversationScenarioRegistry(registry) {
  const resolved = structuredClone(registry);
  const projection = resolved.truth_projection;
  const modulePath = path.resolve(repoRoot, projection.module);
  const fixture = await import(pathToFileURL(modulePath).href);
  const truth = fixture[projection.export]();
  for (const scenario of array(resolved.scenarios)) {
    for (const stream of array(scenario.streams)) {
      const sourceExport = stream.source_provenance?.source_ref?.export;
      const sourceRef = fixture[sourceExport];
      if (!sourceRef) throw new Error(`scenario source_ref export ${sourceExport || '<missing>'} is unavailable`);
      stream.source_provenance.source_ref = structuredClone(sourceRef);
      for (const turn of array(stream.turns)) {
        turn.user_message = resolveTemplate(turn.user_message, truth, stream.scenario_inputs);
      }
    }
  }
  return resolved;
}

function validateSourceInputRef(failures, ref, truth, inputs, label) {
  if (ref.startsWith('truth.')) {
    if (truth && getPath(truth, ref.slice('truth.'.length)) === undefined) failures.push(`${label} references absent fixture truth ${ref}`);
    return;
  }
  if (ref.startsWith('absence:truth.')) {
    if (truth && getPath(truth, ref.slice('absence:truth.'.length)) !== undefined) failures.push(`${label} absence assertion is present in fixture truth ${ref}`);
    return;
  }
  if (ref.startsWith('input.')) {
    if (getPath(inputs, ref.slice('input.'.length)) === undefined) failures.push(`${label} references absent scenario input ${ref}`);
    return;
  }
  if (!ref.startsWith('runtime.') && !ref.startsWith('prior_turn.')) failures.push(`${label} has unsupported source_input_ref ${ref}`);
}

export function validateConversationScenarioRegistry(registry, { resolved = false, truth = null } = {}) {
  const failures = [];
  if (registry?.schema_version !== 'nimi.local-agent-conversation-scenarios/v1') failures.push('scenario registry schema_version must be v1');
  if (registry?.authority_class !== 'non_authoritative_execution_manifest') failures.push('scenario registry must remain non-authoritative');
  if (array(registry?.scenarios).length !== 1) failures.push('scenario registry requires exactly one baseline scenario');
  walkKeys(registry, (key) => {
    if (forbiddenSemanticKeys.has(key)) failures.push(`scenario registry contains forbidden semantic automation key ${key}`);
    if (forbiddenOwnershipKeys.has(key)) failures.push(`scenario registry contains source/app-owned or pre-resolved identity key ${key}`);
  });
  const scenario = array(registry?.scenarios)[0];
  if (!scenario) return failures;
  if (scenario.scenario_id !== 'conversation-report-baseline') failures.push('baseline scenario_id must be conversation-report-baseline');
  if (scenario.model_matrix?.selection_owner !== 'runtime_catalog_and_ai_config'
    || scenario.model_matrix?.default_model_count !== 1
    || scenario.model_matrix?.default_repeat_count !== 1
    || scenario.model_matrix?.retry !== 'none') failures.push('baseline model matrix must be Runtime-selected one model/one repeat/no retry');
  if (!Number.isInteger(scenario.time_budget_ms) || scenario.time_budget_ms <= 0) failures.push('baseline time budget must be positive');
  if (JSON.stringify(scenario.environment?.start_limits) !== JSON.stringify({ provider: 1, realm: 1, runtime: 2, desktop: 1, zhiyu: 1 })) failures.push('baseline start limits must describe one environment plus one Runtime restart');
  if (scenario.environment?.materializations?.worldCharacter !== 1 || scenario.environment?.materializations?.realmPersona !== 1) failures.push('baseline must materialize each declared source exactly once');
  if (array(scenario.streams).length !== 2) failures.push('baseline requires exactly two LocalAgent conversation streams');
  const streamIds = new Set();
  const localAliases = new Set();
  const conversationAliases = new Set();
  const sourceKinds = new Set();
  const turnIds = new Set();
  const referencedReviewDimensions = new Set();
  for (const stream of array(scenario.streams)) {
    const label = `stream ${stream?.stream_id || '<missing>'}`;
    if (!text(stream?.stream_id) || streamIds.has(stream.stream_id)) failures.push(`${label} stream_id is missing or duplicate`);
    streamIds.add(stream.stream_id);
    sourceKinds.add(stream?.source_provenance?.source_kind);
    if (!['worldCharacter', 'realmPersona'].includes(stream?.source_provenance?.source_kind)) failures.push(`${label} source_kind is invalid`);
    if (resolved) {
      const sourceRef = stream?.source_provenance?.source_ref;
      if (!text(sourceRef?.sourceId) || !text(sourceRef?.sourceContentHash)) failures.push(`${label} resolved source_ref is incomplete`);
    } else if (stream?.source_provenance?.source_ref?.resolver !== 'fixture_export') failures.push(`${label} source_ref must resolve from admitted fixture truth`);
    if (stream?.source_provenance?.expected_snapshot?.runtime_resolved !== true) failures.push(`${label} snapshot identity must be Runtime-resolved`);
    if (stream?.runtime_resolved_identity?.local_agent_ref !== true || stream?.runtime_resolved_identity?.conversation_anchor_id !== true) failures.push(`${label} LocalAgent/anchor identity must be Runtime-resolved`);
    if (!text(stream.local_agent_alias) || localAliases.has(stream.local_agent_alias)) failures.push(`${label} local_agent_alias is missing or duplicate`);
    localAliases.add(stream.local_agent_alias);
    if (!text(stream.conversation_alias) || conversationAliases.has(stream.conversation_alias)) failures.push(`${label} conversation_alias is missing or duplicate`);
    conversationAliases.add(stream.conversation_alias);
    if (array(stream.turns).length < 9) failures.push(`${label} must contain at least nine continuous turns`);
    const streamTruth = truth ? getPath(truth, stream.source_provenance.truth_path) : null;
    for (const [index, turn] of array(stream.turns).entries()) {
      const turnLabel = `${label}/${turn?.turn_id || index}`;
      if (!text(turn?.turn_id) || turnIds.has(turn.turn_id)) failures.push(`${turnLabel} turn_id is missing or duplicate`);
      turnIds.add(turn.turn_id);
      if (turn.order !== index + 1) failures.push(`${turnLabel} order must be contiguous from one`);
      if (!['desktop', 'zhiyu'].includes(turn.surface)) failures.push(`${turnLabel} surface must be desktop or zhiyu`);
      if (turn.continuation_required !== true) failures.push(`${turnLabel} must continue the Runtime-owned stream`);
      if (!text(turn.user_message)) failures.push(`${turnLabel} user_message is required`);
      if (resolved && /\{\{[^}]+\}\}/u.test(turn.user_message)) failures.push(`${turnLabel} contains unresolved fixture/input tokens`);
      for (const captureId of requiredCaptureIds) if (!array(turn.capture_requirements).includes(captureId)) failures.push(`${turnLabel} missing capture requirement ${captureId}`);
      for (const dimensionId of array(turn.human_review_dimensions)) referencedReviewDimensions.add(dimensionId);
      if (array(turn.source_input_refs).length === 0) failures.push(`${turnLabel} must identify source/runtime inputs`);
      for (const ref of array(turn.source_input_refs)) validateSourceInputRef(failures, ref, truth, stream.scenario_inputs, turnLabel);
      if (turn.privacy_probe === 'relationship_recall' && turn.user_message.includes(String(stream.scenario_inputs?.preferred_name || ''))) failures.push(`${turnLabel} relationship recall repeats its protected canary`);
      if (turn.privacy_probe === 'cross_agent_isolation') {
        if (array(turn.forbidden_response_canaries).length !== 1) failures.push(`${turnLabel} cross-agent probe requires one exact forbidden canary`);
        for (const canary of array(turn.forbidden_response_canaries)) if (turn.user_message.includes(canary)) failures.push(`${turnLabel} cross-agent prompt contains the forbidden response canary`);
      }
      if (streamTruth && !object(streamTruth)) failures.push(`${label} truth_path does not resolve to an object`);
    }
  }
  if (JSON.stringify([...sourceKinds].sort()) !== JSON.stringify(['realmPersona', 'worldCharacter'])) failures.push('baseline streams must cover WorldCharacter and RealmPersona provenance once each');
  const timeline = scenario.lifecycle_timeline;
  if (timeline?.kind !== 'cross_surface_cross_agent_lifecycle_timeline') failures.push('baseline requires one lifecycle/correlation timeline');
  if (Object.hasOwn(timeline || {}, 'turns')) failures.push('lifecycle timeline cannot become a third conversation stream');
  if (array(timeline?.stream_refs).some((streamId) => !streamIds.has(streamId))) failures.push('lifecycle timeline references an unknown stream');
  const eventKinds = array(timeline?.events).map((event) => event.kind);
  if (eventKinds.filter((kind) => kind === 'runtime_restart').length !== 1) failures.push('lifecycle timeline requires exactly one Runtime restart');
  if (eventKinds.filter((kind) => kind === 'realm_offline').length !== 1) failures.push('lifecycle timeline requires exactly one Realm offline transition');
  if (eventKinds.filter((kind) => kind === 'materialization').length !== 2) failures.push('lifecycle timeline requires exactly two source materializations');
  const observationIds = new Set([
    ...array(scenario.streams).flatMap((stream) => array(stream.turns).flatMap((turn) => array(turn.observation_point_ids))),
    ...array(timeline?.events).flatMap((event) => array(event.observation_point_ids)),
    ...array(scenario.report_sections).flatMap((section) => array(section.observation_point_ids)),
  ]);
  if (observationIds.size !== 24 || [...observationIds].some((pointId) => !/^P-/u.test(pointId))) failures.push(`scenario registry must map exactly 24 P observation points, got ${observationIds.size}`);
  const reviewDimensions = array(scenario.review_dimensions);
  const reviewDimensionIds = reviewDimensions.map((dimension) => text(dimension?.dimension_id));
  if (new Set(reviewDimensionIds).size !== reviewDimensionIds.length
    || JSON.stringify([...reviewDimensionIds].sort()) !== JSON.stringify([...requiredHumanReviewDimensionIds].sort())) failures.push('scenario registry must declare the complete unique human review dimension set');
  if (reviewDimensions.some((dimension) => dimension.review_status !== 'unreviewed' || dimension.notes !== '')) failures.push('generated review dimensions must default to unreviewed with empty notes');
  for (const dimensionId of reviewDimensionIds) {
    if (!referencedReviewDimensions.has(dimensionId)) failures.push(`human review dimension ${dimensionId} has no related conversation turn`);
  }
  for (const dimensionId of referencedReviewDimensions) {
    if (!reviewDimensionIds.includes(dimensionId)) failures.push(`turn references undeclared human review dimension ${dimensionId}`);
  }
  return failures;
}
