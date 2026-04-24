import {
  appendRunEvent,
  chunkRef,
  ensureIsoTimestamp,
  inputError,
  loadChunk,
  loadPlan,
  packetRef,
  safeSweepId,
  writeYamlRef,
} from "./common.mjs";
import { budgetBlockForChunk } from "./risk-budget.mjs";

function updatePlanChunk(plan, chunkId, patch) {
  return {
    ...plan,
    chunks: plan.chunks.map((chunk) => chunk.chunk_id === chunkId ? { ...chunk, ...patch } : chunk),
  };
}

function buildAuditorPacket(sweepId, chunk, auditor, dispatchedAt, plan) {
  const specAuthority = chunk.planning_basis === "spec_authority";
  return {
    version: 1,
    kind: "audit-auditor-packet",
    sweep_id: sweepId,
    chunk_id: chunk.chunk_id,
    auditor,
    planning_basis: chunk.planning_basis ?? "file_inventory",
    spec_surface: chunk.spec_surface ?? null,
    criteria: chunk.criteria,
    owner_domain: chunk.owner_domain,
    files: chunk.files,
    authority_refs: chunk.authority_refs ?? chunk.files,
    host_authority_projection_refs: chunk.host_authority_projection_refs ?? [],
    evidence_roots: chunk.evidence_roots ?? [],
    admitted_evidence_roots: chunk.admitted_evidence_roots ?? [],
    evidence_inventory: chunk.evidence_inventory ?? [],
    evidence_inventory_status: chunk.evidence_inventory_status ?? null,
    evidence_inventory_empty_reason: chunk.evidence_inventory_empty_reason ?? null,
    coverage_contract: chunk.coverage_contract ?? null,
    risk_budget_policy: plan.risk_budget_policy ?? null,
    risk_budget_status: plan.risk_budget_status ?? null,
    audit_instructions: specAuthority ? {
      posture: "spec_first_full_audit",
      authority_source: ".nimi/spec/**",
      auditor_goal: "Find all material issues. Missing an issue is worse than a false positive.",
      required_categories: [
        "security",
        "logic-error",
        "error-handling",
        "code-quality",
        "performance",
        "consistency",
        "type-safety",
        "resource-leak",
        "race-condition",
        "spec-drift",
        "boundary",
        "contract",
        "architecture",
      ],
      required_flow: [
        "read every authority_ref first",
        "read every evidence_inventory file completely",
        "evaluate implementation evidence against the authority_refs",
        "if evidence_inventory is empty, treat evidence_inventory_empty_reason as an auditable planning assertion rather than proof of correctness",
        "emit coverage.evidence_files exactly matching evidence_inventory",
        "emit one authority_outcome per authority_ref",
        "emit every finding that satisfies the audit-finding contract",
      ],
    } : null,
    output_contract: {
      format: "json",
      required_top_level_fields: ["chunk_id", "auditor", "coverage", "findings"],
      coverage_files_must_exactly_match: chunk.files,
      coverage_authority_refs_must_exactly_match: chunk.authority_refs ?? chunk.files,
      evidence_files_must_exactly_match: specAuthority ? (chunk.evidence_inventory ?? []) : null,
      spec_authority_coverage_requires_authority_outcomes: specAuthority,
      spec_authority_coverage_requires_evidence_files: specAuthority,
      finding_locations_must_belong_to_chunk_files_or_evidence_inventory: true,
      finding_contract_ref: ".nimi/contracts/audit-finding.schema.yaml",
      ingest_command: `nimicoding audit-sweep chunk ingest --sweep-id ${sweepId} --chunk-id ${chunk.chunk_id} --from <audit-output.json> --verified-at <ISO-8601-UTC>`,
    },
    hard_constraints: [
      "do_not_sample_out_files_from_this_chunk",
      "for_spec_authority_chunks_audit_the_authority_refs_first_and_use_evidence_roots_for_implementation_evidence",
      "for_spec_authority_chunks_emit_one_authority_outcome_per_authority_ref",
      "for_spec_authority_chunks_emit_evidence_files_for_every_file_in_evidence_inventory",
      "if_no_implementation_surface_exists_mark_the_authority_outcome_not_applicable_with_reason",
      "do_not_return_pseudo_success",
      "do_not_emit_findings_outside_chunk_files_or_declared_evidence_inventory",
      "fail_closed_if_a_file_cannot_be_audited",
    ],
    created_at: dispatchedAt,
  };
}

