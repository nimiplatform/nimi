import path from "node:path";

import {
  assertDesignArtifact,
  AUDITOR_FAMILIES,
  AUDITOR_MODES,
  AUDITOR_RESULT_ORIGINS,
  deriveRunId,
  designRef,
  FINAL_OUTCOME_STATES,
  findingAuthorityRef,
  findingCodeRefs,
  inputError,
  loadAuditFindings,
  loadYamlRef,
  LLM_AUDITOR_RESULT_ORIGINS,
  normalizeFindingForDesign,
  nowIso,
  PRIOR_DESIGN_STATE_MARKERS,
  requireRunId,
  REVISION_TYPES,
  safeDesignId,
  sha256Object,
  stableStringify,
  TRANSIENT_STATES,
  writeYamlRef,
} from "./common.mjs";

const ZERO_HASH = "0".repeat(64);

function inventoryRef(runId) {
  return designRef(runId, "inventory.yaml");
}

function packetRef(runId, packetId) {
  return designRef(runId, "design-auditor-packets", `${packetId}.yaml`);
}

function resultRef(runId, resultId) {
  return designRef(runId, "design-auditor-results", `${resultId}.yaml`);
}

function auditorPromptRef(runId, packetId) {
  return designRef(runId, "auditor-prompts", `${packetId}.yaml`);
}

function batchManifestRef(runId, manifestId) {
  return designRef(runId, "batch-manifests", `${manifestId}.yaml`);
}

function ledgerRef(runId) {
  return designRef(runId, "revision-ledger.yaml");
}

function finalStateReportRef(runId) {
  return designRef(runId, "final-state-report.yaml");
}

function wavePlanRef(runId) {
  return designRef(runId, "wave-plan.yaml");
}

function decisionQueueRef(runId) {
  return designRef(runId, "decision-queue.yaml");
}

async function loadInventory(projectRoot, runId) {
  return assertDesignArtifact(projectRoot, inventoryRef(runId), "sweep-design-inventory", "inventory");
}

function splitList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeIdList(value) {
  return [...new Set(splitList(value))].sort();
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return { ok: false, error: `nimicoding sweep design refused: ${label} must be a positive integer.\n` };
  }
  return { ok: true, value: parsed };
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function requireArray(value, label, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  return value;
}

function requireNonEmptyArray(value, label, errors) {
  const array = requireArray(value, label, errors);
  if (array.length === 0) errors.push(`${label} must not be empty`);
  return array;
}

