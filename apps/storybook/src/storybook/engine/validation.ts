// Cross-product validation, observability, and the complete failure taxonomy
// (wave-13). This is the app's "doctor": it aggregates every owner-slice validator
// into one report, summarizes generation observability, and produces a
// provenance/audit view. It owns no truth — it only reads and reports.

import { type StorybookFailureCode, type ValidationFinding, type ValidationReport, validationReport } from './failure.js';
import { type TruthRef } from './ids.js';
import { type StorybookTruthPackage, validateTruthPackage } from './truth.js';
import { validateProjectionFreshness } from './projection.js';
import { validatePreparedPackage } from './prepared-package.js';
import {
  type RealmWorldAgentImport,
  type RealmPromotionRequest,
  validateRealmImport,
  validateRealmPromotionRequest,
} from './realm.js';

/**
 * The complete first-class failure taxonomy. The `_exhaustive` guard below makes
 * this a COMPILE-TIME error if any `StorybookFailureCode` is missing — the taxonomy
 * can never silently drift behind the codes the engine actually uses.
 */
export const FAILURE_TAXONOMY = [
  // intake / lite rule builder
  'source_too_large_for_app_lite_builder', 'scenario_seed_invalid', 'character_card_invalid', 'source_corpus_invalid',
  'structured_notes_invalid', 'document_text_invalid', 'manual_setting_invalid', 'intake_kind_unsupported', 'long_novel_extraction_unsupported',
  // truth package / authority
  'truth_package_section_incomplete', 'truth_ref_unresolved', 'evidence_binding_unresolved',
  'projection_missing_governing_truth_ref', 'projection_introduces_unbacked_rule', 'projection_stale',
  // foundation
  'scenario_frame_incomplete', 'agent_cast_visibility_invalid', 'branch_topology_invalid', 'state_ending_matrix_invalid', 'asset_spec_incomplete',
  // adaptation
  'adaptation_brief_invalid', 'adaptation_unconfirmed', 'adaptation_spoiler_leak', 'divergence_decision_invalid', 'visual_style_guide_invalid', 'bible_validation_failed',
  // run / narrative engine
  'chapter_graph_unreachable', 'chapter_dead_end', 'ending_unreachable', 'ending_closure_missing',
  'choices_missing_for_default_progression', 'free_text_not_required_violation', 'narrative_core_output_invalid',
  'narrative_context_insufficient', 'narrative_guard_rejected', 'narrative_guard_adjusted', 'narrative_spine_write_conflict',
  'agent_turn_failed', 'run_transcript_inconsistent',
  // playable run / branch
  'branch_switch_invalid', 'run_state_conflict', 'node_ref_missing', 'route_condition_invalid', 'checkpoint_invalid',
  // assets
  'asset_missing_generation_not_success', 'asset_state_invalid',
  // generation runs / batches
  'ai_generation_failed', 'asset_generation_failed', 'artifact_missing', 'generation_batch_invalid',
  'generation_batch_state_conflict', 'generation_retry_exhausted', 'generation_provenance_missing',
  // realm import / promotion
  'realm_world_agent_import_invalid', 'realm_imported_ref_stale', 'realm_import_conflict',
  'realm_promotion_request_invalid', 'realm_run_state_promotion_forbidden',
  // promotion / memory
  'promotion_enum_invalid', 'promotion_auto_accept_forbidden_class', 'promotion_assessment_failed', 'feedback_patch_target_invalid',
  // studio editor / regeneration
  'edit_conflict', 'edit_target_invalid', 'regeneration_scope_invalid',
  // prepared package
  'prepared_package_invalid_manifest', 'prepared_package_incompatible_version', 'prepared_package_missing_start_entry',
  'prepared_package_missing_required_asset', 'prepared_package_redaction_failure', 'prepared_package_stale_projection',
  'prepared_package_invalid_validator_result',
  // ai boundary
  'ai_runtime_unavailable', 'ai_binding_missing', 'ai_request_invalid',
] as const satisfies readonly StorybookFailureCode[];

// Compile-time exhaustiveness: errors if a code is missing from FAILURE_TAXONOMY.
type _Uncovered = Exclude<StorybookFailureCode, (typeof FAILURE_TAXONOMY)[number]>;
const _exhaustive: _Uncovered extends never ? true : _Uncovered = true;
void _exhaustive;

// --- generation observability (structural input; decoupled from ai/**) ---

export type GenerationRunObservation = {
  id: string;
  kind: string;
  provenance: { status: 'succeeded' | 'unavailable'; reason?: string };
};

