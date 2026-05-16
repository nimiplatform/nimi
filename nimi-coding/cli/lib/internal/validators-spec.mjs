import path from "node:path";

import {
  SPEC_GENERATION_AUDIT_CONTRACT_REF,
  SPEC_GENERATION_AUDIT_COVERAGE_STATUS_ENUM,
  SPEC_GENERATION_AUDIT_FILE_REQUIRED_FIELDS,
  SPEC_GENERATION_AUDIT_SOURCE_BASIS_ENUM,
} from "../../constants.mjs";
import {
  loadBlueprintReference,
  loadSpecGenerationAuditContract,
  loadSpecGenerationInputsConfig,
  loadSpecTreeModelContract,
} from "../contracts.mjs";
import { readTextIfFile } from "../fs-helpers.mjs";
import { isPlainObject } from "../value-helpers.mjs";
import { parseYamlText } from "../yaml-helpers.mjs";
import {
  makeValidatorRefusal,
  VALIDATOR_NATIVE_REFUSAL_CODES,
} from "./validators-shared.mjs";
import {
  validateDomainAdmission,
  validatePlacement,
  validateTableFamily,
} from "./surface-taxonomy-validators.mjs";
import {
  classifyAuditCoveredFiles,
  classifySpecTreeFiles,
  collectTreeFiles,
  isDeclaredInputsCompatibleWithConfig,
  isSourceRefWithinDeclaredRoots,
} from "./validators-spec-helpers.mjs";

async function loadV2RequiredFiles(projectRoot) {
  const text = await readTextIfFile(path.join(projectRoot, ".nimi", "methodology", "spec-reconstruction.yaml"));
  const parsed = parseYamlText(text);
  return Array.isArray(parsed?.reconstruction?.target_tree_shape?.minimal_required_outputs)
    ? parsed.reconstruction.target_tree_shape.minimal_required_outputs.map(String)
    : [];
}

function isV2SpecGenerationInputs(specGenerationInputs) {
  return specGenerationInputs.ok && specGenerationInputs.mode === "class_filtered";
}

async function validateSpecTreeV2(rootPath, projectRoot, specGenerationInputs) {
  const errors = [];
  const warnings = [];
  const expectedRoot = path.resolve(projectRoot, specGenerationInputs.canonicalTargetRoot ?? ".nimi/spec");
  const targetRoot = path.resolve(rootPath);

  if (targetRoot !== expectedRoot) {
    errors.push(`spec tree root mismatch: expected ${expectedRoot} but received ${targetRoot}`);
  }

  const files = await collectTreeFiles(targetRoot);
  if (files.length === 0) {
    return {
      ok: false,
      errors: errors.length > 0 ? errors : [`missing spec tree root: ${targetRoot}`],
      warnings,
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.SPEC_TREE_MISSING,
        "spec tree root is missing or empty",
      ),
    };
  }

  const requiredFiles = await loadV2RequiredFiles(projectRoot);
  const canonicalRoot = specGenerationInputs.canonicalTargetRoot ?? ".nimi/spec";
  const missingRequired = requiredFiles
    .map((entry) => path.posix.relative(canonicalRoot, entry))
    .filter((entry) => !files.includes(entry));
  if (missingRequired.length > 0) {
    errors.push(`missing required canonical files: ${missingRequired.join(", ")}`);
  }

  const rootRef = path.relative(projectRoot, targetRoot).split(path.sep).join(path.posix.sep) || ".";
  const placement = await validatePlacement(projectRoot, { rootRef });
  const domainAdmission = await validateDomainAdmission(projectRoot, { rootRef });
  const tableFamily = await validateTableFamily(projectRoot, { rootRef });
  errors.push(...(placement.errors ?? []), ...(domainAdmission.errors ?? []), ...(tableFamily.errors ?? []));

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    refusal: errors.length === 0
      ? null
      : makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.SPEC_TREE_INVALID,
        `spec tree is invalid: ${path.basename(targetRoot)}`,
      ),
    summary: {
      profile: "surface_taxonomy_v1",
      canonicalRoot,
      totalFiles: files.length,
      requiredFiles: requiredFiles.length,
      missingRequired,
      classifiedFiles: placement.summary?.total ?? files.length,
      unexpectedFiles: [],
      conflictingFiles: [],
    },
  };
}

function toPortableProjectPath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

