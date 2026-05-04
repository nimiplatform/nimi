export const COVERAGE_SCOPE_LABEL = "declared_authority_and_evidence_inventory";
export const FILE_INVENTORY_SCOPE_LABEL = "file_inventory";

function makeDiagnostic(id, message, details = {}) {
  return { id, message, ...details };
}

function ownerDomainCoverage(chunks) {
  const byOwner = {};
  for (const chunk of chunks) {
    const ownerDomain = chunk.owner_domain ?? "unknown";
    const evidenceCount = Array.isArray(chunk.evidence_inventory) ? chunk.evidence_inventory.length : 0;
    const entry = byOwner[ownerDomain] ?? {
      authority_chunks: 0,
      chunks_with_evidence_inventory: 0,
      chunks_without_evidence_inventory: 0,
      evidence_file_refs: new Set(),
      posture: "strong",
    };
    entry.authority_chunks += 1;
    for (const fileRef of Array.isArray(chunk.evidence_inventory) ? chunk.evidence_inventory : []) {
      entry.evidence_file_refs.add(fileRef);
    }
    if (evidenceCount > 0) {
      entry.chunks_with_evidence_inventory += 1;
    } else {
      entry.chunks_without_evidence_inventory += 1;
    }
    byOwner[ownerDomain] = entry;
  }
  for (const entry of Object.values(byOwner)) {
    entry.evidence_files = entry.evidence_file_refs.size;
    delete entry.evidence_file_refs;
    entry.posture = entry.authority_chunks > 0 && entry.evidence_files === 0 ? "warning" : "strong";
  }
  return byOwner;
}

