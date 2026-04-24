import {
  ACTIVE_CHUNK_STATES,
  artifactPath,
  ledgerRef,
  loadLatestLedger,
  loadYamlRef,
  remediationMapRef,
  sha256Object,
} from "./common.mjs";
import { pathExists } from "../fs-helpers.mjs";
import { isPlainObject } from "../value-helpers.mjs";

function check(checks, id, ok, reason) {
  checks.push({ id, ok, reason });
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

async function refExists(projectRoot, ref) {
  const info = await pathExists(artifactPath(projectRoot, ref));
  return Boolean(info?.isFile());
}

async function validateEvidenceRefs(projectRoot, refs, checks, prefix) {
  for (const ref of refs.filter((entry) => typeof entry === "string" && entry.trim())) {
    check(checks, `${prefix}_${ref.replace(/[^a-zA-Z0-9]+/g, "_")}_exists`, await refExists(projectRoot, ref), `referenced artifact exists: ${ref}`);
  }
}

export function deriveLedgerSnapshotId(sweepId, plan, chunks, findings, clusters = []) {
  const snapshotSeed = {
    sweepId,
    inventoryHash: plan.inventory_hash,
    evidenceInventoryHash: plan.evidence_inventory_hash ?? null,
    chunkStates: chunks.map((chunk) => ({
      chunk_id: chunk.chunk_id,
      state: chunk.state,
      evidence_ref: chunk.evidence_ref ?? null,
      finding_count: chunk.finding_count ?? 0,
    })),
    findings: findings.map((finding) => ({
      id: finding.id,
      fingerprint: finding.fingerprint,
      disposition: finding.disposition,
      resolution_evidence_ref: finding.resolution?.evidence_ref ?? null,
    })),
    clusters: clusters.map((cluster) => ({
      cluster_id: cluster.cluster_id,
      canonical_finding_ids: cluster.canonical_finding_ids,
      duplicate_symptom_count: cluster.duplicate_symptom_count ?? 0,
    })),
  };
  return `ledger-${sha256Object(snapshotSeed).slice(0, 16)}`;
}

export function validateClusterShape(cluster, findingIds, checks) {
  check(checks, `cluster_${cluster?.cluster_id ?? "unknown"}_required_fields`, isPlainObject(cluster)
    && nonEmptyString(cluster.cluster_id)
    && nonEmptyString(cluster.cluster_key)
    && nonEmptyString(cluster.representative_finding_id)
    && Array.isArray(cluster.canonical_finding_ids)
    && Array.isArray(cluster.duplicate_symptoms), "audit finding cluster has required fields");
  if (!isPlainObject(cluster)) {
    return;
  }
  check(checks, `cluster_${cluster.cluster_id}_findings_known`, findingIds.has(cluster.representative_finding_id)
    && cluster.canonical_finding_ids.every((findingId) => findingIds.has(findingId)), "audit finding cluster references known canonical findings");
  check(checks, `cluster_${cluster.cluster_id}_symptom_count_matches`, (cluster.duplicate_symptom_count ?? 0) === cluster.duplicate_symptoms.length, "audit finding cluster duplicate symptom count matches symptoms");
}

function buildLedgerExpectedCounts(plan, chunks, findings, clusters = []) {
  const frozenChunks = chunks.filter((chunk) => chunk.state === "frozen");
  const lifecycleCoverage = {
    frozen_chunks: frozenChunks.length,
    failed_chunks: chunks.filter((chunk) => chunk.state === "failed").length,
    skipped_chunks: chunks.filter((chunk) => chunk.state === "skipped").length,
    active_chunks: chunks.filter((chunk) => ACTIVE_CHUNK_STATES.has(chunk.state)).length,
  };
  const coverage = plan.planning_basis?.mode === "spec_authority"
    ? buildSpecAuthorityCoverage(plan, frozenChunks, lifecycleCoverage)
    : buildFileCoverage(plan, frozenChunks, lifecycleCoverage);
  const findingPosture = {
    open: findings.filter((finding) => finding.disposition === "open").length,
    remediated: findings.filter((finding) => finding.disposition === "remediated").length,
    accepted_risk: findings.filter((finding) => finding.disposition === "accepted-risk").length,
    false_positive: findings.filter((finding) => finding.disposition === "false-positive").length,
    deferred_backlog: findings.filter((finding) => finding.disposition === "deferred-backlog").length,
  };
  return {
    coverage,
    findingPosture,
    findingClusterCount: clusters.length,
    clusteredSymptomCount: clusters.reduce((total, cluster) => total + (cluster.duplicate_symptom_count ?? 0), 0),
  };
}

function buildSpecAuthorityCoverage(plan, frozenChunks, lifecycleCoverage) {
  const authorityTotal = plan.coverage?.authority_files ?? plan.coverage?.included_files ?? 0;
  const evidenceTotal = plan.coverage?.evidence_files ?? plan.evidence_inventory?.length ?? 0;
  const auditedAuthorityFiles = new Set(frozenChunks.flatMap((chunk) => chunk.files));
  const auditedEvidenceFiles = new Set(frozenChunks.flatMap((chunk) => chunk.evidence_inventory ?? []));
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
      unmapped_files: plan.coverage?.unmapped_evidence_files ?? plan.unmapped_evidence_files?.length ?? 0,
    },
    ...lifecycleCoverage,
  };
}

