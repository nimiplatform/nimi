import path from "node:path";

import {
  ACCEPTANCE_SCHEMA_REF,
  DOC_SPEC_AUDIT_DEFAULT_COMPARED_PATHS,
  DOC_SPEC_AUDIT_RESULT_CONTRACT_REF,
  DOC_SPEC_AUDIT_SUMMARY_REQUIRED_FIELDS,
  DOC_SPEC_AUDIT_SUMMARY_STATUS,
  EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF,
  EXTERNAL_HOST_COMPATIBILITY_FORBIDDEN_BEHAVIOR,
  EXTERNAL_HOST_COMPATIBILITY_REQUIRED_BEHAVIOR,
  EXTERNAL_HOST_COMPATIBILITY_SUPPORTED_HOST_EXAMPLES,
  EXTERNAL_HOST_COMPATIBILITY_SUPPORTED_POSTURE,
  EXECUTION_PACKET_SCHEMA_REF,
  HIGH_RISK_ADMISSION_CONTRACT_REF,
  HIGH_RISK_ADMISSION_DISPOSITION_ENUM,
  HIGH_RISK_ADMISSION_RECORD_REQUIRED_FIELDS,
  HIGH_RISK_ADMISSION_REQUIRED_TOP_LEVEL_KEYS,
  HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF,
  HIGH_RISK_EXECUTION_SUMMARY_REQUIRED_FIELDS,
  HIGH_RISK_EXECUTION_SUMMARY_STATUS,
  HIGH_RISK_SCHEMA_SPECS,
  ORCHESTRATION_STATE_SCHEMA_REF,
  PROMPT_SCHEMA_REF,
  SPEC_RECONSTRUCTION_RESULT_CONTRACT_REF,
  SPEC_RECONSTRUCTION_SUMMARY_REQUIRED_FIELDS,
  SPEC_RECONSTRUCTION_SUMMARY_STATUS,
  TARGET_SPEC_FILES,
  TARGET_SPEC_REQUIRED_KEYS,
  WORKER_OUTPUT_SCHEMA_REF,
} from "../constants.mjs";
import { readTextIfFile } from "./fs-helpers.mjs";
import { isIsoUtcTimestamp, isPlainObject, arraysEqual, toStringArray } from "./value-helpers.mjs";
import { parsePathRequirements, parseYamlText } from "./yaml-helpers.mjs";

function parseSpecReconstructionContract(text) {
  const parsed = parseYamlText(text);
  const targetTruthFiles = parsePathRequirements(text, "target_truth_files");
  const summaryRequiredFields = toStringArray(parsed?.summary_required_fields);
  const summaryStatusEnum = toStringArray(parsed?.summary_status_enum);
  const completionRequirements = toStringArray(parsed?.completion_requirements);

  const targetPathOk = arraysEqual(
    targetTruthFiles.map((entry) => entry.path),
    TARGET_SPEC_FILES,
  );
  const targetKeysOk = targetTruthFiles.every((entry) => {
    const expectedKeys = TARGET_SPEC_REQUIRED_KEYS[entry.path] ?? [];
    return arraysEqual(entry.required_top_level_keys, expectedKeys);
  });

  return {
    ok: targetTruthFiles.length === TARGET_SPEC_FILES.length
      && targetPathOk
      && targetKeysOk
      && arraysEqual(summaryRequiredFields, SPEC_RECONSTRUCTION_SUMMARY_REQUIRED_FIELDS)
      && arraysEqual(summaryStatusEnum, SPEC_RECONSTRUCTION_SUMMARY_STATUS)
      && completionRequirements.includes("all_target_truth_files_present")
      && completionRequirements.includes("required_top_level_keys_present_for_all_target_truth_files"),
    targetTruthFiles,
    summaryRequiredFields,
    summaryStatusEnum,
  };
}

