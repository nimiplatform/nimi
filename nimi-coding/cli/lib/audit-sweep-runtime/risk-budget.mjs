import path from "node:path";

import { SEVERITY_RANK, sha256Object } from "./common.mjs";
import { isPlainObject } from "../value-helpers.mjs";

const RISK_BUDGET_LIMIT_FIELDS = [
  "maxSweepFindings",
  "maxDomainFindings",
  "maxSweepHighRiskFindings",
  "maxDomainHighRiskFindings",
];

function positiveIntegerOrNull(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function buildRiskBudgetPolicy(options = {}) {
  const hasLimit = RISK_BUDGET_LIMIT_FIELDS.some((field) => positiveIntegerOrNull(options[field]) !== null);
  if (!hasLimit) {
    return null;
  }

  return {
    mode: "root_cause_aware",
    duplicate_symptoms_count_as_remediation_obligations: false,
    high_risk_unique_root_causes_are_canonical: true,
    accepted_cluster_resume_skip: true,
    max_sweep_findings: positiveIntegerOrNull(options.maxSweepFindings),
    max_domain_findings: positiveIntegerOrNull(options.maxDomainFindings),
    max_sweep_high_risk_findings: positiveIntegerOrNull(options.maxSweepHighRiskFindings),
    max_domain_high_risk_findings: positiveIntegerOrNull(options.maxDomainHighRiskFindings),
  };
}

export function highRiskFinding(finding) {
  return finding?.severity === "critical" || finding?.severity === "high";
}

function evidenceRootForFile(chunk, fileRef) {
  for (const rootRef of chunk.evidence_roots ?? []) {
    const normalized = String(rootRef).replace(/\\/g, "/").replace(/\/$/, "");
    if (fileRef === normalized || fileRef.startsWith(`${normalized}/`)) {
      return normalized;
    }
  }
  return path.posix.dirname(fileRef) || ".";
}

function normalizeRootCauseField(rawFinding, name) {
  const rootCause = isPlainObject(rawFinding.root_cause) ? rawFinding.root_cause : {};
  const value = rootCause[name] ?? rawFinding[name];
  return nonEmptyString(value) ? String(value).trim().replace(/\\/g, "/") : null;
}

export function deriveFindingCluster(rawFinding, finding, chunk, plan) {
  const authorityRef = normalizeRootCauseField(rawFinding, "authority_ref")
    ?? chunk.authority_refs?.[0]
    ?? chunk.files?.[0]
    ?? finding.location.file;
  const allowedAuthorityRefs = new Set([...(chunk.authority_refs ?? []), ...(chunk.files ?? [])]);
  if (chunk.planning_basis === "spec_authority" && !allowedAuthorityRefs.has(authorityRef)) {
    return { ok: false, error: "root_cause.authority_ref must belong to chunk authority refs" };
  }

  const explicitEvidenceRoot = normalizeRootCauseField(rawFinding, "evidence_root");
  if (explicitEvidenceRoot && chunk.planning_basis === "spec_authority" && !(chunk.evidence_roots ?? []).includes(explicitEvidenceRoot)) {
    return { ok: false, error: "root_cause.evidence_root must belong to chunk evidence roots" };
  }

  const rootCauseKey = normalizeRootCauseField(rawFinding, "key") ?? normalizeRootCauseField(rawFinding, "id");
  const evidenceRoot = explicitEvidenceRoot ?? evidenceRootForFile(chunk, finding.location.file);
  const contractSeam = normalizeRootCauseField(rawFinding, "contract_seam") ?? finding.category;
  const repairTarget = normalizeRootCauseField(rawFinding, "repair_target") ?? finding.location.file;
  const fallbackUniqueKey = `${finding.title}:${finding.description}:${finding.location.file}`;
  const seed = {
    sweep_id: finding.sweep_id,
    authority_context: {
      inventory_hash: plan.inventory_hash,
      evidence_inventory_hash: plan.evidence_inventory_hash ?? null,
    },
    owner_domain: finding.owner_domain,
    category: finding.category,
    actionability: finding.actionability,
    authority_ref: authorityRef,
    evidence_root: evidenceRoot,
    contract_seam: contractSeam,
    repair_target: repairTarget,
    root_cause_key: rootCauseKey ?? fallbackUniqueKey,
  };

  return {
    ok: true,
    cluster: {
      cluster_id: `cluster-${sha256Object(seed).slice(0, 16)}`,
      cluster_key: sha256Object(seed),
      root_cause_key: rootCauseKey,
      authority_ref: authorityRef,
      evidence_root: evidenceRoot,
      contract_seam: contractSeam,
      repair_target: repairTarget,
      authority_context: seed.authority_context,
    },
  };
}

export function ensureClusterStore(store) {
  if (!Array.isArray(store.clusters)) {
    store.clusters = [];
  }
  if (!Number.isInteger(store.clustered_symptom_count)) {
    store.clustered_symptom_count = 0;
  }
  if (!Number.isInteger(store.accepted_cluster_skip_count)) {
    store.accepted_cluster_skip_count = 0;
  }
  store.remediation_obligation_count = store.findings.length;
  return store;
}

function severityRank(value) {
  return SEVERITY_RANK[value] ?? 99;
}

export function findingRequiresCanonicalInCluster(finding, cluster) {
  const currentRank = severityRank(cluster.max_severity);
  const incomingRank = severityRank(finding.severity);
  return incomingRank < currentRank;
}

export function clusterAcceptanceMatchesPlan(cluster, plan) {
  const acceptance = cluster.acceptance;
  if (!isPlainObject(acceptance)) {
    return false;
  }
  return acceptance.source_inventory_hash === plan.inventory_hash
    && (acceptance.source_evidence_inventory_hash ?? null) === (plan.evidence_inventory_hash ?? null);
}

export function buildDuplicateSymptom(finding, fingerprint, classification) {
  return {
    fingerprint,
    classification,
    chunk_id: finding.chunk_id,
    evidence_ref: finding.evidence_ref,
    severity: finding.severity,
    title: finding.title,
    location: finding.location,
    detected_at: finding.detected_at,
  };
}

export function updateClusterWithCanonical(cluster, finding) {
  if (!cluster.canonical_finding_ids.includes(finding.id)) {
    cluster.canonical_finding_ids.push(finding.id);
    cluster.canonical_finding_ids.sort();
  }
  if (severityRank(finding.severity) < severityRank(cluster.max_severity)) {
    cluster.max_severity = finding.severity;
    cluster.representative_finding_id = finding.id;
  }
  cluster.source_chunks = [...new Set([...cluster.source_chunks, finding.chunk_id])].sort();
  cluster.files = [...new Set([...cluster.files, finding.location.file])].sort();
  cluster.updated_at = finding.detected_at;
}

export function createCluster(clusterSeed, finding) {
  return {
    ...clusterSeed,
    representative_finding_id: finding.id,
    canonical_finding_ids: [finding.id],
    owner_domain: finding.owner_domain,
    category: finding.category,
    actionability: finding.actionability,
    max_severity: finding.severity,
    source_chunks: [finding.chunk_id],
    files: [finding.location.file],
    duplicate_symptom_count: 0,
    duplicate_symptoms: [],
    created_at: finding.detected_at,
    updated_at: finding.detected_at,
  };
}

export function buildRiskBudgetStatus(plan, store, verifiedAt) {
  const policy = plan.risk_budget_policy;
  if (!isPlainObject(policy)) {
    return null;
  }

  const findings = Array.isArray(store.findings) ? store.findings : [];
  const clusters = Array.isArray(store.clusters) ? store.clusters : [];
  const domains = new Map();
  for (const finding of findings) {
    const ownerDomain = finding.owner_domain ?? "root";
    const domain = domains.get(ownerDomain) ?? {
      owner_domain: ownerDomain,
      finding_count: 0,
      high_risk_finding_count: 0,
      cluster_count: 0,
      clustered_symptom_count: 0,
      state: "within_budget",
      reasons: [],
    };
    domain.finding_count += 1;
    if (highRiskFinding(finding)) {
      domain.high_risk_finding_count += 1;
    }
    domains.set(ownerDomain, domain);
  }
  for (const cluster of clusters) {
    const ownerDomain = cluster.owner_domain ?? "root";
    const domain = domains.get(ownerDomain) ?? {
      owner_domain: ownerDomain,
      finding_count: 0,
      high_risk_finding_count: 0,
      cluster_count: 0,
      clustered_symptom_count: 0,
      state: "within_budget",
      reasons: [],
    };
    domain.cluster_count += 1;
    domain.clustered_symptom_count += cluster.duplicate_symptom_count ?? 0;
    domains.set(ownerDomain, domain);
  }

  const sweep = {
    finding_count: findings.length,
    high_risk_finding_count: findings.filter(highRiskFinding).length,
    cluster_count: clusters.length,
    clustered_symptom_count: store.clustered_symptom_count ?? 0,
    state: "within_budget",
    reasons: [],
  };

  if (policy.max_sweep_findings && sweep.finding_count >= policy.max_sweep_findings) {
    sweep.state = "paused";
    sweep.reasons.push(`max_sweep_findings:${policy.max_sweep_findings}`);
  }
  if (policy.max_sweep_high_risk_findings && sweep.high_risk_finding_count >= policy.max_sweep_high_risk_findings) {
    sweep.state = "paused";
    sweep.reasons.push(`max_sweep_high_risk_findings:${policy.max_sweep_high_risk_findings}`);
  }

  for (const domain of domains.values()) {
    if (policy.max_domain_findings && domain.finding_count >= policy.max_domain_findings) {
      domain.state = "paused";
      domain.reasons.push(`max_domain_findings:${policy.max_domain_findings}`);
    }
    if (policy.max_domain_high_risk_findings && domain.high_risk_finding_count >= policy.max_domain_high_risk_findings) {
      domain.state = "paused";
      domain.reasons.push(`max_domain_high_risk_findings:${policy.max_domain_high_risk_findings}`);
    }
  }

  const domainStatuses = [...domains.values()].sort((left, right) => left.owner_domain.localeCompare(right.owner_domain));
  return {
    policy,
    state: sweep.state === "paused" || domainStatuses.some((domain) => domain.state === "paused") ? "paused" : "within_budget",
    sweep,
    domains: domainStatuses,
    updated_at: verifiedAt,
  };
}

export function budgetBlockForChunk(plan, chunk) {
  const status = plan.risk_budget_status;
  if (!isPlainObject(status)) {
    return null;
  }
  if (status.sweep?.state === "paused") {
    return `sweep risk budget paused (${(status.sweep.reasons ?? []).join(", ") || "budget reached"})`;
  }
  const domain = (status.domains ?? []).find((entry) => entry.owner_domain === chunk.owner_domain);
  if (domain?.state === "paused") {
    return `domain risk budget paused for ${chunk.owner_domain} (${(domain.reasons ?? []).join(", ") || "budget reached"})`;
  }
  return null;
}
