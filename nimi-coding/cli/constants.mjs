export const VERSION = "0.1.0";
export const PACKAGE_NAME = "@nimiplatform/nimi-coding";
export const BOOTSTRAP_CONTRACT_ID = "nimicoding.bootstrap";
export const BOOTSTRAP_CONTRACT_VERSION = 1;
export const HANDOFF_PAYLOAD_CONTRACT_VERSION = "nimicoding.handoff.v1";
export const CLOSEOUT_PAYLOAD_CONTRACT_VERSION = "nimicoding.closeout.v1";
export const HIGH_RISK_INGEST_PAYLOAD_CONTRACT_VERSION = "nimicoding.high-risk-ingest.v1";
export const HIGH_RISK_REVIEW_PAYLOAD_CONTRACT_VERSION = "nimicoding.high-risk-review.v1";
export const HIGH_RISK_DECISION_PAYLOAD_CONTRACT_VERSION = "nimicoding.high-risk-decision.v1";
export const HIGH_RISK_ADMISSION_PAYLOAD_CONTRACT_VERSION = "nimicoding.high-risk-admission.v1";
export const STANDALONE_COMPLETION_PROFILE = "boundary_complete";
export const STANDALONE_COMPLETION_STATUS = {
  COMPLETE: "complete",
  DRIFTED: "drifted",
  INCOMPLETE: "incomplete",
};
export const STANDALONE_COMPLETED_SURFACES = [
  "bootstrap",
  "doctor",
  "handoff",
  "validators",
  "topic_lifecycle_report_methodology",
  "closeout",
  "ingest",
  "review",
  "decision",
  "admission",
  "host_overlay_recognition",
];
export const STANDALONE_DEFERRED_EXECUTION_SURFACES = [
  "packet_bound_run_kernel",
  "provider_backed_execution",
  "scheduler",
  "notification",
  "automation_backend",
  "multi_topic_orchestration",
];
export const STANDALONE_PROMOTED_PARITY_GAP_SUMMARY = [
  "packet_bound_run_kernel",
  "provider_backed_execution",
  "scheduler_automation_notification",
];

export const LOCAL_GITIGNORE_ENTRIES = [".nimi/local/", ".nimi/cache/"];

export const AGENTS_BEGIN = "<!-- nimicoding:managed:agents:start -->";
export const AGENTS_END = "<!-- nimicoding:managed:agents:end -->";
export const CLAUDE_BEGIN = "<!-- nimicoding:managed:claude:start -->";
export const CLAUDE_END = "<!-- nimicoding:managed:claude:end -->";

export const SPEC_RECONSTRUCTION_RESULT_CONTRACT_REF = ".nimi/contracts/spec-reconstruction-result.yaml";
export const DOC_SPEC_AUDIT_RESULT_CONTRACT_REF = ".nimi/contracts/doc-spec-audit-result.yaml";
export const HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF = ".nimi/contracts/high-risk-execution-result.yaml";
export const HIGH_RISK_ADMISSION_CONTRACT_REF = ".nimi/contracts/high-risk-admission.schema.yaml";
export const EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF = ".nimi/contracts/external-host-compatibility.yaml";
export const HOST_ADAPTER_CONFIG_REF = ".nimi/config/host-adapter.yaml";
export const EXTERNAL_EXECUTION_ARTIFACTS_CONFIG_REF = ".nimi/config/external-execution-artifacts.yaml";
export const EXECUTION_PACKET_SCHEMA_REF = ".nimi/contracts/execution-packet.schema.yaml";
export const ORCHESTRATION_STATE_SCHEMA_REF = ".nimi/contracts/orchestration-state.schema.yaml";
export const PROMPT_SCHEMA_REF = ".nimi/contracts/prompt.schema.yaml";
export const WORKER_OUTPUT_SCHEMA_REF = ".nimi/contracts/worker-output.schema.yaml";
export const ACCEPTANCE_SCHEMA_REF = ".nimi/contracts/acceptance.schema.yaml";
export const ADAPTER_PACKAGE_PROFILE_REFS = {
  oh_my_codex: "adapters/oh-my-codex/profile.yaml",
};
export const EXTERNAL_HOST_COMPATIBILITY_REQUIRED_BEHAVIOR = [
  "consume_handoff_json_as_authoritative_contract",
  "treat_handoff_prompt_as_human_projection_only",
  "read_project_local_nimi_truth",
  "route_declared_external_skills",
  "fail_closed_on_missing_authority",
];
export const EXTERNAL_HOST_COMPATIBILITY_SUPPORTED_POSTURE = [
  "host_agnostic_external_host",
];
export const EXTERNAL_HOST_COMPATIBILITY_FORBIDDEN_BEHAVIOR = [
  "assume_packaged_run_kernel",
  "assume_provider_or_scheduler_ownership",
  "promote_runtime_state_to_semantic_truth",
  "redefine_acceptance_disposition_or_finding_judgment",
];
export const EXTERNAL_HOST_COMPATIBILITY_SUPPORTED_HOST_EXAMPLES = [
  "oh_my_codex",
  "codex",
  "claude",
  "gemini",
];