function requireString(value, label, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${label} must be a non-empty string`);
    return "";
  }
  return value;
}

function validateRequiredFields(value, fields, label, errors) {
  for (const field of fields) {
    if (value[field] === undefined || value[field] === null) {
      errors.push(`${label}.${field} is required`);
    }
  }
}

function findInventoryFindings(inventory, findingIds) {
  const byId = new Map(inventory.findings.map((finding) => [finding.finding_id, finding]));
  return findingIds.map((findingId) => byId.get(findingId)).filter(Boolean);
}

function relatedFindingCandidates(inventory, selectedIds) {
  const selected = findInventoryFindings(inventory, selectedIds);
  const selectedOwners = new Set(selected.map((finding) => finding.owner_domain).filter(Boolean));
  const selectedCategories = new Set(selected.map((finding) => finding.category).filter(Boolean));
  return inventory.findings
    .filter((finding) => !selectedIds.includes(finding.finding_id))
    .filter((finding) => selectedOwners.has(finding.owner_domain) || selectedCategories.has(finding.category))
    .map((finding) => finding.source_finding_ref)
    .slice(0, 12);
}

function initialLedger(runId, timestamp) {
  const ledger = {
    version: 1,
    kind: "sweep-design-revision-ledger",
    run_id: runId,
    ledger_id: `${runId}-revision-ledger`,
    append_only: true,
    entries: [],
    previous_ledger_snapshot_hash: null,
    entries_root_hash: ZERO_HASH,
    ledger_snapshot_hash: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  ledger.ledger_snapshot_hash = computeLedgerSnapshotHash(ledger);
  return ledger;
}

function entryHashPayload(entry) {
  const clone = { ...entry };
  delete clone.entry_hash;
  return clone;
}

function computeEntryHash(entry) {
  return sha256Object(entryHashPayload(entry));
}

function computeEntriesRootHash(entries) {
  return sha256Object(entries.map((entry) => entry.entry_hash));
}

function computeLedgerSnapshotHash(ledger) {
  return sha256Object({
    run_id: ledger.run_id,
    ledger_id: ledger.ledger_id,
    append_only: ledger.append_only,
    entries_root_hash: ledger.entries_root_hash,
    entry_count: ledger.entries.length,
    previous_ledger_snapshot_hash: ledger.previous_ledger_snapshot_hash ?? null,
  });
}

function validateLedger(ledger) {
  const errors = [];
  if (!ledger || ledger.kind !== "sweep-design-revision-ledger") {
    return ["revision ledger is missing or malformed"];
  }
  if (ledger.append_only !== true) errors.push("revision ledger append_only must be true");
  if (!Array.isArray(ledger.entries)) errors.push("revision ledger entries must be an array");
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  let previous = ZERO_HASH;
  entries.forEach((entry, index) => {
    if (entry.entry_index !== index + 1) errors.push(`revision entry ${index + 1} has non-monotonic entry_index`);
    if (entry.previous_entry_hash !== previous) errors.push(`revision entry ${entry.revision_entry_id ?? index + 1} has invalid previous_entry_hash`);
    const actual = computeEntryHash(entry);
    if (entry.entry_hash !== actual) errors.push(`revision entry ${entry.revision_entry_id ?? index + 1} has invalid entry_hash`);
    previous = entry.entry_hash;
  });
  if (entries.length > 0 && ledger.entries_root_hash !== computeEntriesRootHash(entries)) {
    errors.push("revision ledger entries_root_hash is invalid");
  }
  if (entries.length === 0 && ledger.entries_root_hash !== ZERO_HASH) {
    errors.push("empty revision ledger entries_root_hash must be zero hash");
  }
  if (ledger.ledger_snapshot_hash !== computeLedgerSnapshotHash(ledger)) {
    errors.push("revision ledger ledger_snapshot_hash is invalid");
  }
  return errors;
}

async function loadOrCreateLedger(projectRoot, runId, timestamp) {
  const existing = await loadYamlRef(projectRoot, ledgerRef(runId));
  if (!existing) {
    const ledger = initialLedger(runId, timestamp);
    const ref = await writeYamlRef(projectRoot, ledgerRef(runId), ledger);
    return { ok: true, ref, value: ledger };
  }
  const errors = validateLedger(existing);
  if (errors.length > 0) {
    return inputError(`nimicoding sweep design refused: ${errors.join("; ")}.\n`);
  }
  return { ok: true, ref: ledgerRef(runId), value: existing };
}

function normalizeRevisionEntry(entry, context) {
  const nextIndex = context.ledger.entries.length + context.normalized.length + 1;
  const previousHash = context.normalized.length > 0
    ? context.normalized[context.normalized.length - 1].entry_hash
    : context.ledger.entries.at(-1)?.entry_hash ?? ZERO_HASH;
  const revisionType = requireString(entry.revision_type, "revision_entries[].revision_type", context.errors);
  if (revisionType && !REVISION_TYPES.has(revisionType)) {
    context.errors.push(`unsupported revision_type ${revisionType}`);
  }
  const replacementArtifactRefs = Array.isArray(entry.replacement_artifact_refs) ? entry.replacement_artifact_refs : [];
  if (!replacementArtifactRefs.includes(context.resultArtifactRef)) {
    replacementArtifactRefs.push(context.resultArtifactRef);
  }
  const normalized = {
    version: 1,
    kind: "sweep-design-revision-entry",
    revision_entry_id: entry.revision_entry_id ?? `${context.resultId}-revision-${String(nextIndex).padStart(4, "0")}`,
    entry_index: nextIndex,
    revision_type: revisionType,
    created_at: entry.created_at ?? context.timestamp,
    previous_entry_hash: previousHash,
    previous_artifact_refs: Array.isArray(entry.previous_artifact_refs) ? entry.previous_artifact_refs : [],
    replacement_artifact_refs: replacementArtifactRefs,
    affected_finding_ids: Array.isArray(entry.affected_finding_ids) ? entry.affected_finding_ids : [],
    affected_cluster_ids: Array.isArray(entry.affected_cluster_ids) ? entry.affected_cluster_ids : [],
    affected_wave_ids: Array.isArray(entry.affected_wave_ids) ? entry.affected_wave_ids : [],
    reason_code: requireString(entry.reason_code, "revision_entries[].reason_code", context.errors),
    evidence_refs: Array.isArray(entry.evidence_refs) ? entry.evidence_refs : [],
    auditor_provenance: entry.auditor_provenance ?? context.auditorProvenance,
    human_gate_status: entry.human_gate_status ?? "not_required",
    projection_refs_changed: Array.isArray(entry.projection_refs_changed) ? entry.projection_refs_changed : [],
  };
  normalized.entry_hash = computeEntryHash(normalized);
  return normalized;
}

function updateLedgerHashes(ledger, previousSnapshotHash, timestamp) {
  ledger.previous_ledger_snapshot_hash = previousSnapshotHash ?? ledger.previous_ledger_snapshot_hash ?? null;
  ledger.entries_root_hash = ledger.entries.length > 0 ? computeEntriesRootHash(ledger.entries) : ZERO_HASH;
  ledger.updated_at = timestamp;
  ledger.ledger_snapshot_hash = computeLedgerSnapshotHash(ledger);
  return ledger;
}

function finalOutcomeState(outcome) {
  return outcome.final_outcome ?? outcome.state ?? outcome.outcome ?? null;
}

function validateOutcome(outcome, context) {
  const errors = context.errors;
  const state = finalOutcomeState(outcome);
  requireString(outcome.finding_id, "finding_outcomes[].finding_id", errors);
  if (!FINAL_OUTCOME_STATES.has(state)) {
    errors.push(`finding_outcomes[] has unsupported final outcome ${state}`);
    return;
  }
  for (const field of [
    "design_auditor_packet_ref",
    "design_auditor_result_ref",
    "revision_ledger_entry_refs",
    "related_finding_ids_considered",
    "code_refs_considered",
    "authority_refs_considered",
  ]) {
    if (outcome[field] === undefined || outcome[field] === null) errors.push(`finding_outcomes[].${field} is required for ${state}`);
  }
  requireNonEmptyArray(outcome.revision_ledger_entry_refs, "finding_outcomes[].revision_ledger_entry_refs", errors);
  requireArray(outcome.related_finding_ids_considered, "finding_outcomes[].related_finding_ids_considered", errors);
  requireArray(outcome.code_refs_considered, "finding_outcomes[].code_refs_considered", errors);
  requireArray(outcome.authority_refs_considered, "finding_outcomes[].authority_refs_considered", errors);
  if (state === "duplicate" && !outcome.canonical_finding_or_cluster_ref) errors.push("duplicate outcome requires canonical_finding_or_cluster_ref");
  if (state === "superseded" && !outcome.superseding_finding_or_cluster_ref) errors.push("superseded outcome requires superseding_finding_or_cluster_ref");
  if (state === "false_positive" && !outcome.human_gate_ref) errors.push("false_positive outcome requires human_gate_ref");
  if (state === "ready_for_implementation_wave") {
    for (const field of ["wave_id_ref", "preflight_ref", "validation_command_refs", "closeout_criteria_ref"]) {
      if (outcome[field] === undefined || outcome[field] === null) errors.push(`ready_for_implementation_wave outcome requires ${field}`);
    }
    requireNonEmptyArray(outcome.validation_command_refs, "ready_for_implementation_wave.validation_command_refs", errors);
  }
  if (state === "needs_user_decision") {
    for (const field of ["decision_queue_item_ref", "decision_packet_ref", "recommended_decision", "queue_status", "blocked_downstream_wave_refs"]) {
      if (outcome[field] === undefined || outcome[field] === null) errors.push(`needs_user_decision outcome requires ${field}`);
    }
    requireNonEmptyArray(outcome.blocked_downstream_wave_refs, "needs_user_decision.blocked_downstream_wave_refs", errors);
    if (["accepted", "closed"].includes(outcome.queue_status) && !outcome.human_gate_decision_ref) {
      errors.push("accepted or closed needs_user_decision requires human_gate_decision_ref");
    }
  }
  if (state === "needs_more_audit" && !outcome.extra_audit_request_ref) errors.push("needs_more_audit outcome requires extra_audit_request_ref");
  if (state === "needs_authority_alignment" && !outcome.authority_convergence_ref) errors.push("needs_authority_alignment outcome requires authority_convergence_ref");
  if (state === "blocked") requireNonEmptyArray(outcome.blocking_cause_refs, "blocked.blocking_cause_refs", errors);
}

function validateAuditorResult(result) {
  const errors = [];
  if (!result || result.kind !== "sweep-design-design-auditor-result") {
    errors.push("result kind must be sweep-design-design-auditor-result");
    return errors;
  }
  validateRequiredFields(result, [
    "run_id",
    "packet_id",
    "result_id",
    "auditor",
    "auditor_family",
    "auditor_mode",
    "auditor_result_origin",
    "methodology_ref",
    "packet_ref",
    "session_ref",
    "transcript_ref",
    "result_schema_version",
    "provenance",
    "evidence_read",
    "finding_outcomes",
    "cluster_changes",
    "wave_changes",
    "revision_entries",
    "human_decision_requests",
    "extra_audit_requests",
    "validation_recommendations",
    "closeout_recommendations",
    "rejection_status",
  ], "result", errors);
  if (!AUDITOR_FAMILIES.has(result.auditor_family)) errors.push(`unsupported auditor_family ${result.auditor_family}`);
  if (!AUDITOR_MODES.has(result.auditor_mode)) errors.push(`unsupported auditor_mode ${result.auditor_mode}`);
  if (!AUDITOR_RESULT_ORIGINS.has(result.auditor_result_origin)) errors.push(`unsupported auditor_result_origin ${result.auditor_result_origin}`);
  if (LLM_AUDITOR_RESULT_ORIGINS.has(result.auditor_result_origin)) {
    for (const field of ["llm_session_ref", "llm_transcript_ref", "llm_prompt_ref"]) {
      requireString(result[field], `result.${field}`, errors);
    }
  }
  for (const field of [
    "evidence_read",
    "finding_outcomes",
    "cluster_changes",
    "wave_changes",
    "revision_entries",
    "human_decision_requests",
    "extra_audit_requests",
    "validation_recommendations",
    "closeout_recommendations",
  ]) {
    requireArray(result[field], `result.${field}`, errors);
  }
  return errors;
}

function isLlmAuditorResult(result) {
  return LLM_AUDITOR_RESULT_ORIGINS.has(result?.auditor_result_origin);
}

function isSyntheticAuditorResult(result) {
  return result?.auditor_result_origin === "synthetic_trial";
}

function validatePacket(packet) {
  const errors = [];
  validateRequiredFields(packet, [
    "run_id",
    "packet_id",
    "source_audit_sweep_id",
    "included_finding_ids",
    "source_finding_refs",
    "related_finding_refs",
    "related_code_refs",
    "authority_refs",
    "prior_design_state_refs",
    "prior_design_state_marker",
    "revision_ledger_refs",
    "current_cluster_refs",
    "current_wave_refs",
    "explicit_questions",
    "expected_result_shape_ref",
    "evidence_gap_policy",
    "stop_conditions",
  ], "packet", errors);
  requireNonEmptyArray(packet.included_finding_ids, "packet.included_finding_ids", errors);
  requireNonEmptyArray(packet.source_finding_refs, "packet.source_finding_refs", errors);
  if (!packet.authority_only_packet) requireNonEmptyArray(packet.related_code_refs, "packet.related_code_refs", errors);
  requireArray(packet.authority_refs, "packet.authority_refs", errors);
  requireArray(packet.related_finding_refs, "packet.related_finding_refs", errors);
  if (!PRIOR_DESIGN_STATE_MARKERS.has(packet.prior_design_state_marker)) {
    errors.push(`unsupported prior_design_state_marker ${packet.prior_design_state_marker}`);
  }
  if (packet.prior_design_state_marker !== "empty" && (!Array.isArray(packet.prior_design_state_refs) || packet.prior_design_state_refs.length === 0)) {
    errors.push("non-empty prior_design_state_marker requires prior_design_state_refs");
  }
  if (packet.prior_design_state_marker === "empty" && Array.isArray(packet.prior_design_state_refs) && packet.prior_design_state_refs.length > 0) {
    errors.push("prior_design_state_marker empty requires no prior_design_state_refs");
  }
  if (Array.isArray(packet.evidence_gaps) && packet.evidence_gaps.length > 0 && !packet.evidence_gap_result) {
    errors.push("material evidence gaps require evidence_gap_result");
  }
  return errors;
}

async function ensureRefAbsent(projectRoot, ref, label) {
  const existing = await loadYamlRef(projectRoot, ref);
  if (existing) {
    return inputError(`nimicoding sweep design refused: ${label} already exists at ${ref}.\n`);
  }
  return { ok: true };
}

function buildPacketValue(inventory, ledger, runId, packetId, includedFindingIds, options, timestamp) {
  const selected = findInventoryFindings(inventory, includedFindingIds);
  if (selected.length !== includedFindingIds.length) {
    const found = new Set(selected.map((finding) => finding.finding_id));
    const missing = includedFindingIds.filter((findingId) => !found.has(findingId));
    return { ok: false, error: `nimicoding sweep design refused: finding not found: ${missing.join(", ")}.\n` };
  }
  const relatedCodeRefs = [...new Set(selected.flatMap((finding) => findingCodeRefs({
    ...finding,
    implementation_refs: finding.evidence_refs,
  })))].sort();
  const authorityRefs = [...new Set(selected.map((finding) => finding.authority_ref).filter(Boolean))].sort();
  const priorDesignStateRefs = splitList(options.priorDesignStateRefs);
  const priorDesignStateMarker = options.priorDesignStateMarker ?? (priorDesignStateRefs.length > 0 ? "present" : "empty");
  const evidenceGaps = [];
  if (!options.authorityOnly && relatedCodeRefs.length === 0) evidenceGaps.push("related_code_refs_missing");
  const packet = {
    version: 2,
    kind: "sweep-design-design-auditor-packet",
    run_id: runId,
    packet_id: packetId,
    source_audit_sweep_id: inventory.source_audit_sweep_id,
    included_finding_ids: includedFindingIds,
    source_finding_refs: selected.map((finding) => finding.source_finding_ref),
    related_finding_refs: relatedFindingCandidates(inventory, includedFindingIds),
    related_code_refs: relatedCodeRefs,
    authority_refs: authorityRefs,
    authority_only_packet: Boolean(options.authorityOnly),
    prior_design_state_refs: priorDesignStateRefs,
    prior_design_state_marker: priorDesignStateMarker,
    revision_ledger_refs: [ledger.ref],
    current_cluster_refs: splitList(options.currentClusterRefs),
    current_wave_refs: splitList(options.currentWaveRefs),
    explicit_questions: splitList(options.explicitQuestions || options.explicitQuestion),
    expected_result_shape_ref: ".nimi/contracts/sweep-design-result.yaml#artifact_kinds.design_auditor_result",
    evidence_gap_policy: "missing_material_input_requires_explicit_gap_result_or_refusal",
    evidence_gaps: evidenceGaps,
    evidence_gap_result: evidenceGaps.length > 0 ? "blocked_until_material_input_supplied" : null,
    stop_conditions: [
      "product_fork",
      "authority_fork",
      "semantic_fork",
      "missing_evidence",
      "extra_audit_required",
      "authority_alignment_required",
      "human_decision_required",
    ],
    created_at: timestamp,
  };
  const errors = validatePacket(packet);
  if (errors.length > 0) return { ok: false, error: `nimicoding sweep design refused: ${errors.join("; ")}.\n` };
  return { ok: true, packet, selected };
}

function buildAuditorPromptValue(runId, packetId, packetRefValue, packet, timestamp) {
  return {
    version: 2,
    kind: "sweep-design-auditor-prompt",
    run_id: runId,
    packet_id: packetId,
    packet_ref: packetRefValue,
    expected_result_shape_ref: ".nimi/contracts/sweep-design-result.yaml#artifact_kinds.design_auditor_result",
    required_result_origin: "external_llm_session",
    synthetic_result_policy: "synthetic_trial_results_are_load_tests_only_and_do_not_satisfy_true_llm_closeout",
    required_llm_provenance_fields: [
      "auditor_result_origin",
      "llm_session_ref",
      "llm_transcript_ref",
      "llm_prompt_ref",
    ],
    task: [
      "Read every included source finding, related code ref, authority ref, related finding candidate, prior design state ref, current cluster ref, and current wave ref in the packet.",
      "Return a sweep-design-design-auditor-result with final outcomes for every included finding.",
      "Queue product, semantic, or authority forks instead of accepting them.",
      "Use needs_authority_alignment when implementation cannot safely proceed until authority ownership is aligned.",
      "Emit implementation-ready waves only when scope, authority owner, validation commands, negative checks, closeout criteria, and provenance are concrete.",
      "Do not mutate source audit findings.",
    ],
    packet_summary: {
      included_finding_count: packet.included_finding_ids.length,
      source_finding_refs: packet.source_finding_refs,
      related_code_refs: packet.related_code_refs,
      authority_refs: packet.authority_refs,
      related_finding_refs: packet.related_finding_refs,
      prior_design_state_refs: packet.prior_design_state_refs,
      current_cluster_refs: packet.current_cluster_refs,
      current_wave_refs: packet.current_wave_refs,
      explicit_questions: packet.explicit_questions,
    },
    created_at: timestamp,
  };
}

function waveIncludedCount(wave) {
  const counts = [
    Array.isArray(wave.finding_ids) ? wave.finding_ids.length : 0,
    Array.isArray(wave.merged_cluster_ids) ? wave.merged_cluster_ids.length : 0,
  ];
  return Math.max(...counts);
}

function validateWave(wave, errors) {
  for (const field of [
    "wave_id",
    "scope",
    "owner_domain",
    "authority_owner",
    "dependencies",
    "preflight_ref",
    "non_goals",
    "validation_commands",
    "negative_checks",
    "drift_resistance_checks",
    "closeout_criteria",
    "source_design_packet_refs",
    "design_auditor_result_refs",
    "revision_ledger_entry_refs",
    "blocked_gate_refs",
    "merged_cluster_ids",
    "merged_root_cause_keys",
  ]) {
    if (wave[field] === undefined || wave[field] === null) errors.push(`wave.${field} is required`);
  }
  for (const field of ["validation_commands", "negative_checks", "drift_resistance_checks", "closeout_criteria", "source_design_packet_refs", "design_auditor_result_refs", "revision_ledger_entry_refs"]) {
    requireNonEmptyArray(wave[field], `wave.${field}`, errors);
  }
  const count = waveIncludedCount(wave);
  if (count > 1 && !wave.consolidation_rationale) errors.push("multi-finding or multi-cluster wave requires consolidation_rationale");
  if (count <= 1 && !wave.isolation_justification) errors.push("single-finding or single-cluster wave requires isolation_justification");
}

function stopClassForResult(result) {
  const outcomes = result.finding_outcomes ?? [];
  if (outcomes.some((outcome) => finalOutcomeState(outcome) === "needs_user_decision") || (result.human_decision_requests ?? []).length > 0) {
    return "require_human_confirmation";
  }
  if (outcomes.some((outcome) => finalOutcomeState(outcome) === "needs_authority_alignment")) {
    return "authority_alignment_required";
  }
  if (outcomes.some((outcome) => finalOutcomeState(outcome) === "needs_more_audit") || (result.extra_audit_requests ?? []).length > 0) {
    return "extra_audit_required";
  }
  if (outcomes.some((outcome) => finalOutcomeState(outcome) === "blocked")) {
    return "blocked";
  }
  return null;
}

export async function runIntake(projectRoot, options) {
  const sweepId = safeDesignId(options.sweepId);
  if (!sweepId) return inputError("nimicoding sweep design refused: --sweep-id must be a stable id.\n");
  const audit = await loadAuditFindings(projectRoot, sweepId);
  if (!audit.ok) return audit;
  const runId = options.runId ? safeDesignId(options.runId) : deriveRunId(sweepId);
  if (!runId) return inputError("nimicoding sweep design refused: --run-id must be a stable id.\n");
  const timestamp = options.verifiedAt ?? nowIso();
  const findings = audit.store.findings.map((finding) => normalizeFindingForDesign(finding, audit.ref));
  const inventory = {
    version: 2,
    kind: "sweep-design-inventory",
    run_id: runId,
    artifact_role: "forked_design_workset",
    source_audit_sweep_id: sweepId,
    source_findings_ref: audit.ref,
    source_findings_sha256: audit.sourceSha256,
    source_findings_mutation_policy: "read_only_never_update_from_sweep_design",
    design_judgement_policy: "llm_auditor_result_required_for_final_outcomes",
    finding_count: findings.length,
    findings,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const ref = await writeYamlRef(projectRoot, inventoryRef(runId), inventory);
  await loadOrCreateLedger(projectRoot, runId, timestamp);
  return { ok: true, exitCode: 0, runId, sourceAuditSweepId: sweepId, inventoryRef: ref, ledgerRef: ledgerRef(runId), findingCount: findings.length };
}

export async function runPacketBuild(projectRoot, options) {
  const run = requireRunId(options);
  if (!run.ok) return run;
  const packetId = safeDesignId(options.packetId);
  if (!packetId) return inputError("nimicoding sweep design refused: --packet-id must be a stable id.\n");
  const includedFindingIds = normalizeIdList(options.findingIds || options.findingId);
  if (includedFindingIds.length === 0) {
    return inputError("nimicoding sweep design refused: packet-build requires --finding-id or --finding-ids.\n");
  }
  const inventory = await loadInventory(projectRoot, run.runId);
  if (!inventory.ok) return inventory;
  const ledger = await loadOrCreateLedger(projectRoot, run.runId, options.verifiedAt ?? nowIso());
  if (!ledger.ok) return ledger;
  const built = buildPacketValue(inventory.value, ledger, run.runId, packetId, includedFindingIds, options, options.verifiedAt ?? nowIso());
  if (!built.ok) return inputError(built.error);
  const { packet } = built;
  const ref = await writeYamlRef(projectRoot, packetRef(run.runId, packetId), packet);
  return { ok: true, exitCode: 0, runId: run.runId, packetRef: ref, packetId, findingCount: includedFindingIds.length };
}

export async function runPacketBuildBatch(projectRoot, options) {
  const run = requireRunId(options);
  if (!run.ok) return run;
  const batchSize = parsePositiveInteger(options.batchSize, "--batch-size");
  if (!batchSize.ok) return inputError(batchSize.error);
  const inventory = await loadInventory(projectRoot, run.runId);
  if (!inventory.ok) return inventory;
  const timestamp = options.verifiedAt ?? nowIso();
  const ledger = await loadOrCreateLedger(projectRoot, run.runId, timestamp);
  if (!ledger.ok) return ledger;
  const selectedFindingIds = normalizeIdList(options.findingIds)
    || inventory.value.findings.map((finding) => finding.finding_id).sort();
  const ids = selectedFindingIds.length > 0 ? selectedFindingIds : inventory.value.findings.map((finding) => finding.finding_id).sort();
  const found = new Set(inventory.value.findings.map((finding) => finding.finding_id));
  const missing = ids.filter((findingId) => !found.has(findingId));
  if (missing.length > 0) return inputError(`nimicoding sweep design refused: finding not found: ${missing.join(", ")}.\n`);
  const packetPrefix = options.packetPrefix || "packet";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,80}$/.test(packetPrefix)) {
    return inputError("nimicoding sweep design refused: --packet-prefix must be a stable id prefix.\n");
  }
  const manifestId = options.manifestId || `${packetPrefix}-manifest`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,120}$/.test(manifestId)) {
    return inputError("nimicoding sweep design refused: --manifest-id must be a stable artifact id.\n");
  }
  const manifestRef = batchManifestRef(run.runId, manifestId);
  const manifestAbsent = await ensureRefAbsent(projectRoot, manifestRef, "batch manifest");
  if (!manifestAbsent.ok) return manifestAbsent;
  const batches = chunkArray(ids, batchSize.value);
  const packetEntries = [];
  for (const [index, findingIds] of batches.entries()) {
    const packetId = `${packetPrefix}-${String(index + 1).padStart(4, "0")}`;
    const packetArtifactRef = packetRef(run.runId, packetId);
    const promptArtifactRef = auditorPromptRef(run.runId, packetId);
    for (const [ref, label] of [[packetArtifactRef, "design auditor packet"], [promptArtifactRef, "auditor prompt"]]) {
      const absent = await ensureRefAbsent(projectRoot, ref, label);
      if (!absent.ok) return absent;
    }
    const built = buildPacketValue(inventory.value, ledger, run.runId, packetId, findingIds, options, timestamp);
    if (!built.ok) return inputError(built.error);
    await writeYamlRef(projectRoot, packetArtifactRef, built.packet);
    await writeYamlRef(projectRoot, promptArtifactRef, buildAuditorPromptValue(run.runId, packetId, packetArtifactRef, built.packet, timestamp));
    packetEntries.push({
      packet_id: packetId,
      packet_ref: packetArtifactRef,
      prompt_ref: promptArtifactRef,
      finding_ids: findingIds,
      source_finding_refs: built.packet.source_finding_refs,
    });
  }
  const manifest = {
    version: 2,
    kind: "sweep-design-batch-manifest",
    run_id: run.runId,
    manifest_id: manifestId,
    source_inventory_ref: inventory.ref,
    source_audit_sweep_id: inventory.value.source_audit_sweep_id,
    source_findings_ref: inventory.value.source_findings_ref,
    source_findings_sha256: inventory.value.source_findings_sha256,
    source_findings_mutation_policy: "read_only_never_update_from_sweep_design",
    batch_policy: "deterministic_inventory_order_chunking",
    batch_size: batchSize.value,
    packet_prefix: packetPrefix,
    selected_finding_count: ids.length,
    packet_count: packetEntries.length,
    packets: packetEntries,
    generated_artifact_policy: "packets_and_prompts_only_no_auditor_results",
    true_llm_closeout_policy: "requires_external_llm_session_or_llm_session_results_ingested_later",
    created_at: timestamp,
  };
  const ref = await writeYamlRef(projectRoot, manifestRef, manifest);
  return {
    ok: true,
    exitCode: 0,
    runId: run.runId,
    manifestRef: ref,
    packetCount: packetEntries.length,
    promptCount: packetEntries.length,
    findingCount: ids.length,
    sourceFindingsSha256: inventory.value.source_findings_sha256,
  };
}

export async function runAuditorPrompt(projectRoot, options) {
  const run = requireRunId(options);
  if (!run.ok) return run;
  const packetId = safeDesignId(options.packetId);
  if (!packetId) return inputError("nimicoding sweep design refused: --packet-id must be a stable id.\n");
  const packet = await assertDesignArtifact(projectRoot, packetRef(run.runId, packetId), "sweep-design-design-auditor-packet", "design auditor packet");
  if (!packet.ok) return packet;
  const packetErrors = validatePacket(packet.value);
  if (packetErrors.length > 0) return inputError(`nimicoding sweep design refused: ${packetErrors.join("; ")}.\n`);
  const prompt = buildAuditorPromptValue(run.runId, packetId, packet.ref, packet.value, options.verifiedAt ?? nowIso());
  const ref = await writeYamlRef(projectRoot, auditorPromptRef(run.runId, packetId), prompt);
  return { ok: true, exitCode: 0, runId: run.runId, packetId, promptRef: ref, findingCount: packet.value.included_finding_ids.length };
}

export async function runResultIngest(projectRoot, options) {
  const run = requireRunId(options);
  if (!run.ok) return run;
  if (!options.from) return inputError("nimicoding sweep design refused: result-ingest requires --from.\n");
  const result = await loadYamlRef(projectRoot, options.from) ?? await import("node:fs/promises").then(async ({ readFile }) => {
    const YAML = await import("yaml");
    return YAML.parse(await readFile(path.resolve(projectRoot, options.from), "utf8"));
  }).catch(() => null);
  const errors = validateAuditorResult(result);
  if (errors.length > 0) return inputError(`nimicoding sweep design refused: ${errors.join("; ")}.\n`);
  if (isSyntheticAuditorResult(result) && options.allowSyntheticTrial !== true) {
    return inputError("nimicoding sweep design refused: synthetic_trial results require --allow-synthetic-trial and do not satisfy true LLM closeout.\n");
  }
  if (!safeDesignId(result.packet_id)) return inputError("nimicoding sweep design refused: result packet_id must be a stable id.\n");
  if (!safeDesignId(result.result_id)) return inputError("nimicoding sweep design refused: result_id must be a stable id.\n");
  if (result.run_id !== run.runId) return inputError("nimicoding sweep design refused: result run_id does not match --run-id.\n");
  const packet = await assertDesignArtifact(projectRoot, packetRef(run.runId, result.packet_id), "sweep-design-design-auditor-packet", "design auditor packet");
  if (!packet.ok) return packet;
  if (result.packet_ref !== packet.ref) return inputError("nimicoding sweep design refused: result packet_ref does not match canonical packet artifact.\n");
  const packetErrors = validatePacket(packet.value);
  if (packetErrors.length > 0) return inputError(`nimicoding sweep design refused: ${packetErrors.join("; ")}.\n`);
  const timestamp = options.verifiedAt ?? nowIso();
  const ledger = await loadOrCreateLedger(projectRoot, run.runId, timestamp);
  if (!ledger.ok) return ledger;
  const previousSnapshotHash = ledger.value.ledger_snapshot_hash;
  const normalizedRevisionEntries = [];
  const revisionErrors = [];
  const context = {
    ledger: ledger.value,
    normalized: normalizedRevisionEntries,
    errors: revisionErrors,
    resultId: result.result_id,
    resultArtifactRef: resultRef(run.runId, result.result_id),
    timestamp,
    auditorProvenance: {
      auditor: result.auditor,
      auditor_family: result.auditor_family,
      auditor_mode: result.auditor_mode,
      auditor_result_origin: result.auditor_result_origin,
      session_ref: result.session_ref,
      transcript_ref: result.transcript_ref,
      llm_session_ref: result.llm_session_ref ?? null,
      llm_transcript_ref: result.llm_transcript_ref ?? null,
      llm_prompt_ref: result.llm_prompt_ref ?? null,
      packet_ref: result.packet_ref,
      result_ref: resultRef(run.runId, result.result_id),
    },
  };
  for (const entry of result.revision_entries) {
    normalizedRevisionEntries.push(normalizeRevisionEntry(entry, context));
  }
  if (revisionErrors.length > 0) return inputError(`nimicoding sweep design refused: ${revisionErrors.join("; ")}.\n`);
  const outcomeErrors = [];
  for (const outcome of result.finding_outcomes) {
    validateOutcome(outcome, { errors: outcomeErrors });
  }
  const includedFindingIds = new Set(packet.value.included_finding_ids);
  const outcomeFindingIds = result.finding_outcomes.map((outcome) => outcome.finding_id);
  const uniqueOutcomeFindingIds = new Set(outcomeFindingIds);
  if (uniqueOutcomeFindingIds.size !== outcomeFindingIds.length) {
    outcomeErrors.push("finding_outcomes[] contains duplicate finding_id entries");
  }
  const missingOutcomeIds = packet.value.included_finding_ids.filter((findingId) => !uniqueOutcomeFindingIds.has(findingId));
  if (missingOutcomeIds.length > 0) {
    outcomeErrors.push(`design auditor result is missing final outcomes for included findings: ${missingOutcomeIds.join(", ")}`);
  }
  const outOfPacketOutcomeIds = outcomeFindingIds.filter((findingId) => !includedFindingIds.has(findingId));
  if (outOfPacketOutcomeIds.length > 0) {
    outcomeErrors.push(`design auditor result includes outcomes outside the packet: ${[...new Set(outOfPacketOutcomeIds)].join(", ")}`);
  }
  const normalizedRevisionRefs = new Set(normalizedRevisionEntries.map((entry) => `${ledger.ref}#${entry.revision_entry_id}`));
  for (const outcome of result.finding_outcomes) {
    for (const ref of outcome.revision_ledger_entry_refs ?? []) {
      if (!normalizedRevisionRefs.has(ref)) {
        outcomeErrors.push(`finding_outcomes[] revision_ledger_entry_refs must reference revision entries from this ingest: ${ref}`);
      }
    }
  }
  if (outcomeErrors.length > 0) return inputError(`nimicoding sweep design refused: ${outcomeErrors.join("; ")}.\n`);
  const storedResult = {
    ...result,
    closeout_eligible: isLlmAuditorResult(result),
    ingested_at: timestamp,
    normalized_revision_entry_refs: normalizedRevisionEntries.map((entry) => `${ledger.ref}#${entry.revision_entry_id}`),
  };
  const storedResultRef = await writeYamlRef(projectRoot, resultRef(run.runId, result.result_id), storedResult);
  ledger.value.entries.push(...normalizedRevisionEntries);
  updateLedgerHashes(ledger.value, previousSnapshotHash, timestamp);
  await writeYamlRef(projectRoot, ledger.ref, ledger.value);
  const decisionItems = result.finding_outcomes
    .filter((outcome) => finalOutcomeState(outcome) === "needs_user_decision")
    .map((outcome) => ({
      decision_queue_item_ref: outcome.decision_queue_item_ref,
      finding_id: outcome.finding_id,
      decision_packet_ref: outcome.decision_packet_ref,
      recommended_decision: outcome.recommended_decision,
      queue_status: outcome.queue_status,
      blocked_downstream_wave_refs: outcome.blocked_downstream_wave_refs,
    }));
  if (decisionItems.length > 0 || result.human_decision_requests.length > 0) {
    await writeYamlRef(projectRoot, decisionQueueRef(run.runId), {
      version: 2,
      kind: "sweep-design-decision-queue",
      run_id: run.runId,
      source_design_auditor_result_ref: storedResultRef,
      queue_policy: "focused_mode_stops_immediately_all_mode_batches_until_audit_complete",
      original_findings_mutation_policy: "read_only_never_update_from_sweep_design",
      pending_decision_count: decisionItems.length + result.human_decision_requests.length,
      items: decisionItems,
      human_decision_requests: result.human_decision_requests,
      created_at: timestamp,
    });
  }
  const stopClass = stopClassForResult(result);
  const mode = options.mode ?? result.auditor_mode;
  const focusedStop = mode === "focused" && stopClass;
  return {
    ok: true,
    exitCode: focusedStop ? 2 : 0,
    runId: run.runId,
    resultRef: storedResultRef,
    ledgerRef: ledger.ref,
    revisionEntryCount: normalizedRevisionEntries.length,
    findingOutcomeCount: result.finding_outcomes.length,
    closeoutEligible: isLlmAuditorResult(result),
    stopped: Boolean(focusedStop),
    stopClass: focusedStop ? stopClass : null,
    stopReason: focusedStop ? "focused_mode_requires_manager_or_human_resolution" : null,
  };
}

