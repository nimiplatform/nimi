import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  FINDING_ACTIONABILITY,
  FINDING_CONFIDENCE,
  FINDING_SEVERITY,
  appendRunEvent,
  artifactPath,
  artifactRef,
  chunkRef,
  ensureIsoTimestamp,
  findingsRef,
  inputError,
  loadChunk,
  loadFindings,
  loadJsonFile,
  loadPlan,
  resolveInsideProject,
  safeSweepId,
  sha256Object,
  writeYamlRef,
} from "./common.mjs";
import { isPlainObject } from "../value-helpers.mjs";
import { pathExists } from "../fs-helpers.mjs";

function validateEvidenceEnvelope(evidence, chunk) {
  if (!isPlainObject(evidence)) {
    return { ok: false, error: "audit evidence must be a JSON object" };
  }
  if (evidence.chunk_id !== chunk.chunk_id) {
    return { ok: false, error: "audit evidence chunk_id must match the ingested chunk" };
  }
  if (!isPlainObject(evidence.auditor) || typeof evidence.auditor.id !== "string" || !evidence.auditor.id.trim()) {
    return { ok: false, error: "audit evidence auditor.id is required" };
  }
  if (!isPlainObject(evidence.coverage) || !Array.isArray(evidence.coverage.files)) {
    return { ok: false, error: "audit evidence coverage.files is required" };
  }
  if (chunk.planning_basis === "spec_authority") {
    if (!Array.isArray(evidence.coverage.authority_refs)) {
      return { ok: false, error: "spec-authority audit evidence coverage.authority_refs is required" };
    }
    const coveredAuthority = [...evidence.coverage.authority_refs].sort();
    const expectedAuthority = [...(chunk.authority_refs ?? chunk.files)].sort();
    if (coveredAuthority.length !== expectedAuthority.length || coveredAuthority.some((fileRef, index) => fileRef !== expectedAuthority[index])) {
      return { ok: false, error: "audit evidence coverage.authority_refs must exactly match chunk authority refs" };
    }
    const coveredFiles = [...evidence.coverage.files].sort();
    if (coveredFiles.length !== expectedAuthority.length || coveredFiles.some((fileRef, index) => fileRef !== expectedAuthority[index])) {
      return { ok: false, error: "spec-authority audit evidence coverage.files must exactly match chunk authority refs" };
    }
    const evidenceFiles = evidence.coverage.evidence_files;
    if (!Array.isArray(evidenceFiles)) {
      return { ok: false, error: "spec-authority audit evidence coverage.evidence_files is required" };
    }
    const normalizedEvidenceFiles = evidenceFiles.map((fileRef) => typeof fileRef === "string" ? fileRef.replace(/\\/g, "/") : fileRef);
    if (normalizedEvidenceFiles.some((fileRef) => typeof fileRef !== "string")) {
      return { ok: false, error: "spec-authority audit evidence coverage.evidence_files must contain file refs" };
    }
    const expectedEvidenceFiles = [...(chunk.evidence_inventory ?? [])].sort();
    const coveredEvidenceFiles = [...normalizedEvidenceFiles].sort();
    if (coveredEvidenceFiles.length !== expectedEvidenceFiles.length
      || coveredEvidenceFiles.some((fileRef, index) => fileRef !== expectedEvidenceFiles[index])) {
      return { ok: false, error: "spec-authority audit evidence coverage.evidence_files must exactly match chunk evidence inventory" };
    }
    const outcomes = evidence.coverage.authority_outcomes;
    if (!Array.isArray(outcomes)) {
      return { ok: false, error: "spec-authority audit evidence coverage.authority_outcomes is required" };
    }
    const expectedAuthoritySet = new Set(expectedAuthority);
    const outcomeAuthorityRefs = new Set();
    const validStatuses = new Set(["audited", "blocked", "not_applicable"]);
    for (const [index, outcome] of outcomes.entries()) {
      if (!isPlainObject(outcome)) {
        return { ok: false, error: `authority_outcomes[${index}] must be an object` };
      }
      const authorityRef = typeof outcome.authority_ref === "string" ? outcome.authority_ref.replace(/\\/g, "/") : "";
      if (!expectedAuthoritySet.has(authorityRef)) {
        return { ok: false, error: `authority_outcomes[${index}].authority_ref must belong to chunk authority_refs` };
      }
      if (outcomeAuthorityRefs.has(authorityRef)) {
        return { ok: false, error: `authority_outcomes contains duplicate authority_ref ${authorityRef}` };
      }
      outcomeAuthorityRefs.add(authorityRef);
      if (!validStatuses.has(outcome.status)) {
        return { ok: false, error: `authority_outcomes[${index}].status must be audited, blocked, or not_applicable` };
      }
      if (!Array.isArray(outcome.evidence_refs)) {
        return { ok: false, error: `authority_outcomes[${index}].evidence_refs must be an array` };
      }
      for (const evidenceRef of outcome.evidence_refs) {
        if (typeof evidenceRef !== "string" || !chunkAllowsFindingFile(chunk, evidenceRef.replace(/\\/g, "/"))) {
          return { ok: false, error: `authority_outcomes[${index}].evidence_refs must belong to chunk authority refs or evidence inventory` };
        }
      }
      if (outcome.status === "audited" && outcome.evidence_refs.length === 0) {
        return { ok: false, error: `authority_outcomes[${index}] audited status requires evidence_refs` };
      }
      if (outcome.status !== "audited" && (typeof outcome.reason !== "string" || !outcome.reason.trim())) {
        return { ok: false, error: `authority_outcomes[${index}] ${outcome.status} status requires reason` };
      }
    }
    if (outcomeAuthorityRefs.size !== expectedAuthority.length) {
      return { ok: false, error: "spec-authority audit evidence coverage.authority_outcomes must contain exactly one entry per authority ref" };
    }
  } else {
    const covered = [...evidence.coverage.files].sort();
    const expected = [...chunk.files].sort();
    if (covered.length !== expected.length || covered.some((fileRef, index) => fileRef !== expected[index])) {
      return { ok: false, error: "audit evidence coverage.files must exactly match chunk files" };
    }
  }
  if (!Array.isArray(evidence.findings)) {
    return { ok: false, error: "audit evidence findings must be an array" };
  }
  return { ok: true };
}

