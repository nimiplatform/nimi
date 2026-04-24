import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  FINDING_DISPOSITION,
  RERUN_VERDICT,
  appendRunEvent,
  artifactPath,
  artifactRef,
  ensureIsoTimestamp,
  findingsRef,
  inputError,
  loadFindings,
  loadJsonFile,
  resolveInsideProject,
  safeSweepId,
  writeYamlRef,
} from "./common.mjs";
import { isPlainObject } from "../value-helpers.mjs";
import { pathExists } from "../fs-helpers.mjs";

function validateRerunEvidence(evidence, finding, disposition) {
  if (!isPlainObject(evidence)) {
    return { ok: false, error: "rerun evidence must be a JSON object" };
  }
  if (evidence.finding_id !== finding.id) {
    return { ok: false, error: "rerun evidence finding_id must match --finding-id" };
  }
  if (evidence.source_fingerprint !== finding.fingerprint) {
    return { ok: false, error: "rerun evidence source_fingerprint must match original finding" };
  }
  if (evidence.disposition !== disposition) {
    return { ok: false, error: "rerun evidence disposition must match --disposition" };
  }
  if (!isPlainObject(evidence.rerun) || !Array.isArray(evidence.rerun.covered_files)) {
    return { ok: false, error: "rerun.covered_files is required" };
  }
  if (!evidence.rerun.covered_files.includes(finding.location.file)) {
    return { ok: false, error: "rerun.covered_files must include original finding file" };
  }
  if (!RERUN_VERDICT.has(evidence.rerun.verdict)) {
    return { ok: false, error: "rerun.verdict is invalid" };
  }
  if (disposition === "remediated" && evidence.rerun.verdict !== "not_reproduced") {
    return { ok: false, error: "remediated disposition requires not_reproduced rerun verdict" };
  }
  if (["accepted-risk", "false-positive"].includes(disposition) && !isPlainObject(evidence.manager_acceptance)) {
    return { ok: false, error: `${disposition} disposition requires manager_acceptance evidence` };
  }
  if (disposition === "deferred-backlog" && typeof evidence.backlog_ref !== "string") {
    return { ok: false, error: "deferred-backlog disposition requires backlog_ref" };
  }
  if (typeof evidence.evidence_summary !== "string" || !evidence.evidence_summary.trim()) {
    return { ok: false, error: "evidence_summary is required" };
  }
  return { ok: true };
}

export async function resolveAuditSweepFinding(projectRoot, options) {
  const sweepId = safeSweepId(options.sweepId);
  if (!sweepId || typeof options.findingId !== "string") {
    return inputError("nimicoding audit-sweep refused: --sweep-id and --finding-id are required.\n");
  }
  if (!FINDING_DISPOSITION.has(options.disposition) || options.disposition === "open") {
    return inputError("nimicoding audit-sweep refused: --disposition must be one of remediated, accepted-risk, false-positive, deferred-backlog.\n");
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
    return inputError("nimicoding audit-sweep refused: --from must point to an existing JSON evidence file.\n");
  }

  const { findingsRef: aggregateFindingsRef, store } = await loadFindings(projectRoot, sweepId);
  const findingIndex = store.findings.findIndex((finding) => finding.id === options.findingId);
  if (findingIndex === -1) {
    return inputError(`nimicoding audit-sweep refused: finding not found for ${options.findingId}.\n`);
  }
  const finding = store.findings[findingIndex];
  const evidenceJson = await loadJsonFile(source.absolutePath);
  if (!evidenceJson.ok) {
    return inputError("nimicoding audit-sweep refused: --from must contain valid JSON.\n");
  }
  const validation = validateRerunEvidence(evidenceJson.value, finding, options.disposition);
  if (!validation.ok) {
    return inputError(`nimicoding audit-sweep refused: ${validation.error}.\n`);
  }

  const evidenceRef = artifactRef("evidence_refs", sweepId, `resolution-${options.findingId}.json`);
  await mkdir(path.dirname(artifactPath(projectRoot, evidenceRef)), { recursive: true });
  await copyFile(source.absolutePath, artifactPath(projectRoot, evidenceRef));

  store.findings[findingIndex] = {
    ...finding,
    disposition: options.disposition,
    resolution: {
      disposition: options.disposition,
      evidence_ref: evidenceRef,
      rerun: evidenceJson.value.rerun,
      resolved_at: options.verifiedAt,
    },
  };
  store.updated_at = options.verifiedAt;
  await writeYamlRef(projectRoot, aggregateFindingsRef, store);
  const runRef = await appendRunEvent(projectRoot, sweepId, {
    event_type: "finding_resolved",
    finding_id: options.findingId,
    disposition: options.disposition,
    evidence_ref: evidenceRef,
    findings_ref: findingsRef(sweepId),
  });

  return {
    ok: true,
    exitCode: 0,
    sweepId,
    findingId: options.findingId,
    disposition: options.disposition,
    findingsRef: aggregateFindingsRef,
    evidenceRef,
    runLedgerRef: runRef,
  };
}