function parseDocSpecAuditContract(text) {
  const parsed = parseYamlText(text);
  const summaryRequiredFields = toStringArray(parsed?.summary_required_fields);
  const summaryStatusEnum = toStringArray(parsed?.summary_status_enum);
  const defaultComparedPaths = toStringArray(parsed?.default_compared_paths);

  return {
    ok: arraysEqual(summaryRequiredFields, DOC_SPEC_AUDIT_SUMMARY_REQUIRED_FIELDS)
      && arraysEqual(summaryStatusEnum, DOC_SPEC_AUDIT_SUMMARY_STATUS)
      && arraysEqual(defaultComparedPaths, DOC_SPEC_AUDIT_DEFAULT_COMPARED_PATHS),
    summaryRequiredFields,
    summaryStatusEnum,
    defaultComparedPaths,
  };
}

function parseHighRiskExecutionContract(text) {
  const parsed = parseYamlText(text);
  const summaryRequiredFields = toStringArray(parsed?.summary_required_fields);
  const summaryStatusEnum = toStringArray(parsed?.summary_status_enum);

  return {
    ok: arraysEqual(summaryRequiredFields, HIGH_RISK_EXECUTION_SUMMARY_REQUIRED_FIELDS)
      && arraysEqual(summaryStatusEnum, HIGH_RISK_EXECUTION_SUMMARY_STATUS),
    summaryRequiredFields,
    summaryStatusEnum,
  };
}

function parseHighRiskAdmissionContract(text) {
  const parsed = parseYamlText(text);
  const topLevelRequiredKeys = toStringArray(parsed?.top_level_required_keys);
  const admissionRequiredFields = toStringArray(parsed?.admission_required_fields);
  const dispositionEnum = toStringArray(parsed?.disposition_enum);

  return {
    ok: String(parsed?.truth_contract?.id ?? "") === "canonical_high_risk_admissions_truth"
      && arraysEqual(topLevelRequiredKeys, HIGH_RISK_ADMISSION_REQUIRED_TOP_LEVEL_KEYS)
      && arraysEqual(admissionRequiredFields, HIGH_RISK_ADMISSION_RECORD_REQUIRED_FIELDS)
      && arraysEqual(dispositionEnum, HIGH_RISK_ADMISSION_DISPOSITION_ENUM),
    topLevelRequiredKeys,
    admissionRequiredFields,
    dispositionEnum,
  };
}

function parseExternalHostCompatibilityContract(text) {
  const parsed = parseYamlText(text);
  const supportedHostPosture = toStringArray(parsed?.supported_host_posture);
  const supportedHostExamples = toStringArray(parsed?.supported_host_examples);
  const requiredBehavior = toStringArray(parsed?.required_behavior);
  const forbiddenBehavior = toStringArray(parsed?.forbidden_behavior);

  return {
    ok: String(parsed?.compatibility_contract?.id ?? "") === "external_host_boundary_compatibility"
      && String(parsed?.compatibility_contract?.completion_profile ?? "") === "boundary_complete"
      && arraysEqual(supportedHostPosture, EXTERNAL_HOST_COMPATIBILITY_SUPPORTED_POSTURE)
      && arraysEqual(supportedHostExamples, EXTERNAL_HOST_COMPATIBILITY_SUPPORTED_HOST_EXAMPLES)
      && arraysEqual(requiredBehavior, EXTERNAL_HOST_COMPATIBILITY_REQUIRED_BEHAVIOR)
      && arraysEqual(forbiddenBehavior, EXTERNAL_HOST_COMPATIBILITY_FORBIDDEN_BEHAVIOR),
    supportedHostPosture,
    supportedHostExamples,
    requiredBehavior,
    forbiddenBehavior,
  };
}

export async function loadSpecReconstructionContract(projectRoot) {
  const contractText = await readTextIfFile(
    path.join(projectRoot, SPEC_RECONSTRUCTION_RESULT_CONTRACT_REF),
  );

  return {
    path: SPEC_RECONSTRUCTION_RESULT_CONTRACT_REF,
    text: contractText,
    ...parseSpecReconstructionContract(contractText),
  };
}