function isInsideRef(rootRef, fileRef) {
  const normalizedRoot = rootRef.replace(/\\/g, "/").replace(/\/$/, "");
  return fileRef === normalizedRoot || fileRef.startsWith(`${normalizedRoot}/`);
}

function chunkAllowsFindingFile(chunk, fileRef) {
  if (chunk.files.includes(fileRef)) {
    return true;
  }
  if (chunk.planning_basis !== "spec_authority") {
    return false;
  }
  return Array.isArray(chunk.evidence_inventory) && chunk.evidence_inventory.includes(fileRef);
}

function normalizeFinding(rawFinding, index, chunk, sweepId, evidenceRef, verifiedAt) {
  if (!isPlainObject(rawFinding)) {
    return { ok: false, error: `finding ${index + 1} must be an object` };
  }

  const severity = String(rawFinding.severity ?? "");
  if (!FINDING_SEVERITY.has(severity)) {
    return { ok: false, error: `finding ${index + 1} severity must be one of critical, high, medium, low` };
  }

  const actionability = String(rawFinding.actionability ?? "");
  if (!FINDING_ACTIONABILITY.has(actionability)) {
    return { ok: false, error: `finding ${index + 1} actionability must be one of auto-fix, needs-decision, deferred-backlog` };
  }

  const confidence = String(rawFinding.confidence ?? "");
  if (!FINDING_CONFIDENCE.has(confidence)) {
    return { ok: false, error: `finding ${index + 1} confidence must be one of high, medium, low` };
  }

  const category = typeof rawFinding.category === "string" && rawFinding.category.trim() ? rawFinding.category.trim() : null;
  const impact = typeof rawFinding.impact === "string" && rawFinding.impact.trim() ? rawFinding.impact.trim() : null;
  const title = typeof rawFinding.title === "string" && rawFinding.title.trim() ? rawFinding.title.trim() : null;
  const description = typeof rawFinding.description === "string" && rawFinding.description.trim() ? rawFinding.description.trim() : null;
  if (!category || !impact || !title || !description) {
    return { ok: false, error: `finding ${index + 1} category, impact, title, and description are required` };
  }

  if (!isPlainObject(rawFinding.location) || typeof rawFinding.location.file !== "string" || !rawFinding.location.file.trim()) {
    return { ok: false, error: `finding ${index + 1} location.file is required` };
  }
  const fileRef = rawFinding.location.file.replace(/\\/g, "/");
  if (!chunkAllowsFindingFile(chunk, fileRef)) {
    return { ok: false, error: `finding ${index + 1} location.file must belong to chunk ${chunk.chunk_id}` };
  }

  if (!isPlainObject(rawFinding.evidence)) {
    return { ok: false, error: `finding ${index + 1} evidence object is required` };
  }
  const evidenceSummary = typeof rawFinding.evidence.summary === "string" && rawFinding.evidence.summary.trim()
    ? rawFinding.evidence.summary.trim()
    : null;
  const auditorReasoning = typeof rawFinding.evidence.auditor_reasoning === "string" && rawFinding.evidence.auditor_reasoning.trim()
    ? rawFinding.evidence.auditor_reasoning.trim()
    : null;
  if (!evidenceSummary || !auditorReasoning) {
    return { ok: false, error: `finding ${index + 1} evidence.summary and evidence.auditor_reasoning are required` };
  }

  const normalized = {
    sweep_id: sweepId,
    chunk_id: chunk.chunk_id,
    owner_domain: chunk.owner_domain,
    severity,
    category,
    actionability,
    confidence,
    impact,
    location: {
      file: fileRef,
      ...(Number.isInteger(rawFinding.location.line) && rawFinding.location.line > 0 ? { line: rawFinding.location.line } : {}),
      ...(typeof rawFinding.location.symbol === "string" && rawFinding.location.symbol.trim() ? { symbol: rawFinding.location.symbol.trim() } : {}),
    },
    title,
    description,
    evidence: {
      summary: evidenceSummary,
      auditor_reasoning: auditorReasoning,
      ...(typeof rawFinding.evidence.snippet === "string" && rawFinding.evidence.snippet.trim() ? { snippet: rawFinding.evidence.snippet.trim() } : {}),
    },
    disposition: "open",
    evidence_ref: evidenceRef,
    detected_at: verifiedAt,
  };

  return {
    ok: true,
    finding: normalized,
    fingerprint: sha256Object({
      severity,
      category,
      actionability,
      file: normalized.location.file,
      line: normalized.location.line ?? null,
      symbol: normalized.location.symbol ?? null,
      title,
      description,
      evidenceSummary,
    }),
  };
}