export async function runLedgerValidate(projectRoot, options) {
  const run = requireRunId(options);
  if (!run.ok) return run;
  const ledger = await assertDesignArtifact(projectRoot, ledgerRef(run.runId), "sweep-design-revision-ledger", "revision ledger");
  if (!ledger.ok) return ledger;
  const errors = validateLedger(ledger.value);
  if (errors.length > 0) return inputError(`nimicoding sweep design refused: ${errors.join("; ")}.\n`);
  return {
    ok: true,
    exitCode: 0,
    runId: run.runId,
    ledgerRef: ledger.ref,
    revisionEntryCount: ledger.value.entries.length,
    ledgerSnapshotHash: ledger.value.ledger_snapshot_hash,
  };
}

export async function runFinalize(projectRoot, options) {
  const run = requireRunId(options);
  if (!run.ok) return run;
  const inventory = await loadInventory(projectRoot, run.runId);
  if (!inventory.ok) return inventory;
  const ledger = await assertDesignArtifact(projectRoot, ledgerRef(run.runId), "sweep-design-revision-ledger", "revision ledger");
  if (!ledger.ok) return ledger;
  const ledgerErrors = validateLedger(ledger.value);
  if (ledgerErrors.length > 0) return inputError(`nimicoding sweep design refused: ${ledgerErrors.join("; ")}.\n`);
  const outcomes = new Map();
  const resultRefs = new Set();
  const nonLlmResultRefs = [];
  for (const entry of ledger.value.entries) {
    for (const ref of entry.replacement_artifact_refs ?? []) {
      if (ref.includes("/design-auditor-results/")) resultRefs.add(ref);
    }
  }
  for (const ref of resultRefs) {
    const result = await loadYamlRef(projectRoot, ref);
    if (result?.kind !== "sweep-design-design-auditor-result") continue;
    if (!isLlmAuditorResult(result)) nonLlmResultRefs.push(ref);
    for (const outcome of result.finding_outcomes ?? []) {
      outcomes.set(outcome.finding_id, { ...outcome, source_result_ref: ref });
    }
  }
  const findings = inventory.value.findings.map((finding) => {
    const outcome = outcomes.get(finding.finding_id);
    if (!outcome) {
      return {
        finding_id: finding.finding_id,
        state: "raw",
        final_outcome: false,
        transient: true,
        reason: "missing_design_auditor_final_outcome",
      };
    }
    const state = finalOutcomeState(outcome);
    return {
      finding_id: finding.finding_id,
      state,
      final_outcome: FINAL_OUTCOME_STATES.has(state),
      transient: TRANSIENT_STATES.has(state),
      source_result_ref: outcome.source_result_ref,
      design_auditor_packet_ref: outcome.design_auditor_packet_ref,
      revision_ledger_entry_refs: outcome.revision_ledger_entry_refs,
    };
  });
  const transient = findings.filter((finding) => finding.transient || !finding.final_outcome);
  const finalOutcomeComplete = transient.length === 0;
  const llmCloseoutEligible = nonLlmResultRefs.length === 0;
  const complete = finalOutcomeComplete && (llmCloseoutEligible || options.allowSyntheticCloseout === true);
  const artifact = {
    version: 2,
    kind: "sweep-design-final-state-report",
    run_id: run.runId,
    source_inventory_ref: inventory.ref,
    source_revision_ledger_ref: ledger.ref,
    final_state_policy: "every_finding_must_have_final_sweep_design_outcome_with_llm_packet_result_ledger_provenance",
    source_findings_mutation_policy: "read_only_never_update_from_sweep_design",
    complete,
    final_outcome_complete: finalOutcomeComplete,
    llm_closeout_eligible: llmCloseoutEligible,
    non_llm_result_refs: nonLlmResultRefs,
    total_finding_count: findings.length,
    final_finding_count: findings.length - transient.length,
    transient_finding_count: transient.length,
    final_outcome_states: [...FINAL_OUTCOME_STATES].sort(),
    transient_states: [...TRANSIENT_STATES].sort(),
    blocking_findings: transient.map((finding) => ({
      finding_id: finding.finding_id,
      state: finding.state,
      reason: finding.reason ?? "transient_or_missing_final_outcome",
    })),
    findings,
    created_at: options.verifiedAt ?? nowIso(),
  };
  const ref = await writeYamlRef(projectRoot, finalStateReportRef(run.runId), artifact);
  return {
    ok: true,
    exitCode: complete ? 0 : 2,
    runId: run.runId,
    finalStateReportRef: ref,
    finalComplete: complete,
    finalOutcomeComplete,
    llmCloseoutEligible,
    nonLlmResultCount: nonLlmResultRefs.length,
    totalFindingCount: artifact.total_finding_count,
    finalFindingCount: artifact.final_finding_count,
    transientFindingCount: artifact.transient_finding_count,
    stopped: !complete,
    stopClass: complete ? null : finalOutcomeComplete ? "non_llm_result_provenance" : "incomplete_final_state",
    stopReason: complete ? null : finalOutcomeComplete ? "synthetic_or_non_llm_results_do_not_satisfy_true_llm_closeout" : "missing_or_transient_final_outcomes_remaining",
  };
}