export async function loadDocSpecAuditContract(projectRoot) {
  const contractText = await readTextIfFile(
    path.join(projectRoot, DOC_SPEC_AUDIT_RESULT_CONTRACT_REF),
  );

  return {
    path: DOC_SPEC_AUDIT_RESULT_CONTRACT_REF,
    text: contractText,
    ...parseDocSpecAuditContract(contractText),
  };
}

export async function loadHighRiskExecutionContract(projectRoot) {
  const contractText = await readTextIfFile(
    path.join(projectRoot, HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF),
  );

  return {
    path: HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF,
    text: contractText,
    ...parseHighRiskExecutionContract(contractText),
  };
}

export async function loadHighRiskAdmissionContract(projectRoot) {
  const contractText = await readTextIfFile(
    path.join(projectRoot, HIGH_RISK_ADMISSION_CONTRACT_REF),
  );

  return {
    path: HIGH_RISK_ADMISSION_CONTRACT_REF,
    text: contractText,
    ...parseHighRiskAdmissionContract(contractText),
  };
}

export async function loadExternalHostCompatibilityContract(projectRoot) {
  const contractText = await readTextIfFile(
    path.join(projectRoot, EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF),
  );

  return {
    path: EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF,
    text: contractText,
    ...parseExternalHostCompatibilityContract(contractText),
  };
}

function parseHighRiskSchemaContract(text, schemaRef) {
  const parsed = parseYamlText(text);
  const spec = HIGH_RISK_SCHEMA_SPECS[schemaRef];

  if (!spec || !parsed) {
    return {
      ok: false,
      id: null,
      kind: null,
      listFieldMatches: [],
      rulesMatch: false,
    };
  }

  const listFieldMatches = Object.entries(spec.listFields).map(([field, expectedValues]) => ({
    field,
    ok: arraysEqual(toStringArray(parsed[field]), expectedValues),
  }));
  const rulesMatch = arraysEqual(toStringArray(parsed.rules), spec.requiredRules);

  return {
    ok: String(parsed.id ?? "") === spec.id
      && String(parsed.kind ?? "") === spec.kind
      && listFieldMatches.every((entry) => entry.ok)
      && rulesMatch,
    id: String(parsed.id ?? ""),
    kind: String(parsed.kind ?? ""),
    listFieldMatches,
    rulesMatch,
  };
}

export async function loadHighRiskSchemaContracts(projectRoot) {
  const contractRefs = [
    EXECUTION_PACKET_SCHEMA_REF,
    ORCHESTRATION_STATE_SCHEMA_REF,
    PROMPT_SCHEMA_REF,
    WORKER_OUTPUT_SCHEMA_REF,
    ACCEPTANCE_SCHEMA_REF,
  ];

  const results = [];
  for (const schemaRef of contractRefs) {
    const text = await readTextIfFile(path.join(projectRoot, schemaRef));
    results.push({
      path: schemaRef,
      text,
      ...parseHighRiskSchemaContract(text, schemaRef),
    });
  }

  return results;
}