function buildFileCoverage(plan, frozenChunks, lifecycleCoverage) {
  const auditedFiles = new Set(frozenChunks.flatMap((chunk) => chunk.files));
  return {
    total_files: plan.coverage.total_files,
    included_files: plan.coverage.included_files,
    audited_files: auditedFiles.size,
    ...lifecycleCoverage,
  };
}

export async function validateLatestLedger(projectRoot, sweepId, plan, chunks, findings, clusters, checks) {
  const latest = await loadLatestLedger(projectRoot, sweepId);
  check(checks, "latest_ledger_loadable", latest.ok, "latest ledger pointer and ledger are loadable");
  if (!latest.ok) {
    return null;
  }
  const ledger = latest.ledger;
  const expectedSnapshotId = deriveLedgerSnapshotId(sweepId, plan, chunks, findings, clusters);
  check(checks, "ledger_snapshot_id_content_hash", ledger.snapshot_id === expectedSnapshotId && latest.ledgerRef === ledgerRef(sweepId, expectedSnapshotId), "ledger snapshot id is content-derived and current");
  const expected = buildLedgerExpectedCounts(plan, chunks, findings, clusters);
  check(checks, "ledger_coverage_counts_match", JSON.stringify(ledger.coverage) === JSON.stringify(expected.coverage), "ledger coverage counts match plan and chunks");
  check(checks, "ledger_finding_counts_match", ledger.finding_count === findings.length
    && ledger.unresolved_finding_count === expected.findingPosture.open
    && JSON.stringify(ledger.finding_posture) === JSON.stringify(expected.findingPosture), "ledger finding counts match findings store");
  check(checks, "ledger_cluster_counts_match", (ledger.finding_cluster_count ?? 0) === expected.findingClusterCount
    && (ledger.clustered_symptom_count ?? 0) === expected.clusteredSymptomCount
    && (ledger.remediation_obligation_count ?? findings.length) === findings.length, "ledger cluster counts match findings store");
  check(checks, "ledger_latest_pointer_matches", latest.ledgerRef === ledgerRef(sweepId, ledger.snapshot_id), "latest pointer references the immutable ledger snapshot");
  check(checks, "ledger_status_valid", ["candidate_ready", "partial", "blocked", "blocked_evidence_incomplete", "partial_authority_only"].includes(ledger.status), "ledger status is valid");
  checkLedgerSpecCoverage(plan, ledger, checks);
  await validateEvidenceRefs(projectRoot, [
    ledger.plan_ref,
    ...(Array.isArray(ledger.chunk_refs) ? ledger.chunk_refs : []),
    ledger.findings_ref,
    ...(Array.isArray(ledger.evidence_refs) ? ledger.evidence_refs : []),
    ledger.report_ref,
    ledger.run_ledger_ref,
  ], checks, "ledger_ref");
  return { ledger, ledger_ref: latest.ledgerRef, snapshot_id: ledger.snapshot_id };
}

