import { checkLocalAgentConversationReport } from './platform-spec-local-agent-conversation-report-checks.mjs';

export function checkTestGovernanceTables({
  cwd,
  definedRuleIds,
  fail,
  fs,
  path,
  read,
  testGovernancePolicyTable,
  testGovernanceRuleEvidenceFragment,
}) {
  checkTestGovernancePolicy({
    definedRuleIds,
    fail,
    testGovernancePolicyTable,
  });
  checkTestGovernanceRuleEvidenceFragment({
    cwd,
    definedRuleIds,
    fail,
    fs,
    path,
    read,
    testGovernanceRuleEvidenceFragment,
  });
}

function checkTestGovernancePolicy({ definedRuleIds, fail, testGovernancePolicyTable }) {
  const rel = '.nimi/spec/platform/kernel/tables/test-governance-policy.yaml';
  if (!testGovernancePolicyTable || typeof testGovernancePolicyTable !== 'object') {
    fail(`${rel} must parse as an object`);
    return;
  }
  if (testGovernancePolicyTable.version !== 2) fail(`${rel} must declare version: 2`);
  if (testGovernancePolicyTable.table_family !== 'product_catalog') fail(`${rel} must declare table_family: product_catalog`);
  if (testGovernancePolicyTable.owner !== 'platform') fail(`${rel} must declare owner: platform`);
  if (testGovernancePolicyTable.catalog_id !== 'platform_test_governance_policy') {
    fail(`${rel} must declare catalog_id: platform_test_governance_policy`);
  }
  if (testGovernancePolicyTable.source_rule !== 'P-TEST-001') fail(`${rel} must declare source_rule: P-TEST-001`);
  expectExactSet(fail, rel, testGovernancePolicyTable.entries, [
    'evidence_classes',
    'execution_lanes',
    'hard_blocks',
    'census',
    'suites',
    'local_agent_conversation_report',
    'local_agent_journey_acceptance',
  ], 'entries');

  const expectedClassifications = new Map([
    ['authority_boundary_guard', 'T3'],
    ['behavior_unit', 'T4'],
    ['contract_conformance', 'T5'],
    ['generated_drift_guard', 'T2'],
    ['product_acceptance', 'T6'],
    ['live_provider_proof', 'T7'],
  ]);
  const vocabulary = Array.isArray(testGovernancePolicyTable.evidence_classes)
    ? testGovernancePolicyTable.evidence_classes
    : [];
  expectExactSet(
    fail,
    rel,
    vocabulary.map((row) => row?.classification),
    [...expectedClassifications.keys()],
    'evidence_classes.classification',
  );
  for (const row of vocabulary) {
    const classification = String(row?.classification || '').trim() || '<empty>';
    const expectedTier = expectedClassifications.get(classification);
    if (row?.tier !== expectedTier) fail(`${rel} ${classification} tier must be ${expectedTier}`);
    if (!String(row?.meaning || '').trim()) fail(`${rel} classification ${classification} must declare meaning`);
    checkAuthorityRefs(fail, rel, `evidence_classes.${classification}.authority_refs`, row?.authority_refs, definedRuleIds);
  }

  const expectedLanes = new Map([
    ['workspace_regression', 'pass'],
    ['domain_release', 'pass'],
    ['release_native', 'pass_or_declared_blocked'],
    ['product_acceptance', 'pass_or_declared_blocked'],
    ['live_provider', 'pass_or_declared_blocked'],
  ]);
  const lanes = Array.isArray(testGovernancePolicyTable.execution_lanes)
    ? testGovernancePolicyTable.execution_lanes
    : [];
  expectExactSet(fail, rel, lanes.map((row) => row?.id), [...expectedLanes.keys()], 'execution_lanes.id');
  for (const lane of lanes) {
    const id = String(lane?.id || '').trim() || '<empty>';
    if (!String(lane?.semantics || '').trim()) fail(`${rel} execution lane ${id} must declare semantics`);
    if (lane?.required_outcome !== expectedLanes.get(id)) {
      fail(`${rel} execution lane ${id} required_outcome must be ${expectedLanes.get(id)}`);
    }
    checkAuthorityRefs(fail, rel, `execution_lanes.${id}.authority_refs`, lane?.authority_refs, definedRuleIds);
  }

  const hardBlocks = Array.isArray(testGovernancePolicyTable.hard_blocks) ? testGovernancePolicyTable.hard_blocks : [];
  expectExactSet(fail, rel, hardBlocks.map((row) => row?.id), [
    'unmapped_test_source',
    'multiply_mapped_test_source',
    'empty_or_missing_suite_selector',
    'unresolved_suite_command_or_gate',
    'workspace_regression_not_reachable',
    'active_quarantine_or_phase_state',
    'source_inspection_claims_behavior',
    'required_prerequisite_converted_to_pass',
    'automatic_semantic_verdict_or_acceptance',
    'deterministic_context_admission_wrong_classification',
    'electron_behavior_acceptance_wrong_classification',
    'live_conversation_without_t7_env_evidence',
    'reported_model_fingerprint_incomplete',
    'direct_provider_or_provider_model_constant',
    'generated_review_status_not_unreviewed',
    'incomplete_conversation_report_bundle',
    'source_or_app_owned_conversation_identity',
    'materialized_local_agent_automatic_source_rebase',
    'local_agent_execution_layer_outside_closed_set',
    'electron_cartesian_product',
    'mixed_point_scenario_journey_policy_truth',
    'i8_observation_masquerades_as_acceptance',
    'missing_acceptance_or_observation_mapping',
    'prerequisite_failure_downstream_pass',
    'non_pass_counted_as_pass',
    'source_artifact_privacy_or_process_integrity_failure',
    'journey_environment_start_count_mismatch',
    'journey_repeat_logical_identity_reuse',
    'journey_or_gate_budget_exceeded',
    'leaf_result_orphan_duplicate_conflict',
    'leaf_per_process_required_path',
  ], 'hard_blocks.id');
  for (const row of hardBlocks) {
    const id = String(row?.id || '').trim() || '<empty>';
    if (!String(row?.condition || '').trim()) fail(`${rel} hard block ${id} must declare condition`);
    checkAuthorityRefs(fail, rel, `hard_blocks.${id}.authority_refs`, row?.authority_refs, definedRuleIds);
  }

  checkLocalAgentConversationReport({
    contract: testGovernancePolicyTable.local_agent_conversation_report,
    definedRuleIds,
    fail,
    rel,
  });
  checkLocalAgentJourneyAcceptance({
    contract: testGovernancePolicyTable.local_agent_journey_acceptance,
    definedRuleIds,
    fail,
    rel,
  });
  checkCensus({ definedRuleIds, fail, rel, census: testGovernancePolicyTable.census });
  checkSuites({
    definedRuleIds,
    fail,
    rel,
    suites: testGovernancePolicyTable.suites,
    executionLanes: new Set(expectedLanes.keys()),
  });
}

