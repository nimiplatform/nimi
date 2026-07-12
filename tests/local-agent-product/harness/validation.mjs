import { createHash } from 'node:crypto';
import fs from 'node:fs';

const layerIds = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
const journeyOutcomeIds = ['passed', 'failed', 'blocked_by_failed_prerequisite'];
const oldSchedulingFields = ['tiers', 'runner', 'fixture_profile', 'selectors', 'artifact_ids', 'credential_class', 'owner_test_file', 'registrations', 'repeats'];
const requiredProviderLaneIds = [
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
const logicalIdentityFields = ['accountIds', 'worldIds', 'sourceIds', 'runtimeSourceRefs', 'localAgentIds'];

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function sameSet(left, right) {
  const a = [...new Set(array(left).map(String))].sort();
  const b = [...new Set(array(right).map(String))].sort();
  return a.length === array(left).length && b.length === array(right).length && JSON.stringify(a) === JSON.stringify(b);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function checkRequiredFields(failures, label, value, fields) {
  if (!object(value)) {
    failures.push(`${label} must be an object`);
    return;
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) failures.push(`${label} missing ${field}`);
  }
}

function checkCycles(failures, journey, checkpointMap) {
  const visiting = new Set();
  const visited = new Set();
  function visit(id, path) {
    if (visiting.has(id)) {
      failures.push(`${journey.journey_id} checkpoint prerequisite cycle: ${[...path, id].join(' -> ')}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const checkpoint = checkpointMap.get(id);
    for (const prerequisiteId of array(checkpoint?.prerequisite_ids)) visit(prerequisiteId, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of checkpointMap.keys()) visit(id, []);
}

export function validateArchitecture({ points: pointCatalog, journeys, policy, scenarios }) {
  const failures = [];
  if (pointCatalog?.schema_version !== 'nimi.local-agent-product-test-points/v3') failures.push('test point catalog schema_version must be v3');
  if (journeys?.schema_version !== 'nimi.local-agent-product-journeys/v2') failures.push('journey registry schema_version must be v2');
  if (policy?.schema_version !== 'nimi.local-agent-product-execution-policy/v2') failures.push('execution policy schema_version must be v2');
  if (scenarios?.schema_version !== 'nimi.local-agent-conversation-scenarios/v1') failures.push('conversation scenario registry schema_version must be v1');

  const points = array(pointCatalog?.points);
  const pointById = new Map();
  const layerCounts = Object.fromEntries(layerIds.map((layer) => [layer, 0]));
  let acceptanceCount = 0;
  let observationCount = 0;
  for (const [index, point] of points.entries()) {
    const label = `test point ${point?.point_id || index}`;
    checkRequiredFields(failures, label, point, [
      'point_kind', 'point_id', 'owner_iteration', 'group', 'product_requirement', 'requirement_refs', 'spec_refs',
      'source_kinds', 'minimum_sufficient_layer', 'evidence_class', 'execution_binding',
    ]);
    const id = text(point?.point_id);
    if (!id) continue;
    if (pointById.has(id)) failures.push(`duplicate or conflicting point owner for ${id}`);
    else pointById.set(id, point);
    for (const field of oldSchedulingFields) if (Object.hasOwn(point || {}, field)) failures.push(`${id} point catalog mixes scheduling field ${field}`);
    const layer = text(point?.minimum_sufficient_layer);
    if (!layerIds.includes(layer)) failures.push(`${id} has invalid minimum layer ${layer}`);
    else layerCounts[layer] += 1;
    if (!text(point?.product_requirement)) failures.push(`${id} product requirement must be non-empty`);
    if (point?.point_kind === 'acceptance_point') {
      acceptanceCount += 1;
      if (point.owner_iteration !== 'I7' || point.group === 'P' || layer === 'L5') failures.push(`${id} acceptance_point must be I7 and cannot be P/L5`);
      if (array(point.assertion_ids).length === 0 || new Set(point.assertion_ids).size !== point.assertion_ids.length) failures.push(`${id} acceptance_point assertion_ids must be non-empty and unique`);
      if (Object.hasOwn(point, 'review_dimensions')) failures.push(`${id} acceptance_point cannot carry behavior review dimensions`);
    } else if (point?.point_kind === 'behavior_observation_point') {
      observationCount += 1;
      if (point.owner_iteration !== 'I8' || point.group !== 'P' || layer !== 'L5') failures.push(`${id} behavior_observation_point must be I8/P/L5`);
      if (array(point.review_dimensions).length === 0) failures.push(`${id} behavior_observation_point requires review_dimensions`);
      if (Object.hasOwn(point, 'assertion_ids')) failures.push(`${id} behavior_observation_point cannot carry semantic assertion_ids`);
      if (point.evidence_class !== 'conversation_report_observation') failures.push(`${id} behavior observation evidence class must be conversation_report_observation`);
      if (point.execution_binding?.journey_id !== 'conversation-report-baseline' || point.execution_binding?.suite_id) failures.push(`${id} must bind the baseline report Journey only`);
    } else failures.push(`${id} has invalid point_kind ${point?.point_kind}`);
  }
  if (points.length !== 169 || pointById.size !== 169 || pointCatalog?.point_count !== 169) failures.push(`point catalog must contain exactly 169 unique points, got rows=${points.length} unique=${pointById.size}`);
  if (acceptanceCount !== 145 || observationCount !== 24) failures.push(`point kinds must be acceptance=145/observation=24, got ${acceptanceCount}/${observationCount}`);
  const expectedLayerCounts = { L0: 28, L1: 43, L2: 44, L3: 30, L4: 0, L5: 24 };
  for (const [layer, expected] of Object.entries(expectedLayerCounts)) if (layerCounts[layer] !== expected) failures.push(`minimum layer ${layer} expected ${expected}, got ${layerCounts[layer]}`);

  const journeyRows = array(journeys?.journeys);
  const journeyById = new Map();
  const coverage = new Map();
  for (const journey of journeyRows) {
    const id = text(journey?.journey_id);
    if (!id) { failures.push('journey row missing journey_id'); continue; }
    if (journeyById.has(id)) failures.push(`duplicate journey ${id}`);
    else journeyById.set(id, journey);
    checkRequiredFields(failures, `journey ${id}`, journey, ['applicable_layer', 'environment', 'prerequisites', 'isolation_level', 'repeat_policy_ref', 'time_budget_ms', 'checkpoints']);
    if (!['L2', 'L3', 'L5'].includes(journey.applicable_layer)) failures.push(`${id} applicable_layer must be L2, L3, or L5`);
    if (!text(journey.isolation_level) || !text(journey.repeat_policy_ref)) failures.push(`${id} must declare isolation and repeat policy`);
    if (!Number.isInteger(journey.time_budget_ms) || journey.time_budget_ms <= 0) failures.push(`${id} time budget must be positive`);
    const environment = journey.environment;
    checkRequiredFields(failures, `${id} environment`, environment, ['type', 'requires_real_realm', 'supports_real_realm', 'requires_desktop', 'requires_zhiyu', 'requires_native_macos', 'start_limits']);
    for (const processId of ['provider', 'realm', 'runtime', 'desktop', 'zhiyu']) if (!Number.isInteger(environment?.start_limits?.[processId]) || environment.start_limits[processId] < 0) failures.push(`${id} start limit ${processId} must be a non-negative integer`);
    const coverageField = journey.applicable_layer === 'L5' ? 'covered_point_ids' : 'covered_leaf_ids';
    const checkpointMap = new Map();
    for (const checkpoint of array(journey.checkpoints)) {
      const checkpointId = text(checkpoint?.checkpoint_id);
      if (!checkpointId) { failures.push(`${id} checkpoint missing checkpoint_id`); continue; }
      if (checkpointMap.has(checkpointId)) failures.push(`${id} duplicate checkpoint ${checkpointId}`);
      else checkpointMap.set(checkpointId, checkpoint);
      if (!Array.isArray(checkpoint.prerequisite_ids) || !Array.isArray(checkpoint[coverageField])) failures.push(`${id}/${checkpointId} must declare prerequisite_ids and ${coverageField} arrays`);
      const wrongField = coverageField === 'covered_point_ids' ? 'covered_leaf_ids' : 'covered_point_ids';
      if (Object.hasOwn(checkpoint, wrongField)) failures.push(`${id}/${checkpointId} mixes ${wrongField} with ${coverageField}`);
    }
    for (const checkpoint of checkpointMap.values()) {
      for (const prerequisiteId of array(checkpoint.prerequisite_ids)) {
        if (!checkpointMap.has(prerequisiteId)) failures.push(`${id}/${checkpoint.checkpoint_id} references missing prerequisite ${prerequisiteId}`);
        if (prerequisiteId === checkpoint.checkpoint_id) failures.push(`${id}/${checkpoint.checkpoint_id} cannot depend on itself`);
      }
      for (const pointId of array(checkpoint[coverageField])) {
        const point = pointById.get(pointId);
        if (!point) failures.push(`${id}/${checkpoint.checkpoint_id} covers orphan point ${pointId}`);
        else if (point.minimum_sufficient_layer !== journey.applicable_layer
          || point.point_kind !== (journey.applicable_layer === 'L5' ? 'behavior_observation_point' : 'acceptance_point')) failures.push(`${id}/${checkpoint.checkpoint_id} covers ${pointId} at conflicting kind/layer`);
        const rows = coverage.get(pointId) ?? [];
        rows.push({ journeyId: id, checkpointId: checkpoint.checkpoint_id });
        coverage.set(pointId, rows);
      }
    }
    checkCycles(failures, journey, checkpointMap);
  }
  for (const requiredJourney of ['full-chain-core', 'conversation-report-baseline']) if (!journeyById.has(requiredJourney)) failures.push(`journey registry must contain ${requiredJourney}`);
  if (journeyById.has('live-behavior-product') || journeyById.has('live-evaluator-calibration')) failures.push('old live behavior/calibration Journeys are forbidden');

  for (const point of points) {
    const id = point.point_id;
    const layer = point.minimum_sufficient_layer;
    const binding = point.execution_binding;
    if (!object(binding) || array(binding.checkpoint_ids).length === 0) { failures.push(`${id} execution binding must contain checkpoint_ids`); continue; }
    if (layer === 'L0' || layer === 'L1') {
      if (binding.suite_id !== 'contract-smoke' || binding.journey_id) failures.push(`${id} ${layer} binding must target contract-smoke only`);
      continue;
    }
    const journey = journeyById.get(binding.journey_id);
    if (!journey) { failures.push(`${id} references missing journey ${binding.journey_id}`); continue; }
    if (journey.applicable_layer !== layer) failures.push(`${id} layer ${layer} conflicts with journey ${journey.journey_id}/${journey.applicable_layer}`);
    const coverageField = layer === 'L5' ? 'covered_point_ids' : 'covered_leaf_ids';
    const checkpointMap = new Map(journey.checkpoints.map((checkpoint) => [checkpoint.checkpoint_id, checkpoint]));
    for (const checkpointId of binding.checkpoint_ids) {
      const checkpoint = checkpointMap.get(checkpointId);
      if (!checkpoint) failures.push(`${id} references nonexistent checkpoint ${checkpointId}`);
      else if (!array(checkpoint[coverageField]).includes(id)) failures.push(`${id} checkpoint ${checkpointId} has no reciprocal covered mapping`);
    }
    const covered = array(coverage.get(id)).filter((row) => row.journeyId === journey.journey_id).map((row) => row.checkpointId);
    if (!sameSet(covered, binding.checkpoint_ids)) failures.push(`${id} Journey covered mapping conflicts with point catalog binding`);
    if (array(coverage.get(id)).some((row) => row.journeyId !== journey.journey_id)) failures.push(`${id} is covered by conflicting Journey owners`);
  }

  const coreJourney = journeyById.get('full-chain-core');
  const coreLeafIds = new Set(array(coreJourney?.checkpoints).flatMap((checkpoint) => array(checkpoint.covered_leaf_ids)));
  if (coreLeafIds.size !== 44) failures.push(`full-chain-core must cover 44 unique L2 acceptance points, got ${coreLeafIds.size}`);
  const extendedLeafIds = new Set(journeyRows.filter((journey) => journey.applicable_layer === 'L3').flatMap((journey) => journey.checkpoints.flatMap((checkpoint) => array(checkpoint.covered_leaf_ids))));
  if (extendedLeafIds.size !== 30) failures.push(`extended journeys must cover 30 unique L3 acceptance points, got ${extendedLeafIds.size}`);
  const reportJourney = journeyById.get('conversation-report-baseline');
  const observationIds = new Set(array(reportJourney?.checkpoints).flatMap((checkpoint) => array(checkpoint.covered_point_ids)));
  if (observationIds.size !== 24) failures.push(`conversation-report-baseline must map 24 behavior observation points, got ${observationIds.size}`);
  if (reportJourney?.environment?.requires_live_provider !== true
    || !same(reportJourney?.environment?.start_limits, { provider: 1, realm: 1, runtime: 2, desktop: 1, zhiyu: 1 })
    || !same(reportJourney?.environment?.materialization_limits, { worldCharacter: 1, realmPersona: 1 })) failures.push('conversation report Journey must declare one environment, two one-time materializations, and one Runtime restart');
  if (!array(coreJourney?.checkpoints).some((checkpoint) => array(checkpoint.covered_leaf_ids).length > 1)) failures.push('a Journey checkpoint must be able to cover multiple acceptance points');

  if (policy?.active_required_runner !== 'tests/local-agent-product/harness/run-gate.mjs') failures.push(`active runner must be Journey-based run-gate.mjs, got ${policy?.active_required_runner}`);
  const forbiddenPaths = array(policy?.forbidden_active_paths);
  for (const forbiddenPath of ['tests/local-agent-product/harness/run-tier.mjs', 'tests/local-agent-product/harness/orchestrator.mjs', 'leaf_per_process', 'full_environment_starts_equals_leaf_count_times_repeat', 'tests/local-agent-product/behavior/run-live-behavior.mjs', 'scripts/check-local-agent-live-behavior.mjs']) if (!forbiddenPaths.includes(forbiddenPath)) failures.push(`execution policy must forbid old runner/path ${forbiddenPath}`);
  if (policy?.i8_execution_in_i7 !== 'forbidden') failures.push('I8 execution in I7 must be forbidden');
  const expectedGateCommands = {
    coverage: 'pnpm check:local-agent-product-coverage',
    contract: 'pnpm test:local-agent-product-contract',
    core: 'pnpm test:e2e:local-agent-product:core',
    core_stability: 'pnpm test:e2e:local-agent-product:core-stability',
    extended: 'pnpm test:e2e:local-agent-product:extended',
    exhaustive: 'pnpm test:local-agent-product:exhaustive',
    conversation_report: 'pnpm test:e2e:local-agent-conversation-report',
    acceptance: 'pnpm check:local-agent-product-acceptance',
  };
  for (const [gateId, command] of Object.entries(expectedGateCommands)) if (policy?.gates?.[gateId]?.command !== command) failures.push(`execution policy gate ${gateId} must use ${command}`);
  if (Object.hasOwn(policy?.gates || {}, 'live_behavior')) failures.push('old live behavior gate is forbidden');
  if (array(policy?.required_local_pr_composition).includes('conversation_report')) failures.push('on-demand conversation report cannot enter required local/PR composition');
  if (policy?.repeat_policies?.core?.stability !== 3 || policy?.repeat_policies?.core?.clean_root_per_repeat !== true || policy?.repeat_policies?.core?.fresh_logical_identity_per_repeat !== true) failures.push('core stability must use three clean Journey repeats with fresh logical identities');
  if (policy?.repeat_policies?.exhaustive?.full_environment_per_leaf !== false) failures.push('exhaustive policy must forbid full environment per leaf');
  if (!same(policy?.repeat_policies?.conversation_report, {
    owner_iteration: 'I8', runs: 1, models_per_run: 1, repeats_per_model: 1,
    clean_root_per_run: true, retry: 'none', full_environment_per_scene_or_turn: false,
  })) failures.push('conversation report repeat policy must be one run/one model/one repeat/no retry/one environment');
  if (policy?.gates?.conversation_report?.admission_threshold !== 'none'
    || policy?.gates?.conversation_report?.human_review !== 'required'
    || policy?.gates?.conversation_report?.ordinary_regression !== 'forbidden') failures.push('conversation report must be on-demand human review with no admission threshold');
  if (policy?.gate_budgets_ms?.conversation_report_journey_hard !== 2700000 || policy?.gate_budgets_ms?.conversation_report_closeout_hard !== 3000000) failures.push('conversation report time budgets drifted from P-TEST');
  if (array(scenarios?.scenarios).length !== 1 || scenarios.scenarios[0]?.scenario_id !== 'conversation-report-baseline' || array(scenarios.scenarios[0]?.streams).length !== 2 || Object.hasOwn(scenarios.scenarios[0]?.lifecycle_timeline || {}, 'turns')) failures.push('scenario registry must contain two LocalAgent streams and one non-conversation lifecycle timeline');
  return failures;
}

export function validateJourneyResult({ architecture, journey, result, expectedSourceState }) {
  const failures = [];
  checkRequiredFields(failures, 'journey result', result, [
    'schemaVersion', 'journeyTrialId', 'journeyId', 'tier', 'batch', 'repeatIndex', 'sourceState',
    'environmentIdentity', 'durationMs', 'checkpoints', 'leafResults', 'artifacts', 'processProblems', 'privacy', 'outcome',
  ]);
  if (result?.schemaVersion !== 'nimi.local-agent-product-journey-result/v2') failures.push('journey result schemaVersion must be v2');
  if (result?.journeyId !== journey?.journey_id || result?.tier !== journey?.applicable_layer) failures.push('journey result identity or tier mismatch');
  if (!text(result?.journeyTrialId) || !Number.isInteger(result?.repeatIndex) || result.repeatIndex <= 0) failures.push('journey trial identity/repeat is invalid');
  if (JSON.stringify(result?.sourceState) !== JSON.stringify(expectedSourceState)) failures.push('journey source state or source digest mismatch');
  if (!Number.isInteger(result?.durationMs) || result.durationMs < 0 || result.durationMs > Number(journey?.time_budget_ms || 0)) failures.push(`journey duration exceeds budget ${journey?.time_budget_ms}`);
  if (!object(result?.environmentIdentity) || !text(result.environmentIdentity.rootId)) failures.push('journey environment identity/root is missing');
  if (JSON.stringify(result?.environmentIdentity?.processStarts) !== JSON.stringify(journey?.environment?.start_limits)) failures.push('journey environment process start count mismatch');
  if (journey?.journey_id === 'full-chain-core') {
    for (const field of logicalIdentityFields) {
      const values = array(result?.environmentIdentity?.[field]);
      if (values.length === 0 || values.some((value) => !text(value)) || new Set(values).size !== values.length) {
        failures.push(`full-chain-core environment identity ${field} must contain unique observed identities`);
      }
    }
  }

  const expectedCheckpointMap = new Map(array(journey?.checkpoints).map((checkpoint) => [checkpoint.checkpoint_id, checkpoint]));
  const checkpointMap = new Map();
  for (const checkpoint of array(result?.checkpoints)) {
    const id = text(checkpoint?.checkpointId);
    if (!id) {
      failures.push('result checkpoint missing checkpointId');
      continue;
    }
    if (checkpointMap.has(id)) failures.push(`duplicate result checkpoint ${id}`);
    else checkpointMap.set(id, checkpoint);
    const expected = expectedCheckpointMap.get(id);
    if (!expected) failures.push(`orphan result checkpoint ${id}`);
    checkRequiredFields(failures, `checkpoint ${id}`, checkpoint, ['prerequisiteIds', 'startedAt', 'completedAt', 'correlations', 'assertions', 'artifactRefs', 'outcome']);
    if (expected && !sameSet(checkpoint.prerequisiteIds, expected.prerequisite_ids)) failures.push(`${id} prerequisite IDs drifted from registry`);
    if (!journeyOutcomeIds.includes(checkpoint.outcome)) failures.push(`${id} has invalid outcome ${checkpoint.outcome}`);
    const started = Date.parse(checkpoint.startedAt);
    const completed = Date.parse(checkpoint.completedAt);
    if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) failures.push(`${id} timestamps are invalid`);
    const assertionIds = array(checkpoint.assertions).map((assertion) => text(assertion?.assertionId)).filter(Boolean);
    if (assertionIds.length !== new Set(assertionIds).size) failures.push(`${id} has duplicate assertion IDs`);
    for (const assertion of array(checkpoint.assertions)) {
      if (!text(assertion?.assertionId) || !journeyOutcomeIds.includes(assertion?.outcome)) failures.push(`${id} has invalid assertion record`);
    }
  }
  for (const checkpointId of expectedCheckpointMap.keys()) if (!checkpointMap.has(checkpointId)) failures.push(`missing required checkpoint ${checkpointId}`);

  for (const [checkpointId, checkpoint] of checkpointMap) {
    const failedPrerequisites = array(checkpoint.prerequisiteIds).filter((id) => checkpointMap.get(id)?.outcome !== 'passed');
    if (failedPrerequisites.length > 0 && checkpoint.outcome === 'passed') failures.push(`${checkpointId} downstream PASS after failed prerequisite ${failedPrerequisites.join(',')}`);
    if (failedPrerequisites.length > 0 && checkpoint.outcome !== 'blocked_by_failed_prerequisite' && checkpoint.outcome !== 'failed') failures.push(`${checkpointId} prerequisite failure must fail or block`);
  }

  const points = array(architecture?.points?.points).filter((point) => point.point_kind === 'acceptance_point'
    && point.execution_binding?.journey_id === journey?.journey_id);
  const pointById = new Map(points.map((point) => [point.point_id, point]));
  const leafMap = new Map();
  for (const leaf of array(result?.leafResults)) {
    const id = text(leaf?.leafId);
    if (!id) {
      failures.push('leaf result missing leafId');
      continue;
    }
    if (leafMap.has(id)) failures.push(`duplicate leaf result ${id}`);
    else leafMap.set(id, leaf);
    const point = pointById.get(id);
    if (!point) {
      failures.push(`orphan leaf result ${id}`);
      continue;
    }
    checkRequiredFields(failures, `leaf result ${id}`, leaf, ['journeyTrialId', 'checkpointIds', 'assertionIds', 'evidenceRefs', 'outcome', 'failureClass']);
    if (leaf.journeyTrialId !== result.journeyTrialId) failures.push(`${id} journeyTrialId mismatch`);
    if (!sameSet(leaf.checkpointIds, point.execution_binding.checkpoint_ids)) failures.push(`${id} checkpoint result mapping mismatch`);
    if (!sameSet(leaf.assertionIds, point.assertion_ids)) failures.push(`${id} assertion result mapping mismatch`);
    if (array(leaf.evidenceRefs).length === 0) failures.push(`${id} has no evidence refs`);
    const referencedCheckpoints = array(leaf.checkpointIds).map((checkpointId) => checkpointMap.get(checkpointId));
    if (leaf.outcome === 'passed' && referencedCheckpoints.some((checkpoint) => checkpoint?.outcome !== 'passed')) failures.push(`${id} forged pass after failed prerequisite/checkpoint`);
    const assertions = referencedCheckpoints.flatMap((checkpoint) => array(checkpoint?.assertions));
    const leafAssertions = array(leaf.assertionIds).map((assertionId) => assertions.find((candidate) => candidate.assertionId === assertionId));
    if (leaf.outcome === 'passed') {
      for (const [index, assertionId] of array(leaf.assertionIds).entries()) {
        if (!leafAssertions[index] || leafAssertions[index].outcome !== 'passed') failures.push(`${id} assertion ${assertionId} lacks passing checkpoint evidence`);
      }
    } else if (leaf.outcome === 'failed' && leafAssertions.every((assertion) => assertion?.outcome === 'passed')) {
      failures.push(`${id} failed leaf has no failed assertion evidence`);
    }
    if (leaf.outcome === 'passed' && leaf.failureClass != null) failures.push(`${id} passing leaf cannot have failureClass`);
    if (leaf.outcome !== 'passed' && !text(leaf.failureClass)) failures.push(`${id} non-passing leaf must have a failureClass`);
  }
  for (const point of points) if (!leafMap.has(point.point_id)) failures.push(`missing leaf result ${point.point_id}`);

  const artifactMap = new Map();
  for (const artifact of array(result?.artifacts)) {
    const id = text(artifact?.artifactId);
    if (!id) {
      failures.push('artifact missing artifactId');
      continue;
    }
    if (artifactMap.has(id)) failures.push(`duplicate artifact ${id}`);
    else artifactMap.set(id, artifact);
    if (!text(artifact.path) || !fs.existsSync(artifact.path) || !fs.statSync(artifact.path).isFile()) failures.push(`missing artifact file ${id}`);
    else {
      if (sha256(artifact.path) !== artifact.sha256) failures.push(`artifact hash mismatch ${id}`);
      if (fs.statSync(artifact.path).size !== artifact.bytes) failures.push(`artifact byte count mismatch ${id}`);
    }
    if (artifact.privacyClass !== 'safe_evidence') failures.push(`artifact ${id} is not safe evidence`);
  }
  for (const leaf of leafMap.values()) for (const evidenceRef of array(leaf.evidenceRefs)) if (!artifactMap.has(evidenceRef)) failures.push(`${leaf.leafId} references missing evidence ${evidenceRef}`);
  for (const checkpoint of checkpointMap.values()) for (const artifactRef of array(checkpoint.artifactRefs)) if (!artifactMap.has(artifactRef)) failures.push(`${checkpoint.checkpointId} references missing artifact ${artifactRef}`);

  if (journey?.journey_id === 'full-chain-core') {
    const provider = artifactMap.get('provider-capture-summary');
    if (!provider || !fs.existsSync(provider.path)) failures.push('full-chain-core provider capture summary is missing');
    else {
      try {
        const summary = JSON.parse(fs.readFileSync(provider.path, 'utf8'));
        const laneIds = array(summary.contextLaneIds ?? summary.laneIds);
        if (summary.complete !== true
          || summary.contextLaneOrderVerified !== true
          || requiredProviderLaneIds.some((laneId) => !laneIds.includes(laneId))) failures.push('provider capture lanes are incomplete');
      } catch {
        failures.push('provider capture summary is invalid JSON');
      }
    }
  }
  if (array(result?.processProblems).length !== 0) failures.push('journey process problems must be zero');
  if (result?.privacy?.ok !== true || array(result?.privacy?.findings).length !== 0) failures.push('journey privacy findings must be zero');
  if (result?.outcome === 'passed' && ([...checkpointMap.values()].some((checkpoint) => checkpoint.outcome !== 'passed') || [...leafMap.values()].some((leaf) => leaf.outcome !== 'passed'))) failures.push('journey cannot PASS with non-passing checkpoint or leaf');
  if (result?.outcome !== 'passed' && result?.outcome !== 'failed' && result?.outcome !== 'blocked_by_failed_prerequisite') failures.push('journey outcome is invalid');

  return failures;
}

export function validateJourneyRepeatIsolation(results) {
  const failures = [];
  const byJourney = new Map();
  for (const result of array(results)) {
    const journeyId = text(result?.journeyId);
    const rows = byJourney.get(journeyId) || [];
    rows.push(result);
    byJourney.set(journeyId, rows);
  }
  for (const [journeyId, rows] of byJourney) {
    if (!journeyId || rows.length < 2) continue;
    const seenTrialIds = new Set();
    const seenRepeatIndexes = new Set();
    const identityFields = journeyId === 'full-chain-core'
      ? ['rootId', ...logicalIdentityFields]
      : ['rootId'];
    const seenIdentity = new Map(identityFields.map((field) => [field, new Set()]));
    for (const result of rows) {
      const trialId = text(result?.journeyTrialId);
      if (!trialId || seenTrialIds.has(trialId)) failures.push(`${journeyId} Journey repeat reused or omitted journeyTrialId ${trialId || '<empty>'}`);
      seenTrialIds.add(trialId);
      if (!Number.isInteger(result?.repeatIndex) || seenRepeatIndexes.has(result.repeatIndex)) failures.push(`${journeyId} Journey repeat reused or omitted repeatIndex ${result?.repeatIndex}`);
      seenRepeatIndexes.add(result?.repeatIndex);
      for (const field of identityFields) {
        const values = field === 'rootId'
          ? [result?.environmentIdentity?.rootId]
          : array(result?.environmentIdentity?.[field]);
        if (values.length === 0 || values.some((value) => !text(value))) {
          failures.push(`${journeyId} Journey repeat omitted logical environment identity ${field}`);
          continue;
        }
        for (const value of values.map(text)) {
          if (seenIdentity.get(field).has(value)) failures.push(`${journeyId} Journey repeat reused logical environment identity ${field}:${value}`);
          seenIdentity.get(field).add(value);
        }
      }
    }
  }
  return failures;
}

export function validateSuiteResult({ architecture, result, expectedSourceState }) {
  const failures = [];
  checkRequiredFields(failures, 'suite result', result, [
    'schemaVersion', 'suiteTrialId', 'suiteId', 'layers', 'sourceState', 'durationMs', 'checkpoints',
    'leafResults', 'artifacts', 'processProblems', 'privacy', 'outcome',
  ]);
  const expectedLayers = result?.suiteId === 'contract-smoke'
    ? ['L0', 'L1']
    : result?.suiteId === 'deterministic-exhaustive' ? ['L0', 'L1', 'L4'] : null;
  if (result?.schemaVersion !== 'nimi.local-agent-product-suite-result/v2' || !expectedLayers) failures.push('suite result identity/schema mismatch');
  if (expectedLayers && !sameSet(result?.layers, expectedLayers)) failures.push(`${result?.suiteId} layers must be ${expectedLayers.join(',')}`);
  if (JSON.stringify(result?.sourceState) !== JSON.stringify(expectedSourceState)) failures.push('suite source state or source digest mismatch');
  const suitePolicy = array(architecture?.policy?.suites).find((suite) => suite.suite_id === 'contract-smoke');
  const activeSuitePolicy = array(architecture?.policy?.suites).find((suite) => suite.suite_id === result?.suiteId) || suitePolicy;
  if (!Number.isInteger(result?.durationMs) || result.durationMs < 0 || result.durationMs > Number(activeSuitePolicy?.max_duration_ms || 0)) failures.push(`suite duration exceeds ${result?.suiteId} budget`);
  if (result?.suiteId === 'contract-smoke') {
    if (result?.executionPolicy?.mode !== 'contract'
      || result.executionPolicy.logicalLeafTrialCount !== 71
      || result.executionPolicy.fullEnvironmentPerLeaf !== false) failures.push('contract-smoke execution policy must be 71 grouped low-level trials');
  }
  if (result?.suiteId === 'deterministic-exhaustive') {
    if (result?.executionPolicy?.mode !== 'exhaustive'
      || result.executionPolicy.logicalLeafTrialCount !== 3239
      || !Number.isInteger(result.executionPolicy.groupedProcessCount)
      || result.executionPolicy.groupedProcessCount >= 3239
      || result.executionPolicy.fullEnvironmentPerLeaf !== false) failures.push('deterministic-exhaustive execution policy must preserve 3239 logical trials without per-leaf environments');
  }

  const points = array(architecture?.points?.points).filter((point) => point.point_kind === 'acceptance_point'
    && ['L0', 'L1'].includes(point.minimum_sufficient_layer));
  const pointById = new Map(points.map((point) => [point.point_id, point]));
  const checkpointMap = new Map();
  for (const checkpoint of array(result?.checkpoints)) {
    const id = text(checkpoint?.checkpointId);
    if (!id) {
      failures.push('suite checkpoint missing checkpointId');
      continue;
    }
    if (checkpointMap.has(id)) failures.push(`duplicate suite checkpoint ${id}`);
    else checkpointMap.set(id, checkpoint);
    checkRequiredFields(failures, `suite checkpoint ${id}`, checkpoint, ['leafIds', 'startedAt', 'completedAt', 'assertions', 'artifactRefs', 'outcome']);
    if (!journeyOutcomeIds.includes(checkpoint.outcome)) failures.push(`${id} has invalid suite checkpoint outcome`);
    const started = Date.parse(checkpoint.startedAt);
    const completed = Date.parse(checkpoint.completedAt);
    if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) failures.push(`${id} suite checkpoint timestamps are invalid`);
  }

  const artifactMap = new Map();
  for (const artifact of array(result?.artifacts)) {
    const id = text(artifact?.artifactId);
    if (!id || artifactMap.has(id)) failures.push(`invalid or duplicate suite artifact ${id || '<empty>'}`);
    else artifactMap.set(id, artifact);
    if (!text(artifact?.path) || !fs.existsSync(artifact.path)) failures.push(`missing suite artifact file ${id}`);
    else {
      if (sha256(artifact.path) !== artifact.sha256) failures.push(`suite artifact hash mismatch ${id}`);
      if (fs.statSync(artifact.path).size !== artifact.bytes) failures.push(`suite artifact bytes mismatch ${id}`);
    }
    if (artifact?.privacyClass !== 'safe_evidence') failures.push(`suite artifact ${id} is not safe evidence`);
  }

  const leafMap = new Map();
  for (const leaf of array(result?.leafResults)) {
    const id = text(leaf?.leafId);
    if (!id || leafMap.has(id)) failures.push(`invalid or duplicate suite leaf ${id || '<empty>'}`);
    else leafMap.set(id, leaf);
    const point = pointById.get(id);
    if (!point) {
      failures.push(`orphan suite leaf result ${id}`);
      continue;
    }
    const expectedCheckpointIds = point.execution_binding.checkpoint_ids;
    if (leaf.suiteTrialId !== result.suiteTrialId) failures.push(`${id} suiteTrialId mismatch`);
    if (!sameSet(leaf.checkpointIds, expectedCheckpointIds)) failures.push(`${id} suite checkpoint mapping mismatch`);
    if (!sameSet(leaf.assertionIds, point.assertion_ids)) failures.push(`${id} suite assertion mapping mismatch`);
    if (leaf.outcome !== 'passed') failures.push(`${id} suite leaf is not passing`);
    if (array(leaf.evidenceRefs).length === 0) failures.push(`${id} suite leaf has no evidence`);
    for (const evidenceRef of array(leaf.evidenceRefs)) if (!artifactMap.has(evidenceRef)) failures.push(`${id} suite leaf references missing evidence ${evidenceRef}`);
    const checkpoints = expectedCheckpointIds.map((checkpointId) => checkpointMap.get(checkpointId));
    if (checkpoints.some((checkpoint) => checkpoint?.outcome !== 'passed')) failures.push(`${id} suite leaf pass lacks passing checkpoint`);
    const assertions = checkpoints.flatMap((checkpoint) => array(checkpoint?.assertions));
    for (const assertionId of point.assertion_ids) if (!assertions.some((assertion) => assertion.assertionId === assertionId && assertion.outcome === 'passed')) failures.push(`${id} suite assertion ${assertionId} lacks evidence`);
  }
  for (const point of points) {
    if (!leafMap.has(point.point_id)) failures.push(`missing suite leaf result ${point.point_id}`);
    for (const checkpointId of point.execution_binding.checkpoint_ids) {
      const checkpoint = checkpointMap.get(checkpointId);
      if (!checkpoint) failures.push(`missing suite checkpoint ${checkpointId}`);
      else if (!array(checkpoint.leafIds).includes(point.point_id)) failures.push(`${checkpointId} does not reciprocally bind ${point.point_id}`);
    }
  }
  if (array(result?.processProblems).length !== 0) failures.push('suite process problems must be zero');
  if (result?.privacy?.ok !== true || array(result?.privacy?.findings).length !== 0) failures.push('suite privacy findings must be zero');
  if (result?.outcome !== 'passed') failures.push(`${result?.suiteId || 'unknown'} suite outcome must pass`);
  return failures;
}
