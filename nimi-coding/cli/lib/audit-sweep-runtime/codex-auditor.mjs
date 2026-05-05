import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  appendRunEvent,
  artifactPath,
  artifactRef,
  chunkRef,
  ensureIsoTimestamp,
  inputError,
  loadChunk,
  loadPlan,
  packetRef,
  resolveInsideProject,
  safeSweepId,
  withAuditSweepMutationLock,
  writeYamlRef,
} from "./common.mjs";
import { buildAuditorPacket, reviewAuditSweepChunk, updatePlanChunk } from "./chunks.mjs";
import { extractCodexAuditorEvidenceFile, P0P1_RULE_CHECK_IDS } from "./codex-auditor-evidence.mjs";
import { ingestAuditSweepChunk } from "./ingest.mjs";
import { budgetBlockForChunk } from "./risk-budget.mjs";
import { validateAuditSweepArtifacts } from "./validators.mjs";

const CODEX_AUDITOR_DEFAULT = "codex_semantic_auditor";
const DEFAULT_CODEX_TIMEOUT_MS = 10 * 60 * 1000;
const CODEX_TIMEOUT_KILL_GRACE_MS = 3000;
const CODEX_RAW_SUFFIX = ".codex-raw.json";
const CODEX_EVIDENCE_SUFFIX = ".codex-evidence.json";

function codexOutputRef(sweepId, chunkId, suffix) {
  return artifactRef("evidence_refs", sweepId, "codex-output", `${chunkId}${suffix}`);
}

function codexRunToken(timestamp) {
  return timestamp.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-+|-+$/g, "");
}

function projectRefForPath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).replace(/\\/g, "/");
}
function codexPrompt({ packet, auditorPacketRef, rawRef, sessionRef }) {
  return [
    "You are the Codex semantic auditor for a nimicoding audit-sweep chunk.",
    "Run in read-only, audit-only mode. Do not edit files. Do not implement product fixes.",
    `Read the auditor packet from ${auditorPacketRef} and inspect the chunk authority refs and implementation evidence semantically.`,
    "Do not rely on this prompt as the chunk inventory; the packet file is the source for files, authority_refs, selected_implementation_refs, audit_depth, retrieval_prepass, and the raw semantic output contract.",
    "Scripts may not generate findings or no-findings; your conclusions must come from your own inspection.",
    "The packet is compact: evidence_inventory/selected_implementation_refs is the manager-selected implementation slice, not the full manager-owned inventory.",
    "Do not ask for, reconstruct, or echo the omitted full evidence_inventory. audit-codex will mechanically fill coverage.files, coverage.authority_refs, and full coverage.evidence_files from manager-owned chunk state.",
    "You only author semantic audit content: authority_outcomes reasoning/status, inspected_implementation_refs, P0/P1 rule checks, p0p1_negative_reasoning when applicable, and findings.",
    "For each authority outcome, set authority_ref to the packet authority_ref and put inspected implementation refs in inspected_implementation_refs or implementation_evidence_refs.",
    "Every implementation ref you cite must be an exact file ref from packet.selected_implementation_refs / packet.evidence_inventory.",
    "Never put AGENTS.md, README.md, spec files, authority refs, methodology docs, or governance docs in inspected_implementation_refs, implementation_evidence_refs, coverage.p0p1_evidence_refs, findings[].implementation_refs, or coverage.p0p1_rule_checks[].implementation_refs unless that exact file appears in packet.selected_implementation_refs.",
    "If a governance or authority document influenced reasoning but is not in packet.selected_implementation_refs, mention it only in negative_reasoning/description text, not in any implementation_refs array.",
    "Use packet.audit_depth to size your inspection: deep means inspect the selected slice thoroughly, normal means focused semantic inspection, shallow means audit generated/table/index invariants from the selected slice without expanding the omitted inventory.",
    "Return exactly one JSON object and nothing else. Do not wrap it in markdown.",
    "The JSON object must have exactly these top-level fields: chunk_id, auditor, coverage, findings.",
    `Set auditor.id to ${JSON.stringify(packet.auditor)}.`,
    `Set auditor.mode to "codex_semantic_audit".`,
    `Set auditor.methodology_ref to "nimi-coding/methodology/audit-sweep-p0p1-recall.yaml".`,
    "Put P0/P1 rule checks only at coverage.p0p1_rule_checks.",
    `Set auditor.provenance.kind to "semantic_audit".`,
    `Set auditor.provenance.packet_ref to ${JSON.stringify(packetRef(packet.sweep_id, packet.chunk_id))}.`,
    `Set auditor.provenance.session_ref to ${JSON.stringify(sessionRef)}.`,
    `Set auditor.provenance.transcript_ref to ${JSON.stringify(rawRef)}.`,
    "coverage.authority_outcomes must contain one outcome per authority_ref.",
    `coverage.p0p1_rule_checks must contain exactly these ids and no aliases: ${P0P1_RULE_CHECK_IDS.join(", ")}.`,
    "Each coverage.authority_outcomes[] object must include negative_reasoning when no critical/high finding is emitted for the chunk.",
    "Each coverage.p0p1_rule_checks[] object must include id, status, implementation_refs, and negative_reasoning.",
    "Use status=\"checked\" when implementation evidence was inspected; checked rules must cite at least one in-scope implementation ref.",
    "Use status=\"not_applicable\" only when the rule truly has no implementation surface, and explain that in negative_reasoning.",
    "When the packet evidence_inventory is empty and no critical/high finding is emitted, include coverage.p0p1_implementation_not_applicable_reason with the chunk-specific reason implementation refs are not applicable.",
    "Do not use priority defect class aliases such as authority_boundary_bypass, security_or_permission_bypass, destructive_action_without_gate, package_boundary_violation, or unadmitted_truth_or_evidence_source as rule check ids.",
    "Do not emit coverage.files, coverage.authority_refs, or coverage.evidence_files; those fields are manager-owned and will be populated from the packet.",
    "Do not emit authority_outcomes[].evidence_refs; it is manager-owned and will be built from authority_ref plus inspected implementation refs.",
    "Every finding must include severity, category, impact, title, and description. Set severity to critical or high for P0/P1 findings. Set finding.category to one of the exact P0/P1 rule ids when the finding maps to a P0/P1 rule; do not use rule_id as the primary finding category field.",
    "authority_outcomes[].status is an audit-process enum only: audited, blocked, or not_applicable.",
    "Use status=audited when the authority/evidence was inspected, even if you discovered violations.",
    "When an authority outcome uses status=blocked or status=not_applicable, include reason with the chunk-specific blocker or not-applicable explanation.",
    "Do not use compliance verdicts such as violated, pass, fail, compliant, or non_compliant in authority_outcomes[].status; put violations in findings.",
    "For no-finding chunks, include chunk-specific inspected implementation refs, P0/P1 rule checks, and negative reasoning.",
  ].join("\n");
}