function checkLocalAgentJourneyAcceptance({ contract, definedRuleIds, fail, rel }) {
  const base = 'local_agent_journey_acceptance';
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    fail(`${rel} must declare ${base}`);
    return;
  }
  expectScalar(fail, rel, `${base}.contract_version`, contract.contract_version, 1);

  const layers = contract.execution_layers;
  expectObject(fail, rel, `${base}.execution_layers`, layers);
  expectExactSet(fail, rel, Object.keys(layers || {}), ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'], `${base}.execution_layers keys`);
  const expectedLayers = new Map([
    ['L0', {
      name: 'static_unit',
      frequency: 'every_related_change',
      budgetField: 'hard_budget_ms',
      budget: 180000,
      scope: ['schema', 'codec', 'hash', 'pure_function', 'type_boundary', 'state_mapping'],
    }],
    ['L1', {
      name: 'module_integration_contract',
      frequency: 'every_pr_iteration',
      budgetField: 'hard_budget_ms',
      budget: 480000,
      scope: ['packet_challenge_snapshot', 'context_compiler', 'sdk_kit_projection', 'provider_capture', 'security_predicate', 'targeted_persistence_restart'],
    }],
    ['L2', {
      name: 'core_product_journey',
      frequency: 'every_product_affecting_iteration',
      budgetField: 'hard_budget_ms',
      budget: 1200000,
      scope: ['realm', 'runtime', 'sdk_kit', 'desktop', 'zhiyu', 'provider_visible_context', 'transcript_memory', 'voice_emotion_apml', 'isolation', 'restart_offline'],
    }],
    ['L3', {
      name: 'extended_risk_journeys',
      frequency: 'related_change_or_nightly',
      budgetField: 'aggregate_hard_budget_ms',
      budget: 2700000,
      scope: ['access_denial_forgery', 'replay_concurrency', 'destructive_lifecycle', 'source_no_rebase', 'crash_recovery', 'native_platform', 'operator_recovery'],
    }],
    ['L4', {
      name: 'exhaustive_deterministic',
      frequency: 'nightly_release_true_close',
      budgetField: 'single_platform_hard_budget_ms',
      budget: 5400000,
      scope: ['property_repetition', 'enum_schema_mutation', 'high_repeat_negative', 'platform_variants', 'stability_three'],
    }],
    ['L5', {
      name: 'live_conversation_report',
      frequency: 'on_demand',
      budgetField: null,
      budget: null,
      scope: ['two_runtime_local_agent_streams', 'cross_surface_lifecycle_timeline', 'complete_human_review_bundle'],
    }],
  ]);
  for (const [layerId, expected] of expectedLayers) {
    const layer = layers?.[layerId];
    expectObject(fail, rel, `${base}.execution_layers.${layerId}`, layer);
    expectScalar(fail, rel, `${base}.execution_layers.${layerId}.name`, layer?.name, expected.name);
    expectScalar(fail, rel, `${base}.execution_layers.${layerId}.frequency`, layer?.frequency, expected.frequency);
    expectExactSet(fail, rel, layer?.scope, expected.scope, `${base}.execution_layers.${layerId}.scope`);
    if (expected.budgetField) {
      expectScalar(fail, rel, `${base}.execution_layers.${layerId}.${expected.budgetField}`, layer?.[expected.budgetField], expected.budget);
    }
    checkAuthorityRefs(fail, rel, `${base}.execution_layers.${layerId}.authority_refs`, layer?.authority_refs, definedRuleIds);
  }
  expectScalar(fail, rel, `${base}.execution_layers.L2.target_budget_ms`, layers?.L2?.target_budget_ms, 900000);
  expectScalar(fail, rel, `${base}.execution_layers.L4.full_electron_per_leaf`, layers?.L4?.full_electron_per_leaf, 'forbidden');
  expectScalar(fail, rel, `${base}.execution_layers.L5.ordinary_core_regression`, layers?.L5?.ordinary_core_regression, 'forbidden');
  expectScalar(fail, rel, `${base}.execution_layers.L5.release_admission_threshold`, layers?.L5?.release_admission_threshold, 'none');
  expectScalar(fail, rel, `${base}.execution_layers.L5.human_review`, layers?.L5?.human_review, 'required');

  const budgets = contract.required_gate_budgets;
  expectObject(fail, rel, `${base}.required_gate_budgets`, budgets);
  for (const [field, expected] of Object.entries({
    local_pr_l0_l1_l2_target_ms: 1500000,
    required_pr_job_hard_max_ms: 1800000,
    i7_core_stability_hard_max_ms: 3600000,
    extended_aggregate_hard_max_ms: 2700000,
    deterministic_exhaustive_hard_max_ms: 5400000,
    live_provider_separate_clock: true,
  })) expectScalar(fail, rel, `${base}.required_gate_budgets.${field}`, budgets?.[field], expected);
  checkAuthorityRefs(fail, rel, `${base}.required_gate_budgets.authority_refs`, budgets?.authority_refs, definedRuleIds);

  const identity = contract.execution_identity;
  expectObject(fail, rel, `${base}.execution_identity`, identity);
  for (const [field, expected] of Object.entries({
    acceptance_point_role: 'independently_traceable_product_fact',
    behavior_observation_point_role: 'human_review_report_location',
    checkpoint_role: 'fact_collection_position_within_journey',
    journey_trial_role: 'one_clean_environment_complete_product_path',
    acceptance_results_per_journey: 'many',
    observation_results: 'forbidden',
    isolation_boundary: 'state_pollution',
    point_scene_turn_count_drives_process_starts: false,
    ordinary_conversation_change: 'extend_existing_stream_registry',
    fresh_logical_identity_per_repeat: true,
    observed_identity_record: 'environmentIdentity',
  })) expectScalar(fail, rel, `${base}.execution_identity.${field}`, identity?.[field], expected);
  expectExactSet(fail, rel, identity?.repeat_identity_scope, [
    'account',
    'world',
    'source',
    'runtime_source',
    'local_agent',
  ], `${base}.execution_identity.repeat_identity_scope`);
  expectExactSet(fail, rel, identity?.new_journey_reasons, [
    'different_initial_subject',
    'different_user_path',
    'different_state_machine',
    'destructive_boundary',
    'recovery_boundary',
    'native_platform',
    'unsafe_state_reset',
  ], `${base}.execution_identity.new_journey_reasons`);
  checkAuthorityRefs(fail, rel, `${base}.execution_identity.authority_refs`, identity?.authority_refs, definedRuleIds);

  const ownership = contract.registry_ownership;
  expectObject(fail, rel, `${base}.registry_ownership`, ownership);
  expectExactSet(fail, rel, ownership?.point_catalog, [
    'point_id', 'point_kind', 'owner_iteration', 'group', 'product_requirement', 'assertion_ids', 'review_dimensions', 'minimum_sufficient_layer', 'evidence_class',
  ], `${base}.registry_ownership.point_catalog`);
  expectExactSet(fail, rel, ownership?.conversation_scenario_registry, [
    'scenario_id', 'stream_alias', 'source_provenance', 'ordered_turns', 'surfaces', 'continuation', 'capture_requirements', 'lifecycle_checkpoints', 'model_matrix', 'time_budget',
  ], `${base}.registry_ownership.conversation_scenario_registry`);
  expectExactSet(fail, rel, ownership?.journey_registry, [
    'journey_id', 'applicable_layer', 'environment', 'real_realm', 'desktop', 'zhiyu', 'native_macos', 'checkpoints', 'covered_point_ids', 'prerequisites', 'isolation_level', 'repeat_policy', 'time_budget',
  ], `${base}.registry_ownership.journey_registry`);
  expectExactSet(fail, rel, ownership?.execution_policy, [
    'gate_journey_selection', 'gate_suite_selection', 'repeat_counts', 'exhaustive_frequency', 'time_budgets', 'platform_requirements',
  ], `${base}.registry_ownership.execution_policy`);
  expectScalar(fail, rel, `${base}.registry_ownership.mixed_truth`, ownership?.mixed_truth, 'forbidden');
  checkAuthorityRefs(fail, rel, `${base}.registry_ownership.authority_refs`, ownership?.authority_refs, definedRuleIds);

  const boundary = contract.iteration_boundary;
  expectObject(fail, rel, `${base}.iteration_boundary`, boundary);
  expectScalar(fail, rel, `${base}.iteration_boundary.total_point_count`, boundary?.total_point_count, 169);
  expectScalar(fail, rel, `${base}.iteration_boundary.i7_acceptance_point_count`, boundary?.i7_acceptance_point_count, 145);
  expectScalar(fail, rel, `${base}.iteration_boundary.i8_behavior_observation_point_count`, boundary?.i8_behavior_observation_point_count, 24);
  expectScalar(fail, rel, `${base}.iteration_boundary.i7_result_for_i8_observation`, boundary?.i7_result_for_i8_observation, 'forbidden');
  expectScalar(fail, rel, `${base}.iteration_boundary.i8_layer`, boundary?.i8_layer, 'L5');
  checkAuthorityRefs(fail, rel, `${base}.iteration_boundary.authority_refs`, boundary?.authority_refs, definedRuleIds);

  const accounting = contract.evidence_accounting;
  expectObject(fail, rel, `${base}.evidence_accounting`, accounting);
  for (const [field, expected] of Object.entries({
    catalog_membership_counts_as_current_evidence: false,
    historical_mapping_only_counts_as_current_evidence: false,
    current_and_historical_counts_are_separate: true,
    unbound_active_checkpoint_posture: 'explicit_incomplete_evidence',
    architecture_validation_claim: 'structural_integrity_not_point_coverage',
  })) expectScalar(fail, rel, `${base}.evidence_accounting.${field}`, accounting?.[field], expected);
  checkAuthorityRefs(fail, rel, `${base}.evidence_accounting.authority_refs`, accounting?.authority_refs, definedRuleIds);

  const integrity = contract.result_integrity;
  expectObject(fail, rel, `${base}.result_integrity`, integrity);
  expectExactSet(fail, rel, integrity?.prerequisite_failure_outcomes, ['failed', 'blocked_by_failed_prerequisite'], `${base}.result_integrity.prerequisite_failure_outcomes`);
  expectScalar(fail, rel, `${base}.result_integrity.passing_outcome`, integrity?.passing_outcome, 'passed');
  expectExactSet(fail, rel, integrity?.non_passing_outcomes, ['failed', 'blocked_by_failed_prerequisite', 'blocked', 'skipped', 'missing', 'unexecuted'], `${base}.result_integrity.non_passing_outcomes`);
  expectExactSet(fail, rel, integrity?.required_journey_fields, ['schemaVersion', 'journeyTrialId', 'journeyId', 'tier', 'batch', 'repeatIndex', 'sourceState', 'environmentIdentity', 'durationMs', 'checkpoints', 'leafResults', 'artifacts', 'processProblems', 'privacy', 'outcome'], `${base}.result_integrity.required_journey_fields`);
  expectExactSet(fail, rel, integrity?.required_checkpoint_fields, ['checkpointId', 'prerequisiteIds', 'startedAt', 'completedAt', 'correlations', 'assertions', 'artifactRefs', 'outcome'], `${base}.result_integrity.required_checkpoint_fields`);
  expectExactSet(fail, rel, integrity?.required_leaf_result_fields, ['leafId', 'journeyTrialId', 'checkpointIds', 'assertionIds', 'evidenceRefs', 'outcome', 'failureClass'], `${base}.result_integrity.required_leaf_result_fields`);
  expectExactSet(fail, rel, integrity?.required_integrity, ['source_digest', 'nimi_head', 'realm_head', 'artifact_sha256', 'privacy_zero', 'process_problems_zero', 'provider_capture_complete', 'environment_start_count', 'logical_identity_unique_per_repeat', 'duration_budget'], `${base}.result_integrity.required_integrity`);
  expectExactSet(fail, rel, integrity?.conversation_report_required_integrity, ['two_distinct_local_agent_streams', 'one_lifecycle_timeline', 'source_snapshot_provenance', 'runtime_resolved_identity', 'exact_transcript_agreement', 'provider_model_revision', 'context_memory_relationship_capture', 'presentation_capture', 'runtime_restart_once', 'realm_offline_once', 'local_link_resolution', 'observation_mapping_complete', 'generated_review_unreviewed'], `${base}.result_integrity.conversation_report_required_integrity`);
  expectScalar(fail, rel, `${base}.result_integrity.conversation_report_semantic_outcome`, integrity?.conversation_report_semantic_outcome, 'forbidden');
  checkAuthorityRefs(fail, rel, `${base}.result_integrity.authority_refs`, integrity?.authority_refs, definedRuleIds);

  const runner = contract.active_runner;
  expectObject(fail, rel, `${base}.active_runner`, runner);
  expectScalar(fail, rel, `${base}.active_runner.scheduling_unit`, runner?.scheduling_unit, 'journey');
  expectScalar(fail, rel, `${base}.active_runner.repeat_unit`, runner?.repeat_unit, 'independent_journey_environment');
  expectScalar(fail, rel, `${base}.active_runner.full_environment_per_leaf`, runner?.full_environment_per_leaf, 'forbidden');
  expectScalar(fail, rel, `${base}.active_runner.l5_scheduling_unit`, runner?.l5_scheduling_unit, 'one_baseline_report_environment');
  expectScalar(fail, rel, `${base}.active_runner.full_environment_per_scene_turn_or_observation`, runner?.full_environment_per_scene_turn_or_observation, 'forbidden');
  expectScalar(fail, rel, `${base}.active_runner.process_start_formula`, runner?.process_start_formula, 'declared_journey_environment');
  expectScalar(fail, rel, `${base}.active_runner.alternate_runner_fallback`, runner?.alternate_runner_fallback, 'forbidden');
  checkAuthorityRefs(fail, rel, `${base}.active_runner.authority_refs`, runner?.authority_refs, definedRuleIds);
}

