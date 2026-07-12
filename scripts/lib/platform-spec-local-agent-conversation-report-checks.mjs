function array(value) {
  return Array.isArray(value) ? value : [];
}

function sameSet(left, right) {
  const a = [...new Set(array(left))].sort();
  const b = [...new Set(array(right))].sort();
  return a.length === array(left).length && b.length === array(right).length && JSON.stringify(a) === JSON.stringify(b);
}

function expectObject(fail, rel, label, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${rel} ${label} must be an object`);
}

function expectScalar(fail, rel, label, actual, expected) {
  if (actual !== expected) fail(`${rel} ${label} must be ${JSON.stringify(expected)}`);
}

function expectSet(fail, rel, label, actual, expected) {
  if (!sameSet(actual, expected)) fail(`${rel} ${label} must contain exactly ${expected.join(', ')}`);
}

function checkRefs(fail, rel, label, refs, definedRuleIds) {
  if (array(refs).length === 0) {
    fail(`${rel} ${label} must declare authority_refs`);
    return;
  }
  for (const ref of refs) if (!definedRuleIds.has(ref)) fail(`${rel} ${label} references undefined rule ${ref}`);
}

export function checkLocalAgentConversationReport({ contract, definedRuleIds, fail, rel }) {
  const base = 'local_agent_conversation_report';
  expectObject(fail, rel, base, contract);
  expectScalar(fail, rel, `${base}.contract_version`, contract?.contract_version, 1);

  const identity = contract?.identity_model;
  expectObject(fail, rel, `${base}.identity_model`, identity);
  for (const [field, expected] of Object.entries({
    source_owner: 'realm',
    source_role_after_materialization: 'provenance_and_frozen_typed_snapshot',
    local_agent_owner: 'runtime',
    conversation_owner: 'runtime',
    registry_or_app_derived_identity: 'forbidden',
    automatic_source_rebase: 'forbidden',
    materializations_per_declared_source: 1,
  })) expectScalar(fail, rel, `${base}.identity_model.${field}`, identity?.[field], expected);
  expectSet(fail, rel, `${base}.identity_model.source_kinds`, identity?.source_kinds, ['worldCharacter', 'realmPersona']);
  expectSet(fail, rel, `${base}.identity_model.resolved_identity_fields`, identity?.resolved_identity_fields, ['localAgentRef', 'conversationAnchorId']);
  checkRefs(fail, rel, `${base}.identity_model.authority_refs`, identity?.authority_refs, definedRuleIds);

  const bindings = contract?.classification_bindings;
  expectObject(fail, rel, `${base}.classification_bindings`, bindings);
  const bindingExpectations = {
    deterministic_context_integrity: ['behavior_unit', 'T4', null],
    electron_product_execution: ['product_acceptance', 'T6', 'after_real_shell_evidence'],
    live_provider_execution: ['live_provider_proof', 'T7', 'after_env_evidence'],
  };
  expectSet(fail, rel, `${base}.classification_bindings keys`, Object.keys(bindings || {}), Object.keys(bindingExpectations));
  for (const [id, [classification, tier, eligibility]] of Object.entries(bindingExpectations)) {
    const row = bindings?.[id];
    expectScalar(fail, rel, `${base}.classification_bindings.${id}.classification`, row?.classification, classification);
    expectScalar(fail, rel, `${base}.classification_bindings.${id}.tier`, row?.tier, tier);
    if (eligibility) expectScalar(fail, rel, `${base}.classification_bindings.${id}.release_eligibility`, row?.release_eligibility, eligibility);
    else if (Object.hasOwn(row || {}, 'release_eligibility')) fail(`${rel} ${base}.classification_bindings.${id}.release_eligibility must be absent`);
    checkRefs(fail, rel, `${base}.classification_bindings.${id}.authority_refs`, row?.authority_refs, definedRuleIds);
  }

  const baseline = contract?.baseline_shape;
  expectObject(fail, rel, `${base}.baseline_shape`, baseline);
  for (const [field, expected] of Object.entries({
    clean_environment_count: 1,
    local_agent_stream_count: 2,
    lifecycle_timeline_count: 1,
    runtime_restart_count: 1,
    realm_offline_transition_count: 1,
    model_count: 1,
    run_count: 1,
    repeat_count: 1,
    retry_policy: 'none',
    full_environment_per_scene_or_turn: 'forbidden',
  })) expectScalar(fail, rel, `${base}.baseline_shape.${field}`, baseline?.[field], expected);
  if (JSON.stringify(baseline?.source_materialization_count) !== JSON.stringify({ worldCharacter: 1, realmPersona: 1 })) fail(`${rel} ${base}.baseline_shape.source_materialization_count must materialize each source once`);
  if (JSON.stringify(baseline?.environment_starts) !== JSON.stringify({ provider: 1, realm: 1, runtime: 2, desktop: 1, zhiyu: 1 })) fail(`${rel} ${base}.baseline_shape.environment_starts must describe one environment plus one Runtime restart`);
  checkRefs(fail, rel, `${base}.baseline_shape.authority_refs`, baseline?.authority_refs, definedRuleIds);

  const streams = contract?.stream_contract;
  expectObject(fail, rel, `${base}.stream_contract`, streams);
  expectSet(fail, rel, `${base}.stream_contract.required_source_kinds`, streams?.required_source_kinds, ['worldCharacter', 'realmPersona']);
  expectSet(fail, rel, `${base}.stream_contract.required_distinct_fields`, streams?.required_distinct_fields, ['localAgentRef', 'conversationAnchorId', 'sourceSnapshotHash', 'memoryScope']);
  for (const [field, expected] of Object.entries({
    cross_surface_continuity: 'same_localAgentRef_and_conversationAnchorId',
    restart_continuity: 'same_localAgentRef_and_conversationAnchorId',
    realm_offline_input: 'frozen_local_agent_source_snapshot',
    app_materialization_after_handoff: 'forbidden',
  })) expectScalar(fail, rel, `${base}.stream_contract.${field}`, streams?.[field], expected);
  checkRefs(fail, rel, `${base}.stream_contract.authority_refs`, streams?.authority_refs, definedRuleIds);

  const model = contract?.model_identity;
  expectObject(fail, rel, `${base}.model_identity`, model);
  expectScalar(fail, rel, `${base}.model_identity.selection_owner`, model?.selection_owner, 'runtime_catalog_and_ai_config');
  expectSet(fail, rel, `${base}.model_identity.required_fields`, model?.required_fields, ['providerId', 'modelId', 'modelRevisionOrFingerprint']);
  expectScalar(fail, rel, `${base}.model_identity.route_change_within_run`, model?.route_change_within_run, 'forbidden');
  expectScalar(fail, rel, `${base}.model_identity.app_or_test_direct_provider`, model?.app_or_test_direct_provider, 'forbidden');
  expectScalar(fail, rel, `${base}.model_identity.provider_model_constants`, model?.provider_model_constants, 'forbidden');
  checkRefs(fail, rel, `${base}.model_identity.authority_refs`, model?.authority_refs, definedRuleIds);

  const bundle = contract?.report_bundle;
  expectObject(fail, rel, `${base}.report_bundle`, bundle);
  expectSet(fail, rel, `${base}.report_bundle.required_files`, bundle?.required_files, ['report.html', 'report.json', 'run-manifest.json', 'transcripts', 'screenshots', 'provider-captures', 'runtime-state']);
  expectSet(fail, rel, `${base}.report_bundle.turn_correlation_chain`, bundle?.turn_correlation_chain, ['accountId', 'sourceRef', 'sourceSnapshotRef', 'localAgentRef', 'conversationAnchorId', 'turnId', 'surface', 'providerId', 'modelId', 'modelRevisionOrFingerprint']);
  expectSet(fail, rel, `${base}.report_bundle.required_turn_captures`, bundle?.required_turn_captures, ['contextSummary', 'memorySnapshot', 'relationshipSnapshot', 'presentationOutput']);
  expectSet(fail, rel, `${base}.report_bundle.required_presentation_fields`, bundle?.required_presentation_fields, ['voice', 'emotion', 'activity', 'apml', 'hooks']);
  expectScalar(fail, rel, `${base}.report_bundle.transcript_report_agreement`, bundle?.transcript_report_agreement, 'exact');
  expectScalar(fail, rel, `${base}.report_bundle.local_links_resolve`, bundle?.local_links_resolve, 'required');
  checkRefs(fail, rel, `${base}.report_bundle.authority_refs`, bundle?.authority_refs, definedRuleIds);

  const findings = contract?.objective_findings;
  expectObject(fail, rel, `${base}.objective_findings`, findings);
  expectScalar(fail, rel, `${base}.objective_findings.semantic_outcomes`, findings?.semantic_outcomes, 'forbidden');
  expectSet(fail, rel, `${base}.objective_findings.automatic_outcomes`, findings?.automatic_outcomes, ['journey_execution', 'process_health', 'transport_completion', 'correlation_integrity', 'artifact_integrity', 'page_console_errors', 'privacy_findings', 'exact_cross_agent_canary_leakage', 'lifecycle_execution', 'time_budget', 'environment_start_counts']);
  checkRefs(fail, rel, `${base}.objective_findings.authority_refs`, findings?.authority_refs, definedRuleIds);

  const review = contract?.human_review;
  expectObject(fail, rel, `${base}.human_review`, review);
  expectScalar(fail, rel, `${base}.human_review.dimensions_role`, review?.dimensions_role, 'report_headings_only');
  expectSet(fail, rel, `${base}.human_review.status_values`, review?.status_values, ['unreviewed', 'accepted', 'needs_adjustment']);
  expectScalar(fail, rel, `${base}.human_review.generated_default_status`, review?.generated_default_status, 'unreviewed');
  expectScalar(fail, rel, `${base}.human_review.generated_default_notes`, review?.generated_default_notes, '');
  expectSet(fail, rel, `${base}.human_review.forbidden_automation`, review?.forbidden_automation, ['semantic_matcher', 'style_score', 'semantic_threshold', 'evaluator_calibration', 'automatic_accepted']);
  expectScalar(fail, rel, `${base}.human_review.optional_ai_annotation_authority`, review?.optional_ai_annotation_authority, 'none');
  expectScalar(fail, rel, `${base}.human_review.admission_threshold`, review?.admission_threshold, 'none');
  checkRefs(fail, rel, `${base}.human_review.authority_refs`, review?.authority_refs, definedRuleIds);
}
