function diagnostic(id, message, details = {}) {
  return { id, message, ...details };
}

function normalizeRefs(refs) {
  return Array.isArray(refs) ? refs.map((ref) => typeof ref === "string" ? ref.replace(/\\/g, "/") : ref) : [];
}

export function buildAuditValidityForEvidence(chunk, evidence) {
  const warnings = [];
  const blockers = [];
  const outcomes = Array.isArray(evidence?.coverage?.authority_outcomes) ? evidence.coverage.authority_outcomes : [];
  const findings = Array.isArray(evidence?.findings) ? evidence.findings : [];
  const evidenceInventory = Array.isArray(chunk?.evidence_inventory) ? chunk.evidence_inventory : [];
  const evidenceInventorySet = new Set(evidenceInventory);
  const hasImplementationInventory = evidenceInventory.length > 0;
  const findingsEmpty = findings.length === 0;
  let auditedWithImplementationEvidenceRefs = 0;
  let auditedWithoutImplementationEvidenceRefs = 0;
  let missingNegativeReasoning = 0;
  let authorityOnlyAuditedOutcomes = 0;

  for (const outcome of outcomes.filter((entry) => entry?.status === "audited")) {
    const explicitImplementationRefs = normalizeRefs(outcome.implementation_evidence_refs);
    const implementationRefs = explicitImplementationRefs.filter((ref) => evidenceInventorySet.has(ref));
    const notApplicableReason = typeof outcome.implementation_not_applicable_reason === "string"
      && outcome.implementation_not_applicable_reason.trim().length > 0;
    const evidenceRefs = normalizeRefs(outcome.evidence_refs);
    const evidenceRefsIncludeImplementation = evidenceRefs.some((ref) => evidenceInventorySet.has(ref));
    const negativeReasoning = typeof outcome.negative_reasoning === "string"
      && outcome.negative_reasoning.trim().length > 0;

    if (implementationRefs.length > 0) {
      auditedWithImplementationEvidenceRefs += 1;
    } else {
      auditedWithoutImplementationEvidenceRefs += 1;
    }

    if (hasImplementationInventory && !evidenceRefsIncludeImplementation && implementationRefs.length === 0 && !notApplicableReason) {
      authorityOnlyAuditedOutcomes += 1;
    }
    if (findingsEmpty && !negativeReasoning) {
      missingNegativeReasoning += 1;
    }
  }

  if (findingsEmpty && hasImplementationInventory && authorityOnlyAuditedOutcomes > 0) {
    blockers.push(diagnostic(
      "audited_outcome_authority_only_evidence_refs",
      "Audited no-finding outcomes cite only authority refs while implementation evidence inventory exists.",
      { outcome_count: authorityOnlyAuditedOutcomes },
    ));
    blockers.push(diagnostic(
      "no_finding_evidence_invalid",
      "No-finding evidence cannot prove that declared implementation evidence was reviewed.",
    ));
  }

  if (findingsEmpty && hasImplementationInventory && missingNegativeReasoning > 0) {
    blockers.push(diagnostic(
      "no_finding_negative_reasoning_missing",
      "No-finding evidence lacks per-outcome negative implementation reasoning.",
      { outcome_count: missingNegativeReasoning },
    ));
  }

  if (findingsEmpty && !hasImplementationInventory) {
    warnings.push(diagnostic(
      "empty_inventory_no_finding_weak",
      "Empty-inventory no-finding evidence is weak unless the empty-evidence reason and negative reasoning support it.",
    ));
  }

  return {
    posture: blockers.length > 0 ? "invalid" : warnings.length > 0 ? "warning" : "trusted",
    no_finding_posture: findings.length > 0 ? "not_applicable" : blockers.length > 0 ? "invalid" : warnings.length > 0 ? "weak" : "explained",
    audited_outcomes_with_implementation_evidence_refs: auditedWithImplementationEvidenceRefs,
    audited_outcomes_without_implementation_evidence_refs: auditedWithoutImplementationEvidenceRefs,
    zero_finding_chunk_count: findingsEmpty ? 1 : 0,
    large_zero_finding_chunk_count: findingsEmpty && evidenceInventory.length >= 10 ? 1 : 0,
    negative_reasoning_present: !findingsEmpty || (outcomes.length > 0 && missingNegativeReasoning === 0),
    warnings,
    blockers,
  };
}

export function combineAuditValidity(entries) {
  const validEntries = entries.filter(Boolean);
  const warnings = validEntries.flatMap((entry) => entry.warnings ?? []);
  const blockers = validEntries.flatMap((entry) => entry.blockers ?? []);
  const zeroFindingChunkCount = validEntries.reduce((total, entry) => total + (entry.zero_finding_chunk_count ?? 0), 0);
  const largeZeroFindingChunkCount = validEntries.reduce((total, entry) => total + (entry.large_zero_finding_chunk_count ?? 0), 0);
  const withImplementation = validEntries.reduce((total, entry) => total + (entry.audited_outcomes_with_implementation_evidence_refs ?? 0), 0);
  const withoutImplementation = validEntries.reduce((total, entry) => total + (entry.audited_outcomes_without_implementation_evidence_refs ?? 0), 0);
  const anyInvalid = validEntries.some((entry) => entry.posture === "invalid");
  const anyWarning = validEntries.some((entry) => entry.posture === "warning");

  return {
    posture: anyInvalid ? "invalid" : anyWarning ? "warning" : "trusted",
    no_finding_posture: anyInvalid ? "invalid" : anyWarning ? "weak" : zeroFindingChunkCount > 0 ? "explained" : "not_applicable",
    audited_outcomes_with_implementation_evidence_refs: withImplementation,
    audited_outcomes_without_implementation_evidence_refs: withoutImplementation,
    zero_finding_chunk_count: zeroFindingChunkCount,
    large_zero_finding_chunk_count: largeZeroFindingChunkCount,
    negative_reasoning_present: validEntries.every((entry) => entry.negative_reasoning_present !== false),
    warnings,
    blockers,
  };
}
