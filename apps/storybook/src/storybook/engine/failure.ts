// Typed, fail-closed failure reasons for the Storybook Engine. Every place that
// could be tempted into pseudo-success returns a StorybookFailure instead. There
// is no silent fallback, no placeholder asset that pretends to be generated, and
// no happy-path-only closure.

export type StorybookFailureCode =
  // intake / lite rule builder
  | 'source_too_large_for_app_lite_builder'
  | 'scenario_seed_invalid'
  | 'character_card_invalid'
  | 'source_corpus_invalid'
  | 'structured_notes_invalid'
  | 'document_text_invalid'
  | 'manual_setting_invalid'
  | 'intake_kind_unsupported'
  | 'long_novel_extraction_unsupported'
  // truth package / authority
  | 'truth_package_section_incomplete'
  | 'truth_ref_unresolved'
  | 'evidence_binding_unresolved'
  | 'projection_missing_governing_truth_ref'
  | 'projection_introduces_unbacked_rule'
  | 'projection_stale'
  // foundation
  | 'scenario_frame_incomplete'
  | 'agent_cast_visibility_invalid'
  | 'branch_topology_invalid'
  | 'state_ending_matrix_invalid'
  | 'asset_spec_incomplete'
  // adaptation model (wave-7)
  | 'adaptation_brief_invalid'
  | 'adaptation_unconfirmed'
  | 'adaptation_spoiler_leak'
  | 'divergence_decision_invalid'
  | 'visual_style_guide_invalid'
  | 'bible_validation_failed'
  // run / narrative engine
  | 'chapter_graph_unreachable'
  | 'chapter_dead_end'
  | 'ending_unreachable'
  | 'ending_closure_missing'
  | 'choices_missing_for_default_progression'
  | 'free_text_not_required_violation'
  | 'narrative_core_output_invalid'
  | 'narrative_context_insufficient'
  | 'narrative_guard_rejected'
  | 'narrative_guard_adjusted'
  | 'narrative_spine_write_conflict'
  | 'agent_turn_failed'
  | 'run_transcript_inconsistent'
  // playable run / branch model (wave-10)
  | 'branch_switch_invalid'
  | 'run_state_conflict'
  | 'node_ref_missing'
  | 'route_condition_invalid'
  | 'checkpoint_invalid'
  // assets
  | 'asset_missing_generation_not_success'
  | 'asset_state_invalid'
  // generation runs / batches (wave-9)
  | 'ai_generation_failed'
  | 'asset_generation_failed'
  | 'artifact_missing'
  | 'generation_batch_invalid'
  | 'generation_batch_state_conflict'
  | 'generation_retry_exhausted'
  | 'generation_provenance_missing'
  // realm import / promotion boundary
  | 'realm_world_agent_import_invalid'
  | 'realm_imported_ref_stale'
  | 'realm_import_conflict'
  | 'realm_promotion_request_invalid'
  | 'realm_run_state_promotion_forbidden'
  // promotion / memory
  | 'promotion_enum_invalid'
  | 'promotion_auto_accept_forbidden_class'
  | 'promotion_assessment_failed'
  | 'feedback_patch_target_invalid'
  // studio editor / regeneration (wave-12)
  | 'edit_conflict'
  | 'edit_target_invalid'
  | 'regeneration_scope_invalid'
  // prepared package
  | 'prepared_package_invalid_manifest'
  | 'prepared_package_incompatible_version'
  | 'prepared_package_missing_start_entry'
  | 'prepared_package_missing_required_asset'
  | 'prepared_package_redaction_failure'
  | 'prepared_package_stale_projection'
  | 'prepared_package_invalid_validator_result'
  // ai boundary
  | 'ai_runtime_unavailable'
  | 'ai_binding_missing'
  | 'ai_request_invalid';

export type StorybookFailure = {
  ok: false;
  code: StorybookFailureCode;
  message: string;
  /** Optional field/path pointers so creators can locate the offending record. */
  pointers?: string[];
};

export type Ok<T> = { ok: true; value: T };
export type Result<T> = Ok<T> | StorybookFailure;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function fail(code: StorybookFailureCode, message: string, pointers?: string[]): StorybookFailure {
  return pointers && pointers.length ? { ok: false, code, message, pointers } : { ok: false, code, message };
}

export function isFailure<T>(result: Result<T>): result is StorybookFailure {
  return result.ok === false;
}

/** Aggregate validator finding for surfaces that report many issues at once. */
export type ValidationFinding = {
  code: StorybookFailureCode;
  message: string;
  pointers?: string[];
};

export type ValidationReport = {
  valid: boolean;
  findings: ValidationFinding[];
};

export function validationReport(findings: ValidationFinding[]): ValidationReport {
  return { valid: findings.length === 0, findings };
}