function terminateProcess(child, signal) {
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {
    // Fall through to direct child termination.
  }
  try {
    child.kill(signal);
  } catch {
    // Process may already have exited.
  }
}

function runCodexExec({ projectRoot, codexBin, rawOutputPath, prompt, timeoutMs }) {
  return new Promise((resolve) => {
    const boundedTimeoutMs = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_CODEX_TIMEOUT_MS;
    let timedOut = false;
    let settled = false;
    let killTimer = null;
    const child = spawn(codexBin, [
      "exec",
      "-C",
      projectRoot,
      "-s",
      "read-only",
      "--output-last-message",
      rawOutputPath,
      "-",
    ], {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminateProcess(child, "SIGTERM");
      killTimer = setTimeout(() => terminateProcess(child, "SIGKILL"), CODEX_TIMEOUT_KILL_GRACE_MS);
    }, boundedTimeoutMs);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      resolve({ ok: false, exitCode: 1, timedOut, timeoutMs: boundedTimeoutMs, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      resolve({ ok: exitCode === 0 && !timedOut, exitCode, signal, timedOut, timeoutMs: boundedTimeoutMs, stdout, stderr });
    });
    child.stdin.end(prompt);
  });
}

async function prepareCodexAuditPacket(projectRoot, options) {
  return withAuditSweepMutationLock(projectRoot, options.sweepId, "chunk codex audit prepare", async () => {
    const planResult = await loadPlan(projectRoot, options.sweepId);
    if (!planResult.ok) {
      return inputError(planResult.error);
    }
    const chunkResult = await loadChunk(projectRoot, options.sweepId, options.chunkId);
    if (!chunkResult.ok) {
      return inputError(chunkResult.error);
    }
    if (chunkResult.chunk.state === "skipped") {
      return inputError("nimicoding audit-sweep refused: skipped chunks cannot be audited through Codex.\n");
    }
    const budgetBlock = budgetBlockForChunk(planResult.plan, chunkResult.chunk);
    if (budgetBlock && chunkResult.chunk.state !== "frozen") {
      return inputError(`nimicoding audit-sweep refused: ${budgetBlock}; build or admit remediation bundles before continuing discovery.\n`);
    }

    const dispatch = {
      auditor: options.auditor ?? CODEX_AUDITOR_DEFAULT,
      criteria: chunkResult.chunk.criteria,
      files: chunkResult.chunk.files,
      authority_refs: chunkResult.chunk.authority_refs ?? chunkResult.chunk.files,
      host_authority_projection_refs: chunkResult.chunk.host_authority_projection_refs ?? [],
      evidence_roots: chunkResult.chunk.evidence_roots ?? [],
      admitted_evidence_roots: chunkResult.chunk.admitted_evidence_roots ?? [],
      evidence_inventory: chunkResult.chunk.evidence_inventory ?? [],
      evidence_inventory_status: chunkResult.chunk.evidence_inventory_status ?? null,
      evidence_inventory_empty_reason: chunkResult.chunk.evidence_inventory_empty_reason ?? null,
      execution_owner: "nimicoding_codex_auditor_path",
    };
    const packet = buildAuditorPacket(options.sweepId, chunkResult.chunk, dispatch.auditor, options.dispatchedAt, planResult.plan, { projectRoot });
    packet.execution_owner = "nimicoding_codex_auditor_path";
    packet.raw_output_contract = {
      raw_output_is_transcript_ref: true,
      raw_output_must_be_exact_json: true,
      schema_drift_rejected_fail_closed: true,
      scripts_may_only_extract_schema_conformant_evidence: true,
    };

    const auditorPacketRef = packetRef(options.sweepId, options.chunkId);
    const updatedChunk = {
      ...chunkResult.chunk,
      state: "dispatched",
      lifecycle: {
        ...chunkResult.chunk.lifecycle,
        dispatched_at: options.dispatchedAt,
        ingested_at: null,
        reviewed_at: null,
        frozen_at: null,
        failed_at: null,
        skipped_at: null,
      },
      dispatch,
      evidence_ref: null,
      finding_count: 0,
      audit_validity: null,
      review: null,
      failure: null,
      updated_at: options.dispatchedAt,
    };

    await writeYamlRef(projectRoot, auditorPacketRef, packet);
    await writeYamlRef(projectRoot, chunkResult.chunkRef, updatedChunk);
    await writeYamlRef(projectRoot, planResult.planRef, {
      ...updatePlanChunk(planResult.plan, options.chunkId, {
        state: "dispatched",
        evidence_ref: null,
        finding_count: 0,
        audit_validity: null,
        failure: null,
      }),
      updated_at: options.dispatchedAt,
    });
    const runLedgerRef = await appendRunEvent(projectRoot, options.sweepId, {
      event_type: "chunk_codex_audit_prepared",
      chunk_id: options.chunkId,
      chunk_ref: chunkRef(options.sweepId, options.chunkId),
      packet_ref: auditorPacketRef,
      auditor: dispatch.auditor,
    });
    return {
      ok: true,
      chunk: updatedChunk,
      packet,
      packetRef: auditorPacketRef,
      chunkRef: chunkResult.chunkRef,
      runLedgerRef,
    };
  });
}

