import {
  HIGH_RISK_ADMISSION_CONTRACT_REF,
  SPEC_GENERATION_AUDIT_REF,
} from "../../constants.mjs";
import {
  arraysEqual,
  isIsoUtcTimestamp,
  isPlainObject,
} from "../value-helpers.mjs";

const SPEC_RECONSTRUCTION_COVERAGE_SUMMARY_REQUIRED_FIELDS = [
  "complete_files",
  "partial_files",
  "placeholder_files",
];

function validateRequiredFields(subject, requiredFields, label) {
  const missingFields = requiredFields.filter((field) => !(field in subject));
  if (missingFields.length > 0) {
    return {
      ok: false,
      reason: `${label} is missing required fields: ${missingFields.join(", ")}`,
    };
  }

  return null;
}

function validateSummaryEnvelope(summary, contract, verifiedAt, label) {
  if (!isPlainObject(summary)) {
    return {
      ok: false,
      reason: `${label} must be an object`,
    };
  }

  const missingFields = validateRequiredFields(summary, contract.summaryRequiredFields, label);
  if (missingFields) {
    return missingFields;
  }

  if (typeof summary.summary !== "string" || summary.summary.trim().length === 0) {
    return {
      ok: false,
      reason: `${label}.summary must be a non-empty string`,
    };
  }

  if (!contract.summaryStatusEnum.includes(summary.status)) {
    return {
      ok: false,
      reason: `${label}.status must be one of: ${contract.summaryStatusEnum.join(", ")}`,
    };
  }

  if (!isIsoUtcTimestamp(summary.verified_at)) {
    return {
      ok: false,
      reason: `${label}.verified_at must be an ISO-8601 UTC timestamp`,
    };
  }

  if (verifiedAt && summary.verified_at !== verifiedAt) {
    return {
      ok: false,
      reason: `${label}.verified_at must match the top-level verifiedAt`,
    };
  }

  return null;
}

export function validateSpecReconstructionSummary(summary, contract, verifiedAt) {
  const envelopeError = validateSummaryEnvelope(
    summary,
    contract,
    verifiedAt,
    "spec_reconstruction summary",
  );
  if (envelopeError) {
    return envelopeError;
  }

  if (
    !Array.isArray(summary.generated_paths)
    || summary.generated_paths.some((entry) => typeof entry !== "string")
  ) {
    return {
      ok: false,
      reason: "spec_reconstruction summary.generated_paths must be an array of strings",
    };
  }

  if (typeof summary.audit_ref !== "string" || summary.audit_ref !== SPEC_GENERATION_AUDIT_REF) {
    return {
      ok: false,
      reason: `spec_reconstruction summary.audit_ref must be \`${SPEC_GENERATION_AUDIT_REF}\``,
    };
  }

  if (!isPlainObject(summary.coverage_summary)) {
    return {
      ok: false,
      reason: "spec_reconstruction summary.coverage_summary must be an object",
    };
  }

  const missingCoverageFields = validateRequiredFields(
    summary.coverage_summary,
    SPEC_RECONSTRUCTION_COVERAGE_SUMMARY_REQUIRED_FIELDS,
    "spec_reconstruction summary.coverage_summary",
  );
  if (missingCoverageFields) {
    return missingCoverageFields;
  }

  for (const field of SPEC_RECONSTRUCTION_COVERAGE_SUMMARY_REQUIRED_FIELDS) {
    if (!Number.isInteger(summary.coverage_summary[field]) || summary.coverage_summary[field] < 0) {
      return {
        ok: false,
        reason: `spec_reconstruction summary.coverage_summary.${field} must be a non-negative integer`,
      };
    }
  }

  if (!Number.isInteger(summary.unresolved_file_count) || summary.unresolved_file_count < 0) {
    return {
      ok: false,
      reason: "spec_reconstruction summary.unresolved_file_count must be a non-negative integer",
    };
  }

  if (!Number.isInteger(summary.inferred_file_count) || summary.inferred_file_count < 0) {
    return {
      ok: false,
      reason: "spec_reconstruction summary.inferred_file_count must be a non-negative integer",
    };
  }

  return { ok: true };
}

export function validateDocSpecAuditSummary(summary, contract, verifiedAt) {
  const envelopeError = validateSummaryEnvelope(summary, contract, verifiedAt, "doc_spec_audit summary");
  if (envelopeError) {
    return envelopeError;
  }

  if (
    !Array.isArray(summary.compared_paths)
    || summary.compared_paths.length === 0
    || summary.compared_paths.some((entry) => typeof entry !== "string")
  ) {
    return {
      ok: false,
      reason: "doc_spec_audit summary.compared_paths must be a non-empty array of strings",
    };
  }

  if (!Number.isInteger(summary.finding_count) || summary.finding_count < 0) {
    return {
      ok: false,
      reason: "doc_spec_audit summary.finding_count must be a non-negative integer",
    };
  }

  return { ok: true };
}

