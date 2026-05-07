import path from "node:path";
import { loadTopicRuntimeContracts } from "./contracts.mjs";

export const TOPIC_ROOT = path.join(".nimi", "topics"),
  TOPIC_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/,
  TOPIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  WAVE_ID_PATTERN = /^wave-[a-z0-9]+(?:-[a-z0-9]+)*$/,
  DEFAULT_TOPIC_RUNTIME_AUTHORITY = {
    topicStates: ["proposal", "ongoing", "pending", "closed"],
    minimalRequiredFields: [
      "topic_id",
      "state",
      "created_at",
      "last_transition_at",
      "last_transition_reason",
    ],
    enrichedRequiredFields: [
      "title",
      "mode",
      "posture",
      "design_policy",
      "parallel_truth",
      "layering",
      "risk",
      "applicability",
      "entry_justification",
      "execution_mode",
      "selected_next_target",
      "current_true_close_status",
      "forbidden_shortcuts",
    ],
    topicEnums: {
      mode: ["greenfield", "landed", "superseding"],
      posture: ["no_legacy_hard_cut", "backward_compat"],
      designPolicy: ["complete_contract_first", "mvp_incremental"],
      parallelTruth: ["forbidden", "admitted"],
      layering: ["ontology", "time_phased"],
      risk: ["high", "low"],
      applicability: [
        "authority_bearing",
        "high_risk_refactor",
        "multi_wave_iteration",
        "complex_remediation",
      ],
      executionMode: ["inline_manager_worker", "manager_worker_auditor"],
      trueCloseStatus: ["not_started", "pending", "true_closed", "revoked", "superseded"],
    },
    waveStates: [
      "candidate",
      "preflight_draft",
      "preflight_admitted",
      "implementation_admitted",
      "implementation_active",
      "needs_revision",
      "overflowed",
      "continuation_packet_open",
      "closed",
      "retired",
      "superseded",
    ],
    packetRequiredFields: [
      "packet_id",
      "topic_id",
      "wave_id",
      "packet_kind",
      "status",
      "authority_owner",
      "canonical_seams",
      "forbidden_shortcuts",
      "acceptance_invariants",
      "negative_tests",
      "reopen_conditions",
    ],
    packetFreezeAllowedStatuses: ["draft", "preflight", "candidate"],
    resultVerdicts: ["PASS", "NEEDS_REVISION", "FAIL", "OVERFLOW"],
    resultKinds: ["preflight", "implementation", "audit", "judgement"],
    resultVerifiedAtFormat: "iso8601_utc_timestamp",
    closeoutScopes: ["wave", "topic"],
    closureStates: ["open", "closed", "blocked"],
    closeoutDispositions: ["complete", "partial", "deferred"],
    remediationKinds: ["a", "b", "continuation", "execution_state_closure"],
    decisionDispositions: ["retired", "superseded", "unchanged"],
    pendingNoteRequiredFields: [
      "pending_note_id",
      "topic_id",
      "entered_from_state",
      "reason",
      "summary",
      "status",
    ],
    pendingNoteStatuses: ["active", "resumed", "closed"],
    defaultForbiddenShortcuts: [
      "mvp_subset_contract",
      "legacy_alias",
      "compat_shim",
      "dual_read",
      "dual_write",
      "placeholder_success",
      "happy_path_only_closure",
      "time_phased_layering",
      "app_local_shadow_truth",
      "silent_owner_cut_reopen",
    ],
    recommendedFiles: [
      "README.md",
      "design.md",
      "preflight.md",
      "waves.md",
      "candidate-wave-plan.md",
      "implementation-doctrine.md",
      "admission-checklists.md",
      "manager-session-protocol.md",
      "manager-prompts.md",
    ],
    closureDimensions: ["authority", "semantic", "consumer", "drift_resistance"],
    waveCloseoutEvidence: { requirePacketLineage: true, requireResultLineage: true },
    trueCloseAuditEvidence: {
      requireWaveCloseoutForClosedWaves: true,
      requirePacketLineageForClosedWaves: true,
      requireResultLineageForClosedWaves: true,
    },
    topicStepDecision: {
      stopClasses: [
        "continue",
        "require_human_confirmation",
        "await_external_evidence",
        "blocked",
        "completed",
      ],
      recommendedActions: [
        "admit_wave",
        "freeze_packet",
        "dispatch_worker",
        "dispatch_audit",
        "record_result",
        "open_remediation",
        "continue_overflow",
        "hold_topic",
        "resume_topic",
        "closeout_wave",
        "closeout_topic",
        "no_action",
      ],
    },
    topicRunLedger: {
      eventKinds: [
        "decision_emitted",
        "wave_admitted",
        "packet_frozen",
        "worker_dispatched",
        "audit_dispatched",
        "result_recorded",
        "human_gate_opened",
        "human_gate_resolved",
        "wave_closed",
        "topic_closed",
        "runner_blocked",
      ],
      runStatuses: [
        "running",
        "awaiting_human_confirmation",
        "awaiting_external_evidence",
        "blocked",
        "completed",
      ],
      artifactRefKeys: [
        "decision_ref",
        "packet_ref",
        "prompt_ref",
        "worker_output_ref",
        "audit_output_ref",
        "result_ref",
        "closeout_ref",
        "evidence_ref",
      ],
      retryPostures: [
        "not_applicable",
        "retry_allowed_same_command",
        "retry_requires_new_packet",
        "retry_forbidden_until_human_gate",
      ],
    },
    ignoredTopicValidateSemantics: { status: "report_only", canonicalSuccess: false },
  },
  topicRuntimeAuthorityCache = new Map(),
  PENDING_ENTRY_BLOCKER_STATES = new Set([
    "preflight_admitted",
    "implementation_admitted",
    "implementation_active",
    "needs_revision",
    "overflowed",
    "continuation_packet_open",
  ]);