export type GenerationObservability = {
  total: number;
  succeeded: number;
  unavailable: number;
  reasonHistogram: Record<string, number>;
};

export function summarizeGeneration(runs: GenerationRunObservation[]): GenerationObservability {
  const reasonHistogram: Record<string, number> = {};
  let succeeded = 0;
  let unavailable = 0;
  for (const run of runs) {
    if (run.provenance.status === 'succeeded') {
      succeeded += 1;
    } else {
      unavailable += 1;
      const reason = run.provenance.reason ?? 'unknown';
      reasonHistogram[reason] = (reasonHistogram[reason] ?? 0) + 1;
    }
  }
  return { total: runs.length, succeeded, unavailable, reasonHistogram };
}

// --- provenance / audit view ---

export type ProvenanceAudit = {
  refsWithEvidence: number;
  refsWithDerivation: number;
  refsWithDivergence: number;
  assetProvenanceEntries: number;
  /** truth refs that have neither evidence, derivation, nor divergence backing. */
  unbackedRefs: TruthRef[];
};

export function buildProvenanceAudit(pkg: StorybookTruthPackage): ProvenanceAudit {
  const evidenceRefs = new Set(pkg.evidence.map((e) => e.truthRef));
  const derivationRefs = new Set(pkg.derivations.map((d) => d.toRef));
  const divergenceRefs = new Set(pkg.divergences.map((d) => d.targetRef));
  const backed = (ref: TruthRef) => evidenceRefs.has(ref) || derivationRefs.has(ref) || divergenceRefs.has(ref);

  const significant: TruthRef[] = [];
  if (pkg.bible) significant.push(pkg.bible.ref);
  if (pkg.scenarioFrame) significant.push(pkg.scenarioFrame.ref);
  if (pkg.agentCast) significant.push(pkg.agentCast.ref);

  return {
    refsWithEvidence: evidenceRefs.size,
    refsWithDerivation: derivationRefs.size,
    refsWithDivergence: divergenceRefs.size,
    assetProvenanceEntries: pkg.assets.reduce((sum, asset) => sum + asset.provenance.length, 0),
    unbackedRefs: significant.filter((ref) => !backed(ref)),
  };
}

// --- the cross-product doctor ---

export type DiagnosticsSection = { name: string; report: ValidationReport };

export type DiagnosticsInput = {
  pkg?: StorybookTruthPackage;
  preparedPackages?: unknown[];
  realmImports?: RealmWorldAgentImport[];
  realmPromotions?: RealmPromotionRequest[];
  generationRuns?: GenerationRunObservation[];
  knownRealmRelease?: string;
};

export type DiagnosticsReport = {
  ok: boolean;
  sections: DiagnosticsSection[];
  generationObservability: GenerationObservability;
  provenanceAudit: ProvenanceAudit | null;
};

/**
 * Run every owner-slice validator over a project bundle and aggregate the result.
 * `ok` is true only when no section has findings — a single failure anywhere fails
 * the whole report (no pseudo-success).
 */
export function runFullDiagnostics(input: DiagnosticsInput): DiagnosticsReport {
  const sections: DiagnosticsSection[] = [];

  if (input.pkg) {
    sections.push({ name: 'truth-package', report: validateTruthPackage(input.pkg) });
    sections.push({ name: 'projection-freshness', report: validationReport(validateProjectionFreshness(input.pkg)) });
  }

  (input.realmImports ?? []).forEach((record, index) => {
    sections.push({ name: `realm-import[${index}]`, report: validationReport(validateRealmImport(record, input.knownRealmRelease)) });
  });

  (input.realmPromotions ?? []).forEach((request, index) => {
    sections.push({ name: `realm-promotion[${index}]`, report: validationReport(validateRealmPromotionRequest(request)) });
  });

  (input.preparedPackages ?? []).forEach((prepared, index) => {
    sections.push({ name: `prepared-package[${index}]`, report: validatePreparedPackage(prepared) });
  });

  const generationObservability = summarizeGeneration(input.generationRuns ?? []);
  const provenanceAudit = input.pkg ? buildProvenanceAudit(input.pkg) : null;
  const ok = sections.every((section) => section.report.valid);
  return { ok, sections, generationObservability, provenanceAudit };
}

/** Flatten a diagnostics report into a single finding list (for compact display). */
export function flattenDiagnostics(report: DiagnosticsReport): ValidationFinding[] {
  return report.sections.flatMap((section) => section.report.findings);
}