export const HIGH_RISK_ADMISSION_REQUIRED_TOP_LEVEL_KEYS = [
  "admissions",
  "admission_rules",
  "semantic_constraints",
];

export const HIGH_RISK_ADMISSION_RECORD_REQUIRED_FIELDS = [
  "topic_id",
  "packet_id",
  "disposition",
  "admitted_at",
  "manager_review_owner",
  "summary",
  "source_decision_contract",
];

export const HIGH_RISK_ADMISSION_DISPOSITION_ENUM = [
  "complete",
  "partial",
  "deferred",
];

export const SPEC_RECONSTRUCTION_SUMMARY_REQUIRED_FIELDS = [
  "generated_paths",
  "audit_ref",
  "coverage_summary",
  "unresolved_file_count",
  "inferred_file_count",
  "status",
  "summary",
  "verified_at",
];

export const SPEC_RECONSTRUCTION_SUMMARY_STATUS = [
  "reconstructed",
  "partial",
  "blocked",
];

export const SPEC_GENERATION_AUDIT_REQUIRED_TOP_LEVEL_FIELDS = [
  "generation_mode",
  "canonical_target_root",
  "declared_profile",
  "input_roots",
  "files",
];

export const SPEC_GENERATION_AUDIT_FILE_REQUIRED_FIELDS = [
  "canonical_path",
  "file_class",
  "source_refs",
  "source_basis",
  "coverage_status",
  "unresolved_items",
];

export const SPEC_GENERATION_AUDIT_SOURCE_BASIS_ENUM = [
  "grounded",
  "mixed_grounded_and_inferred",
  "inferred",
];

export const SPEC_GENERATION_AUDIT_COVERAGE_STATUS_ENUM = [
  "complete",
  "partial",
  "placeholder_not_allowed",
];

export const DOC_SPEC_AUDIT_SUMMARY_REQUIRED_FIELDS = [
  "compared_paths",
  "finding_count",
  "status",
  "summary",
  "verified_at",
];

export const DOC_SPEC_AUDIT_SUMMARY_STATUS = [
  "aligned",
  "drift_detected",
  "blocked",
];

export const HIGH_RISK_EXECUTION_SUMMARY_REQUIRED_FIELDS = [
  "packet_ref",
  "orchestration_state_ref",
  "prompt_ref",
  "worker_output_ref",
  "evidence_refs",
  "status",
  "summary",
  "verified_at",
];

export const HIGH_RISK_EXECUTION_SUMMARY_STATUS = [
  "candidate_ready",
  "blocked",
  "failed",
];

export const HIGH_RISK_EXECUTION_ARTIFACT_ROOTS = {
  packet_ref: ".nimi/local/packets",
  orchestration_state_ref: ".nimi/local/orchestration",
  prompt_ref: ".nimi/local/prompts",
  worker_output_ref: ".nimi/local/outputs",
  evidence_refs: ".nimi/local/evidence",
};

export const HIGH_RISK_EXECUTION_ARTIFACT_HARD_CONSTRAINTS = [
  "external_execution_artifacts_remain_operational_only",
  "imported_refs_must_stay_under_declared_local_roots",
  "candidate_artifacts_must_not_override_semantic_truth",
];

export const DOC_SPEC_AUDIT_DEFAULT_COMPARED_PATHS = [
  "README.md",
  ".nimi/spec",
];