function pathStartsWithRoot(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function generatedOutputNormativeRootOverlaps(specTreeModel) {
  const normativeRoots = specTreeModel.domains.map((domain) => domain.normativeRoot).filter(Boolean);
  const overlaps = [];
  for (const pipeline of specTreeModel.generatedPipelines) {
    for (const outputRoot of pipeline.outputRoots) {
      for (const normativeRoot of normativeRoots) {
        if (pathStartsWithRoot(outputRoot, normativeRoot) || pathStartsWithRoot(normativeRoot, outputRoot)) {
          overlaps.push({
            pipelineId: pipeline.id,
            outputRoot,
            normativeRoot,
          });
        }
      }
    }
  }
  return overlaps;
}

function normalizeAuditFileClass(entry) {
  const explicitSurfaceClass = typeof entry.surface_class === "string" ? entry.surface_class : null;
  if (explicitSurfaceClass) {
    return explicitSurfaceClass;
  }

  switch (String(entry.file_class ?? "")) {
    case "kernel_markdown":
      return "product_authority";
    case "kernel_tables":
      return "product_authority_table";
    case "domain_guides":
    case "kernel_generated":
      return "thin_guidance";
    default:
      return String(entry.file_class ?? "");
  }
}

export async function validateSpecTree(rootPath, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const specTreeModel = await loadSpecTreeModelContract(projectRoot);
  const specGenerationInputs = await loadSpecGenerationInputsConfig(projectRoot);
  const errors = [];
  const warnings = [];

  if (!specTreeModel.ok) {
    if (isV2SpecGenerationInputs(specGenerationInputs)) {
      return validateSpecTreeV2(rootPath, projectRoot, specGenerationInputs);
    }
    return {
      ok: false,
      errors: [`invalid spec tree model contract: ${specTreeModel.path}`],
      warnings,
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.SPEC_TREE_INVALID,
        "spec tree validation requires a valid spec-tree-model contract",
      ),
    };
  }

  const expectedRoot = path.resolve(projectRoot, specTreeModel.canonicalRoot);
  const targetRoot = path.resolve(rootPath);

  if (targetRoot !== expectedRoot) {
    errors.push(`spec tree root mismatch: expected ${expectedRoot} but received ${targetRoot}`);
  }

  const files = await collectTreeFiles(targetRoot);
  if (files.length === 0) {
    return {
      ok: false,
      errors: errors.length > 0 ? errors : [`missing spec tree root: ${targetRoot}`],
      warnings,
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.SPEC_TREE_MISSING,
        "spec tree root is missing or empty",
      ),
    };
  }

  const requiredFiles = specTreeModel.requiredFilesByProfile[specTreeModel.profile] ?? [];
  const missingRequired = requiredFiles
    .map((entry) => path.posix.relative(specTreeModel.canonicalRoot, entry))
    .filter((entry) => !files.includes(entry));

  if (missingRequired.length > 0) {
    errors.push(`missing required canonical files: ${missingRequired.join(", ")}`);
  }

  const generatedOutputOverlaps = generatedOutputNormativeRootOverlaps(specTreeModel);
  if (generatedOutputOverlaps.length > 0) {
    errors.push(
      `generated output roots overlap normative roots: ${generatedOutputOverlaps.map((entry) => `${entry.pipelineId}:${entry.outputRoot}->${entry.normativeRoot}`).join(", ")}`,
    );
  }

  for (const domain of specTreeModel.domains) {
    const domainRoot = path.posix.relative(specTreeModel.canonicalRoot, domain.root);
    const normativeRoot = path.posix.relative(specTreeModel.canonicalRoot, domain.normativeRoot);
    const tablesRoot = path.posix.relative(specTreeModel.canonicalRoot, domain.tablesRoot);
    const domainHasFiles = files.some((entry) => entry.startsWith(`${domainRoot}/`));
    const normativeHasFiles = files.some((entry) => entry.startsWith(`${normativeRoot}/`));
    const tablesHasFiles = files.some((entry) => entry.startsWith(`${tablesRoot}/`));

    if (!domainHasFiles) {
      errors.push(`declared domain root has no files: ${domainRoot}`);
    }
    if (!normativeHasFiles) {
      errors.push(`declared normative root has no files: ${normativeRoot}`);
    }
    if (!tablesHasFiles) {
      errors.push(`declared tables root has no files: ${tablesRoot}`);
    }
  }

  const classification = classifySpecTreeFiles(specTreeModel.canonicalRoot, files, specTreeModel);
  if (classification.unexpected.length > 0) {
    errors.push(`unexpected files outside declared spec classes: ${classification.unexpected.join(", ")}`);
  }
  if (classification.conflicts.length > 0) {
    errors.push(
      `files matched multiple spec classes: ${classification.conflicts.map((entry) => `${entry.path} -> ${entry.classes.join("|")}`).join(", ")}`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    refusal: errors.length === 0
      ? null
      : makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.SPEC_TREE_INVALID,
        `spec tree is invalid: ${path.basename(targetRoot)}`,
      ),
    summary: {
      profile: specTreeModel.profile,
      canonicalRoot: specTreeModel.canonicalRoot,
      totalFiles: files.length,
      requiredFiles: requiredFiles.length,
      missingRequired,
      classifiedFiles: classification.classifications.length,
      unexpectedFiles: classification.unexpected,
      conflictingFiles: classification.conflicts,
    },
  };
}

