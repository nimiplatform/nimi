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

function updatePlanChunk(plan, chunkId, patch) {
  return {
    ...plan,
    chunks: plan.chunks.map((chunk) => chunk.chunk_id === chunkId ? { ...chunk, ...patch } : chunk),
  };
}

function buildAuditorPacket(sweepId, chunk, auditor, dispatchedAt) {
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
    evidence_roots: chunk.evidence_roots ?? [],
    output_contract: {
      format: "json",
      required_top_level_fields: ["chunk_id", "auditor", "coverage", "findings"],
      coverage_files_must_exactly_match: chunk.files,
      coverage_authority_refs_must_exactly_match: chunk.authority_refs ?? chunk.files,
      finding_locations_must_belong_to_chunk_files_or_evidence_roots: true,
      finding_contract_ref: ".nimi/contracts/audit-finding.schema.yaml",
      ingest_command: `nimicoding audit-sweep chunk ingest --sweep-id ${sweepId} --chunk-id ${chunk.chunk_id} --from <audit-output.json> --verified-at <ISO-8601-UTC>`,
    },
    hard_constraints: [
      "do_not_sample_out_files_from_this_chunk",
      "for_spec_authority_chunks_audit_the_authority_refs_first_and_use_evidence_roots_for_implementation_evidence",
      "do_not_return_pseudo_success",
      "do_not_emit_findings_outside_chunk_files_or_declared_evidence_roots",
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
      evidence_roots: chunkResult.chunk.evidence_roots ?? [],
    },
    updated_at: options.dispatchedAt,
  };
  const packet = buildAuditorPacket(sweepId, chunkResult.chunk, updatedChunk.dispatch.auditor, options.dispatchedAt);
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