function checkCensus({ definedRuleIds, fail, rel, census }) {
  if (!census || typeof census !== 'object') {
    fail(`${rel} must declare census`);
    return;
  }
  expectExactSet(fail, rel, census.include_globs, [
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.test.mts',
    '**/*.test.mjs',
    '**/*.test.cts',
    '**/*.test.cjs',
    '**/*.test.js',
    '**/*.test.jsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
    '**/*.spec.mts',
    '**/*.spec.cts',
    '**/*.spec.mjs',
    '**/*.spec.cjs',
    '**/*.spec.js',
    '**/*.spec.jsx',
    '**/*.e2e.mjs',
    '**/*_test.go',
    '**/test_*.py',
    '**/*_test.py',
  ], 'census.include_globs');
  expectScalar(fail, rel, 'census.rust_inline_glob', census.rust_inline_glob, '**/*.rs');
  expectExactSet(fail, rel, census.rust_test_markers, ['#[test]', '#[cfg(test)]'], 'census.rust_test_markers');
  expectExactSet(fail, rel, census.active_roots, [
    'app-tools',
    'apps',
    'docs',
    'examples',
    'gateways',
    'kit',
    'nimi-cognition',
    'nimi2d',
    'proto',
    'runtime',
    'scripts',
    'sdks',
    'tests',
  ], 'census.active_roots');
  expectExactSet(fail, rel, census.exclude_dirs, [
    'archive',
    '_external',
    'node_modules',
    'dist',
    'dist-electron',
    'generated',
    'gen',
    'target',
    'reports',
    '.next',
    '.cache',
    '.iterate',
    '.local',
  ], 'census.exclude_dirs');
  expectExactSet(fail, rel, census.exclude_paths, [
    'app-tools/templates/app-source',
  ], 'census.exclude_paths');
  checkAuthorityRefs(fail, rel, 'census.authority_refs', census.authority_refs, definedRuleIds);
}