export const SPEC_TREE_MODEL_REF = ".nimi/spec/_meta/spec-tree-model.yaml";
export const BLUEPRINT_REFERENCE_REF = ".nimi/spec/_meta/blueprint-reference.yaml";
export const COMMAND_GATING_MATRIX_REF = ".nimi/spec/_meta/command-gating-matrix.yaml";
export const GENERATE_DRIFT_MIGRATION_CHECKLIST_REF = ".nimi/spec/_meta/generate-drift-migration-checklist.yaml";
export const GOVERNANCE_ROUTING_CUTOVER_CHECKLIST_REF = ".nimi/spec/_meta/governance-routing-cutover-checklist.yaml";
export const PHASE2_IMPACTED_SURFACE_MATRIX_REF = ".nimi/spec/_meta/phase2-impacted-surface-matrix.yaml";
export const SPEC_GENERATION_AUDIT_REF = ".nimi/spec/_meta/spec-generation-audit.yaml";
export const SPEC_GENERATION_INPUTS_REF = ".nimi/config/spec-generation-inputs.yaml";
export const SPEC_GENERATION_INPUTS_CONTRACT_REF = ".nimi/contracts/spec-generation-inputs.schema.yaml";
export const SPEC_GENERATION_AUDIT_CONTRACT_REF = ".nimi/contracts/spec-generation-audit.schema.yaml";

export const SKILL_RESULT_CONTRACT_REFS = {
  spec_reconstruction: SPEC_RECONSTRUCTION_RESULT_CONTRACT_REF,
  doc_spec_audit: DOC_SPEC_AUDIT_RESULT_CONTRACT_REF,
  high_risk_execution: HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF,
};

export const REQUIRED_BOOTSTRAP_FILES = [
  ".nimi/methodology/core.yaml",
  ".nimi/methodology/spec-reconstruction.yaml",
  ".nimi/methodology/skill-runtime.yaml",
  ".nimi/methodology/skill-installer-result.yaml",
  ".nimi/methodology/skill-installer-summary-projection.yaml",
  ".nimi/methodology/skill-exchange-projection.yaml",
  ".nimi/methodology/skill-handoff.yaml",
  SPEC_TREE_MODEL_REF,
  COMMAND_GATING_MATRIX_REF,
  GENERATE_DRIFT_MIGRATION_CHECKLIST_REF,
  GOVERNANCE_ROUTING_CUTOVER_CHECKLIST_REF,
  PHASE2_IMPACTED_SURFACE_MATRIX_REF,
  ".nimi/spec/product-scope.yaml",
  ".nimi/spec/bootstrap-state.yaml",
  ".nimi/config/bootstrap.yaml",
  ".nimi/config/skills.yaml",
  ".nimi/config/skill-manifest.yaml",
  SPEC_GENERATION_INPUTS_REF,
  ".nimi/config/host-profile.yaml",
  HOST_ADAPTER_CONFIG_REF,
  EXTERNAL_EXECUTION_ARTIFACTS_CONFIG_REF,
  ".nimi/config/skill-installer.yaml",
  ".nimi/config/installer-evidence.yaml",
  SPEC_RECONSTRUCTION_RESULT_CONTRACT_REF,
  DOC_SPEC_AUDIT_RESULT_CONTRACT_REF,
  HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF,
  HIGH_RISK_ADMISSION_CONTRACT_REF,
  SPEC_GENERATION_INPUTS_CONTRACT_REF,
  SPEC_GENERATION_AUDIT_CONTRACT_REF,
  EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF,
  EXECUTION_PACKET_SCHEMA_REF,
  ORCHESTRATION_STATE_SCHEMA_REF,
  PROMPT_SCHEMA_REF,
  WORKER_OUTPUT_SCHEMA_REF,
  ACCEPTANCE_SCHEMA_REF,
];

export const REQUIRED_LOCAL_DIRS = [".nimi/local", ".nimi/cache"];

export const REQUIRED_BOOTSTRAP_DIRS = [
  ".nimi/methodology",
  ".nimi/spec",
  ".nimi/config",
  ".nimi/contracts",
  ".nimi/local",
  ".nimi/cache",
];