export async function validateSpecAudit(auditPath, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const specTreeModel = await loadSpecTreeModelContract(projectRoot);
  const specGenerationInputs = await loadSpecGenerationInputsConfig(projectRoot);
  const blueprintReference = await loadBlueprintReference(projectRoot);
  const auditContract = await loadSpecGenerationAuditContract(projectRoot);
  const usesV2SurfaceModel = isV2SpecGenerationInputs(specGenerationInputs);
  const errors = [];
  const warnings = [];

  if (!specTreeModel.ok && !usesV2SurfaceModel) {
    return {
      ok: false,
      errors: [`invalid spec tree model contract: ${specTreeModel.path}`],
      warnings,
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.SPEC_AUDIT_INVALID,
        "spec audit validation requires a valid spec-tree-model contract",
      ),
    };
  }

  if (!specGenerationInputs.ok) {
    return {
      ok: false,
      errors: [`invalid spec generation inputs config: ${specGenerationInputs.path}`],
      warnings,
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.SPEC_AUDIT_INVALID,
        "spec audit validation requires a valid spec-generation-inputs config",
      ),
    };
  }

  if (!auditContract.ok) {
    return {
      ok: false,
      errors: [`invalid spec generation audit contract: ${auditContract.path}`],
      warnings,
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.SPEC_AUDIT_INVALID,
        "spec audit validation requires a valid spec-generation-audit contract",
      ),
    };
  }

  const absoluteAuditPath = path.resolve(auditPath);
  const auditText = await readTextIfFile(absoluteAuditPath);
  if (auditText === null) {
    return {
      ok: false,
      errors: [`missing file: ${absoluteAuditPath}`],
      warnings,
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.SPEC_AUDIT_MISSING,
        "spec generation audit artifact is missing",
      ),
    };
  }

  const parsed = parseYamlText(auditText);
  const audit = parsed?.spec_generation_audit;
  if (!isPlainObject(parsed) || !isPlainObject(audit)) {
    return {
      ok: false,
      errors: [`invalid YAML document: ${absoluteAuditPath}`],
      warnings,
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.SPEC_AUDIT_INVALID,
        "spec generation audit artifact is not valid YAML",
      ),
    };
  }

  if (![1, 2].includes(parsed.version)) {
    errors.push("spec generation audit version must be 1 or 2");
  }

  if (String(parsed.contract_ref ?? "") !== SPEC_GENERATION_AUDIT_CONTRACT_REF) {
    errors.push(`spec generation audit contract_ref must be ${SPEC_GENERATION_AUDIT_CONTRACT_REF}`);
  }

  const missingTopLevelFields = auditContract.requiredTopLevelFields.filter((field) => !(field in audit));
  if (missingTopLevelFields.length > 0) {
    errors.push(`spec generation audit is missing required fields: ${missingTopLevelFields.join(", ")}`);
  }

  const declaredInputs = {
    code_roots: Array.isArray(audit?.input_roots?.code_roots) ? audit.input_roots.code_roots.map(String) : [],
    docs_roots: Array.isArray(audit?.input_roots?.docs_roots) ? audit.input_roots.docs_roots.map(String) : [],
    structure_roots: Array.isArray(audit?.input_roots?.structure_roots) ? audit.input_roots.structure_roots.map(String) : [],
    human_note_paths: Array.isArray(audit?.input_roots?.human_note_paths) ? audit.input_roots.human_note_paths.map(String) : [],
    benchmark_blueprint_root: audit?.input_roots?.benchmark_blueprint_root === null
      ? null
      : typeof audit?.input_roots?.benchmark_blueprint_root === "string"
        ? audit.input_roots.benchmark_blueprint_root
        : null,
  };

  if (usesV2SurfaceModel) {
    if (!["mixed", "class_filtered"].includes(String(audit.generation_mode ?? ""))) {
      errors.push("spec generation audit generation_mode must be `mixed` or `class_filtered`");
    }
  } else if (String(audit.generation_mode ?? "") !== "mixed") {
    errors.push("spec generation audit generation_mode must be `mixed`");
  }

  const canonicalRoot = specTreeModel.ok ? specTreeModel.canonicalRoot : specGenerationInputs.canonicalTargetRoot ?? ".nimi/spec";
  const declaredProfile = specTreeModel.ok ? specTreeModel.profile : "surface_taxonomy_v1";
  if (String(audit.canonical_target_root ?? "") !== canonicalRoot) {
    errors.push(`spec generation audit canonical_target_root must be ${canonicalRoot}`);
  }
  if (String(audit.declared_profile ?? "") !== declaredProfile) {
    errors.push(`spec generation audit declared_profile must be ${declaredProfile}`);
  }
  if (!isDeclaredInputsCompatibleWithConfig(declaredInputs, specGenerationInputs, blueprintReference)) {
    errors.push("spec generation audit input_roots must stay within the declared generation inputs and optional benchmark root");
  }

  const canonicalRootPath = path.resolve(projectRoot, canonicalRoot);
  const treeFiles = await collectTreeFiles(canonicalRootPath);
  if (treeFiles.length === 0) {
    return {
      ok: false,
      errors: [`missing spec tree root: ${canonicalRootPath}`],
      warnings,
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.SPEC_AUDIT_INVALID,
        "spec generation audit requires a present canonical spec tree",
      ),
    };
  }

  const { auditedFiles, classifications } = specTreeModel.ok
    ? classifyAuditCoveredFiles(treeFiles, specTreeModel)
    : {
      auditedFiles: treeFiles
        .filter((entry) => !entry.startsWith("_meta/"))
        .map((entry) => ({ path: entry, category: "surface_taxonomy_v1" })),
      classifications: { unexpected: [], conflicts: [] },
    };
  if (classifications.unexpected.length > 0) {
    errors.push(`spec tree contains unexpected files outside declared spec classes: ${classifications.unexpected.join(", ")}`);
  }
  if (classifications.conflicts.length > 0) {
    errors.push(`spec tree contains files matched to multiple classes: ${classifications.conflicts.map((entry) => `${entry.path} -> ${entry.classes.join("|")}`).join(", ")}`);
  }

  const fileEntries = Array.isArray(audit.files) ? audit.files : [];
  if (!Array.isArray(audit.files)) {
    errors.push("spec generation audit files must be an array");
  }
  const fileEntryRefs = audit.file_entry_refs === undefined
    ? []
    : Array.isArray(audit.file_entry_refs)
      ? audit.file_entry_refs.map(String)
      : null;
  if (fileEntryRefs === null) {
    errors.push("spec generation audit file_entry_refs must be an array when present");
  }

  const referencedFileEntries = [];
  for (const entryRef of fileEntryRefs ?? []) {
    if (entryRef.length === 0 || path.isAbsolute(entryRef)) {
      errors.push(`spec generation audit file_entry_refs must be non-empty repository-relative paths: ${entryRef}`);
      continue;
    }
    const absoluteEntryRef = path.resolve(projectRoot, entryRef);
    const relativeEntryRef = path.relative(projectRoot, absoluteEntryRef).split(path.sep).join(path.posix.sep);
    const expectedPrefix = usesV2SurfaceModel
      ? ".nimi/local/state/spec-generation/spec-generation-audit/"
      : `${specTreeModel.canonicalRoot}/_meta/spec-generation-audit/`;
    if (relativeEntryRef !== entryRef || !relativeEntryRef.startsWith(expectedPrefix)) {
      errors.push(`spec generation audit file_entry_ref must stay under ${expectedPrefix}: ${entryRef}`);
      continue;
    }
    const entryText = await readTextIfFile(absoluteEntryRef);
    if (entryText === null) {
      errors.push(`spec generation audit file_entry_ref is missing: ${entryRef}`);
      continue;
    }
    const entryParsed = parseYamlText(entryText);
    const entryPayload = entryParsed?.spec_generation_audit_file_entries;
    if (!isPlainObject(entryParsed) || !isPlainObject(entryPayload)) {
      errors.push(`spec generation audit file_entry_ref is not a valid entry shard: ${entryRef}`);
      continue;
    }
    const expectedShardVersion = usesV2SurfaceModel ? 2 : 1;
    if (entryParsed.version !== expectedShardVersion) {
      errors.push(`spec generation audit file_entry_ref version must be ${expectedShardVersion}: ${entryRef}`);
    }
    if (String(entryParsed.contract_ref ?? "") !== SPEC_GENERATION_AUDIT_CONTRACT_REF) {
      errors.push(`spec generation audit file_entry_ref contract_ref must be ${SPEC_GENERATION_AUDIT_CONTRACT_REF}: ${entryRef}`);
    }
    if (String(entryPayload.parent_ref ?? "") !== toPortableProjectPath(projectRoot, absoluteAuditPath)) {
      errors.push(`spec generation audit file_entry_ref parent_ref must point to ${toPortableProjectPath(projectRoot, absoluteAuditPath)}: ${entryRef}`);
    }
    if (!Array.isArray(entryPayload.files)) {
      errors.push(`spec generation audit file_entry_ref files must be an array: ${entryRef}`);
      continue;
    }
    referencedFileEntries.push(...entryPayload.files);
  }
  const allFileEntries = [...fileEntries, ...referencedFileEntries];

  const auditEntryByRelativePath = new Map();
  for (const entry of allFileEntries) {
    if (!isPlainObject(entry)) {
      errors.push("spec generation audit file entries must be mappings");
      continue;
    }

    const requiredEntryFields = auditContract.requiredFileEntryFields?.length > 0
      ? auditContract.requiredFileEntryFields
      : SPEC_GENERATION_AUDIT_FILE_REQUIRED_FIELDS;
    const missingEntryFields = requiredEntryFields.filter((field) => !(field in entry));
    if (missingEntryFields.length > 0) {
      errors.push(`spec generation audit file entry is missing required fields: ${missingEntryFields.join(", ")}`);
      continue;
    }

    const canonicalPath = String(entry.canonical_path ?? "");
    if (!canonicalPath.startsWith(`${canonicalRoot}/`) && canonicalPath !== `${canonicalRoot}/INDEX.md`) {
      errors.push(`spec generation audit canonical_path must stay under ${canonicalRoot}: ${canonicalPath}`);
      continue;
    }

    const relativePath = path.posix.relative(canonicalRoot, canonicalPath);
    if (relativePath.startsWith("_meta/")) {
      errors.push(`spec generation audit must not record _meta files as generated canonical files: ${canonicalPath}`);
      continue;
    }

    if (auditEntryByRelativePath.has(relativePath)) {
      errors.push(`duplicate spec generation audit entry for canonical path: ${canonicalPath}`);
      continue;
    }

    if (!Array.isArray(entry.source_refs) || entry.source_refs.length === 0 || entry.source_refs.some((ref) => typeof ref !== "string" || ref.length === 0)) {
      errors.push(`spec generation audit source_refs must be a non-empty array for ${canonicalPath}`);
    } else {
      const invalidRefs = entry.source_refs.filter((ref) => !isSourceRefWithinDeclaredRoots(ref, declaredInputs));
      if (invalidRefs.length > 0) {
        errors.push(`spec generation audit source_refs escape declared inputs for ${canonicalPath}: ${invalidRefs.join(", ")}`);
      }
    }

    if (!SPEC_GENERATION_AUDIT_SOURCE_BASIS_ENUM.includes(String(entry.source_basis ?? ""))) {
      errors.push(`spec generation audit source_basis is invalid for ${canonicalPath}`);
    }

    if (!SPEC_GENERATION_AUDIT_COVERAGE_STATUS_ENUM.includes(String(entry.coverage_status ?? ""))) {
      errors.push(`spec generation audit coverage_status is invalid for ${canonicalPath}`);
    }

    if (!Array.isArray(entry.unresolved_items) || entry.unresolved_items.some((item) => typeof item !== "string")) {
      errors.push(`spec generation audit unresolved_items must be an array of strings for ${canonicalPath}`);
    }

    if (entry.notes !== undefined && (!Array.isArray(entry.notes) || entry.notes.some((item) => typeof item !== "string"))) {
      errors.push(`spec generation audit notes must be an array of strings for ${canonicalPath}`);
    }

    const requiresExplicitUnresolved = entry.source_basis !== "grounded" || entry.coverage_status !== "complete";
    if (requiresExplicitUnresolved && (!Array.isArray(entry.unresolved_items) || entry.unresolved_items.length === 0)) {
      errors.push(`spec generation audit inferred or partial files must declare unresolved_items for ${canonicalPath}`);
    }

    auditEntryByRelativePath.set(relativePath, {
      ...entry,
      relativePath,
    });
  }

  const missingAuditEntries = [];
  const requiredFileRefs = specTreeModel.ok
    ? (specTreeModel.requiredFilesByProfile[specTreeModel.profile] ?? [])
    : await loadV2RequiredFiles(projectRoot);
  const requiredFiles = requiredFileRefs
    .map((entry) => path.posix.relative(canonicalRoot, entry))
    .filter((entry) => !entry.startsWith("_meta/"));

  for (const classifiedFile of auditedFiles) {
    const auditEntry = auditEntryByRelativePath.get(classifiedFile.path);
    if (!auditEntry) {
      missingAuditEntries.push(classifiedFile.path);
      continue;
    }

    const auditFileClass = normalizeAuditFileClass(auditEntry);
    if (classifiedFile.classId && auditFileClass !== classifiedFile.classId && !(classifiedFile.path === "INDEX.md" && auditFileClass === "index")) {
      errors.push(`spec generation audit file_class does not match canonical tree classification for ${classifiedFile.path}: expected ${classifiedFile.classId}`);
    }
  }

  if (missingAuditEntries.length > 0) {
    errors.push(`spec generation audit is missing file entries for canonical files: ${missingAuditEntries.join(", ")}`);
  }

  for (const requiredFile of requiredFiles) {
    const auditEntry = auditEntryByRelativePath.get(requiredFile);
    if (!auditEntry) {
      errors.push(`required canonical file is missing an audit entry: ${requiredFile}`);
      continue;
    }
    if (auditEntry.coverage_status === "placeholder_not_allowed") {
      errors.push(`required canonical file must not be placeholder_not_allowed: ${requiredFile}`);
    }
  }

  for (const [relativePath] of auditEntryByRelativePath) {
    if (!auditedFiles.some((entry) => entry.path === relativePath)) {
      errors.push(`spec generation audit entry points to a non-existent canonical file: ${relativePath}`);
    }
  }

  const unresolvedCount = Array.from(auditEntryByRelativePath.values())
    .filter((entry) => Array.isArray(entry.unresolved_items) && entry.unresolved_items.length > 0)
    .length;
  const inferredCount = Array.from(auditEntryByRelativePath.values())
    .filter((entry) => entry.source_basis === "inferred" || entry.source_basis === "mixed_grounded_and_inferred")
    .length;
  const partialCount = Array.from(auditEntryByRelativePath.values())
    .filter((entry) => entry.coverage_status === "partial")
    .length;
  const placeholderCount = Array.from(auditEntryByRelativePath.values())
    .filter((entry) => entry.coverage_status === "placeholder_not_allowed")
    .length;
  const completeCount = Array.from(auditEntryByRelativePath.values())
    .filter((entry) => entry.coverage_status === "complete")
    .length;

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    refusal: errors.length === 0
      ? null
      : makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.SPEC_AUDIT_INVALID,
        `spec generation audit is invalid: ${path.basename(absoluteAuditPath)}`,
      ),
    summary: {
      canonicalRoot,
      declaredProfile,
      auditedFiles: auditEntryByRelativePath.size,
      requiredAuditedFiles: requiredFiles.length,
      missingAuditEntries,
      completeFiles: completeCount,
      partialFiles: partialCount,
      placeholderFiles: placeholderCount,
      unresolvedFiles: unresolvedCount,
      inferredFiles: inferredCount,
    },
  };
}
