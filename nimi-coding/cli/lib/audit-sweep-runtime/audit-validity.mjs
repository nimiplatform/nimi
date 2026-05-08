import { criteriaEnableP0P1Recall } from "./p0p1-profile.mjs";

function diagnostic(id, message, details = {}) {
  return { id, message, ...details };
}

function normalizeRefs(refs) {
  return Array.isArray(refs) ? refs.map((ref) => typeof ref === "string" ? ref.replace(/\\/g, "/") : ref) : [];
}

function normalizeFileRef(value) {
  return typeof value === "string" ? value.replace(/\\/g, "/") : null;
}

const REQUIRED_P0P1_RULE_CHECK_IDS = [
  "fail_open_or_pseudo_success",
  "partial_coverage_misrepresented_as_complete",
  "authority_boundary_or_private_import_bypass",
  "permission_or_capability_bypass",
  "ungated_destructive_action",
  "provider_or_model_hardcoding",
  "app_local_shadow_truth",
];
const REQUIRED_P0P1_RULE_CHECK_ID_SET = new Set(REQUIRED_P0P1_RULE_CHECK_IDS);

function validateP0P1RuleChecks(evidence, implementationRefSet) {
  const ruleChecks = evidence?.coverage?.p0p1_rule_checks;
  if (!Array.isArray(ruleChecks) || ruleChecks.length === 0) {
    return {
      ok: false,
      missing: REQUIRED_P0P1_RULE_CHECK_IDS,
      invalid: [],
      checkedIds: [],
    };
  }

  const checkedIds = [];
  const invalid = [];
  const seenIds = new Set();
  for (const [index, check] of ruleChecks.entries()) {
    const id = typeof check?.id === "string" ? check.id : "";
    if (id) {
      checkedIds.push(id);
      if (!REQUIRED_P0P1_RULE_CHECK_ID_SET.has(id)) {
        invalid.push({ index, id, reason: "id must exactly match an admitted P0/P1 rule check id" });
      } else if (seenIds.has(id)) {
        invalid.push({ index, id, reason: "duplicate P0/P1 rule check id" });
      }
      seenIds.add(id);
    }
    const status = check?.status;
    if (!["checked", "not_applicable"].includes(status)) {
      invalid.push({ index, id, reason: "status must be checked or not_applicable" });
      continue;
    }
    const reasoning = typeof check?.negative_reasoning === "string" && check.negative_reasoning.trim().length > 0;
    if (!reasoning) {
      invalid.push({ index, id, reason: "negative_reasoning is required" });
    }
    const refs = normalizeRefs(check?.implementation_refs);
    if (status === "checked" && refs.length === 0) {
      invalid.push({ index, id, reason: "checked rule must cite implementation_refs" });
    }
    const outOfScopeRefs = refs.filter((ref) => !implementationRefSet.has(ref));
    if (outOfScopeRefs.length > 0) {
      invalid.push({ index, id, reason: "implementation_refs must belong to chunk implementation surface", invalid_refs: outOfScopeRefs });
    }
  }

  const checkedIdSet = new Set(checkedIds);
  const missing = REQUIRED_P0P1_RULE_CHECK_IDS.filter((id) => !checkedIdSet.has(id));
  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    checkedIds,
  };
}

function hasSemanticAuditorProvenance(evidence) {
  const provenance = evidence?.auditor?.provenance;
  if (!provenance || typeof provenance !== "object") {
    return false;
  }
  const kind = typeof provenance.kind === "string" ? provenance.kind : "";
  const packetRef = typeof provenance.packet_ref === "string" && provenance.packet_ref.trim().length > 0;
  const semanticTrace = [
    provenance.session_ref,
    provenance.transcript_ref,
    provenance.review_ref,
  ].some((ref) => typeof ref === "string" && ref.trim().length > 0);
  return kind === "semantic_audit" && packetRef && semanticTrace;
}