export const HIGH_RISK_SCHEMA_SPECS = {
  [EXECUTION_PACKET_SCHEMA_REF]: {
    id: "nimi-coding.execution-packet.v1",
    kind: "execution-packet",
    listFields: {
      required: [
        "packet_id",
        "topic_id",
        "status",
        "owner",
        "created_at",
        "updated_at",
        "baseline_ref",
        "entry_phase_id",
        "phases",
        "escalation_policy",
        "notification_settings",
        "resume_policy",
      ],
      status_enum: ["draft", "frozen", "superseded", "archived"],
      phase_required: [
        "phase_id",
        "goal",
        "authority_refs",
        "write_scope",
        "read_scope",
        "required_checks",
        "completion_criteria",
        "escalation_conditions",
        "next_on_success",
        "stop_on_failure",
      ],
      phase_stop_on_failure_enum: ["pause", "stop"],
      escalation_policy_required: ["pause_conditions", "manager_decision_required"],
      notification_settings_required: ["on_block", "on_final_completion", "on_progress"],
      resume_policy_required: ["same_revision_resume_allowed_reasons", "new_packet_required_on"],
    },
    requiredRules: [
      "baseline_ref must resolve to a baseline artifact",
      "entry_phase_id must exist in phases[].phase_id",
      "next_on_success must be null or an existing phase_id",
      "packet must not encode transport secrets, runtime state, or semantic acceptance outcomes",
    ],
  },
  [ORCHESTRATION_STATE_SCHEMA_REF]: {
    id: "nimi-coding.orchestration-state.v1",
    kind: "orchestration-state",
    listFields: {
      required: [
        "state_id",
        "topic_id",
        "packet_ref",
        "run_status",
        "current_phase_id",
        "last_completed_phase_id",
        "awaiting_human_action",
        "updated_at",
        "owner",
      ],
      optional: [
        "pause_reason",
        "notification_refs",
        "current_prompt_ref",
        "latest_worker_output_ref",
        "latest_acceptance_ref",
        "latest_evidence_refs",
        "started_at",
      ],
      run_status_enum: [
        "running",
        "paused",
        "awaiting_confirmation",
        "completed",
        "failed",
        "superseded",
      ],
      notification_ref_required: ["event", "correlation_id"],
    },
    requiredRules: [
      "packet_ref must resolve to an execution packet artifact",
      "current_phase_id and last_completed_phase_id must be null or existing packet phase ids",
      "running state requires current_phase_id",
      "paused state requires current_phase_id, pause_reason, and awaiting_human_action",
      "awaiting_confirmation state requires current_phase_id and awaiting_human_action and is legacy-only for older runs",
      "failed state requires awaiting_human_action",
      "completed state requires last_completed_phase_id and must not carry current_phase_id, awaiting_human_action, or pause_reason",
      "resume_token and transport secrets are forbidden",
      "notification_refs entries may track event/correlation emission refs, but they must not become notification log state ownership",
      "orchestration state must not encode semantic acceptance or finding judgments",
    ],
  },
  [PROMPT_SCHEMA_REF]: {
    id: "nimi-coding.prompt.v1",
    kind: "prompt",
    listFields: {
      required_blocks: [
        "Task Goal",
        "Authority Reads",
        "Confirmed State",
        "Hard Constraints",
        "Must Complete",
        "Explicit Non-Goals",
        "Required Checks",
        "Required Final Output Format",
        "Blocker Escalation Rule",
      ],
    },
    requiredRules: [],
  },
  [WORKER_OUTPUT_SCHEMA_REF]: {
    id: "nimi-coding.worker-output.v1",
    kind: "worker-output",
    listFields: {
      required_blocks: [
        "Findings",
        "Implementation summary",
        "Files changed",
        "Checks run",
        "Remaining gaps / risks",
        "Runner Signal",
      ],
      optional_blocks: [
        "Chosen decision",
        "Authority / spec impact",
        "Guard behavior decision",
        "Next implementation step",
        "Remaining blockers",
      ],
    },
    requiredRules: [],
  },
  [ACCEPTANCE_SCHEMA_REF]: {
    id: "nimi-coding.acceptance.v1",
    kind: "acceptance",
    listFields: {
      required_order: [
        "authority alignment",
        "phase closure",
        "evidence sufficiency",
        "disposition",
        "next step or reopen",
      ],
      disposition_enum: ["complete", "partial", "deferred"],
      required_blocks: [
        "Findings",
        "Current Phase Disposition",
        "Next Step or Reopen Condition",
      ],
    },
    requiredRules: [],
  },
};