export async function runWavePlan(projectRoot, options) {
  const run = requireRunId(options);
  if (!run.ok) return run;
  if (!options.topicId) return inputError("nimicoding sweep design refused: --topic-id is required.\n");
  const ledger = await assertDesignArtifact(projectRoot, ledgerRef(run.runId), "sweep-design-revision-ledger", "revision ledger");
  if (!ledger.ok) return ledger;
  const ledgerErrors = validateLedger(ledger.value);
  if (ledgerErrors.length > 0) return inputError(`nimicoding sweep design refused: ${ledgerErrors.join("; ")}.\n`);
  const waves = [];
  const errors = [];
  const resultRefs = new Set();
  for (const entry of ledger.value.entries) {
    for (const ref of entry.replacement_artifact_refs ?? []) {
      if (ref.includes("/design-auditor-results/")) resultRefs.add(ref);
    }
  }
  for (const ref of resultRefs) {
    const result = await loadYamlRef(projectRoot, ref);
    if (result?.kind !== "sweep-design-design-auditor-result") continue;
    if (!isLlmAuditorResult(result) && options.allowSyntheticTrial !== true) {
      errors.push(`wave-plan result ${ref} is not closeout-eligible LLM provenance; pass --allow-synthetic-trial only for load tests`);
      continue;
    }
    for (const wave of result.wave_changes ?? []) {
      if (wave.state === "ready_for_implementation" || wave.ready_for_implementation_wave === true) {
        validateWave(wave, errors);
        waves.push({ ...wave, source_design_auditor_result_ref: ref });
      }
    }
  }
  if (errors.length > 0) return inputError(`nimicoding sweep design refused: ${errors.join("; ")}.\n`);
  const artifact = {
    version: 2,
    kind: "sweep-design-wave-plan",
    run_id: run.runId,
    topic_id: options.topicId,
    source_revision_ledger_ref: ledger.ref,
    mutates_topic_state: false,
    worker_dispatch_allowed: false,
    wave_count: waves.length,
    waves,
    created_at: options.verifiedAt ?? nowIso(),
  };
  const ref = await writeYamlRef(projectRoot, wavePlanRef(run.runId), artifact);
  return { ok: true, exitCode: 0, runId: run.runId, wavePlanRef: ref, waveCount: waves.length };
}