async function markCodexAuditFailed(projectRoot, options) {
  return withAuditSweepMutationLock(projectRoot, options.sweepId, "chunk codex audit fail", async () => {
    const planResult = await loadPlan(projectRoot, options.sweepId);
    if (!planResult.ok) {
      return inputError(planResult.error);
    }
    const chunkResult = await loadChunk(projectRoot, options.sweepId, options.chunkId);
    if (!chunkResult.ok) {
      return inputError(chunkResult.error);
    }
    const failure = {
      reason: options.reason,
      failed_at: options.failedAt,
      packet_ref: options.packetRef,
      transcript_ref: options.transcriptRef,
      phase: options.phase,
    };
    const updatedChunk = {
      ...chunkResult.chunk,
      state: "failed",
      lifecycle: {
        ...chunkResult.chunk.lifecycle,
        failed_at: options.failedAt,
        skipped_at: null,
      },
      failure,
      updated_at: options.failedAt,
    };
    await writeYamlRef(projectRoot, chunkResult.chunkRef, updatedChunk);
    await writeYamlRef(projectRoot, planResult.planRef, {
      ...updatePlanChunk(planResult.plan, options.chunkId, {
        state: "failed",
        failure,
      }),
      updated_at: options.failedAt,
    });
    const runLedgerRef = await appendRunEvent(projectRoot, options.sweepId, {
      event_type: "chunk_failed",
      chunk_id: options.chunkId,
      chunk_ref: chunkResult.chunkRef,
      packet_ref: options.packetRef,
      transcript_ref: options.transcriptRef,
      summary: options.reason,
      phase: options.phase,
    });
    return {
      ok: true,
      state: "failed",
      chunkRef: chunkResult.chunkRef,
      runLedgerRef,
    };
  });
}

