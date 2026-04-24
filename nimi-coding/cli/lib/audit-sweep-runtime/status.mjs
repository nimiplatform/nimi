import {
  ACTIVE_CHUNK_STATES,
  inputError,
  loadFindings,
  loadLatestLedger,
  loadPlan,
  safeSweepId,
} from "./common.mjs";

export async function getAuditSweepStatus(projectRoot, options) {
  const sweepId = safeSweepId(options.sweepId);
  if (!sweepId) {
    return inputError("nimicoding audit-sweep refused: --sweep-id is required.\n");
  }

  const planResult = await loadPlan(projectRoot, sweepId);
  if (!planResult.ok) {
    return inputError(planResult.error);
  }
  const { findingsRef, store } = await loadFindings(projectRoot, sweepId);
  const latestLedger = await loadLatestLedger(projectRoot, sweepId);
  const chunks = Array.isArray(planResult.plan.chunks) ? planResult.plan.chunks : [];

  return {
    ok: true,
    exitCode: 0,
    sweepId,
    planRef: planResult.planRef,
    findingsRef,
    latestLedgerRef: latestLedger.ok ? latestLedger.ledgerRef : null,
    coverage: {
      totalFiles: planResult.plan.coverage?.total_files ?? 0,
      includedFiles: planResult.plan.coverage?.included_files ?? 0,
      ...(planResult.plan.planning_basis?.mode === "spec_authority" ? {
        authorityFiles: planResult.plan.coverage?.authority_files ?? 0,
        evidenceFiles: planResult.plan.coverage?.evidence_files ?? 0,
        unmappedEvidenceFiles: planResult.plan.coverage?.unmapped_evidence_files ?? 0,
      } : {}),
      frozenChunks: chunks.filter((chunk) => chunk.state === "frozen").length,
      activeChunks: chunks.filter((chunk) => ACTIVE_CHUNK_STATES.has(chunk.state)).length,
      chunks: chunks.reduce((acc, chunk) => {
        acc[chunk.state] = (acc[chunk.state] ?? 0) + 1;
        return acc;
      }, {}),
    },
    findingCount: store.findings.length,
    unresolvedFindingCount: store.findings.filter((finding) => finding.disposition === "open").length,
  };
}