function checkLedgerSpecCoverage(plan, ledger, checks) {
  check(checks, "ledger_candidate_ready_strict", ledger.status !== "candidate_ready"
    || (ledger.coverage.included_files > 0 && ledger.coverage.audited_files === ledger.coverage.included_files && ledger.coverage.active_chunks === 0 && ledger.coverage.failed_chunks === 0 && ledger.coverage.skipped_chunks === 0), "candidate_ready requires all included files audited and all chunks frozen");
  if (plan.planning_basis?.mode !== "spec_authority") {
    return;
  }
  const authorityFull = ledger.coverage.authority_coverage?.total_files > 0
    && ledger.coverage.authority_coverage.audited_files === ledger.coverage.authority_coverage.total_files;
  const evidenceFull = ledger.coverage.evidence_coverage?.audited_files === ledger.coverage.evidence_coverage?.total_files
    && ledger.coverage.evidence_coverage?.unmapped_files === 0;
  check(checks, "ledger_spec_coverage_split_present", isPlainObject(ledger.coverage.authority_coverage)
    && isPlainObject(ledger.coverage.evidence_coverage), "spec-authority ledger splits authority and evidence coverage");
  check(checks, "ledger_spec_candidate_ready_requires_evidence", ledger.status !== "candidate_ready"
    || (authorityFull && evidenceFull), "candidate_ready requires full authority and evidence coverage");
  check(checks, "ledger_spec_no_full_with_unmapped_evidence", ledger.status !== "candidate_ready"
    || ledger.coverage.evidence_coverage?.unmapped_files === 0, "candidate_ready requires zero unmapped evidence files");
}

export async function validateRemediationMap(projectRoot, sweepId, ledgerInfo, findings, clusters, checks) {
  if (!ledgerInfo) {
    check(checks, "remediation_map_ledger_available", false, "remediation map validation requires latest ledger");
    return null;
  }
  const mapRef = remediationMapRef(sweepId, ledgerInfo.snapshot_id);
  const remediationMap = await loadYamlRef(projectRoot, mapRef);
  const openFindings = findings.filter((finding) => finding.disposition === "open");
  if (!isPlainObject(remediationMap)) {
    check(checks, "remediation_map_required", false, "remediation map exists for the latest ledger");
    return null;
  }
  check(checks, "remediation_map_identity", remediationMap.kind === "audit-remediation-map" && remediationMap.sweep_id === sweepId && remediationMap.source_ledger_ref === ledgerInfo.ledger_ref, "remediation map references latest ledger");
  const findingIds = new Set(findings.map((finding) => finding.id));
  const clusterIds = new Set(clusters.map((cluster) => cluster.cluster_id));
  const mappedIds = new Set();
  const wavesOk = Array.isArray(remediationMap.waves) && remediationMap.waves.every((wave) => {
    if (!isPlainObject(wave) || !nonEmptyString(wave.wave_id) || !Array.isArray(wave.finding_ids) || !Array.isArray(wave.write_set)) {
      return false;
    }
    for (const findingId of wave.finding_ids) {
      mappedIds.add(findingId);
    }
    return wave.finding_ids.every((findingId) => findingIds.has(findingId))
      && (!Array.isArray(wave.cluster_ids) || wave.cluster_ids.every((clusterId) => clusterIds.has(clusterId)));
  });
  check(checks, "remediation_map_waves_valid", wavesOk, "remediation map waves reference known findings");
  check(checks, "remediation_map_open_findings_covered", openFindings.every((finding) => mappedIds.has(finding.id)), "all open findings are covered by remediation map waves");
  return { remediationMap, remediation_map_ref: mapRef };
}