export function buildCoverageQuality(plan, chunks, coverage = plan.coverage ?? {}) {
  if (plan?.planning_basis?.mode !== "spec_authority") {
    return {
      scope_label: FILE_INVENTORY_SCOPE_LABEL,
      posture: "strong",
      authority_chunk_count: chunks.length,
      chunks_with_evidence_inventory: 0,
      chunks_without_evidence_inventory: 0,
      empty_evidence_chunk_ratio: 0,
      evidence_file_count: 0,
      max_evidence_files_per_chunk: 0,
      max_evidence_chunk_id: null,
      evidence_concentration_ratio: 0,
      owner_domain_coverage: ownerDomainCoverage(chunks),
      warnings: [],
      blockers: [],
    };
  }

  const authorityChunkCount = chunks.length;
  const evidenceCounts = chunks.map((chunk) => Array.isArray(chunk.evidence_inventory) ? chunk.evidence_inventory.length : 0);
  const chunksWithEvidenceInventory = evidenceCounts.filter((count) => count > 0).length;
  const chunksWithoutEvidenceInventory = authorityChunkCount - chunksWithEvidenceInventory;
  const evidenceFileCount = coverage.evidence_coverage?.total_files
    ?? coverage.evidence_files
    ?? plan.evidence_inventory?.length
    ?? 0;
  const maxEvidenceFilesPerChunk = evidenceCounts.length > 0 ? Math.max(...evidenceCounts) : 0;
  const maxEvidenceChunkIndex = evidenceCounts.findIndex((count) => count === maxEvidenceFilesPerChunk);
  const maxEvidenceChunkId = maxEvidenceChunkIndex >= 0 ? chunks[maxEvidenceChunkIndex]?.chunk_id ?? null : null;
  const evidenceConcentrationRatio = evidenceFileCount > 0 ? maxEvidenceFilesPerChunk / evidenceFileCount : 0;
  const emptyEvidenceChunkRatio = authorityChunkCount > 0 ? chunksWithoutEvidenceInventory / authorityChunkCount : 0;
  const ownerCoverage = ownerDomainCoverage(chunks);
  const warnings = [];
  const blockers = [];

  if (chunksWithoutEvidenceInventory > 0) {
    warnings.push(makeDiagnostic("sparse_evidence_inventory", "Some authority chunks have no mapped evidence inventory.", {
      chunks_without_evidence_inventory: chunksWithoutEvidenceInventory,
      authority_chunk_count: authorityChunkCount,
    }));
  }

  for (const [owner_domain, entry] of Object.entries(ownerCoverage)) {
    if (entry.authority_chunks > 0 && entry.evidence_files === 0) {
      warnings.push(makeDiagnostic("owner_domain_authority_only", "Owner domain has authority chunks but no mapped evidence files.", {
        owner_domain,
        authority_chunks: entry.authority_chunks,
      }));
    }
  }

  if (evidenceFileCount > 0 && evidenceConcentrationRatio >= 0.5 && chunksWithEvidenceInventory > 1) {
    warnings.push(makeDiagnostic("evidence_fan_in_concentrated", "One chunk owns a concentrated share of the mapped evidence inventory.", {
      chunk_id: maxEvidenceChunkId,
      evidence_concentration_ratio: evidenceConcentrationRatio,
    }));
  }

  const unresolvedChunks = chunks
    .filter((chunk) => Array.isArray(chunk.declared_evidence_unresolved) && chunk.declared_evidence_unresolved.length > 0)
    .map((chunk) => chunk.chunk_id);
  if (unresolvedChunks.length > 0) {
    blockers.push(makeDiagnostic("declared_evidence_target_unresolved", "Declared evidence targets remain unresolved.", {
      chunk_ids: unresolvedChunks,
    }));
  }

  const unmappedEvidenceFiles = coverage.evidence_coverage?.unmapped_files
    ?? coverage.unmapped_evidence_files
    ?? plan.unmapped_evidence_files?.length
    ?? 0;
  if (unmappedEvidenceFiles > 0) {
    blockers.push(makeDiagnostic("unmapped_evidence_files", "Evidence inventory contains files that no authority chunk can accept.", {
      unmapped_evidence_files: unmappedEvidenceFiles,
    }));
  }

  return {
    scope_label: COVERAGE_SCOPE_LABEL,
    posture: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "strong",
    authority_chunk_count: authorityChunkCount,
    chunks_with_evidence_inventory: chunksWithEvidenceInventory,
    chunks_without_evidence_inventory: chunksWithoutEvidenceInventory,
    empty_evidence_chunk_ratio: emptyEvidenceChunkRatio,
    evidence_file_count: evidenceFileCount,
    max_evidence_files_per_chunk: maxEvidenceFilesPerChunk,
    max_evidence_chunk_id: maxEvidenceChunkId,
    evidence_concentration_ratio: evidenceConcentrationRatio,
    owner_domain_coverage: ownerCoverage,
    warnings,
    blockers,
  };
}

export function withFullScopeWarning(coverageQuality) {
  if (!coverageQuality) {
    return coverageQuality;
  }
  if (coverageQuality.scope_label !== COVERAGE_SCOPE_LABEL) {
    return coverageQuality;
  }
  if (coverageQuality.warnings?.some((warning) => warning.id === "full_status_scope_is_declared_inventory")) {
    return coverageQuality;
  }
  return {
    ...coverageQuality,
    posture: coverageQuality.posture === "strong" ? "warning" : coverageQuality.posture,
    warnings: [
      ...(coverageQuality.warnings ?? []),
      makeDiagnostic("full_status_scope_is_declared_inventory", "Full spec-authority coverage is scoped to declared authority and admitted evidence inventory."),
    ],
  };
}

export function deriveCoverageStatus(ledgerStatus) {
  if (ledgerStatus === "candidate_ready") {
    return "full";
  }
  if (ledgerStatus === "blocked") {
    return "blocked";
  }
  return "partial";
}

export function deriveCoverageCloseoutPosture({ coverageStatus, openFindingCount }) {
  if (coverageStatus === "blocked") {
    return "blocked";
  }
  if (coverageStatus === "partial") {
    return openFindingCount > 0 ? "partial_coverage_findings_open" : "partial_coverage_all_findings_postured";
  }
  return openFindingCount > 0 ? "audit_complete_findings_open" : "audit_complete_all_findings_postured";
}