export function formatDate(date = new Date()) {
  const year = date.getFullYear(),
    month = String(date.getMonth() + 1).padStart(2, "0"),
    day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
export function toPortableRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}
export function toStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .filter((entry) => typeof entry == "string" && entry.length > 0)
    .map((entry) => String(entry));
  return normalized.length > 0 ? normalized : fallback;
}
export function normalizeBoolean(value, fallback) {
  return typeof value == "boolean" ? value : fallback;
}
export async function loadTopicRuntimeAuthority(projectRoot) {
  const cached = topicRuntimeAuthorityCache.get(projectRoot);
  if (cached) return cached;
  const loaded = await loadTopicRuntimeContracts(projectRoot),
    topicSchema = loaded.topicSchema.data ?? {},
    waveSchema = loaded.waveSchema.data ?? {},
    packetSchema = loaded.packetSchema.data ?? {},
    resultSchema = loaded.resultSchema.data ?? {},
    closeoutSchema = loaded.closeoutSchema.data ?? {},
    remediationSchema = loaded.remediationSchema.data ?? {},
    decisionReviewSchema = loaded.decisionReviewSchema.data ?? {},
    pendingNoteSchema = loaded.pendingNoteSchema.data ?? {},
    topicStepDecisionSchema = loaded.topicStepDecisionSchema.data ?? {},
    topicRunLedgerSchema = loaded.topicRunLedgerSchema.data ?? {},
    forbiddenShortcutsCatalog = loaded.forbiddenShortcutsCatalog.data ?? {},
    lifecycleReport = loaded.lifecycleReport.data?.topic_lifecycle_report ?? {},
    fourClosurePolicy = loaded.fourClosurePolicy.data?.four_closure_policy ?? {},
    validationPolicy = loaded.validationPolicy.data?.topic_validation_policy ?? {},
    minimalRequiredFields = toStringArray(
      lifecycleReport.state_evidence?.required_fields,
      DEFAULT_TOPIC_RUNTIME_AUTHORITY.minimalRequiredFields,
    ),
    enrichedRequiredFields = toStringArray(
      topicSchema.required,
      DEFAULT_TOPIC_RUNTIME_AUTHORITY.enrichedRequiredFields,
    ).filter((field) => !minimalRequiredFields.includes(field)),
    authority = {
      topicStates: toStringArray(
        topicSchema.state_enum,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicStates,
      ),
      minimalRequiredFields,
      enrichedRequiredFields,
      topicEnums: {
        mode: toStringArray(topicSchema.mode_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.mode),
        posture: toStringArray(
          topicSchema.posture_enum,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.posture,
        ),
        designPolicy: toStringArray(
          topicSchema.design_policy_enum,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.designPolicy,
        ),
        parallelTruth: toStringArray(
          topicSchema.parallel_truth_enum,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.parallelTruth,
        ),
        layering: toStringArray(
          topicSchema.layering_enum,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.layering,
        ),
        risk: toStringArray(topicSchema.risk_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.risk),
        applicability: toStringArray(
          topicSchema.applicability_enum,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.applicability,
        ),
        executionMode: toStringArray(
          topicSchema.execution_mode_enum,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.executionMode,
        ),
        trueCloseStatus: toStringArray(
          topicSchema.true_close_status_enum,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.trueCloseStatus,
        ),
      },
      waveStates: toStringArray(waveSchema.state_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.waveStates),
      packetRequiredFields: toStringArray(
        packetSchema.required,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.packetRequiredFields,
      ),
      packetFreezeAllowedStatuses: toStringArray(
        packetSchema.freeze_allowed_status_enum,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.packetFreezeAllowedStatuses,
      ),
      resultVerdicts: toStringArray(
        resultSchema.verdict_enum,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.resultVerdicts,
      ),
      resultKinds: toStringArray(
        resultSchema.result_kind_enum,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.resultKinds,
      ),
      resultVerifiedAtFormat:
        typeof resultSchema.verified_at_format == "string"
          ? resultSchema.verified_at_format
          : DEFAULT_TOPIC_RUNTIME_AUTHORITY.resultVerifiedAtFormat,
      closeoutScopes: toStringArray(
        closeoutSchema.scope_enum,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.closeoutScopes,
      ),
      closureStates: toStringArray(
        closeoutSchema.closure_enum,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.closureStates,
      ),
      closeoutDispositions: toStringArray(
        closeoutSchema.disposition_enum,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.closeoutDispositions,
      ),
      remediationKinds: toStringArray(
        remediationSchema.kind_enum,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.remediationKinds,
      ),
      decisionDispositions: toStringArray(
        decisionReviewSchema.disposition_enum,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.decisionDispositions,
      ),
      pendingNoteRequiredFields: toStringArray(
        pendingNoteSchema.required,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.pendingNoteRequiredFields,
      ),
      pendingNoteStatuses: toStringArray(
        pendingNoteSchema.status_enum,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.pendingNoteStatuses,
      ),
      defaultForbiddenShortcuts: Array.isArray(forbiddenShortcutsCatalog.entries)
        ? forbiddenShortcutsCatalog.entries
            .map((entry) => (typeof entry?.key == "string" ? entry.key : null))
            .filter(Boolean)
        : DEFAULT_TOPIC_RUNTIME_AUTHORITY.defaultForbiddenShortcuts,
      recommendedFiles: toStringArray(
        lifecycleReport.recommended_files,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.recommendedFiles,
      ).filter((entry) => !entry.includes("*")),
      closureDimensions: toStringArray(
        fourClosurePolicy.closures,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.closureDimensions,
      ),
      waveCloseoutEvidence: {
        requirePacketLineage: normalizeBoolean(
          fourClosurePolicy.wave_closeout_evidence?.require_packet_lineage,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.waveCloseoutEvidence.requirePacketLineage,
        ),
        requireResultLineage: normalizeBoolean(
          fourClosurePolicy.wave_closeout_evidence?.require_result_lineage,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.waveCloseoutEvidence.requireResultLineage,
        ),
      },
      trueCloseAuditEvidence: {
        requireWaveCloseoutForClosedWaves: normalizeBoolean(
          fourClosurePolicy.true_close_audit_evidence?.require_wave_closeout_for_closed_waves,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.trueCloseAuditEvidence.requireWaveCloseoutForClosedWaves,
        ),
        requirePacketLineageForClosedWaves: normalizeBoolean(
          fourClosurePolicy.true_close_audit_evidence?.require_packet_lineage_for_closed_waves,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.trueCloseAuditEvidence.requirePacketLineageForClosedWaves,
        ),
        requireResultLineageForClosedWaves: normalizeBoolean(
          fourClosurePolicy.true_close_audit_evidence?.require_result_lineage_for_closed_waves,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.trueCloseAuditEvidence.requireResultLineageForClosedWaves,
        ),
      },
      topicStepDecision: {
        stopClasses: toStringArray(
          topicStepDecisionSchema.stop_class_enum,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicStepDecision.stopClasses,
        ),
        recommendedActions: toStringArray(
          topicStepDecisionSchema.recommended_action_enum,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicStepDecision.recommendedActions,
        ),
      },
      topicRunLedger: {
        eventKinds: toStringArray(
          topicRunLedgerSchema.event_kind_enum,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicRunLedger.eventKinds,
        ),
        runStatuses: toStringArray(
          topicRunLedgerSchema.run_status_enum,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicRunLedger.runStatuses,
        ),
        artifactRefKeys: toStringArray(
          topicRunLedgerSchema.artifact_ref_keys,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicRunLedger.artifactRefKeys,
        ),
        retryPostures: toStringArray(
          topicRunLedgerSchema.retry_posture_enum,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicRunLedger.retryPostures,
        ),
      },
      ignoredTopicValidateSemantics: {
        status:
          typeof validationPolicy.ignored_topic_validate_semantics?.status == "string"
            ? validationPolicy.ignored_topic_validate_semantics.status
            : DEFAULT_TOPIC_RUNTIME_AUTHORITY.ignoredTopicValidateSemantics.status,
        canonicalSuccess: normalizeBoolean(
          validationPolicy.ignored_topic_validate_semantics?.canonical_success,
          DEFAULT_TOPIC_RUNTIME_AUTHORITY.ignoredTopicValidateSemantics.canonicalSuccess,
        ),
      },
    };
  return (topicRuntimeAuthorityCache.set(projectRoot, authority), authority);
}