export function validateAuditSweepSummary(summary, contract, verifiedAt) {
  const envelopeError = validateSummaryEnvelope(summary, contract, verifiedAt, "audit_sweep summary");
  if (envelopeError) {
    return envelopeError;
  }

  const unexpectedFields = Object.keys(summary).filter(
    (field) => !contract.summaryRequiredFields.includes(field),
  );
  if (unexpectedFields.length > 0) {
    return {
      ok: false,
      reason: `audit_sweep summary contains unexpected fields: ${unexpectedFields.join(", ")}`,
    };
  }

  for (const field of [
    "plan_ref",
    "ledger_ref",
    "report_ref",
    "remediation_map_ref",
    "audit_closeout_ref",
  ]) {
    if (typeof summary[field] !== "string" || summary[field].trim().length === 0) {
      return {
        ok: false,
        reason: `audit_sweep summary.${field} must be a non-empty string`,
      };
    }
  }

  for (const field of ["chunk_refs", "evidence_refs"]) {
    if (
      !Array.isArray(summary[field])
      || summary[field].length === 0
      || summary[field].some((entry) => typeof entry !== "string" || entry.trim().length === 0)
    ) {
      return {
        ok: false,
        reason: `audit_sweep summary.${field} must be a non-empty array of non-empty strings`,
      };
    }
  }

  for (const field of ["finding_count", "unresolved_finding_count"]) {
    if (!Number.isInteger(summary[field]) || summary[field] < 0) {
      return {
        ok: false,
        reason: `audit_sweep summary.${field} must be a non-negative integer`,
      };
    }
  }

  return { ok: true };
}

export function validateHighRiskExecutionSummary(summary, contract, verifiedAt) {
  const envelopeError = validateSummaryEnvelope(
    summary,
    contract,
    verifiedAt,
    "high_risk_execution summary",
  );
  if (envelopeError) {
    return envelopeError;
  }

  const unexpectedFields = Object.keys(summary).filter(
    (field) => !contract.summaryRequiredFields.includes(field),
  );
  if (unexpectedFields.length > 0) {
    return {
      ok: false,
      reason: `high_risk_execution summary contains unexpected fields: ${unexpectedFields.join(", ")}`,
    };
  }

  for (const field of [
    "packet_ref",
    "orchestration_state_ref",
    "prompt_ref",
    "worker_output_ref",
  ]) {
    if (typeof summary[field] !== "string" || summary[field].trim().length === 0) {
      return {
        ok: false,
        reason: `high_risk_execution summary.${field} must be a non-empty string`,
      };
    }
  }

  if (
    !Array.isArray(summary.evidence_refs)
    || summary.evidence_refs.length === 0
    || summary.evidence_refs.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
  ) {
    return {
      ok: false,
      reason: "high_risk_execution summary.evidence_refs must be a non-empty array of non-empty strings",
    };
  }

  return { ok: true };
}

export function validateHighRiskAdmissionRecord(record, contract) {
  if (!isPlainObject(record)) {
    return {
      ok: false,
      reason: "high-risk admission record must be an object",
    };
  }

  const keys = Object.keys(record).sort();
  const expectedKeys = contract.admissionRequiredFields.slice().sort();
  if (!arraysEqual(keys, expectedKeys)) {
    return {
      ok: false,
      reason: `high-risk admission record must contain exactly these fields: ${contract.admissionRequiredFields.join(", ")}`,
    };
  }

  for (const field of [
    "topic_id",
    "packet_id",
    "manager_review_owner",
    "summary",
    "source_decision_contract",
  ]) {
    if (typeof record[field] !== "string" || record[field].trim().length === 0) {
      return {
        ok: false,
        reason: `high-risk admission record ${field} must be a non-empty string`,
      };
    }
  }

  if (!contract.dispositionEnum.includes(record.disposition)) {
    return {
      ok: false,
      reason: `high-risk admission record disposition must be one of: ${contract.dispositionEnum.join(", ")}`,
    };
  }

  if (!isIsoUtcTimestamp(record.admitted_at)) {
    return {
      ok: false,
      reason: "high-risk admission record admitted_at must be an ISO-8601 UTC timestamp",
    };
  }

  return { ok: true };
}

export function validateHighRiskAdmissionsSpec(spec, contract) {
  if (!isPlainObject(spec)) {
    return {
      ok: false,
      reason: "high-risk admissions spec must be an object",
    };
  }

  const missingKeys = contract.topLevelRequiredKeys.filter((key) => !(key in spec));
  if (missingKeys.length > 0) {
    return {
      ok: false,
      reason: `high-risk admissions spec is missing top-level keys: ${missingKeys.join(", ")}`,
    };
  }

  if (
    !Array.isArray(spec.admissions)
    || !Array.isArray(spec.admission_rules)
    || !Array.isArray(spec.semantic_constraints)
  ) {
    return {
      ok: false,
      reason: "high-risk admissions spec top-level sections must be arrays",
    };
  }

  if (
    spec.admission_rules.some((entry) => typeof entry !== "string")
    || spec.semantic_constraints.some((entry) => typeof entry !== "string")
  ) {
    return {
      ok: false,
      reason: "high-risk admissions spec rules and semantic constraints must be string arrays",
    };
  }

  const seenTopicIds = new Set();
  for (const record of spec.admissions) {
    const validation = validateHighRiskAdmissionRecord(record, contract);
    if (!validation.ok) {
      return validation;
    }

    if (seenTopicIds.has(record.topic_id)) {
      return {
        ok: false,
        reason: `high-risk admissions spec contains duplicate topic_id ${record.topic_id}`,
      };
    }
    seenTopicIds.add(record.topic_id);
  }

  return { ok: true };
}

export function makeInvalidHighRiskAdmissionContractReason() {
  return `${HIGH_RISK_ADMISSION_CONTRACT_REF} is missing or malformed`;
}