export async function dispatchAuditSweepChunk(projectRoot, options) {
  const sweepId = safeSweepId(options.sweepId);
  if (!sweepId || typeof options.chunkId !== "string") {
    return inputError("nimicoding audit-sweep refused: --sweep-id and --chunk-id are required.\n");
  }

  const timestampError = ensureIsoTimestamp(options.dispatchedAt, "--dispatched-at");
  if (timestampError) {
    return timestampError;
  }

  const planResult = await loadPlan(projectRoot, sweepId);
  if (!planResult.ok) {
    return inputError(planResult.error);
  }

  const chunkResult = await loadChunk(projectRoot, sweepId, options.chunkId);
  if (!chunkResult.ok) {
    return inputError(chunkResult.error);
  }

  if (chunkResult.chunk.state !== "planned") {
    return inputError("nimicoding audit-sweep refused: chunk dispatch requires planned state.\n");
  }
  const budgetBlock = budgetBlockForChunk(planResult.plan, chunkResult.chunk);
  if (budgetBlock) {
    return inputError(`nimicoding audit-sweep refused: ${budgetBlock}; build or admit remediation bundles before continuing discovery.\n`);
  }

  const updatedChunk = {
    ...chunkResult.chunk,
    state: "dispatched",
    lifecycle: {
      ...chunkResult.chunk.lifecycle,
      dispatched_at: options.dispatchedAt,
    },
    dispatch: {
      auditor: options.auditor ?? "external_auditor",
      criteria: chunkResult.chunk.criteria,
      files: chunkResult.chunk.files,
      authority_refs: chunkResult.chunk.authority_refs ?? chunkResult.chunk.files,
      host_authority_projection_refs: chunkResult.chunk.host_authority_projection_refs ?? [],
      evidence_roots: chunkResult.chunk.evidence_roots ?? [],
      admitted_evidence_roots: chunkResult.chunk.admitted_evidence_roots ?? [],
      evidence_inventory: chunkResult.chunk.evidence_inventory ?? [],
      evidence_inventory_status: chunkResult.chunk.evidence_inventory_status ?? null,
      evidence_inventory_empty_reason: chunkResult.chunk.evidence_inventory_empty_reason ?? null,
    },
    updated_at: options.dispatchedAt,
  };
  const packet = buildAuditorPacket(sweepId, chunkResult.chunk, updatedChunk.dispatch.auditor, options.dispatchedAt, planResult.plan);
  const auditorPacketRef = packetRef(sweepId, options.chunkId);
  await writeYamlRef(projectRoot, auditorPacketRef, packet);
  await writeYamlRef(projectRoot, chunkResult.chunkRef, updatedChunk);
  await writeYamlRef(projectRoot, planResult.planRef, {
    ...updatePlanChunk(planResult.plan, options.chunkId, { state: "dispatched" }),
    updated_at: options.dispatchedAt,
  });
  const runRef = await appendRunEvent(projectRoot, sweepId, {
    event_type: "chunk_dispatched",
    chunk_id: options.chunkId,
    chunk_ref: chunkRef(sweepId, options.chunkId),
    packet_ref: auditorPacketRef,
    auditor: updatedChunk.dispatch.auditor,
  });

  return {
    ok: true,
    exitCode: 0,
    sweepId,
    chunkId: options.chunkId,
    state: "dispatched",
    chunkRef: chunkResult.chunkRef,
    packetRef: auditorPacketRef,
    runLedgerRef: runRef,
  };
}

