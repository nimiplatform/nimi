import {
  appendRunEvent,
  auditCloseoutRef,
  ensureIsoTimestamp,
  inputError,
  loadFindings,
  loadLatestLedger,
  loadYamlRef,
  remediationMapRef,
  safeSweepId,
  writeYamlRef,
} from "./common.mjs";
import { validateAuditSweepArtifacts } from "./validators.mjs";

export async function buildAuditSweepCloseoutImport(projectRoot, options) {
  const sweepId = safeSweepId(options.sweepId);
  if (!sweepId) {
    return inputError("nimicoding audit-sweep refused: --sweep-id is required.\n");
  }
  const timestampError = ensureIsoTimestamp(options.verifiedAt);
  if (timestampError) {
    return timestampError;
  }

  const ledgerResult = await loadLatestLedger(projectRoot, sweepId);
  if (!ledgerResult.ok) {
    return inputError(ledgerResult.error);
  }
  const ledger = ledgerResult.ledger;
  const preflightValidation = await validateAuditSweepArtifacts(projectRoot, { sweepId, scope: "remediation" });
  if (!preflightValidation.ok) {
    const failed = preflightValidation.checks.find((entry) => !entry.ok);
    return inputError(`nimicoding audit-sweep refused: audit-sweep closeout preflight failed: ${failed?.reason ?? "artifact validation failed"}.\n`);
  }
  if (ledger.status === "blocked") {
    return inputError("nimicoding audit-sweep refused: blocked ledger cannot produce completed closeout summary.\n");
  }
  if (ledger.coverage.active_chunks > 0) {
    return inputError("nimicoding audit-sweep refused: closeout summary requires no active chunks.\n");
  }

  const mapRef = remediationMapRef(sweepId, ledger.snapshot_id);
  const remediationMap = await loadYamlRef(projectRoot, mapRef);
  const { store } = await loadFindings(projectRoot, sweepId);
  const openFindingIds = store.findings.filter((finding) => finding.disposition === "open").map((finding) => finding.id);
  const mappedFindingIds = new Set(Array.isArray(remediationMap?.waves)
    ? remediationMap.waves.flatMap((wave) => Array.isArray(wave.finding_ids) ? wave.finding_ids : [])
    : []);
  const unmappedOpenFindings = openFindingIds.filter((findingId) => !mappedFindingIds.has(findingId));
  if (openFindingIds.length > 0 && (!remediationMap || unmappedOpenFindings.length > 0)) {
    return inputError("nimicoding audit-sweep refused: open findings require remediation map coverage before closeout summary.\n");
  }
  const closedWithoutResolutionEvidence = store.findings
    .filter((finding) => finding.disposition !== "open")
    .filter((finding) => !finding.resolution?.evidence_ref || !finding.resolution?.rerun);
  if (closedWithoutResolutionEvidence.length > 0) {
    return inputError("nimicoding audit-sweep refused: closed findings require resolution and rerun evidence before closeout summary.\n");
  }

  const closeoutPosture = openFindingIds.length > 0
    ? "audit_complete_findings_open"
    : "audit_complete_all_findings_postured";
  const auditCloseoutRefValue = auditCloseoutRef(sweepId, ledger.snapshot_id);
  const auditCloseout = {
    version: 1,
    kind: "audit-closeout",
    sweep_id: sweepId,
    ledger_ref: ledgerResult.ledgerRef,
    remediation_map_ref: mapRef,
    audit_closeout_ref: auditCloseoutRefValue,
    coverage_status: ledger.status === "candidate_ready" ? "full" : "partial",
    finding_posture: ledger.finding_posture,
    closeout_posture: closeoutPosture,
    verified_at: options.verifiedAt,
  };
  await writeYamlRef(projectRoot, auditCloseoutRefValue, auditCloseout);
  const summary = {
    plan_ref: ledger.plan_ref,
    chunk_refs: ledger.chunk_refs,
    ledger_ref: ledgerResult.ledgerRef,
    report_ref: ledger.report_ref,
    remediation_map_ref: mapRef,
    audit_closeout_ref: auditCloseoutRefValue,
    evidence_refs: ledger.evidence_refs,
    finding_count: ledger.finding_count,
    unresolved_finding_count: ledger.unresolved_finding_count,
    status: ledger.status,
    summary: `Audit sweep ${sweepId} has ${ledger.coverage.audited_files}/${ledger.coverage.included_files} included files audited, ${ledger.finding_count} findings, and ${ledger.unresolved_finding_count} open findings.`,
    verified_at: options.verifiedAt,
  };
  const runRef = await appendRunEvent(projectRoot, sweepId, {
    event_type: "closeout_summary_projected",
    ledger_ref: ledgerResult.ledgerRef,
    remediation_map_ref: mapRef,
    audit_closeout_ref: auditCloseoutRefValue,
    closeout_posture: closeoutPosture,
  });
  const closeoutValidation = await validateAuditSweepArtifacts(projectRoot, { sweepId, scope: "closeout" });
  if (!closeoutValidation.ok) {
    const failed = closeoutValidation.checks.find((entry) => !entry.ok);
    return inputError(`nimicoding audit-sweep refused: audit-sweep closeout validation failed: ${failed?.reason ?? "artifact validation failed"}.\n`);
  }

  return {
    ok: true,
    exitCode: 0,
    projectRoot,
    skill: { id: "audit_sweep" },
    outcome: "completed",
    verifiedAt: options.verifiedAt,
    localOnly: true,
    runLedgerRef: runRef,
    auditCloseoutRef: auditCloseoutRefValue,
    auditCloseout,
    summary,
  };
}