export async function runCodexAuditSweepChunk(projectRoot, options) {
  const sweepId = safeSweepId(options.sweepId);
  if (!sweepId || typeof options.chunkId !== "string") {
    return inputError("nimicoding audit-sweep refused: --sweep-id and --chunk-id are required.\n");
  }
  const dispatchedAtError = ensureIsoTimestamp(options.dispatchedAt, "--dispatched-at");
  if (dispatchedAtError) {
    return dispatchedAtError;
  }
  const verifiedAtError = ensureIsoTimestamp(options.verifiedAt, "--verified-at");
  if (verifiedAtError) {
    return verifiedAtError;
  }
  const reviewedAtError = ensureIsoTimestamp(options.reviewedAt, "--reviewed-at");
  if (reviewedAtError) {
    return reviewedAtError;
  }

  const prepare = await prepareCodexAuditPacket(projectRoot, {
    ...options,
    sweepId,
  });
  if (!prepare.ok) {
    return prepare;
  }

  const outputSuffix = `.${codexRunToken(options.dispatchedAt)}`;
  let rawRef = codexOutputRef(sweepId, options.chunkId, `${outputSuffix}${CODEX_RAW_SUFFIX}`);
  const evidenceCandidateRef = codexOutputRef(sweepId, options.chunkId, `${outputSuffix}${CODEX_EVIDENCE_SUFFIX}`);
  let rawOutputPath = artifactPath(projectRoot, rawRef);
  let sessionRef = `codex-exec:${sweepId}:${options.chunkId}:${options.dispatchedAt}`;
  if (options.fromRawOutput) {
    const replaySource = resolveInsideProject(projectRoot, options.fromRawOutput, "--from-raw-output");
    if (!replaySource.ok) {
      await markCodexAuditFailed(projectRoot, {
        sweepId,
        chunkId: options.chunkId,
        failedAt: options.verifiedAt,
        packetRef: prepare.packetRef,
        transcriptRef: rawRef,
        phase: "raw_output_replay",
        reason: replaySource.error.trim(),
      });
      return inputError(replaySource.error);
    }
    rawOutputPath = replaySource.absolutePath;
    rawRef = projectRefForPath(projectRoot, rawOutputPath);
    sessionRef = `codex-replay:${sweepId}:${options.chunkId}:${options.dispatchedAt}`;
  } else {
    await mkdir(path.dirname(rawOutputPath), { recursive: true });
    const runResult = await runCodexExec({
      projectRoot,
      codexBin: options.codexBin ?? "codex",
      rawOutputPath,
      prompt: codexPrompt({
        packet: prepare.packet,
        auditorPacketRef: prepare.packetRef,
        rawRef,
        sessionRef,
      }),
      timeoutMs: options.timeoutMs,
    });
    if (!runResult.ok) {
      const failureReason = runResult.timedOut
        ? `Codex auditor execution timed out after ${runResult.timeoutMs}ms.`
        : `Codex auditor execution failed with exit code ${runResult.exitCode ?? "unknown"}.`;
      await markCodexAuditFailed(projectRoot, {
        sweepId,
        chunkId: options.chunkId,
        failedAt: options.verifiedAt,
        packetRef: prepare.packetRef,
        transcriptRef: rawRef,
        phase: "codex_execution",
        reason: failureReason,
      });
      await appendRunEvent(projectRoot, sweepId, {
        event_type: "chunk_codex_audit_failed",
        chunk_id: options.chunkId,
        chunk_ref: prepare.chunkRef,
        packet_ref: prepare.packetRef,
        transcript_ref: rawRef,
        exit_code: runResult.exitCode,
        timed_out: runResult.timedOut,
        timeout_ms: runResult.timeoutMs,
        stderr_tail: runResult.stderr.slice(-2000),
      });
      return inputError(`nimicoding audit-sweep refused: ${failureReason}\n`);
    }
  }

  const extracted = await extractCodexAuditorEvidenceFile(projectRoot, {
    rawOutputPath,
    evidenceRef: evidenceCandidateRef,
    chunk: prepare.chunk,
    packetRef: prepare.packetRef,
    sessionRef,
    transcriptRef: rawRef,
    auditorId: options.auditor ?? CODEX_AUDITOR_DEFAULT,
  });
  if (!extracted.ok) {
    await markCodexAuditFailed(projectRoot, {
      sweepId,
      chunkId: options.chunkId,
      failedAt: options.verifiedAt,
      packetRef: prepare.packetRef,
      transcriptRef: rawRef,
      phase: "auditor_output_validation",
      reason: `Codex auditor output rejected: ${extracted.error}.`,
    });
    await appendRunEvent(projectRoot, sweepId, {
      event_type: "chunk_codex_auditor_output_rejected",
      chunk_id: options.chunkId,
      chunk_ref: prepare.chunkRef,
      packet_ref: prepare.packetRef,
      transcript_ref: rawRef,
      reason: extracted.error,
    });
    return inputError(`nimicoding audit-sweep refused: Codex auditor output rejected for ${options.chunkId}: ${extracted.error}.\n`);
  }

  await appendRunEvent(projectRoot, sweepId, {
    event_type: "chunk_codex_auditor_output_accepted",
    chunk_id: options.chunkId,
    chunk_ref: prepare.chunkRef,
    packet_ref: prepare.packetRef,
    transcript_ref: rawRef,
    evidence_candidate_ref: evidenceCandidateRef,
    audit_validity: extracted.auditValidity,
  });

  const ingest = await ingestAuditSweepChunk(projectRoot, {
    sweepId,
    chunkId: options.chunkId,
    fromPath: evidenceCandidateRef,
    verifiedAt: options.verifiedAt,
  });
  if (!ingest.ok) {
    await markCodexAuditFailed(projectRoot, {
      sweepId,
      chunkId: options.chunkId,
      failedAt: options.verifiedAt,
      packetRef: prepare.packetRef,
      transcriptRef: rawRef,
      phase: "chunk_ingest",
      reason: `Codex auditor evidence ingest rejected: ${ingest.error ?? "unknown ingest failure"}.`,
    });
    return inputError(`nimicoding audit-sweep refused: Codex auditor evidence ingest rejected for ${options.chunkId}: ${ingest.error ?? "unknown ingest failure"}.\n`);
  }

  const review = await reviewAuditSweepChunk(projectRoot, {
    sweepId,
    chunkId: options.chunkId,
    verdict: "pass",
    reviewedAt: options.reviewedAt,
    reviewer: options.reviewer ?? "nimicoding_codex_auditor_path",
    summary: options.summary ?? `Codex semantic audit accepted from ${rawRef}.`,
  });
  if (!review.ok) {
    await markCodexAuditFailed(projectRoot, {
      sweepId,
      chunkId: options.chunkId,
      failedAt: options.reviewedAt,
      packetRef: prepare.packetRef,
      transcriptRef: rawRef,
      phase: "chunk_review",
      reason: `Codex auditor evidence review rejected: ${review.error ?? "unknown review failure"}.`,
    });
    return inputError(`nimicoding audit-sweep refused: Codex auditor evidence review rejected for ${options.chunkId}: ${review.error ?? "unknown review failure"}.\n`);
  }

  const validation = await validateAuditSweepArtifacts(projectRoot, {
    sweepId,
    scope: "chunks",
  });
  if (!validation.ok) {
    await markCodexAuditFailed(projectRoot, {
      sweepId,
      chunkId: options.chunkId,
      failedAt: options.reviewedAt,
      packetRef: prepare.packetRef,
      transcriptRef: rawRef,
      phase: "post_chunk_validation",
      reason: "Post-Codex chunk validation failed.",
    });
    return inputError(`nimicoding audit-sweep refused: post-Codex chunk validation failed for ${options.chunkId}.\n`);
  }

  return {
    ok: true,
    exitCode: 0,
    sweepId,
    chunkId: options.chunkId,
    state: "frozen",
    packetRef: prepare.packetRef,
    transcriptRef: rawRef,
    extractedEvidenceRef: evidenceCandidateRef,
    evidenceRef: ingest.evidenceRef,
    findingsRef: ingest.findingsRef,
    findingCount: ingest.findingCount,
    addedCount: ingest.addedCount,
    duplicateCount: ingest.duplicateCount,
    reviewRef: review.runLedgerRef,
    validationScope: "chunks",
  };
}
