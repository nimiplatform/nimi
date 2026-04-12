import path from "node:path";

import {
  ACCEPTANCE_SCHEMA_REF,
  BLUEPRINT_REFERENCE_REF,
  COMMAND_GATING_MATRIX_REF,
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
  SPEC_TREE_MODEL_REF,
  SPEC_GENERATION_INPUTS_CONTRACT_REF,
  SPEC_GENERATION_INPUTS_REF,
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

const SPEC_TREE_PROFILE_ENUM = ["minimal", "standard", "mature"];
const AUTHORITY_MODE_ENUM = [
  "external_blueprint_active",
  "canonical_cutover_ready",
  "canonical_active",
];
const BLUEPRINT_MODE_ENUM = [
  "none",
  "repo_spec_blueprint",
  "custom_blueprint",
];
const SPEC_GENERATION_MODE_ENUM = ["mixed"];
const SPEC_GENERATION_ACCEPTANCE_MODE_ENUM = [
  "canonical_tree_validity_without_blueprint",
  "semantic_and_structural_parity_when_blueprint_exists",
];
const SPEC_GENERATION_ORDER_ENUM = [
  "index",
  "kernel_markdown",
  "kernel_tables",
  "generated_views",
  "thin_guides",
];

function toStringOrNull(value) {
  return typeof value === "string" ? value : null;
}

function normalizePathClass(entry) {
  if (!isPlainObject(entry)) {
    return null;
  }

  return {
    id: toStringOrNull(entry.id),
    pathPatterns: toStringArray(entry.path_patterns),
    excludedPathPatterns: toStringArray(entry.excluded_path_patterns),
    allowedExtensions: toStringArray(entry.allowed_extensions),
    generatorRefs: toStringArray(entry.generator_refs),
    mustReferenceNormativeIds: entry.must_reference_normative_ids === true,
    normative: entry.normative === true,
  };
}

function normalizeSpecDomain(entry) {
  if (!isPlainObject(entry)) {
    return null;
  }

  return {
    id: toStringOrNull(entry.id),
    root: toStringOrNull(entry.root),
    normativeRoot: toStringOrNull(entry.normative_root),
    tablesRoot: toStringOrNull(entry.tables_root),
    generatedRoot: toStringOrNull(entry.generated_root),
    guidePaths: toStringArray(entry.guide_paths),
  };
}

function normalizeGeneratedPipeline(entry) {
  if (!isPlainObject(entry)) {
    return null;
  }

  return {
    id: toStringOrNull(entry.id),
    ownerSurface: toStringOrNull(entry.owner_surface),
    inputRoots: toStringArray(entry.input_roots),
    outputRoots: toStringArray(entry.output_roots),
    generateCommand: toStringOrNull(entry.generate_command),
    driftCheckCommand: toStringOrNull(entry.drift_check_command),
  };
}

function pathStartsWithRoot(targetPath, root) {
  if (typeof targetPath !== "string" || typeof root !== "string") {
    return false;
  }

  return targetPath === root || targetPath.startsWith(`${root}/`);
}

function parseSpecReconstructionContract(text) {
  const parsed = parseYamlText(text);
  const summaryRequiredFields = toStringArray(parsed?.summary_required_fields);
  const summaryStatusEnum = toStringArray(parsed?.summary_status_enum);
  const completionRequirements = toStringArray(parsed?.completion_requirements);
  const canonicalTreeCompletion = isPlainObject(parsed?.canonical_tree_completion)
    ? {
      profileRef: toStringOrNull(parsed.canonical_tree_completion.profile_ref),
      generationInputsRef: toStringOrNull(parsed.canonical_tree_completion.generation_inputs_ref),
      requiredTreeState: toStringOrNull(parsed.canonical_tree_completion.required_tree_state),
      requiredFilesValid: parsed.canonical_tree_completion.required_files_valid === true,
    }
    : null;

  return {
    ok: arraysEqual(summaryRequiredFields, SPEC_RECONSTRUCTION_SUMMARY_REQUIRED_FIELDS)
      && arraysEqual(summaryStatusEnum, SPEC_RECONSTRUCTION_SUMMARY_STATUS)
      && completionRequirements.includes("canonical_tree_ready")
      && completionRequirements.includes("declared_profile_required_files_valid")
      && completionRequirements.includes("declared_file_class_constraints_valid")
      && completionRequirements.includes("semantic_and_structural_parity_when_blueprint_exists")
      && canonicalTreeCompletion?.profileRef === SPEC_TREE_MODEL_REF
      && canonicalTreeCompletion?.generationInputsRef === SPEC_GENERATION_INPUTS_REF
      && canonicalTreeCompletion?.requiredTreeState === "canonical_tree_ready"
      && canonicalTreeCompletion?.requiredFilesValid === true,
    targetTruthFiles: parsePathRequirements(text, "target_truth_files"),
    canonicalTreeCompletion,
    summaryRequiredFields,
    summaryStatusEnum,
    completionRequirements,
  };
}

function parseSpecGenerationInputsContract(text) {
  const parsed = parseYamlText(text);
  const contract = parsed?.input_contract;
  const requiredFields = toStringArray(parsed?.required_fields);
  const generationOrderEnum = toStringArray(parsed?.generation_order_enum);
  const hardConstraints = toStringArray(parsed?.hard_constraints);

  return {
    ok: parsed?.version === 1
      && String(contract?.id ?? "") === "canonical_spec_generation_inputs"
      && String(contract?.target_root ?? "") === ".nimi/spec"
      && arraysEqual(toStringArray(contract?.mode_enum), SPEC_GENERATION_MODE_ENUM)
      && arraysEqual(toStringArray(contract?.acceptance_mode_enum), SPEC_GENERATION_ACCEPTANCE_MODE_ENUM)
      && arraysEqual(generationOrderEnum, SPEC_GENERATION_ORDER_ENUM)
      && requiredFields.includes("mode")
      && requiredFields.includes("canonical_target_root")
      && requiredFields.includes("benchmark_blueprint_root")
      && hardConstraints.includes("canonical_target_root_must_be_.nimi/spec"),
    requiredFields,
    generationOrderEnum,
    hardConstraints,
  };
}

function parseSpecGenerationInputsConfig(text) {
  const parsed = parseYamlText(text);
  const config = parsed?.spec_generation_inputs;
  const mode = toStringOrNull(config?.mode);
  const canonicalTargetRoot = toStringOrNull(config?.canonical_target_root);
  const codeRoots = toStringArray(config?.code_roots);
  const docsRoots = toStringArray(config?.docs_roots);
  const structureRoots = toStringArray(config?.structure_roots);
  const humanNotePaths = toStringArray(config?.human_note_paths);
  const benchmarkBlueprintRoot = typeof config?.benchmark_blueprint_root === "string"
    ? config.benchmark_blueprint_root
    : null;
  const benchmarkMode = toStringOrNull(config?.benchmark_mode);
  const acceptanceMode = toStringOrNull(config?.acceptance_mode);
  const generationOrder = toStringArray(config?.generation_order);
  const inferenceRules = toStringArray(config?.inference_rules);

  return {
    ok: parsed?.version === 1
      && String(parsed?.contract_ref ?? "") === SPEC_GENERATION_INPUTS_CONTRACT_REF
      && SPEC_GENERATION_MODE_ENUM.includes(mode)
      && canonicalTargetRoot === ".nimi/spec"
      && Array.isArray(codeRoots)
      && Array.isArray(docsRoots)
      && Array.isArray(structureRoots)
      && Array.isArray(humanNotePaths)
      && BLUEPRINT_MODE_ENUM.includes(benchmarkMode)
      && SPEC_GENERATION_ACCEPTANCE_MODE_ENUM.includes(acceptanceMode)
      && generationOrder.length > 0
      && generationOrder.every((entry) => SPEC_GENERATION_ORDER_ENUM.includes(entry))
      && inferenceRules.length > 0
      && (
        benchmarkMode === "none"
          ? benchmarkBlueprintRoot === null
          : typeof benchmarkBlueprintRoot === "string" && benchmarkBlueprintRoot.length > 0
      ),
    mode,
    canonicalTargetRoot,
    codeRoots,
    docsRoots,
    structureRoots,
    humanNotePaths,
    benchmarkBlueprintRoot,
    benchmarkMode,
    acceptanceMode,
    generationOrder,
    inferenceRules,
  };
}

function parseSpecTreeModel(text) {
  const parsed = parseYamlText(text);
  const model = parsed?.spec_tree_model;
  const profile = toStringOrNull(model?.profile);
  const canonicalRoot = toStringOrNull(model?.canonical_root);
  const authorityMode = toStringOrNull(model?.authority_mode);
  const domains = Array.isArray(model?.domains)
    ? model.domains.map(normalizeSpecDomain).filter(Boolean)
    : [];
  const normativeClasses = Array.isArray(model?.normative_classes)
    ? model.normative_classes.map(normalizePathClass).filter(Boolean)
    : [];
  const derivedClasses = Array.isArray(model?.derived_classes)
    ? model.derived_classes.map(normalizePathClass).filter(Boolean)
    : [];
  const guidanceClasses = Array.isArray(model?.guidance_classes)
    ? model.guidance_classes.map(normalizePathClass).filter(Boolean)
    : [];
  const requiredFilesByProfile = SPEC_TREE_PROFILE_ENUM.reduce((acc, currentProfile) => {
    acc[currentProfile] = toStringArray(model?.required_files?.[currentProfile]);
    return acc;
  }, {});
  const generatedPipelines = Array.isArray(model?.generated_pipelines)
    ? model.generated_pipelines.map(normalizeGeneratedPipeline).filter(Boolean)
    : [];
  const failClosedRules = toStringArray(model?.fail_closed_rules);
  const blueprintSource = isPlainObject(model?.blueprint_source)
    ? {
      mode: toStringOrNull(model.blueprint_source.mode),
      root: toStringOrNull(model.blueprint_source.root),
      equivalenceContractRef: toStringOrNull(model.blueprint_source.equivalence_contract_ref),
    }
    : null;

  const canonicalRootValid = canonicalRoot === ".nimi/spec";
  const profileValid = SPEC_TREE_PROFILE_ENUM.includes(profile);
  const authorityModeValid = AUTHORITY_MODE_ENUM.includes(authorityMode);
  const domainRootsValid = domains.length > 0 && domains.every((domain) => (
    typeof domain.id === "string"
    && typeof domain.root === "string"
    && typeof domain.normativeRoot === "string"
    && typeof domain.tablesRoot === "string"
    && pathStartsWithRoot(domain.root, canonicalRoot)
    && pathStartsWithRoot(domain.normativeRoot, domain.root)
    && pathStartsWithRoot(domain.tablesRoot, domain.normativeRoot)
    && (!domain.generatedRoot || pathStartsWithRoot(domain.generatedRoot, domain.normativeRoot))
    && domain.guidePaths.every((guidePath) => pathStartsWithRoot(guidePath, domain.root))
  ));
  const requiredFilesValid = SPEC_TREE_PROFILE_ENUM.every((currentProfile) => (
    requiredFilesByProfile[currentProfile].length > 0
    && requiredFilesByProfile[currentProfile].every((requiredPath) => pathStartsWithRoot(requiredPath, canonicalRoot))
  ));
  const fileClassIdsPresent = normativeClasses.every((entry) => entry.id && entry.pathPatterns.length > 0)
    && derivedClasses.every((entry) => entry.id && entry.pathPatterns.length > 0)
    && guidanceClasses.every((entry) => entry.id && entry.pathPatterns.length > 0);
  const generatedPipelinesValid = generatedPipelines.every((entry) => (
    entry.id
    && entry.ownerSurface
    && entry.generateCommand
    && entry.inputRoots.length > 0
    && entry.outputRoots.length > 0
  ));
  const blueprintSourceValid = !blueprintSource || (
    typeof blueprintSource.mode === "string"
    && ["repo_spec_blueprint", "custom_blueprint"].includes(blueprintSource.mode)
    && typeof blueprintSource.root === "string"
    && typeof blueprintSource.equivalenceContractRef === "string"
  );

  return {
    ok: parsed?.version === 1
      && profileValid
      && canonicalRootValid
      && authorityModeValid
      && domainRootsValid
      && requiredFilesValid
      && fileClassIdsPresent
      && generatedPipelinesValid
      && failClosedRules.length > 0
      && blueprintSourceValid,
    version: parsed?.version ?? null,
    profile,
    canonicalRoot,
    authorityMode,
    domains,
    normativeClasses,
    derivedClasses,
    guidanceClasses,
    requiredFilesByProfile,
    generatedPipelines,
    failClosedRules,
    blueprintSource,
  };
}

function parseCommandGatingMatrix(text) {
  const parsed = parseYamlText(text);
  const entries = Array.isArray(parsed?.command_gating_matrix)
    ? parsed.command_gating_matrix
      .filter((entry) => isPlainObject(entry) && typeof entry.command === "string")
      .map((entry) => ({
        command: entry.command,
        skill: toStringOrNull(entry.skill),
        allowedTreeStates: toStringArray(entry.allowed_tree_states),
        allowedAuthorityModes: toStringArray(entry.allowed_authority_modes),
        completedRequires: isPlainObject(entry.completed_requires) ? entry.completed_requires : null,
        requires: isPlainObject(entry.requires) ? entry.requires : null,
        notes: toStringArray(entry.notes),
        reports: toStringArray(entry.reports),
      }))
    : [];

  return {
    ok: parsed?.version === 1 && entries.length > 0,
    entries,
  };
}

function parseBlueprintReference(text) {
  if (!text) {
    return {
      ok: true,
      present: false,
      mode: null,
      root: null,
      canonicalTargetRoot: null,
      equivalenceContractRef: null,
    };
  }

  const parsed = parseYamlText(text);
  const reference = parsed?.blueprint_reference;
  const mode = toStringOrNull(reference?.mode);
  const root = toStringOrNull(reference?.root);
  const canonicalTargetRoot = toStringOrNull(reference?.canonical_target_root);
  const equivalenceContractRef = toStringOrNull(reference?.equivalence_contract_ref);

  return {
    ok: parsed?.version === 1
      && ["repo_spec_blueprint", "custom_blueprint"].includes(mode)
      && typeof root === "string"
      && typeof canonicalTargetRoot === "string"
      && typeof equivalenceContractRef === "string",
    present: true,
    mode,
    root,
    canonicalTargetRoot,
    equivalenceContractRef,
  };
}

export function findCommandGatingRule(commandGatingMatrix, command, skillId = null) {
  if (!commandGatingMatrix?.entries) {
    return null;
  }

  return commandGatingMatrix.entries.find((entry) => {
    if (entry.command !== command) {
      return false;
    }

    if (skillId === null) {
      return !entry.skill;
    }

    return entry.skill === skillId;
  }) ?? null;
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

export async function loadSpecTreeModelContract(projectRoot) {
  const contractText = await readTextIfFile(
    path.join(projectRoot, SPEC_TREE_MODEL_REF),
  );

  return {
    path: SPEC_TREE_MODEL_REF,
    text: contractText,
    ...parseSpecTreeModel(contractText),
  };
}

export async function loadSpecGenerationInputsContract(projectRoot) {
  const contractText = await readTextIfFile(
    path.join(projectRoot, SPEC_GENERATION_INPUTS_CONTRACT_REF),
  );

  return {
    path: SPEC_GENERATION_INPUTS_CONTRACT_REF,
    text: contractText,
    ...parseSpecGenerationInputsContract(contractText),
  };
}

export async function loadSpecGenerationInputsConfig(projectRoot) {
  const configText = await readTextIfFile(
    path.join(projectRoot, SPEC_GENERATION_INPUTS_REF),
  );

  return {
    path: SPEC_GENERATION_INPUTS_REF,
    text: configText,
    ...parseSpecGenerationInputsConfig(configText),
  };
}

export async function loadCommandGatingMatrix(projectRoot) {
  const contractText = await readTextIfFile(
    path.join(projectRoot, COMMAND_GATING_MATRIX_REF),
  );

  return {
    path: COMMAND_GATING_MATRIX_REF,
    text: contractText,
    ...parseCommandGatingMatrix(contractText),
  };
}

export async function loadBlueprintReference(projectRoot) {
  const contractText = await readTextIfFile(
    path.join(projectRoot, BLUEPRINT_REFERENCE_REF),
  );

  return {
    path: BLUEPRINT_REFERENCE_REF,
    text: contractText,
    ...parseBlueprintReference(contractText),
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