function checkSuites({ definedRuleIds, fail, rel, suites, executionLanes }) {
  const rows = Array.isArray(suites) ? suites : [];
  if (rows.length === 0) fail(`${rel} suites must be a non-empty list`);
  const suiteIds = new Set();
  const gateIds = new Set();
  const workspaceOrders = new Set();
  const laneCounts = new Map([...executionLanes].map((lane) => [lane, 0]));
  const surfaceIds = new Set(['sdk_dist', 'kit_dist']);

  for (const row of rows) {
    const id = String(row?.id || '').trim();
    if (!/^[a-z][a-z0-9-]*$/u.test(id)) fail(`${rel} suite id must be lower-kebab: ${id || '<empty>'}`);
    if (suiteIds.has(id)) fail(`${rel} duplicate suite id ${id}`);
    suiteIds.add(id);
    if (!String(row?.owner || '').trim()) fail(`${rel} suite ${id} must declare owner`);
    if (!executionLanes.has(row?.lane)) fail(`${rel} suite ${id} has unknown lane ${String(row?.lane)}`);
    else laneCounts.set(row.lane, laneCounts.get(row.lane) + 1);
    if (!/^gate\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u.test(String(row?.gate_id || ''))) {
      fail(`${rel} suite ${id} must declare a valid gate_id`);
    }
    if (gateIds.has(row?.gate_id)) fail(`${rel} duplicate suite gate_id ${row?.gate_id}`);
    gateIds.add(row?.gate_id);
    if (!String(row?.command || '').trim()) fail(`${rel} suite ${id} must declare command`);
    if (row?.cwd != null && !String(row.cwd).trim()) fail(`${rel} suite ${id} cwd must be non-empty when present`);

    if (row?.lane === 'workspace_regression') {
      if (!Number.isInteger(row?.workspace_order) || row.workspace_order <= 0) {
        fail(`${rel} workspace suite ${id} must declare positive integer workspace_order`);
      } else if (workspaceOrders.has(row.workspace_order)) {
        fail(`${rel} duplicate workspace_order ${row.workspace_order}`);
      }
      workspaceOrders.add(row?.workspace_order);
    } else if (row?.workspace_order != null) {
      fail(`${rel} non-workspace suite ${id} must not declare workspace_order`);
    }

    for (const field of ['provides_workspace_surfaces', 'requires_workspace_surfaces']) {
      for (const surface of Array.isArray(row?.[field]) ? row[field] : []) {
        if (!surfaceIds.has(surface)) fail(`${rel} suite ${id} ${field} contains unknown surface ${surface}`);
      }
    }

    const selectors = row?.selectors;
    if (!selectors || typeof selectors !== 'object' || Array.isArray(selectors)) {
      fail(`${rel} suite ${id} must declare selectors`);
    } else {
      const selectorFields = ['globs', 'files', 'rust_inline_globs'];
      const unknownFields = Object.keys(selectors).filter((field) => !selectorFields.includes(field));
      if (unknownFields.length > 0) fail(`${rel} suite ${id} has unknown selector fields: ${unknownFields.join(', ')}`);
      const values = selectorFields.flatMap((field) => Array.isArray(selectors[field]) ? selectors[field] : []);
      if (values.length === 0) fail(`${rel} suite ${id} selectors must not be empty`);
      for (const value of values) {
        if (!String(value || '').trim()) fail(`${rel} suite ${id} selector values must be non-empty strings`);
      }
    }
    checkAuthorityRefs(fail, rel, `suites.${id}.authority_refs`, row?.authority_refs, definedRuleIds);
  }

  for (const [lane, count] of laneCounts) {
    if (count === 0 && lane !== 'live_provider') fail(`${rel} execution lane ${lane} must own at least one suite`);
  }
}

