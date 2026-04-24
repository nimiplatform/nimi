import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

import {
  ACTIVE_CHUNK_STATES,
  appendRunEvent,
  artifactPath,
  artifactRef,
  chunkRef,
  ensureIsoTimestamp,
  findingsRef,
  inputError,
  ledgerRef,
  loadChunk,
  loadFindings,
  loadPlan,
  remediationMapRef,
  reportRef,
  runLedgerRef,
  safeSweepId,
  writeYamlRef,
} from "./common.mjs";
import { deriveLedgerSnapshotId } from "./validators.mjs";

function countBy(values, keyFn) {
  const counts = {};
  for (const value of values) {
    const key = keyFn(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function loadChunks(projectRoot, sweepId, plan) {
  const chunks = [];
  for (const chunk of plan.chunks) {
    const loaded = await loadChunk(projectRoot, sweepId, chunk.chunk_id);
    if (!loaded.ok) {
      return loaded;
    }
    chunks.push(loaded.chunk);
  }
  return { ok: true, chunks };
}

function buildFindingPosture(findings) {
  return {
    open: findings.filter((finding) => finding.disposition === "open").length,
    remediated: findings.filter((finding) => finding.disposition === "remediated").length,
    accepted_risk: findings.filter((finding) => finding.disposition === "accepted-risk").length,
    false_positive: findings.filter((finding) => finding.disposition === "false-positive").length,
    deferred_backlog: findings.filter((finding) => finding.disposition === "deferred-backlog").length,
  };
}

function buildLedgerCoverage(plan, chunks) {
  const frozenChunks = chunks.filter((chunk) => chunk.state === "frozen");
  const base = {
    frozen_chunks: frozenChunks.length,
    failed_chunks: chunks.filter((chunk) => chunk.state === "failed").length,
    skipped_chunks: chunks.filter((chunk) => chunk.state === "skipped").length,
    active_chunks: chunks.filter((chunk) => ACTIVE_CHUNK_STATES.has(chunk.state)).length,
  };
  if (plan.planning_basis?.mode !== "spec_authority") {
    const auditedFiles = new Set(frozenChunks.flatMap((chunk) => chunk.files));
    return {
      total_files: plan.coverage.total_files,
      included_files: plan.coverage.included_files,
      audited_files: auditedFiles.size,
      ...base,
    };
  }

  const auditedAuthorityFiles = new Set(frozenChunks.flatMap((chunk) => chunk.files));
  const auditedEvidenceFiles = new Set(frozenChunks.flatMap((chunk) => chunk.evidence_inventory ?? []));
  const authorityTotal = plan.coverage?.authority_files ?? plan.coverage?.included_files ?? 0;
  const evidenceTotal = plan.coverage?.evidence_files ?? plan.evidence_inventory?.length ?? 0;
  const unmappedEvidenceFiles = plan.coverage?.unmapped_evidence_files ?? plan.unmapped_evidence_files?.length ?? 0;
  return {
    total_files: authorityTotal + evidenceTotal,
    included_files: authorityTotal + evidenceTotal,
    audited_files: auditedAuthorityFiles.size + auditedEvidenceFiles.size,
    authority_coverage: {
      total_files: authorityTotal,
      audited_files: auditedAuthorityFiles.size,
    },
    evidence_coverage: {
      total_files: evidenceTotal,
      audited_files: auditedEvidenceFiles.size,
      unmapped_files: unmappedEvidenceFiles,
    },
    ...base,
  };
}

function deriveLedgerStatus(plan, coverage, chunks) {
  const includedFiles = coverage.included_files ?? 0;
  const frozenChunks = chunks.filter((chunk) => chunk.state === "frozen").length;

  if (includedFiles === 0) {
    return "blocked";
  }
  if (coverage.active_chunks > 0) {
    return "partial";
  }
  if (coverage.failed_chunks > 0 || coverage.skipped_chunks > 0) {
    return "partial";
  }
  if (plan.planning_basis?.mode === "spec_authority") {
    const authorityFull = coverage.authority_coverage?.total_files > 0
      && coverage.authority_coverage.audited_files === coverage.authority_coverage.total_files;
    const evidenceFull = coverage.evidence_coverage?.audited_files === coverage.evidence_coverage?.total_files
      && coverage.evidence_coverage?.unmapped_files === 0;
    if (frozenChunks === chunks.length && authorityFull && evidenceFull) {
      return "candidate_ready";
    }
    if (authorityFull && !evidenceFull) {
      return "blocked_evidence_incomplete";
    }
    return "partial_authority_only";
  }
  return frozenChunks === chunks.length ? "candidate_ready" : "partial";
}

function formatReport({ sweepId, ledger, findings }) {
  const lines = [
    `# Audit Sweep ${sweepId}`,
    "",
    `- Snapshot: ${ledger.snapshot_id}`,
    `- Status: ${ledger.status}`,
    `- Included files: ${ledger.coverage.included_files}`,
    `- Audited files: ${ledger.coverage.audited_files}`,
    ...(ledger.coverage.authority_coverage ? [
      `- Authority coverage: ${ledger.coverage.authority_coverage.audited_files}/${ledger.coverage.authority_coverage.total_files}`,
      `- Evidence coverage: ${ledger.coverage.evidence_coverage.audited_files}/${ledger.coverage.evidence_coverage.total_files}`,
      `- Unmapped evidence files: ${ledger.coverage.evidence_coverage.unmapped_files}`,
    ] : []),
    `- Frozen chunks: ${ledger.coverage.frozen_chunks}`,
    `- Findings: ${ledger.finding_count}`,
    `- Open findings: ${ledger.finding_posture.open}`,
    "",
    "## Severity Counts",
    "",
    ...Object.entries(ledger.severity_counts).map(([severity, count]) => `- ${severity}: ${count}`),
    "",
    "## Findings",
    "",
  ];

  if (findings.length === 0) {
    lines.push("No findings recorded.");
  } else {
    for (const finding of findings) {
      lines.push(`### ${finding.id}: ${finding.title}`);
      lines.push("");
      lines.push(`- Severity: ${finding.severity}`);
      lines.push(`- Disposition: ${finding.disposition}`);
      lines.push(`- Actionability: ${finding.actionability}`);
      lines.push(`- Location: ${finding.location.file}${finding.location.line ? `:${finding.location.line}` : ""}`);
      lines.push(`- Fingerprint: ${finding.fingerprint}`);
      lines.push("");
      lines.push(finding.description);
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function buildAuditSweepLedger(projectRoot, options) {
  const sweepId = safeSweepId(options.sweepId);
  if (!sweepId) {
    return inputError("nimicoding audit-sweep refused: --sweep-id is required.\n");
  }

  const timestampError = options.verifiedAt ? ensureIsoTimestamp(options.verifiedAt) : null;
  if (timestampError) {
    return timestampError;
  }
  const verifiedAt = options.verifiedAt ?? new Date().toISOString();

  const planResult = await loadPlan(projectRoot, sweepId);
  if (!planResult.ok) {
    return inputError(planResult.error);
  }
  const chunksResult = await loadChunks(projectRoot, sweepId, planResult.plan);
  if (!chunksResult.ok) {
    return inputError(chunksResult.error);
  }
  const { findingsRef: aggregateFindingsRef, store } = await loadFindings(projectRoot, sweepId);
  await writeYamlRef(projectRoot, aggregateFindingsRef, store);
  const chunks = chunksResult.chunks;
  const coverage = buildLedgerCoverage(planResult.plan, chunks);
  const status = deriveLedgerStatus(planResult.plan, coverage, chunks);
  const evidenceRefs = [
    aggregateFindingsRef,
    ...chunks.map((chunk) => chunk.evidence_ref).filter(Boolean),
    ...store.findings.map((finding) => finding.resolution?.evidence_ref).filter(Boolean),
  ];
  const findingPosture = buildFindingPosture(store.findings);
  const snapshotId = deriveLedgerSnapshotId(sweepId, planResult.plan, chunks, store.findings);
  const currentLedgerRef = ledgerRef(sweepId, snapshotId);
  const currentReportRef = reportRef(sweepId, snapshotId);
  const latestPointerRef = artifactRef("ledger_ref", sweepId, "latest.yaml");
  const ledger = {
    version: 1,
    kind: "audit-ledger",
    sweep_id: sweepId,
    snapshot_id: snapshotId,
    immutable: true,
    plan_ref: planResult.planRef,
    chunk_refs: chunks.map((chunk) => chunkRef(sweepId, chunk.chunk_id)),
    findings_ref: aggregateFindingsRef,
    evidence_refs: evidenceRefs,
    run_ledger_ref: runLedgerRef(sweepId),
    report_ref: currentReportRef,
    remediation_map_ref: remediationMapRef(sweepId, snapshotId),
    status,
    coverage,
    finding_count: store.findings.length,
    unresolved_finding_count: findingPosture.open,
    finding_posture: findingPosture,
    severity_counts: countBy(store.findings, (finding) => finding.severity),
    actionability_counts: countBy(store.findings, (finding) => finding.actionability),
    created_at: verifiedAt,
  };

  await writeYamlRef(projectRoot, currentLedgerRef, ledger);
  await writeYamlRef(projectRoot, latestPointerRef, {
    version: 1,
    kind: "audit-ledger-pointer",
    sweep_id: sweepId,
    ledger_ref: currentLedgerRef,
    snapshot_id: snapshotId,
    updated_at: verifiedAt,
  });
  await mkdir(path.dirname(artifactPath(projectRoot, currentReportRef)), { recursive: true });
  await writeFile(artifactPath(projectRoot, currentReportRef), formatReport({ sweepId, ledger, findings: store.findings }), "utf8");
  const runRef = await appendRunEvent(projectRoot, sweepId, {
    event_type: "ledger_snapshot_created",
    ledger_ref: currentLedgerRef,
    snapshot_id: snapshotId,
    status,
  });

  return {
    ok: true,
    exitCode: 0,
    sweepId,
    status,
    snapshotId,
    planRef: planResult.planRef,
    chunkRefs: ledger.chunk_refs,
    ledgerRef: currentLedgerRef,
    latestLedgerRef: latestPointerRef,
    reportRef: currentReportRef,
    remediationMapRef: ledger.remediation_map_ref,
    runLedgerRef: runRef,
    evidenceRefs,
    findingCount: store.findings.length,
    unresolvedFindingCount: findingPosture.open,
    coverage: ledger.coverage,
  };
}

export { formatReport as formatAuditSweepReport };