function looksSyntheticNoFindingEvidence(evidence) {
  const auditorMode = typeof evidence?.auditor?.mode === "string" ? evidence.auditor.mode : "";
  const generatedByScript = evidence?.auditor?.generated_by_script === true;
  const negativeReasoning = typeof evidence?.coverage?.p0p1_negative_reasoning === "string"
    ? evidence.coverage.p0p1_negative_reasoning
    : "";
  const templatedFragments = [
    "reading the complete chunk corpus through the local audit cache",
    "Lower-severity cleanup was intentionally summarized so the sweep preserved P0/P1 recall focus",
    "No critical/high fail-open, authority-boundary bypass, unadmitted truth promotion, partial coverage success",
  ];
  return generatedByScript
    || auditorMode.includes("script")
    || auditorMode.includes("local_full_sweep")
    || templatedFragments.some((fragment) => negativeReasoning.includes(fragment));
}

export function p0p1ImplementationRefsForChunk(chunk) {
  if (chunk?.planning_basis === "spec_authority") {
    return normalizeRefs(chunk?.evidence_inventory);
  }
  return normalizeRefs(chunk?.files);
}

function expectedDefectMatchesFinding(expected, finding) {
  if (typeof expected?.root_cause_key === "string") {
    const findingRootCauseKey = finding?.root_cause?.key ?? finding?.root_cause_key ?? null;
    if (findingRootCauseKey !== expected.root_cause_key) {
      return false;
    }
  }
  if (typeof expected?.location_file === "string") {
    if (normalizeFileRef(finding?.location?.file) !== normalizeFileRef(expected.location_file)) {
      return false;
    }
  }
  if (typeof expected?.severity === "string" && finding?.severity !== expected.severity) {
    return false;
  }
  if (typeof expected?.category === "string" && finding?.category !== expected.category) {
    return false;
  }
  return true;
}

function findMissedCalibrationDefects(chunk, findings) {
  const expectedDefects = Array.isArray(chunk?.calibration_expected_defects)
    ? chunk.calibration_expected_defects.filter((entry) => typeof entry?.id === "string" && entry.id.trim().length > 0)
    : [];
  const missed = expectedDefects.filter((expected) => !findings.some((finding) => expectedDefectMatchesFinding(expected, finding)));
  return { expectedDefects, missed };
}