function checkTestGovernanceRuleEvidenceFragment({
  cwd,
  definedRuleIds,
  fail,
  fs,
  path,
  read,
  testGovernanceRuleEvidenceFragment,
}) {
  const registryRel = '.nimi/spec/platform/kernel/tables/rule-evidence.yaml';
  const fragmentRel = '.nimi/spec/platform/kernel/tables/rule-evidence.rules-test-governance.yaml';
  if (!read(registryRel).includes('rule-evidence.rules-test-governance.yaml')) {
    fail(`${registryRel} must register rule-evidence.rules-test-governance.yaml`);
  }
  if (!testGovernanceRuleEvidenceFragment || typeof testGovernanceRuleEvidenceFragment !== 'object') {
    fail(`${fragmentRel} must parse as an object`);
    return;
  }
  if (testGovernanceRuleEvidenceFragment.table_family !== 'support_registry') {
    fail(`${fragmentRel} must declare table_family: support_registry`);
  }
  if (testGovernanceRuleEvidenceFragment.owner !== 'platform') fail(`${fragmentRel} must declare owner: platform`);
  expectExactSet(fail, fragmentRel, testGovernanceRuleEvidenceFragment.forbidden_state_fields, [
    'done',
    'covered',
    'coverage_status',
    'audit_date',
    'evidence_report',
    'current',
    'proposed',
    'backlog_status',
    'migration_status',
    'mapping_status',
    'run_id',
    'ledger_ref',
  ], 'forbidden_state_fields');
  const expectedRules = [
    'P-TEST-001',
    'P-TEST-002',
    'P-TEST-003',
    'P-TEST-004',
    'P-TEST-005',
    'P-TEST-006',
    'P-TEST-007',
    'P-TEST-008',
    'P-TEST-009',
    'P-TEST-010',
    'P-TEST-011',
    'P-TEST-012',
    'P-TEST-013',
    'P-TEST-014',
    'P-TEST-015',
    'P-TEST-016',
    'P-TEST-017',
    'P-TEST-018',
    'P-TEST-019',
  ];
  expectExactSet(fail, fragmentRel, testGovernanceRuleEvidenceFragment.entries, expectedRules, 'entries');
  const rows = Array.isArray(testGovernanceRuleEvidenceFragment.rules) ? testGovernanceRuleEvidenceFragment.rules : [];
  if (rows.length !== expectedRules.length) fail(`${fragmentRel} rules must contain exactly ${expectedRules.length} entries`);
  const seen = new Set();
  for (const row of rows) {
    const ruleId = String(row?.rule_id || '').trim();
    if (!ruleId) {
      fail(`${fragmentRel} rule row missing rule_id`);
      continue;
    }
    seen.add(ruleId);
    if (!expectedRules.includes(ruleId)) fail(`${fragmentRel} unexpected rule_id ${ruleId}`);
    if (!definedRuleIds.has(ruleId)) fail(`${fragmentRel} references unknown rule_id ${ruleId}`);
    if (row?.evidence_requirement !== 'test-governance-policy.yaml') {
      fail(`${fragmentRel} ${ruleId} evidence_requirement must be test-governance-policy.yaml`);
    }
    if (!fs.existsSync(path.join(cwd, '.nimi/spec/platform/kernel/tables', row?.evidence_requirement || ''))) {
      fail(`${fragmentRel} ${ruleId} evidence_requirement target does not exist`);
    }
    checkNoForbiddenStateFields(fail, fragmentRel, ruleId, row, testGovernanceRuleEvidenceFragment.forbidden_state_fields);
  }
  for (const ruleId of expectedRules) {
    if (!seen.has(ruleId)) fail(`${fragmentRel} missing rule row ${ruleId}`);
  }
}