export async function reviewAuditSweepChunk(projectRoot, options) {
  const sweepId = safeSweepId(options.sweepId);
  if (!sweepId || typeof options.chunkId !== "string") {
    return inputError("nimicoding audit-sweep refused: --sweep-id and --chunk-id are required.\n");
  }

  const timestampError = ensureIsoTimestamp(options.reviewedAt, "--reviewed-at");
  if (timestampError) {
    return timestampError;
  }

  if (!["pass", "fail"].includes(options.verdict)) {
    return inputError("nimicoding audit-sweep refused: --verdict must be pass or fail.\n");
  }

  const planResult = await loadPlan(projectRoot, sweepId);
  if (!planResult.ok) {
    return inputError(planResult.error);
  }

  const chunkResult = await loadChunk(projectRoot, sweepId, options.chunkId);
  if (!chunkResult.ok) {
    return inputError(chunkResult.error);
  }

  if (chunkResult.chunk.state !== "ingested") {
    return inputError("nimicoding audit-sweep refused: chunk review requires ingested state.\n");
  }

  const nextState = options.verdict === "pass" ? "frozen" : "failed";
  const updatedChunk = {
    ...chunkResult.chunk,
    state: nextState,
    lifecycle: {
      ...chunkResult.chunk.lifecycle,
      reviewed_at: options.reviewedAt,
      frozen_at: options.verdict === "pass" ? options.reviewedAt : chunkResult.chunk.lifecycle.frozen_at,
      failed_at: options.verdict === "fail" ? options.reviewedAt : chunkResult.chunk.lifecycle.failed_at,
    },
    review: {
      verdict: options.verdict,
      reviewer: options.reviewer ?? "nimicoding_manager",
      summary: options.summary ?? null,
      reviewed_at: options.reviewedAt,
    },
    failure: options.verdict === "fail"
      ? { reason: options.summary ?? "manager_review_failed", failed_at: options.reviewedAt }
      : chunkResult.chunk.failure,
    updated_at: options.reviewedAt,
  };
  await writeYamlRef(projectRoot, chunkResult.chunkRef, updatedChunk);
  await writeYamlRef(projectRoot, planResult.planRef, {
    ...updatePlanChunk(planResult.plan, options.chunkId, { state: nextState }),
    updated_at: options.reviewedAt,
  });
  const runRef = await appendRunEvent(projectRoot, sweepId, {
    event_type: options.verdict === "pass" ? "chunk_frozen" : "chunk_failed",
    chunk_id: options.chunkId,
    chunk_ref: chunkResult.chunkRef,
    reviewer: updatedChunk.review.reviewer,
    summary: updatedChunk.review.summary,
  });

  return {
    ok: true,
    exitCode: 0,
    sweepId,
    chunkId: options.chunkId,
    state: nextState,
    chunkRef: chunkResult.chunkRef,
    runLedgerRef: runRef,
  };
}

export async function skipAuditSweepChunk(projectRoot, options) {
  const sweepId = safeSweepId(options.sweepId);
  if (!sweepId || typeof options.chunkId !== "string") {
    return inputError("nimicoding audit-sweep refused: --sweep-id and --chunk-id are required.\n");
  }
  const timestampError = ensureIsoTimestamp(options.skippedAt, "--skipped-at");
  if (timestampError) {
    return timestampError;
  }
  if (typeof options.reason !== "string" || !options.reason.trim()) {
    return inputError("nimicoding audit-sweep refused: --reason is required when skipping a chunk.\n");
  }

  const planResult = await loadPlan(projectRoot, sweepId);
  if (!planResult.ok) {
    return inputError(planResult.error);
  }
  const chunkResult = await loadChunk(projectRoot, sweepId, options.chunkId);
  if (!chunkResult.ok) {
    return inputError(chunkResult.error);
  }
  if (chunkResult.chunk.state === "frozen") {
    return inputError("nimicoding audit-sweep refused: frozen chunks cannot be skipped.\n");
  }

  const updatedChunk = {
    ...chunkResult.chunk,
    state: "skipped",
    lifecycle: {
      ...chunkResult.chunk.lifecycle,
      skipped_at: options.skippedAt,
    },
    skip: {
      reason: options.reason,
      skipped_at: options.skippedAt,
    },
    updated_at: options.skippedAt,
  };
  await writeYamlRef(projectRoot, chunkResult.chunkRef, updatedChunk);
  await writeYamlRef(projectRoot, planResult.planRef, {
    ...updatePlanChunk(planResult.plan, options.chunkId, { state: "skipped" }),
    updated_at: options.skippedAt,
  });
  const runRef = await appendRunEvent(projectRoot, sweepId, {
    event_type: "chunk_skipped",
    chunk_id: options.chunkId,
    chunk_ref: chunkResult.chunkRef,
    reason: options.reason,
  });

  return {
    ok: true,
    exitCode: 0,
    sweepId,
    chunkId: options.chunkId,
    state: "skipped",
    chunkRef: chunkResult.chunkRef,
    runLedgerRef: runRef,
  };
}