export function buildAuditValidityForEvidence(chunk, evidence) {
  const warnings = [];
  const blockers = [];
  const outcomes = Array.isArray(evidence?.coverage?.authority_outcomes) ? evidence.coverage.authority_outcomes : [];
  const findings = Array.isArray(evidence?.findings) ? evidence.findings : [];
  const evidenceInventory = Array.isArray(chunk?.evidence_inventory) ? chunk.evidence_inventory : [];
  const p0p1ImplementationRefs = p0p1ImplementationRefsForChunk(chunk);
  const evidenceInventorySet = new Set(evidenceInventory);
  const p0p1ImplementationRefSet = new Set(p0p1ImplementationRefs);
  const hasImplementationInventory = evidenceInventory.length > 0;
  const findingsEmpty = findings.length === 0;
  const p0p1RecallRequired = criteriaEnableP0P1Recall(chunk?.criteria);
  const hasP0P1Finding = findings.some((finding) => ["critical", "high"].includes(finding?.severity));
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

  if (p0p1RecallRequired && !hasP0P1Finding) {
    const p0p1NegativeReasoning = typeof evidence?.coverage?.p0p1_negative_reasoning === "string"
      && evidence.coverage.p0p1_negative_reasoning.trim().length > 0;
    const p0p1EvidenceRefs = normalizeRefs(evidence?.coverage?.p0p1_evidence_refs);
    const p0p1ImplementationNotApplicable = !hasImplementationInventory
      && typeof evidence?.coverage?.p0p1_implementation_not_applicable_reason === "string"
      && evidence.coverage.p0p1_implementation_not_applicable_reason.trim().length > 0;
    const invalidP0P1EvidenceRefs = p0p1EvidenceRefs.filter((ref) => !p0p1ImplementationRefSet.has(ref));
    const hasP0P1ImplementationRef = p0p1EvidenceRefs.length > 0 && invalidP0P1EvidenceRefs.length === 0;
    const syntheticNoFindingEvidence = looksSyntheticNoFindingEvidence(evidence);
    if (invalidP0P1EvidenceRefs.length > 0) {
      blockers.push(diagnostic(
        "p0p1_evidence_refs_out_of_scope",
        "P0/P1 evidence refs must all belong to the chunk implementation surface.",
        { invalid_refs: invalidP0P1EvidenceRefs },
      ));
    }
    if (!p0p1NegativeReasoning || (!hasP0P1ImplementationRef && !p0p1ImplementationNotApplicable)) {
      blockers.push(diagnostic(
        "p0p1_negative_reasoning_missing",
        "P0/P1 recall evidence without critical/high findings must include P0/P1 negative reasoning and implementation evidence refs, or an explicit not-applicable reason when no implementation inventory exists.",
        {
          p0p1_negative_reasoning_present: p0p1NegativeReasoning,
          p0p1_implementation_evidence_refs_present: hasP0P1ImplementationRef,
          p0p1_implementation_not_applicable_reason_present: p0p1ImplementationNotApplicable,
        },
      ));
    }
    if (syntheticNoFindingEvidence) {
      blockers.push(diagnostic(
        "synthetic_no_finding_evidence",
        "P0/P1 no-finding evidence appears to be generated by a script or bulk template rather than a semantic audit.",
      ));
    }
    if (hasImplementationInventory) {
      if (!hasSemanticAuditorProvenance(evidence)) {
        blockers.push(diagnostic(
          "auditor_provenance_missing",
          "P0/P1 no-finding evidence with implementation inventory must cite semantic auditor provenance.",
          {
            required_kind: "semantic_audit",
            required_fields: ["auditor.provenance.packet_ref", "auditor.provenance.session_ref|transcript_ref|review_ref"],
          },
        ));
      }
      const ruleCheckValidity = validateP0P1RuleChecks(evidence, p0p1ImplementationRefSet);
      if (!ruleCheckValidity.ok) {
        blockers.push(diagnostic(
          "p0p1_rule_checks_missing_or_invalid",
          "P0/P1 no-finding evidence with implementation inventory must record rule-specific checks over the chunk implementation surface.",
          {
            missing_rule_check_ids: ruleCheckValidity.missing,
            invalid_rule_checks: ruleCheckValidity.invalid,
            present_rule_check_ids: ruleCheckValidity.checkedIds,
          },
        ));
      }
    }
  }

  const calibration = findMissedCalibrationDefects(chunk, findings);
  if (calibration.missed.length > 0) {
    blockers.push(diagnostic(
      "calibration_known_defect_missed",
      "Calibration evidence missed one or more expected known defects.",
      {
        expected_defect_count: calibration.expectedDefects.length,
        missed_defect_ids: calibration.missed.map((defect) => defect.id),
      },
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
    p0p1_recall_required: p0p1RecallRequired,
    p0p1_recall_posture: !p0p1RecallRequired ? "not_applicable" : hasP0P1Finding ? "p0p1_finding_present" : blockers.length > 0 ? "invalid" : "explained",
    p0p1_rule_check_count: Array.isArray(evidence?.coverage?.p0p1_rule_checks) ? evidence.coverage.p0p1_rule_checks.length : 0,
    auditor_provenance_present: !findingsEmpty || hasSemanticAuditorProvenance(evidence),
    calibration_expected_defect_count: calibration.expectedDefects.length,
    calibration_missed_defect_count: calibration.missed.length,
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
  const calibrationExpectedDefectCount = validEntries.reduce((total, entry) => total + (entry.calibration_expected_defect_count ?? 0), 0);
  const calibrationMissedDefectCount = validEntries.reduce((total, entry) => total + (entry.calibration_missed_defect_count ?? 0), 0);
  const p0p1RecallRequiredCount = validEntries.reduce((total, entry) => total + (entry.p0p1_recall_required ? 1 : 0), 0);
  const p0p1InvalidCount = validEntries.reduce((total, entry) => total + (entry.p0p1_recall_posture === "invalid" ? 1 : 0), 0);
  const p0p1RuleCheckCount = validEntries.reduce((total, entry) => total + (entry.p0p1_rule_check_count ?? 0), 0);
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
    p0p1_recall_required_count: p0p1RecallRequiredCount,
    p0p1_recall_invalid_count: p0p1InvalidCount,
    p0p1_rule_check_count: p0p1RuleCheckCount,
    auditor_provenance_present: validEntries.every((entry) => entry.auditor_provenance_present !== false),
    calibration_expected_defect_count: calibrationExpectedDefectCount,
    calibration_missed_defect_count: calibrationMissedDefectCount,
    warnings,
    blockers,
  };
}
