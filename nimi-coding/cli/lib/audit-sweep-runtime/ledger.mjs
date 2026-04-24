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

function deriveLedgerStatus(plan, chunks) {
  const includedFiles = plan.coverage?.included_files ?? 0;
  const frozenChunks = chunks.filter((chunk) => chunk.state === "frozen").length;
  const failedChunks = chunks.filter((chunk) => chunk.state === "failed").length;
  const skippedChunks = chunks.filter((chunk) => chunk.state === "skipped").length;
  const activeChunks = chunks.filter((chunk) => ACTIVE_CHUNK_STATES.has(chunk.state)).length;

  if (includedFiles === 0) {
    return "blocked";
  }
  if (activeChunks > 0) {
    return "partial";
  }
  if (failedChunks > 0 || skippedChunks > 0) {
    return "partial";
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
  const chunks = chunksResult.chunks;
  const status = deriveLedgerStatus(planResult.plan, chunks);
  const auditedFiles = new Set(chunks.filter((chunk) => chunk.state === "frozen").flatMap((chunk) => chunk.files));
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
    coverage: {
      total_files: planResult.plan.coverage.total_files,
      included_files: planResult.plan.coverage.included_files,
      audited_files: auditedFiles.size,
      frozen_chunks: chunks.filter((chunk) => chunk.state === "frozen").length,
      failed_chunks: chunks.filter((chunk) => chunk.state === "failed").length,
      skipped_chunks: chunks.filter((chunk) => chunk.state === "skipped").length,
      active_chunks: chunks.filter((chunk) => ACTIVE_CHUNK_STATES.has(chunk.state)).length,
    },
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
