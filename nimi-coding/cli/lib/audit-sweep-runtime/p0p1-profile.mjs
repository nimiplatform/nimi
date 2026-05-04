const P0P1_CRITERIA = new Set([
  "p0p1",
  "p0-p1",
  "p0",
  "p1",
  "critical-high",
  "critical_high",
]);

const HIGH_RISK_OWNER_DOMAINS = new Set([
  "runtime",
  "sdk",
  "platform",
  "security",
  "provider",
  "desktop",
  "web",
  "nimi-coding",
  "nimi-coding/audit-sweep",
]);

export function criteriaEnableP0P1Recall(criteria) {
  return Array.isArray(criteria)
    && criteria.some((entry) => P0P1_CRITERIA.has(String(entry).trim().toLowerCase()));
}

export function buildP0P1RecallProfile({ chunk, plan }) {
  const ownerDomain = chunk.owner_domain ?? "unknown";
  const highRiskOwnerDomain = HIGH_RISK_OWNER_DOMAINS.has(ownerDomain);
  const calibrationExpectedDefects = Array.isArray(chunk.calibration_expected_defects)
    ? chunk.calibration_expected_defects.length
    : 0;

  return {
    profile_id: "p0_p1_recall",
    objective: "Prioritize critical/high recall. Missing a P0/P1 issue is worse than a low-confidence false positive.",
    severity_mapping: {
      p0: "critical",
      p1: "high",
    },
    priority_defect_classes: [
      {
        id: "fail_open_or_pseudo_success",
        question: "Can an error, missing dependency, skipped work, or invalid evidence still produce a success posture?",
      },
      {
        id: "authority_boundary_bypass",
        question: "Can runtime/sdk/app/spec boundaries be bypassed or treated as advisory?",
      },
      {
        id: "unadmitted_truth_or_evidence_source",
        question: "Can an unadmitted file, host-local artifact, or generated projection become semantic truth?",
      },
      {
        id: "partial_coverage_misrepresented_as_complete",
        question: "Can partial, skipped, sampled, or authority-only coverage be reported as complete?",
      },
      {
        id: "state_divergence_or_lost_update",
        question: "Can concurrent or repeated execution lose state, diverge ledgers, or overwrite reviewed evidence?",
      },
      {
        id: "security_or_permission_bypass",
        question: "Can user, provider, filesystem, network, or app permissions be bypassed?",
      },
      {
        id: "destructive_action_without_gate",
        question: "Can destructive mutation, deletion, overwrite, or publication happen without the required gate?",
      },
      {
        id: "package_boundary_violation",
        question: "Can a package import or call across a forbidden private/runtime boundary?",
      },
    ],
    triage_flow: [
      "classify whether the chunk contains P0/P1-relevant authority or implementation evidence",
      "scan authority_refs and evidence_inventory for every priority_defect_class",
      "record candidate P0/P1 signals before spending time on low-severity cleanup",
      "deep-audit only the files and flows tied to a candidate P0/P1 signal or trigger",
      "cluster duplicate symptoms under one canonical root-cause finding",
    ],
    deep_audit_triggers: [
      "p0_p1_signal_found_in_triage",
      highRiskOwnerDomain ? "high_risk_owner_domain" : null,
      calibrationExpectedDefects > 0 ? "calibration_expected_defects_present" : null,
    ].filter(Boolean),
    token_budget_policy: {
      triage_first: true,
      deep_audit_only_on_trigger: true,
      cluster_duplicate_symptoms: true,
      prefer_canonical_root_cause_findings: true,
      pause_when_risk_budget_blocks_more_discovery: true,
      max_sweep_high_risk_findings_before_pause: plan.risk_budget_policy?.max_sweep_high_risk_findings ?? null,
      max_domain_high_risk_findings_before_pause: plan.risk_budget_policy?.max_domain_high_risk_findings ?? null,
    },
    no_p0p1_finding_requirement: {
      required: true,
      reasoning_field: "coverage.p0p1_negative_reasoning",
      evidence_refs_field: "coverage.p0p1_evidence_refs",
      summary: "If no critical/high finding is emitted, explain why each applicable priority defect class did not produce a P0/P1 issue and cite implementation evidence.",
      evidence_refs_must_include_implementation: true,
    },
  };
}