function checkAuthorityRefs(fail, rel, label, refs, definedRuleIds) {
  const values = Array.isArray(refs) ? refs.map((item) => String(item || '').trim()).filter(Boolean) : [];
  if (values.length === 0) {
    fail(`${rel} ${label} must not be empty`);
    return;
  }
  for (const ref of values) {
    if (!definedRuleIds.has(ref)) fail(`${rel} ${label} references unknown rule ${ref}`);
  }
}

function expectObject(fail, rel, label, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${rel} ${label} must be an object`);
  }
}

function expectScalar(fail, rel, label, actual, expected) {
  if (actual !== expected) {
    fail(`${rel} ${label} must be ${JSON.stringify(expected)}`);
  }
}

function expectExactSet(fail, rel, values, expectedValues, label) {
  const actual = (Array.isArray(values) ? values : []).map((value) => String(value)).filter(Boolean);
  const expected = expectedValues.map((value) => String(value));
  expectSetContains(fail, rel, actual, expected, label);
  for (const value of actual) {
    if (!expected.includes(value)) fail(`${rel} ${label} includes unexpected ${value}`);
  }
  if (actual.length !== new Set(actual).size) fail(`${rel} ${label} must not contain duplicates`);
}

function expectSetContains(fail, rel, values, requiredValues, label) {
  const set = new Set((Array.isArray(values) ? values : []).map((value) => String(value)));
  for (const value of requiredValues) {
    if (!set.has(value)) {
      fail(`${rel} ${label} must include ${value}`);
    }
  }
}

function checkNoForbiddenStateFields(fail, rel, label, row, forbiddenFields) {
  const forbidden = new Set(Array.isArray(forbiddenFields) ? forbiddenFields : []);
  for (const key of Object.keys(row || {})) {
    if (forbidden.has(key)) fail(`${rel} ${label} must not use forbidden state field ${key}`);
  }
}
