import {
  BLUEPRINT_REFERENCE_REF,
  SPEC_GENERATION_AUDIT_CONTRACT_REF,
  SPEC_GENERATION_AUDIT_COVERAGE_STATUS_ENUM,
  SPEC_GENERATION_AUDIT_FILE_REQUIRED_FIELDS,
  SPEC_GENERATION_AUDIT_REF,
  SPEC_GENERATION_AUDIT_REQUIRED_TOP_LEVEL_FIELDS,
  SPEC_GENERATION_AUDIT_SOURCE_BASIS_ENUM,
  SPEC_GENERATION_INPUTS_CONTRACT_REF,
  SPEC_GENERATION_INPUTS_REF,
  SPEC_RECONSTRUCTION_SUMMARY_REQUIRED_FIELDS,
  SPEC_RECONSTRUCTION_SUMMARY_STATUS,
  SPEC_TREE_MODEL_REF,
} from "../../constants.mjs";
import {
  arraysEqual,
  isPlainObject,
  toStringArray,
} from "../value-helpers.mjs";
import { parseYamlText } from "../yaml-helpers.mjs";
export {
  parseDocSpecAuditContract,
  parseExternalHostCompatibilityContract,
  parseHighRiskAdmissionContract,
  parseHighRiskExecutionContract,
  parseHighRiskSchemaContract,
} from "./contracts-parse-high-risk.mjs";

const SPEC_TREE_PROFILE_ENUM = ["minimal", "standard", "mature"];
const AUTHORITY_MODE_ENUM = [
  "external_authority_active",
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
const TOPIC_LIFECYCLE_LOCAL_REPORT_MARKDOWN = /^\.nimi\/local\/report\/(?:proposal|ongoing|closed)\/\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\.md$/;

function normalizeAuthorityModeValue(value) {
  return value === "external_blueprint_active" ? "external_authority_active" : value;
}

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

function isDatePrefixedLocalReportMarkdownPath(value) {
  if (typeof value !== "string") {
    return false;
  }
  return TOPIC_LIFECYCLE_LOCAL_REPORT_MARKDOWN.test(value);
}

function localReportMarkdownPathsAreSortable(paths) {
  return paths.every((entry) => {
    if (typeof entry !== "string") {
      return true;
    }
    if (entry.startsWith(".local/report/")) {
      return false;
    }
    if (!entry.startsWith(".nimi/local/report/")) {
      return true;
    }
    if (!entry.endsWith(".md")) {
      return true;
    }
    return isDatePrefixedLocalReportMarkdownPath(entry);
  });
}

export function parseSpecReconstructionContract(text) {
  const parsed = parseYamlText(text);
  const summaryRequiredFields = toStringArray(parsed?.summary_required_fields);
  const summaryStatusEnum = toStringArray(parsed?.summary_status_enum);
  const completionRequirements = toStringArray(parsed?.completion_requirements);
  const canonicalTreeCompletion = isPlainObject(parsed?.canonical_tree_completion)
    ? {
      profileRef: toStringOrNull(parsed.canonical_tree_completion.profile_ref),
      generationInputsRef: toStringOrNull(parsed.canonical_tree_completion.generation_inputs_ref),
      auditContractRef: toStringOrNull(parsed.canonical_tree_completion.audit_contract_ref),
      auditRef: toStringOrNull(parsed.canonical_tree_completion.audit_ref),
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
      && completionRequirements.includes("spec_generation_audit_present_and_valid")
      && completionRequirements.includes("required_canonical_files_have_matching_audit_entries")
      && completionRequirements.includes("unresolved_gaps_must_remain_explicit")
      && completionRequirements.includes("semantic_and_structural_parity_when_blueprint_exists")
      && canonicalTreeCompletion?.profileRef === SPEC_TREE_MODEL_REF
      && canonicalTreeCompletion?.generationInputsRef === SPEC_GENERATION_INPUTS_REF
      && canonicalTreeCompletion?.auditContractRef === SPEC_GENERATION_AUDIT_CONTRACT_REF
      && canonicalTreeCompletion?.auditRef === SPEC_GENERATION_AUDIT_REF
      && canonicalTreeCompletion?.requiredTreeState === "canonical_tree_ready"
      && canonicalTreeCompletion?.requiredFilesValid === true,
    canonicalTreeCompletion,
    summaryRequiredFields,
    summaryStatusEnum,
    completionRequirements,
  };
}

export function parseSpecGenerationAuditContract(text) {
  const parsed = parseYamlText(text);
  const requiredTopLevelFields = toStringArray(parsed?.required_top_level_fields);
  const requiredFileEntryFields = toStringArray(parsed?.required_file_entry_fields);
  const sourceBasisEnum = toStringArray(parsed?.source_basis_enum);
  const coverageStatusEnum = toStringArray(parsed?.coverage_status_enum);
  const hardConstraints = toStringArray(parsed?.hard_constraints);

  return {
    ok: parsed?.version === 1
      && String(parsed?.audit_contract?.id ?? "") === "canonical_spec_generation_audit"
      && String(parsed?.audit_contract?.target_ref ?? "") === SPEC_GENERATION_AUDIT_REF
      && arraysEqual(requiredTopLevelFields, SPEC_GENERATION_AUDIT_REQUIRED_TOP_LEVEL_FIELDS)
      && arraysEqual(requiredFileEntryFields, SPEC_GENERATION_AUDIT_FILE_REQUIRED_FIELDS)
      && arraysEqual(sourceBasisEnum, SPEC_GENERATION_AUDIT_SOURCE_BASIS_ENUM)
      && arraysEqual(coverageStatusEnum, SPEC_GENERATION_AUDIT_COVERAGE_STATUS_ENUM)
      && hardConstraints.includes("every_generated_canonical_file_requires_a_matching_audit_entry")
      && hardConstraints.includes("required_canonical_files_must_not_be_placeholder_not_allowed")
      && hardConstraints.includes("unresolved_or_inferred_content_must_be_explicit")
      && hardConstraints.includes("source_refs_must_stay_within_declared_inputs_or_optional_benchmark_root")
      && hardConstraints.includes("no_empty_success_looking_audit_entries"),
    requiredTopLevelFields,
    requiredFileEntryFields,
    sourceBasisEnum,
    coverageStatusEnum,
    hardConstraints,
  };
}

export function parseSpecGenerationInputsContract(text) {
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
      && hardConstraints.includes("canonical_target_root_must_be_.nimi/spec")
      && hardConstraints.includes("local_report_markdown_paths_must_use_topic_lifecycle_shape")
      && hardConstraints.includes("human_authored_topic_reports_must_use_.nimi/local/report_as_canonical_root"),
    requiredFields,
    generationOrderEnum,
    hardConstraints,
  };
}

