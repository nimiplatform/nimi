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
  if (testGovernancePolicyTable.version !== 1) fail(`${rel} must declare version: 1`);
  if (testGovernancePolicyTable.table_family !== 'product_catalog') fail(`${rel} must declare table_family: product_catalog`);
  if (testGovernancePolicyTable.owner !== 'platform') fail(`${rel} must declare owner: platform`);
  if (testGovernancePolicyTable.catalog_id !== 'platform_test_governance_policy') {
    fail(`${rel} must declare catalog_id: platform_test_governance_policy`);
  }
  if (testGovernancePolicyTable.source_rule !== 'P-TEST-001') fail(`${rel} must declare source_rule: P-TEST-001`);
  expectSetContains(fail, rel, testGovernancePolicyTable.entries, [
    'classification_vocabulary',
    'gate_eligibility_enum',
    'hard_blocks',
    'census',
    'module_owner_map',
    'local_agent_behavior_evaluation',
    'local_agent_journey_acceptance',
  ], 'entries');

  const expectedClassifications = new Map([
    ['authority_boundary_guard', 'T3'],
    ['behavior_unit', 'T4'],
    ['contract_conformance', 'T5'],
    ['generated_drift_guard', 'T2'],
    ['product_acceptance', 'T6'],
    ['live_provider_proof', 'T7'],
    ['source_regex_sentinel', 'T3'],
    ['evidence_only', 'T10'],
    ['legacy_drift_quarantine', null],
    ['redundant_candidate', null],
    ['remove_after_replacement', null],
    ['quarantine_unreviewed', null],
  ]);
  const vocabulary = Array.isArray(testGovernancePolicyTable.classification_vocabulary)
    ? testGovernancePolicyTable.classification_vocabulary
    : [];
  if (vocabulary.length !== expectedClassifications.size) {
    fail(`${rel} classification_vocabulary must contain exactly ${expectedClassifications.size} entries`);
  }
  const seenClassifications = new Set();
  for (const row of vocabulary) {
    const classification = String(row?.classification || '').trim();
    if (!classification) {
      fail(`${rel} classification_vocabulary row missing classification`);
      continue;
    }
    if (seenClassifications.has(classification)) fail(`${rel} duplicate classification ${classification}`);
    seenClassifications.add(classification);
    if (!expectedClassifications.has(classification)) {
      fail(`${rel} unexpected classification ${classification}`);
      continue;
    }
    const expectedTier = expectedClassifications.get(classification);
    if ((row?.tier ?? null) !== expectedTier) {
      fail(`${rel} ${classification} tier must be ${expectedTier === null ? 'null' : expectedTier}`);
    }
    checkAuthorityRefs(fail, rel, `${classification}.authority_refs`, row?.authority_refs, definedRuleIds);
  }
  for (const classification of expectedClassifications.keys()) {
    if (!seenClassifications.has(classification)) fail(`${rel} missing classification ${classification}`);
  }

  expectExactSet(fail, rel, testGovernancePolicyTable.gate_eligibility_enum?.values, [
    'allowed',
    'never',
    'after_rewrite',
    'after_scope_limit',
    'after_real_shell_evidence',
    'after_env_evidence',
  ], 'gate_eligibility_enum.values');
  checkAuthorityRefs(fail, rel, 'gate_eligibility_enum.authority_refs', testGovernancePolicyTable.gate_eligibility_enum?.authority_refs, definedRuleIds);

  const hardBlocks = Array.isArray(testGovernancePolicyTable.hard_blocks) ? testGovernancePolicyTable.hard_blocks : [];
  expectExactSet(fail, rel, hardBlocks.map((row) => row?.id), [
    'unclassified_test_file',
    'test_file_without_spec_ref',
    'authority_claim_true',
    'quarantine_without_removal_condition',
    'source_regex_sentinel_not_forbidden_purpose',
    'evidence_only_in_gate',
    'live_proof_without_env_evidence',
    'unreviewed_in_release_gate',
    'owner_mismatch',
    'tier_classification_mismatch',
    'behavior_expectation_not_source_derived',
    'deterministic_context_admission_wrong_classification',
    'electron_behavior_acceptance_wrong_classification',
    'live_behavior_or_evaluator_without_t7_env_evidence',
    'subject_evaluator_route_fingerprint_missing_or_equal',
    'direct_provider_or_provider_model_constant',
    'evaluator_schema_or_calibration_invalid',
    'behavior_batch_retry_or_mutable_inputs',
    'behavior_trial_not_retained',
    'evaluator_product_state_or_personality_mutation',
    'local_agent_execution_layer_outside_closed_set',
    'electron_cartesian_product',
    'mixed_acceptance_journey_policy_truth',
    'i8_leaf_executed_by_i7',
    'missing_checkpoint_or_leaf_evidence',
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

  checkLocalAgentBehaviorEvaluation({
    contract: testGovernancePolicyTable.local_agent_behavior_evaluation,
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

  checkCensus({
    definedRuleIds,
    fail,
    rel,
    census: testGovernancePolicyTable.census,
  });
  checkModuleOwnerMap({
    definedRuleIds,
    fail,
    rel,
    moduleRows: testGovernancePolicyTable.module_owner_map,
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
      name: 'live_behavior',
      frequency: 'i8_only',
      budgetField: null,
      budget: null,
      scope: ['real_provider_subject', 'independent_evaluator', 'calibration', 'two_batches_of_ten', 'raw_trial_ledger'],
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
    checkpoint_role: 'fact_collection_position_within_journey',
    journey_trial_role: 'one_clean_environment_complete_product_path',
    leaf_results_per_journey: 'many',
    isolation_boundary: 'state_pollution',
    leaf_count_drives_process_starts: false,
    ordinary_assertion_change: 'extend_existing_checkpoint',
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
  expectExactSet(fail, rel, ownership?.acceptance_point_catalog, [
    'leaf_id', 'owner_iteration', 'group', 'product_requirement', 'assertion_ids', 'minimum_sufficient_layer', 'evidence_class',
  ], `${base}.registry_ownership.acceptance_point_catalog`);
  expectExactSet(fail, rel, ownership?.journey_registry, [
    'journey_id', 'applicable_layer', 'environment', 'real_realm', 'desktop', 'zhiyu', 'native_macos', 'checkpoints', 'covered_leaf_ids', 'prerequisites', 'isolation_level', 'repeat_policy', 'time_budget',
  ], `${base}.registry_ownership.journey_registry`);
  expectExactSet(fail, rel, ownership?.execution_policy, [
    'gate_journey_selection', 'gate_suite_selection', 'repeat_counts', 'exhaustive_frequency', 'time_budgets', 'platform_requirements',
  ], `${base}.registry_ownership.execution_policy`);
  expectScalar(fail, rel, `${base}.registry_ownership.mixed_truth`, ownership?.mixed_truth, 'forbidden');
  checkAuthorityRefs(fail, rel, `${base}.registry_ownership.authority_refs`, ownership?.authority_refs, definedRuleIds);

  const boundary = contract.iteration_boundary;
  expectObject(fail, rel, `${base}.iteration_boundary`, boundary);
  expectScalar(fail, rel, `${base}.iteration_boundary.total_leaf_count`, boundary?.total_leaf_count, 169);
  expectScalar(fail, rel, `${base}.iteration_boundary.i7_leaf_count`, boundary?.i7_leaf_count, 145);
  expectScalar(fail, rel, `${base}.iteration_boundary.i8_p_leaf_count`, boundary?.i8_p_leaf_count, 24);
  expectScalar(fail, rel, `${base}.iteration_boundary.i7_result_for_i8_leaf`, boundary?.i7_result_for_i8_leaf, 'forbidden');
  expectScalar(fail, rel, `${base}.iteration_boundary.i8_layer`, boundary?.i8_layer, 'L5');
  checkAuthorityRefs(fail, rel, `${base}.iteration_boundary.authority_refs`, boundary?.authority_refs, definedRuleIds);

  const integrity = contract.result_integrity;
  expectObject(fail, rel, `${base}.result_integrity`, integrity);
  expectExactSet(fail, rel, integrity?.prerequisite_failure_outcomes, ['failed', 'blocked_by_failed_prerequisite'], `${base}.result_integrity.prerequisite_failure_outcomes`);
  expectScalar(fail, rel, `${base}.result_integrity.passing_outcome`, integrity?.passing_outcome, 'passed');
  expectExactSet(fail, rel, integrity?.non_passing_outcomes, ['failed', 'blocked_by_failed_prerequisite', 'blocked', 'skipped', 'missing', 'unexecuted'], `${base}.result_integrity.non_passing_outcomes`);
  expectExactSet(fail, rel, integrity?.required_journey_fields, ['schemaVersion', 'journeyTrialId', 'journeyId', 'tier', 'batch', 'repeatIndex', 'sourceState', 'environmentIdentity', 'durationMs', 'checkpoints', 'leafResults', 'artifacts', 'processProblems', 'privacy', 'outcome'], `${base}.result_integrity.required_journey_fields`);
  expectExactSet(fail, rel, integrity?.required_checkpoint_fields, ['checkpointId', 'prerequisiteIds', 'startedAt', 'completedAt', 'correlations', 'assertions', 'artifactRefs', 'outcome'], `${base}.result_integrity.required_checkpoint_fields`);
  expectExactSet(fail, rel, integrity?.required_leaf_result_fields, ['leafId', 'journeyTrialId', 'checkpointIds', 'assertionIds', 'evidenceRefs', 'outcome', 'failureClass'], `${base}.result_integrity.required_leaf_result_fields`);
  expectExactSet(fail, rel, integrity?.required_integrity, ['source_digest', 'nimi_head', 'realm_head', 'artifact_sha256', 'privacy_zero', 'process_problems_zero', 'provider_capture_complete', 'environment_start_count', 'logical_identity_unique_per_repeat', 'duration_budget'], `${base}.result_integrity.required_integrity`);
  checkAuthorityRefs(fail, rel, `${base}.result_integrity.authority_refs`, integrity?.authority_refs, definedRuleIds);

  const runner = contract.active_runner;
  expectObject(fail, rel, `${base}.active_runner`, runner);
  expectScalar(fail, rel, `${base}.active_runner.scheduling_unit`, runner?.scheduling_unit, 'journey');
  expectScalar(fail, rel, `${base}.active_runner.repeat_unit`, runner?.repeat_unit, 'independent_journey_environment');
  expectScalar(fail, rel, `${base}.active_runner.full_environment_per_leaf`, runner?.full_environment_per_leaf, 'forbidden');
  expectScalar(fail, rel, `${base}.active_runner.process_start_formula`, runner?.process_start_formula, 'declared_journey_environment');
  expectScalar(fail, rel, `${base}.active_runner.legacy_fallback`, runner?.legacy_fallback, 'forbidden');
  checkAuthorityRefs(fail, rel, `${base}.active_runner.authority_refs`, runner?.authority_refs, definedRuleIds);
}

function checkLocalAgentBehaviorEvaluation({ contract, definedRuleIds, fail, rel }) {
  const base = 'local_agent_behavior_evaluation';
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    fail(`${rel} must declare ${base}`);
    return;
  }
  expectScalar(fail, rel, `${base}.contract_version`, contract.contract_version, 1);

  const expectation = contract.expectation_manifest;
  expectObject(fail, rel, `${base}.expectation_manifest`, expectation);
  expectScalar(fail, rel, `${base}.expectation_manifest.source`, expectation?.source, 'typed_source_snapshot');
  expectExactSet(fail, rel, expectation?.required_domains, [
    'identity',
    'behavior',
    'world',
    'relationship',
    'knowledge',
  ], `${base}.expectation_manifest.required_domains`);
  expectExactSet(fail, rel, expectation?.prohibited_sources, [
    'app_metadata',
    'evaluator_score',
    'raw_system_prompt',
  ], `${base}.expectation_manifest.prohibited_sources`);
  checkAuthorityRefs(fail, rel, `${base}.expectation_manifest.authority_refs`, expectation?.authority_refs, definedRuleIds);

  const bindings = contract.classification_bindings;
  expectObject(fail, rel, `${base}.classification_bindings`, bindings);
  const expectedBindings = new Map([
    ['deterministic_context_admission', ['behavior_unit', 'T4', null, ['P-TEST-010']]],
    ['electron_product_acceptance', ['product_acceptance', 'T6', 'after_real_shell_evidence', ['P-TEST-010']]],
    ['live_subject_behavior', ['live_provider_proof', 'T7', 'after_env_evidence', ['P-TEST-006', 'P-TEST-011']]],
    ['semantic_evaluator', ['live_provider_proof', 'T7', 'after_env_evidence', ['P-TEST-006', 'P-TEST-011']]],
  ]);
  expectExactSet(fail, rel, Object.keys(bindings || {}), [...expectedBindings.keys()], `${base}.classification_bindings keys`);
  for (const [id, [classification, tier, releaseEligibility, authorityRefs]] of expectedBindings) {
    const binding = bindings?.[id];
    expectObject(fail, rel, `${base}.classification_bindings.${id}`, binding);
    expectScalar(fail, rel, `${base}.classification_bindings.${id}.classification`, binding?.classification, classification);
    expectScalar(fail, rel, `${base}.classification_bindings.${id}.tier`, binding?.tier, tier);
    if (releaseEligibility === null) {
      if (Object.hasOwn(binding || {}, 'release_eligibility')) {
        fail(`${rel} ${base}.classification_bindings.${id}.release_eligibility must be absent`);
      }
    } else {
      expectScalar(
        fail,
        rel,
        `${base}.classification_bindings.${id}.release_eligibility`,
        binding?.release_eligibility,
        releaseEligibility,
      );
    }
    expectExactSet(
      fail,
      rel,
      binding?.authority_refs,
      authorityRefs,
      `${base}.classification_bindings.${id}.authority_refs`,
    );
    checkAuthorityRefs(
      fail,
      rel,
      `${base}.classification_bindings.${id}.authority_refs`,
      binding?.authority_refs,
      definedRuleIds,
    );
  }

  const contextAdmission = contract.deterministic_context_admission;
  expectObject(fail, rel, `${base}.deterministic_context_admission`, contextAdmission);
  expectScalar(
    fail,
    rel,
    `${base}.deterministic_context_admission.evidence_source`,
    contextAdmission?.evidence_source,
    'provider_visible_runtime_request_capture',
  );
  expectExactSet(fail, rel, contextAdmission?.required_domains, [
    'identity',
    'behavior',
    'boundary',
    'world',
    'relationship',
    'knowledge',
    'transcript',
    'memory',
  ], `${base}.deterministic_context_admission.required_domains`);
  expectExactSet(fail, rel, contextAdmission?.required_assertions, [
    'typed_lane',
    'lane_order',
    'content_hash',
    'token_budget',
    'forbidden_canary_absence',
    'exact_provider_call_count',
  ], `${base}.deterministic_context_admission.required_assertions`);
  expectScalar(
    fail,
    rel,
    `${base}.deterministic_context_admission.fixture_substitutes_live_behavior`,
    contextAdmission?.fixture_substitutes_live_behavior,
    false,
  );
  checkAuthorityRefs(
    fail,
    rel,
    `${base}.deterministic_context_admission.authority_refs`,
    contextAdmission?.authority_refs,
    definedRuleIds,
  );

  const route = contract.route_independence;
  expectObject(fail, rel, `${base}.route_independence`, route);
  expectScalar(fail, rel, `${base}.route_independence.executor`, route?.executor, 'runtime_ai_execution');
  expectExactSet(fail, rel, route?.fingerprint_fields, [
    'providerId',
    'modelId',
    'modelRevisionOrFingerprint',
  ], `${base}.route_independence.fingerprint_fields`);
  expectScalar(
    fail,
    rel,
    `${base}.route_independence.comparison`,
    route?.comparison,
    'complete_fingerprint_must_differ',
  );
  expectScalar(
    fail,
    rel,
    `${base}.route_independence.unresolved_or_equal_outcome`,
    route?.unresolved_or_equal_outcome,
    'blocked_live_provider_admission',
  );
  expectScalar(fail, rel, `${base}.route_independence.app_or_test_direct_provider`, route?.app_or_test_direct_provider, 'forbidden');
  expectScalar(fail, rel, `${base}.route_independence.provider_model_constants`, route?.provider_model_constants, 'forbidden');
  checkAuthorityRefs(fail, rel, `${base}.route_independence.authority_refs`, route?.authority_refs, definedRuleIds);

  const evaluator = contract.evaluator_contract;
  expectObject(fail, rel, `${base}.evaluator_contract`, evaluator);
  expectExactSet(fail, rel, evaluator?.input_allowlist, [
    'expectation_manifest',
    'rubric',
    'transcript',
  ], `${base}.evaluator_contract.input_allowlist`);
  expectExactSet(fail, rel, evaluator?.input_forbidden, [
    'raw_system_prompt',
    'private_context_lanes',
    'product_anchor',
    'product_memory_scope',
  ], `${base}.evaluator_contract.input_forbidden`);
  expectScalar(fail, rel, `${base}.evaluator_contract.result_format`, evaluator?.result_format, 'strict_json_schema');
  expectScalar(
    fail,
    rel,
    `${base}.evaluator_contract.unknown_or_malformed_outcome`,
    evaluator?.unknown_or_malformed_outcome,
    'fail_closed',
  );
  expectExactSet(fail, rel, evaluator?.deterministic_dimensions, [
    'facts',
    'boundaries',
    'ids',
    'hashes',
    'leakage',
  ], `${base}.evaluator_contract.deterministic_dimensions`);
  expectExactSet(fail, rel, evaluator?.semantic_dimensions, [
    'style',
    'cadence',
    'voice',
    'pacing',
  ], `${base}.evaluator_contract.semantic_dimensions`);
  checkAuthorityRefs(fail, rel, `${base}.evaluator_contract.authority_refs`, evaluator?.authority_refs, definedRuleIds);

  const calibration = contract.calibration;
  expectObject(fail, rel, `${base}.calibration`, calibration);
  expectExactSet(fail, rel, calibration?.controls_per_dimension, [
    'known_pass',
    'deliberate_fail',
  ], `${base}.calibration.controls_per_dimension`);
  expectScalar(fail, rel, `${base}.calibration.timing`, calibration?.timing, 'before_subject_trials');
  expectExactSet(fail, rel, calibration?.block_on, [
    'control_misclassification',
    'constant_scoring',
    'schema_mismatch',
    'reason_code_mismatch',
    'route_collision',
  ], `${base}.calibration.block_on`);
  expectExactSet(fail, rel, calibration?.fixed_within_batch, [
    'thresholds',
    'controls',
    'rubric',
    'result_schema',
  ], `${base}.calibration.fixed_within_batch`);
  expectScalar(fail, rel, `${base}.calibration.retry_policy`, calibration?.retry_policy, 'none');
  checkAuthorityRefs(fail, rel, `${base}.calibration.authority_refs`, calibration?.authority_refs, definedRuleIds);

  const evidence = contract.evidence_and_state;
  expectObject(fail, rel, `${base}.evidence_and_state`, evidence);
  expectScalar(fail, rel, `${base}.evidence_and_state.raw_trial_retention`, evidence?.raw_trial_retention, 'all');
  expectScalar(fail, rel, `${base}.evidence_and_state.denominator`, evidence?.denominator, 'all_original_trials');
  expectScalar(fail, rel, `${base}.evidence_and_state.product_state_mutation`, evidence?.product_state_mutation, 'forbidden');
  expectExactSet(fail, rel, evidence?.mutation_targets, [
    'realm_source',
    'runtime_source_snapshot',
    'local_agent',
    'turn',
    'message',
    'transcript',
    'memory',
    'anchor',
  ], `${base}.evidence_and_state.mutation_targets`);
  expectScalar(
    fail,
    rel,
    `${base}.evidence_and_state.score_truth_role`,
    evidence?.score_truth_role,
    'non_authoritative_evaluation_evidence',
  );
  expectScalar(fail, rel, `${base}.evidence_and_state.score_context_influence`, evidence?.score_context_influence, 'forbidden');
  checkAuthorityRefs(fail, rel, `${base}.evidence_and_state.authority_refs`, evidence?.authority_refs, definedRuleIds);
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
    '**/*.spec.mjs',
    '**/*.spec.js',
    '**/*_test.go',
  ], 'census.include_globs');
  expectExactSet(fail, rel, census.helper_globs, [
    '**/*-helpers.mjs',
    '**/*.test-helper.ts',
  ], 'census.helper_globs');
  expectExactSet(fail, rel, census.exclude_dirs, [
    'archive',
    '_external',
    'node_modules',
    'dist',
    'generated',
    '.next',
    '.cache',
    '.iterate',
  ], 'census.exclude_dirs');
  checkAuthorityRefs(fail, rel, 'census.authority_refs', census.authority_refs, definedRuleIds);
}

function checkModuleOwnerMap({ definedRuleIds, fail, rel, moduleRows }) {
  const rows = Array.isArray(moduleRows) ? moduleRows : [];
  const expectedDomains = new Map([
    ['runtime', ['runtime', 'runtime', 'config/runtime-test-inventory.yaml']],
    ['desktop', ['desktop', 'apps/desktop', 'config/desktop-test-inventory.yaml']],
    ['kit', ['platform', 'kit', 'config/kit-test-inventory.yaml']],
    ['sdks-typescript', ['sdks', 'sdks/typescript', 'config/sdks-typescript-test-inventory.yaml']],
    ['avatar', ['avatar', 'apps/avatar', 'config/avatar-test-inventory.yaml']],
    ['scripts', ['platform', 'scripts', 'config/scripts-test-inventory.yaml']],
    ['local-agent-product', ['platform', 'tests/local-agent-product', 'config/local-agent-product-test-inventory.yaml']],
    ['zhiyu', ['zhiyu', 'apps/zhiyu/test', 'config/zhiyu-test-inventory.yaml']],
    ['nimi-cognition', ['cognition', 'nimi-cognition', 'config/nimi-cognition-test-inventory.yaml']],
    ['tester', ['tester', 'apps/tester', 'config/tester-test-inventory.yaml']],
    ['web', ['web', 'apps/web', 'config/web-test-inventory.yaml']],
    ['install-gateway', ['web', 'apps/install-gateway', 'config/install-gateway-test-inventory.yaml']],
  ]);
  if (rows.length !== expectedDomains.size) {
    fail(`${rel} module_owner_map must contain exactly ${expectedDomains.size} entries`);
  }
  const seenDomains = new Set();
  for (const row of rows) {
    const domain = String(row?.domain || '').trim();
    if (!domain) {
      fail(`${rel} module_owner_map row missing domain`);
      continue;
    }
    if (seenDomains.has(domain)) fail(`${rel} duplicate module_owner_map domain ${domain}`);
    seenDomains.add(domain);
    const expected = expectedDomains.get(domain);
    if (!expected) {
      fail(`${rel} unexpected module_owner_map domain ${domain}`);
      continue;
    }
    const [owner, root, inventory] = expected;
    if (row?.owner !== owner) fail(`${rel} module_owner_map.${domain}.owner must be ${owner}`);
    if (row?.root !== root) fail(`${rel} module_owner_map.${domain}.root must be ${root}`);
    if (row?.inventory !== inventory) fail(`${rel} module_owner_map.${domain}.inventory must be ${inventory}`);
    checkAuthorityRefs(fail, rel, `module_owner_map.${domain}.authority_refs`, row?.authority_refs, definedRuleIds);
  }
  for (const domain of expectedDomains.keys()) {
    if (!seenDomains.has(domain)) fail(`${rel} missing module_owner_map domain ${domain}`);
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