export async function ingestAuditSweepChunk(projectRoot, options) {
  const sweepId = safeSweepId(options.sweepId);
  if (!sweepId || typeof options.chunkId !== "string") {
    return inputError("nimicoding audit-sweep refused: --sweep-id and --chunk-id are required.\n");
  }

  const timestampError = ensureIsoTimestamp(options.verifiedAt);
  if (timestampError) {
    return timestampError;
  }

  const source = resolveInsideProject(projectRoot, options.fromPath ?? "", "--from");
  if (!source.ok) {
    return inputError(source.error);
  }
  const sourceInfo = await pathExists(source.absolutePath);
  if (!sourceInfo || !sourceInfo.isFile()) {
    return inputError("nimicoding audit-sweep refused: --from must point to an existing JSON file.\n");
  }

  const planResult = await loadPlan(projectRoot, sweepId);
  if (!planResult.ok) {
    return inputError(planResult.error);
  }
  const chunkResult = await loadChunk(projectRoot, sweepId, options.chunkId);
  if (!chunkResult.ok) {
    return inputError(chunkResult.error);
  }
  if (chunkResult.chunk.state !== "dispatched") {
    return inputError("nimicoding audit-sweep refused: chunk ingest requires dispatched state.\n");
  }

  const evidenceJson = await loadJsonFile(source.absolutePath);
  if (!evidenceJson.ok) {
    return inputError("nimicoding audit-sweep refused: --from must contain valid JSON.\n");
  }
  const envelope = validateEvidenceEnvelope(evidenceJson.value, chunkResult.chunk);
  if (!envelope.ok) {
    return inputError(`nimicoding audit-sweep refused: ${envelope.error}.\n`);
  }

  const evidenceRef = artifactRef("evidence_refs", sweepId, `${options.chunkId}.audit-evidence.json`);
  await mkdir(path.dirname(artifactPath(projectRoot, evidenceRef)), { recursive: true });
  await copyFile(source.absolutePath, artifactPath(projectRoot, evidenceRef));

  const { findingsRef: aggregateFindingsRef, store } = await loadFindings(projectRoot, sweepId);
  const seen = new Set(store.findings.map((finding) => finding.fingerprint));
  let addedCount = 0;
  let duplicateCount = 0;
  for (const [index, rawFinding] of evidenceJson.value.findings.entries()) {
    const normalized = normalizeFinding(rawFinding, index, chunkResult.chunk, sweepId, evidenceRef, options.verifiedAt);
    if (!normalized.ok) {
      return inputError(`nimicoding audit-sweep refused: ${normalized.error}.\n`);
    }
    if (seen.has(normalized.fingerprint)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(normalized.fingerprint);
    store.findings.push({
      id: `finding-${String(store.findings.length + 1).padStart(4, "0")}`,
      fingerprint: normalized.fingerprint,
      ...normalized.finding,
    });
    addedCount += 1;
  }
  store.duplicate_count = (store.duplicate_count ?? 0) + duplicateCount;
  store.updated_at = options.verifiedAt;
  await writeYamlRef(projectRoot, aggregateFindingsRef, store);

  const updatedChunk = {
    ...chunkResult.chunk,
    state: "ingested",
    evidence_ref: evidenceRef,
    finding_count: evidenceJson.value.findings.length,
    lifecycle: {
      ...chunkResult.chunk.lifecycle,
      ingested_at: options.verifiedAt,
    },
    updated_at: options.verifiedAt,
  };
  await writeYamlRef(projectRoot, chunkResult.chunkRef, updatedChunk);
  await writeYamlRef(projectRoot, planResult.planRef, {
    ...planResult.plan,
    chunks: planResult.plan.chunks.map((chunk) => chunk.chunk_id === options.chunkId
      ? { ...chunk, state: "ingested", finding_count: evidenceJson.value.findings.length, evidence_ref: evidenceRef }
      : chunk),
    updated_at: options.verifiedAt,
  });

  const runRef = await appendRunEvent(projectRoot, sweepId, {
    event_type: "chunk_ingested",
    chunk_id: options.chunkId,
    chunk_ref: chunkRef(sweepId, options.chunkId),
    evidence_ref: evidenceRef,
    findings_ref: aggregateFindingsRef,
    finding_count: evidenceJson.value.findings.length,
    added_count: addedCount,
    duplicate_count: duplicateCount,
  });

  return {
    ok: true,
    exitCode: 0,
    sweepId,
    chunkId: options.chunkId,
    state: "ingested",
    evidenceRef,
    findingsRef: aggregateFindingsRef,
    findingCount: evidenceJson.value.findings.length,
    addedCount,
    duplicateCount,
    runLedgerRef: runRef,
  };
}