export function parseSpecGenerationInputsConfig(text) {
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
      && localReportMarkdownPathsAreSortable(humanNotePaths)
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

export function parseSpecTreeModel(text) {
  const parsed = parseYamlText(text);
  const model = parsed?.spec_tree_model;
  const profile = toStringOrNull(model?.profile);
  const canonicalRoot = toStringOrNull(model?.canonical_root);
  const authorityMode = normalizeAuthorityModeValue(toStringOrNull(model?.authority_mode));
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
    && isDatePrefixedLocalReportMarkdownPath(blueprintSource.equivalenceContractRef)
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

export function parseCommandGatingMatrix(text) {
  const parsed = parseYamlText(text);
  const entries = Array.isArray(parsed?.command_gating_matrix)
    ? parsed.command_gating_matrix
      .filter((entry) => isPlainObject(entry) && typeof entry.command === "string")
      .map((entry) => ({
        command: entry.command,
        skill: toStringOrNull(entry.skill),
        allowedTreeStates: toStringArray(entry.allowed_tree_states),
        allowedAuthorityModes: toStringArray(entry.allowed_authority_modes).map(normalizeAuthorityModeValue),
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

export function parseBlueprintReference(text) {
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
      && typeof equivalenceContractRef === "string"
      && isDatePrefixedLocalReportMarkdownPath(equivalenceContractRef),
    present: true,
    mode,
    root,
    canonicalTargetRoot,
    equivalenceContractRef,
  };
}

export function matchCommandGatingRule(commandGatingMatrix, command, skillId = null) {
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