export function validateSpecReconstructionSummary(summary, contract, verifiedAt) {
  if (!isPlainObject(summary)) {
    return {
      ok: false,
      reason: "spec_reconstruction summary must be an object",
    };
  }

  const missingFields = contract.summaryRequiredFields.filter((field) => !(field in summary));
  if (missingFields.length > 0) {
    return {
      ok: false,
      reason: `spec_reconstruction summary is missing required fields: ${missingFields.join(", ")}`,
    };
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

  if (!contract.summaryStatusEnum.includes(summary.status)) {
    return {
      ok: false,
      reason: `spec_reconstruction summary.status must be one of: ${contract.summaryStatusEnum.join(", ")}`,
    };
  }

  if (typeof summary.summary !== "string" || summary.summary.trim().length === 0) {
    return {
      ok: false,
      reason: "spec_reconstruction summary.summary must be a non-empty string",
    };
  }

  if (!isIsoUtcTimestamp(summary.verified_at)) {
    return {
      ok: false,
      reason: "spec_reconstruction summary.verified_at must be an ISO-8601 UTC timestamp",
    };
  }

  if (verifiedAt && summary.verified_at !== verifiedAt) {
    return {
      ok: false,
      reason: "spec_reconstruction summary.verified_at must match the top-level verifiedAt",
    };
  }

  return {
    ok: true,
  };
}

export function validateDocSpecAuditSummary(summary, contract, verifiedAt) {
  if (!isPlainObject(summary)) {
    return {
      ok: false,
      reason: "doc_spec_audit summary must be an object",
    };
  }

  const missingFields = contract.summaryRequiredFields.filter((field) => !(field in summary));
  if (missingFields.length > 0) {
    return {
      ok: false,
      reason: `doc_spec_audit summary is missing required fields: ${missingFields.join(", ")}`,
    };
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

  if (!contract.summaryStatusEnum.includes(summary.status)) {
    return {
      ok: false,
      reason: `doc_spec_audit summary.status must be one of: ${contract.summaryStatusEnum.join(", ")}`,
    };
  }

  if (typeof summary.summary !== "string" || summary.summary.trim().length === 0) {
    return {
      ok: false,
      reason: "doc_spec_audit summary.summary must be a non-empty string",
    };
  }

  if (!isIsoUtcTimestamp(summary.verified_at)) {
    return {
      ok: false,
      reason: "doc_spec_audit summary.verified_at must be an ISO-8601 UTC timestamp",
    };
  }

  if (verifiedAt && summary.verified_at !== verifiedAt) {
    return {
      ok: false,
      reason: "doc_spec_audit summary.verified_at must match the top-level verifiedAt",
    };
  }

  return {
    ok: true,
  };
}

export function validateHighRiskExecutionSummary(summary, contract, verifiedAt) {
  if (!isPlainObject(summary)) {
    return {
      ok: false,
      reason: "high_risk_execution summary must be an object",
    };
  }

  const missingFields = contract.summaryRequiredFields.filter((field) => !(field in summary));
  if (missingFields.length > 0) {
    return {
      ok: false,
      reason: `high_risk_execution summary is missing required fields: ${missingFields.join(", ")}`,
    };
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

  if (!contract.summaryStatusEnum.includes(summary.status)) {
    return {
      ok: false,
      reason: `high_risk_execution summary.status must be one of: ${contract.summaryStatusEnum.join(", ")}`,
    };
  }

  if (typeof summary.summary !== "string" || summary.summary.trim().length === 0) {
    return {
      ok: false,
      reason: "high_risk_execution summary.summary must be a non-empty string",
    };
  }

  if (!isIsoUtcTimestamp(summary.verified_at)) {
    return {
      ok: false,
      reason: "high_risk_execution summary.verified_at must be an ISO-8601 UTC timestamp",
    };
  }

  if (verifiedAt && summary.verified_at !== verifiedAt) {
    return {
      ok: false,
      reason: "high_risk_execution summary.verified_at must match the top-level verifiedAt",
    };
  }

  return {
    ok: true,
  };
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

  for (const field of ["topic_id", "packet_id", "manager_review_owner", "summary", "source_decision_contract"]) {
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

  return {
    ok: true,
  };
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

  if (!Array.isArray(spec.admissions) || !Array.isArray(spec.admission_rules) || !Array.isArray(spec.semantic_constraints)) {
    return {
      ok: false,
      reason: "high-risk admissions spec top-level sections must be arrays",
    };
  }

  if (spec.admission_rules.some((entry) => typeof entry !== "string") || spec.semantic_constraints.some((entry) => typeof entry !== "string")) {
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

  return {
    ok: true,
  };
}
