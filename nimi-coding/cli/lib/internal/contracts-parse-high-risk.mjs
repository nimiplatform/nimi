import {
  AUDIT_SWEEP_SUMMARY_REQUIRED_FIELDS,
  AUDIT_SWEEP_SUMMARY_STATUS,
  DOC_SPEC_AUDIT_DEFAULT_COMPARED_PATHS,
  DOC_SPEC_AUDIT_SUMMARY_REQUIRED_FIELDS,
  DOC_SPEC_AUDIT_SUMMARY_STATUS,
  EXTERNAL_HOST_COMPATIBILITY_FORBIDDEN_BEHAVIOR,
  EXTERNAL_HOST_COMPATIBILITY_REQUIRED_BEHAVIOR,
  EXTERNAL_HOST_COMPATIBILITY_SUPPORTED_HOST_EXAMPLES,
  EXTERNAL_HOST_COMPATIBILITY_SUPPORTED_POSTURE,
  HIGH_RISK_ADMISSION_DISPOSITION_ENUM,
  HIGH_RISK_ADMISSION_RECORD_REQUIRED_FIELDS,
  HIGH_RISK_ADMISSION_REQUIRED_TOP_LEVEL_KEYS,
  HIGH_RISK_EXECUTION_SUMMARY_REQUIRED_FIELDS,
  HIGH_RISK_EXECUTION_SUMMARY_STATUS,
  HIGH_RISK_SCHEMA_SPECS,
} from "../../constants.mjs";
import { arraysEqual, toStringArray } from "../value-helpers.mjs";
import { parseYamlText } from "../yaml-helpers.mjs";

export function parseDocSpecAuditContract(text) {
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

export function parseAuditSweepContract(text) {
  const parsed = parseYamlText(text);
  const summaryRequiredFields = toStringArray(parsed?.summary_required_fields);
  const summaryStatusEnum = toStringArray(parsed?.summary_status_enum);

  return {
    ok: arraysEqual(summaryRequiredFields, AUDIT_SWEEP_SUMMARY_REQUIRED_FIELDS)
      && arraysEqual(summaryStatusEnum, AUDIT_SWEEP_SUMMARY_STATUS),
    summaryRequiredFields,
    summaryStatusEnum,
  };
}

export function parseHighRiskExecutionContract(text) {
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

export function parseHighRiskAdmissionContract(text) {
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

export function parseExternalHostCompatibilityContract(text) {
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

export function parseHighRiskSchemaContract(text, schemaRef) {
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
