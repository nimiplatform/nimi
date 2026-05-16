import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import { pathExists } from "../fs-helpers.mjs";
import { parseYamlText } from "../yaml-helpers.mjs";
import { isPlainObject } from "../value-helpers.mjs";

const SURFACE_RESULT_CONTRACT = "nimicoding.surface-validator-result.v1";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const CONTRACT_REFS = {
  sharedEnums: "contracts/shared-enums.yaml",
  surfaceTaxonomy: "contracts/surface-taxonomy.schema.yaml",
  placement: "contracts/placement-contract.schema.yaml",
  projectionEdge: "contracts/projection-edge.schema.yaml",
  tableFamily: "contracts/table-family.schema.yaml",
  domainAdmission: "contracts/domain-admission.schema.yaml",
  trackedOutputAdmission: "contracts/tracked-output-admission.schema.yaml",
  highRiskAdmission: "contracts/high-risk-admission.schema.yaml",
  negativeFixtures: "contracts/negative-fixtures.yaml",
};

const TEXT_RULE_BODY_PATTERN = /\bMUST(?:\s+NOT)?\b|\bmust\s+not\b|必须|不得|fail(?:s|ed)?\s+closed/i;
const PRODUCT_RULE_ID_PATTERN = /\b[A-Z][A-Z0-9]*-[A-Z0-9]+-[A-Z0-9-]+\b/;
const GENERATED_REF_PATTERN = /\.nimi\/spec\/[^)\s]+\/kernel\/generated\/|\.nimi\/spec\/generated\/|kernel\/generated\//;

function toPosix(value) {
  return value.split(path.sep).join(path.posix.sep);
}

function relativeRef(projectRoot, absolutePath) {
  return toPosix(path.relative(projectRoot, absolutePath));
}

async function readYamlAt(relativePath) {
  const absolutePath = path.join(PACKAGE_ROOT, relativePath);
  const text = await readFile(absolutePath, "utf8");
  return {
    path: path.relative(PACKAGE_ROOT, absolutePath),
    text,
    data: parseYamlText(text),
  };
}

async function loadSurfaceContracts() {
  const entries = await Promise.all(Object.entries(CONTRACT_REFS).map(async ([key, ref]) => [key, await readYamlAt(ref)]));
  return Object.fromEntries(entries);
}

async function collectFilesUnder(rootPath) {
  const exists = await pathExists(rootPath);
  if (!exists || !exists.isDirectory()) {
    return [];
  }

  async function walk(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const childPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walk(childPath));
      } else if (entry.isFile()) {
        files.push(childPath);
      }
    }
    return files.sort();
  }

  return walk(rootPath);
}

async function collectCandidateFiles(projectRoot, rootRef = ".nimi/spec") {
  const roots = [
    rootRef,
    ".nimi/contracts",
    ".nimi/methodology",
    ".nimi/config",
    ".nimi/derived",
    ".nimi/state",
    ".nimi/audit",
    ".nimi/roadmap",
  ];
  const uniqueRoots = [...new Set(roots)];
  const files = [];
  for (const root of uniqueRoots) {
    files.push(...await collectFilesUnder(path.resolve(projectRoot, root)));
  }
  return [...new Set(files)].sort();
}

function pathMatchesGlob(candidate, pattern) {
  const tokens = [];
  let source = pattern
    .replaceAll("{spec,methodology,contracts,config}", "__BRACE_PACKAGE_ROOTS__")
    .replaceAll("{config,contracts,methodology,spec}", "__BRACE_PACKAGE_ROOTS__")
    .replaceAll("<domain>", "__DOMAIN__")
    .replaceAll("**", "__DOUBLE_STAR__")
    .replaceAll("*", "__STAR__");

  source = source.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  source = source
    .replaceAll("__BRACE_PACKAGE_ROOTS__", "(?:spec|methodology|contracts|config)")
    .replaceAll("__DOMAIN__", "[^/]+")
    .replaceAll("__DOUBLE_STAR__", ".*")
    .replaceAll("__STAR__", "[^/]*");
  tokens.push(new RegExp(`^${source}$`));
  return tokens.some((regex) => regex.test(candidate));
}

function basenameNoExt(ref) {
  return path.posix.basename(ref).replace(/\.(yaml|yml|md)$/i, "");
}

function firstPathSegment(ref) {
  return ref.split("/")[0] ?? "";
}

function domainForSpecRef(ref) {
  const parts = ref.split("/");
  if (parts[0] !== ".nimi" || parts[1] !== "spec" || parts.length < 4) {
    return null;
  }
  if (parts[2] === "_meta" || parts[2] === "generated") {
    return null;
  }
  return parts[2] ?? null;
}

function walkObjectKeys(value, callback) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      walkObjectKeys(entry, callback);
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    callback(String(key), entry);
    walkObjectKeys(entry, callback);
  }
}

function containsAnyKey(value, keys) {
  const wanted = new Set(keys);
  let found = false;
  walkObjectKeys(value, (key) => {
    if (wanted.has(key)) {
      found = true;
    }
  });
  return found;
}

function yamlForText(text) {
  return parseYamlText(text);
}

function isYamlRef(ref) {
  return /\.(yaml|yml)$/i.test(ref);
}

function isMarkdownRef(ref) {
  return /\.md$/i.test(ref);
}

function tableFamilyContractMap(contracts) {
  const families = Array.isArray(contracts.tableFamily.data?.table_families)
    ? contracts.tableFamily.data.table_families
    : [];
  return new Map(families.map((entry) => [String(entry.table_family), entry]));
}

function domainAdmissionMap(contracts) {
  const admissions = Array.isArray(contracts.domainAdmission.data?.domain_admissions)
    ? contracts.domainAdmission.data.domain_admissions
    : [];
  return new Map(admissions.map((entry) => [String(entry.domain_id), entry]));
}

function trackedAdmissionRoots(contracts) {
  const admissions = Array.isArray(contracts.trackedOutputAdmission.data?.admissions)
    ? contracts.trackedOutputAdmission.data.admissions
    : [];
  return admissions.map((entry) => String(entry.root)).filter(Boolean);
}

function isTrackedNonProductRef(ref) {
  return ref.startsWith(".nimi/derived/")
    || ref.startsWith(".nimi/state/")
    || ref.startsWith(".nimi/audit/")
    || ref.startsWith(".nimi/roadmap/");
}

function isAdmittedTrackedOutput(ref, admittedRoots) {
  return admittedRoots.some((root) => pathMatchesGlob(ref, root));
}

function classifyRef(ref, text, parsedYaml) {
  if (ref.startsWith(".nimi/spec/future/")) {
    return "candidate_roadmap";
  }
  if (ref.startsWith(".nimi/spec/generated/") || ref.includes("/kernel/generated/")) {
    return "derived_view";
  }
  if (ref === ".nimi/spec/_meta/spec-generation-audit.yaml" || ref.startsWith(".nimi/spec/_meta/spec-generation-audit/")) {
    return "spec_generation_state";
  }
  if (ref.startsWith(".nimi/spec/_meta/")) {
    if (ref.endsWith("-admission-anchor.yaml")) {
      return "host_projection_anchor";
    }
    if (/cutover|checklist|matrix|readiness|migration/i.test(ref)) {
      return "lifecycle_progress_state";
    }
    return "methodology_authority";
  }
  if (ref === ".nimi/spec/bootstrap-state.yaml") {
    return "lifecycle_progress_state";
  }
  if (ref === ".nimi/spec/high-risk-admissions.yaml") {
    return "product_admission_registry";
  }
  if (ref === ".nimi/spec/product-scope.yaml") {
    return "methodology_authority";
  }
  if (ref.startsWith(".nimi/spec/") && ref.includes("/kernel/tables/") && isYamlRef(ref)) {
    if (isPlainObject(parsedYaml) && parsedYaml.table_family === "support_registry") {
      return "support_registry";
    }
    if (isPlainObject(parsedYaml) && typeof parsedYaml.table_family === "string") {
      return "product_authority_table";
    }
    const stateKeys = ["done", "covered", "coverage_status", "audit_date", "evidence_report", "current", "proposed", "backlog_status", "migration_status", "mapping_status", "run_id", "ledger_ref"];
    if (containsAnyKey(parsedYaml, stateKeys) || /rule-evidence|backlog|migration/i.test(basenameNoExt(ref))) {
      return "audit_evidence_state";
    }
    return "product_authority_table";
  }
  if (ref.startsWith(".nimi/spec/") && isYamlRef(ref) && basenameNoExt(ref) === "spec-exempt-modules") {
    return "support_registry";
  }
  if (ref.startsWith(".nimi/spec/") && ref.includes("/kernel/") && isMarkdownRef(ref)) {
    return "product_authority";
  }
  if (ref === ".nimi/spec/INDEX.md" || (ref.startsWith(".nimi/spec/") && isMarkdownRef(ref))) {
    return "thin_guidance";
  }
  if (ref.startsWith(".nimi/local/derived/")) {
    return "derived_view";
  }
  if (ref.startsWith(".nimi/local/state/spec-generation/")) {
    return "spec_generation_state";
  }
  if (ref.startsWith(".nimi/local/audit/")) {
    return "audit_evidence_state";
  }
  if (ref.startsWith(".nimi/local/") || ref.startsWith(".local/")) {
    return "operational_local_artifact";
  }
  if (ref.startsWith(".nimi/topics/")) {
    return "lifecycle_progress_state";
  }
  if (ref.startsWith(".nimi/contracts/") || ref.startsWith(".nimi/methodology/")) {
    return "nimicoding_managed_projection";
  }
  if (ref.startsWith(".nimi/config/")) {
    return ref === ".nimi/config/host-overlay.yaml" ? "host_projection_anchor" : "nimicoding_managed_projection";
  }
  if (ref.startsWith("nimi-coding/")) {
    return "methodology_authority";
  }
  if (isTrackedNonProductRef(ref)) {
    if (ref.startsWith(".nimi/derived/")) return "derived_view";
    if (ref.startsWith(".nimi/state/")) return "spec_generation_state";
    if (ref.startsWith(".nimi/audit/")) return "audit_evidence_state";
    return "candidate_roadmap";
  }
  return "unclassified";
}

function dispositionFor(ref, surfaceClass, errors) {
  if (errors.length > 0 && surfaceClass === "unclassified") {
    return "block";
  }
  if (surfaceClass === "methodology_authority") {
    return "move_package";
  }
  if (surfaceClass === "nimicoding_managed_projection") {
    return "keep";
  }
  if (surfaceClass === "derived_view") {
    return "delete";
  }
  if (["spec_generation_state", "audit_evidence_state", "candidate_roadmap", "lifecycle_progress_state", "operational_local_artifact"].includes(surfaceClass)) {
    return "move_local";
  }
  if (errors.length > 0) {
    return "block";
  }
  return "keep";
}

function targetRootFor(surfaceClass, ref) {
  if (surfaceClass === "methodology_authority") {
    return "nimi-coding";
  }
  if (surfaceClass === "nimicoding_managed_projection") {
    return ".nimi";
  }
  if (surfaceClass === "derived_view") {
    return "stdout_view";
  }
  if (surfaceClass === "spec_generation_state" || surfaceClass === "lifecycle_progress_state" || surfaceClass === "operational_local_artifact") {
    return ".nimi/local/state";
  }
  if (surfaceClass === "audit_evidence_state") {
    return ".nimi/local/audit";
  }
  if (surfaceClass === "candidate_roadmap") {
    return ".nimi/topics";
  }
  if (surfaceClass === "unclassified") {
    return null;
  }
  if (ref.startsWith(".nimi/spec/")) {
    return ".nimi/spec";
  }
  return firstPathSegment(ref);
}

function ownerFor(surfaceClass, ref) {
  if (surfaceClass === "methodology_authority" || surfaceClass === "nimicoding_managed_projection") {
    return "nimi-coding";
  }
  if (surfaceClass === "derived_view") {
    return "generator";
  }
  if (surfaceClass === "spec_generation_state") {
    return "spec_generator";
  }
  if (surfaceClass === "audit_evidence_state") {
    return "audit_workflow";
  }
  if (surfaceClass === "candidate_roadmap") {
    return "planning_owner";
  }
  if (surfaceClass === "lifecycle_progress_state") {
    return "topic_or_execution_workflow";
  }
  return domainForSpecRef(ref) ?? "product_domain";
}

function confirmationFor(errors) {
  if (errors.some((error) => error.includes("unadmitted_domain_retained_as_spec_input"))) {
    return "product_semantic_fork";
  }
  if (errors.some((error) => error.includes("missing_domain_admission"))) {
    return "owner_ambiguity";
  }
  if (errors.some((error) => error.includes("package_methodology_under_host_spec") || error.includes("package_body_promoted_to_product_authority"))) {
    return "package_boundary_ambiguity";
  }
  return "none";
}

function ambiguityFor(requiredConfirmation, surfaceClass) {
  if (requiredConfirmation === "none") {
    return {
      posture: "none",
      reason: null,
      candidate_owners: [],
    };
  }
  return {
    posture: "blocks_migration",
    reason: requiredConfirmation,
    candidate_owners: surfaceClass === "unclassified" ? [] : [ownerFor(surfaceClass, "")],
  };
}

function validationCommandsFor(entryClass) {
  const commands = {
    product_admission_registry: ["pnpm exec nimicoding validate-placement --profile nimi --root .nimi/spec"],
    product_authority_table: ["pnpm exec nimicoding validate-table-family --profile nimi --root .nimi/spec"],
    support_registry: ["pnpm exec nimicoding validate-table-family --profile nimi --root .nimi/spec"],
    thin_guidance: ["pnpm exec nimicoding validate-guidance-bodies --profile nimi --root .nimi/spec"],
    host_projection_anchor: ["pnpm exec nimicoding validate-projection-edges --profile nimi --root .nimi/spec"],
    nimicoding_managed_projection: ["pnpm exec nimicoding validate-placement --profile nimi --root .nimi/spec"],
    candidate_roadmap: ["pnpm exec nimicoding validate-domain-admission --profile nimi --root .nimi/spec"],
  };
  return commands[entryClass] ?? ["pnpm exec nimicoding validate-placement --profile nimi --root .nimi/spec"];
}

function addError(errors, code, ref, detail) {
  errors.push(detail ? `${code}: ${ref}: ${detail}` : `${code}: ${ref}`);
}

function validateRefPlacement(ref, surfaceClass, parsedYaml, text, contracts) {
  const errors = [];

  if (surfaceClass === "unclassified") {
    addError(errors, "unclassified_file", ref);
  }
  if (surfaceClass === "derived_view" && ref.startsWith(".nimi/spec/")) {
    addError(errors, "derived_view_under_product_authority_root", ref);
  }
  if (surfaceClass === "derived_view" && ref.startsWith(".nimi/local/derived/")) {
    addError(errors, "derived_view_written_to_local_derived", ref);
  }
  if (surfaceClass === "spec_generation_state" && ref.startsWith(".nimi/spec/")) {
    addError(errors, "spec_generation_state_under_spec", ref);
  }
  if (surfaceClass === "audit_evidence_state" && ref.startsWith(".nimi/spec/")) {
    addError(errors, "audit_evidence_state_under_spec", ref);
  }
  if (surfaceClass === "lifecycle_progress_state" && ref.startsWith(".nimi/spec/")) {
    addError(errors, "lifecycle_progress_state_under_spec", ref);
  }
  if (surfaceClass === "methodology_authority" && ref.startsWith(".nimi/spec/")) {
    addError(errors, "package_methodology_under_host_spec", ref);
  }
  if (surfaceClass === "candidate_roadmap" && ref.startsWith(".nimi/spec/")) {
    addError(errors, "candidate_roadmap_under_spec", ref);
  }
  if (isTrackedNonProductRef(ref) && !isAdmittedTrackedOutput(ref, trackedAdmissionRoots(contracts))) {
    addError(errors, "tracked_non_product_without_admission", ref);
  }
  if (surfaceClass === "thin_guidance" && isMarkdownRef(ref)) {
    if (TEXT_RULE_BODY_PATTERN.test(text)) {
      addError(errors, "guidance_defines_rule_body", ref);
    }
    if (PRODUCT_RULE_ID_PATTERN.test(text) && !ref.endsWith("INDEX.md")) {
      addError(errors, "guidance_defines_or_restates_rule_id", ref);
    }
  }
  if (surfaceClass === "product_authority" && isMarkdownRef(ref) && GENERATED_REF_PATTERN.test(text)) {
    addError(errors, "derived_view_referenced_as_authority", ref);
  }
  if (surfaceClass === "product_admission_registry") {
    errors.push(...validateProductAdmissionRegistryRef(ref, parsedYaml, text, contracts));
  }

  return errors;
}

function validateProductAdmissionRegistryRef(ref, parsedYaml, text, contracts) {
  const errors = [];
  if (ref !== ".nimi/spec/high-risk-admissions.yaml") {
    addError(errors, "product_admission_registry_outside_allowed_root", ref);
    return errors;
  }
  if (!isPlainObject(parsedYaml)) {
    addError(errors, "product_admission_registry_invalid_yaml", ref);
    return errors;
  }
  const requiredKeys = Array.isArray(contracts.highRiskAdmission.data?.top_level_required_keys)
    ? contracts.highRiskAdmission.data.top_level_required_keys
    : [];
  for (const key of requiredKeys) {
    if (!(key in parsedYaml)) {
      addError(errors, "product_admission_registry_missing_required_key", ref, key);
    }
  }
  if (/package_name:\s*"?@nimiplatform\/nimi-coding"?|spec_tree_model:|canonical_spec_root:/i.test(text)) {
    addError(errors, "product_admission_registry_contains_package_methodology_body", ref);
  }
  return errors;
}

function validateTableRef(ref, parsedYaml, contracts) {
  const errors = [];
  if (!ref.startsWith(".nimi/spec/") || !ref.includes("/kernel/tables/") || !isYamlRef(ref)) {
    return errors;
  }

  if (!isPlainObject(parsedYaml)) {
    addError(errors, "invalid_yaml_table", ref);
    return errors;
  }

  const family = typeof parsedYaml.table_family === "string" ? parsedYaml.table_family : null;
  const familyMap = tableFamilyContractMap(contracts);
  if (!family) {
    addError(errors, "missing_table_family", ref);
  } else if (!familyMap.has(family)) {
    addError(errors, "unknown_table_family", ref, family);
  } else {
    const familyContract = familyMap.get(family);
    for (const field of familyContract.required_fields ?? []) {
      if (!(field in parsedYaml)) {
        addError(errors, "missing_table_family_required_field", ref, String(field));
      }
    }
  }

  const forbiddenFields = contracts.tableFamily.data?.forbidden_fields_by_authority_class?.product_authority_table ?? [];
  if (containsAnyKey(parsedYaml, forbiddenFields)) {
    addError(errors, "table_contains_forbidden_state_or_audit_field", ref);
  }

  return errors;
}

function validateDomainRef(ref, contracts) {
  const errors = [];
  const domain = domainForSpecRef(ref);
  if (!domain) {
    return errors;
  }
  const admissions = domainAdmissionMap(contracts);
  const admission = admissions.get(domain);
  if (!admission) {
    addError(errors, "missing_domain_admission", ref, domain);
    return errors;
  }
  if (admission.authority_class === "excluded_from_spec") {
    addError(errors, "excluded_domain_retained_under_spec", ref, domain);
  }
  if (admission.authority_class === "migration_input_only") {
    addError(errors, "unadmitted_domain_retained_as_spec_input", ref, domain);
  }
  return errors;
}

async function buildInventory(projectRoot, options = {}) {
  const contracts = await loadSurfaceContracts();
  const rootRef = options.rootRef ?? ".nimi/spec";
  const absoluteFiles = await collectCandidateFiles(projectRoot, rootRef);
  const entries = [];
  const errors = [];

  for (const absolutePath of absoluteFiles) {
    const ref = relativeRef(projectRoot, absolutePath);
    const text = await readFile(absolutePath, "utf8");
    const parsedYaml = isYamlRef(ref) ? yamlForText(text) : null;
    const surfaceClass = classifyRef(ref, text, parsedYaml);
    const entryErrors = [
      ...validateRefPlacement(ref, surfaceClass, parsedYaml, text, contracts),
      ...validateTableRef(ref, parsedYaml, contracts),
      ...validateDomainRef(ref, contracts),
    ];
    errors.push(...entryErrors);
    const requiredConfirmation = confirmationFor(entryErrors);
    entries.push({
      source_path: ref,
      current_inferred_class: surfaceClass,
      target_class: surfaceClass,
      disposition: dispositionFor(ref, surfaceClass, entryErrors),
      target_root: targetRootFor(surfaceClass, ref),
      owner: ownerFor(surfaceClass, ref),
      required_confirmation: requiredConfirmation,
      ambiguity: ambiguityFor(requiredConfirmation, surfaceClass),
      evidence: entryErrors.length > 0 ? entryErrors : [`classified_as:${surfaceClass}`],
      validation_commands: validationCommandsFor(surfaceClass),
      errors: entryErrors,
    });
  }

  return {
    contracts,
    entries,
    errors,
  };
}

function summarize(entries) {
  const byClass = {};
  const byDisposition = {};
  for (const entry of entries) {
    byClass[entry.current_inferred_class] = (byClass[entry.current_inferred_class] ?? 0) + 1;
    byDisposition[entry.disposition] = (byDisposition[entry.disposition] ?? 0) + 1;
  }
  return {
    total_files: entries.length,
    by_surface_class: byClass,
    by_disposition: byDisposition,
    blocking_entries: entries.filter((entry) => entry.disposition === "block").length,
  };
}

function reportFor(validator, ok, errors, warnings, entries, extra = {}) {
  return {
    contract: SURFACE_RESULT_CONTRACT,
    validator,
    ok,
    errors,
    warnings,
    summary: summarize(entries),
    ...extra,
  };
}

function countBy(entries, field) {
  const counts = {};
  for (const entry of entries) {
    const value = String(entry[field] ?? "unknown");
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function groupInventoryByDisposition(entries) {
  const groups = {};
  for (const entry of entries) {
    const disposition = String(entry.disposition);
    const group = groups[disposition] ?? [];
    group.push(entry.source_path);
    groups[disposition] = group;
  }
  return Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, value.sort()]));
}

function buildMigrationExecutionPackets(entries) {
  const packetKinds = [
    {
      packet_id: "move-package-methodology-copied-under-spec",
      dispositions: ["move_package"],
      requires_confirmation: false,
    },
    {
      packet_id: "move-local-derived-audit-state-and-lifecycle",
      dispositions: ["move_local"],
      requires_confirmation: false,
    },
    {
      packet_id: "rewrite-product-authority-tables-and-guidance",
      dispositions: ["rewrite"],
      requires_confirmation: true,
    },
    {
      packet_id: "resolve-blocked-semantic-forks",
      dispositions: ["block"],
      requires_confirmation: true,
    },
  ];
  return packetKinds
    .map((packet) => {
      const matching = entries.filter((entry) => packet.dispositions.includes(entry.disposition));
      return {
        ...packet,
        entry_count: matching.length,
        source_paths: matching.map((entry) => entry.source_path).sort(),
      };
    })
    .filter((packet) => packet.entry_count > 0);
}

function enumValidation(entries, inventory) {
  const targetClasses = new Set(inventory.target_class_enum);
  const dispositions = new Set(inventory.disposition_enum);
  return {
    unknown_target_classes: entries
      .filter((entry) => !targetClasses.has(entry.target_class))
      .map((entry) => entry.source_path),
    unknown_dispositions: entries
      .filter((entry) => !dispositions.has(entry.disposition))
      .map((entry) => entry.source_path),
  };
}

function migrationPlanForInventory(rootRef, inventory) {
  const entries = inventory.inventory;
  const enumStatus = enumValidation(entries, inventory);
  const requiredConfirmationEntries = entries.filter((entry) => entry.required_confirmation !== "none");
  return {
    contract: "nimicoding.spec-migration-plan.v1",
    ok: enumStatus.unknown_target_classes.length === 0 && enumStatus.unknown_dispositions.length === 0,
    version: inventory.version,
    root: rootRef,
    inventory: entries,
    disposition_enum: inventory.disposition_enum,
    target_class_enum: inventory.target_class_enum,
    semantic_constraints: [
      ...inventory.semantic_constraints,
      "migration_plan_must_not_modify_files",
      "required_confirmation_entries_must_be_preserved",
      "local_only_plan_artifact_required",
    ],
    summary: {
      total_files: entries.length,
      by_surface_class: countBy(entries, "current_inferred_class"),
      by_disposition: countBy(entries, "disposition"),
      by_required_confirmation: countBy(entries, "required_confirmation"),
      required_confirmation_count: requiredConfirmationEntries.length,
      blocking_entries: entries.filter((entry) => entry.disposition === "block").length,
    },
    enum_validation: enumStatus,
    required_confirmations: requiredConfirmationEntries.map((entry) => ({
      source_path: entry.source_path,
      required_confirmation: entry.required_confirmation,
      ambiguity: entry.ambiguity,
      evidence: entry.evidence,
      recommendation: entry.required_confirmation === "product_semantic_fork"
        ? "stop_for_user_decision_before_migration"
        : "resolve_owner_or_package_boundary_before_migration",
    })),
    groups: groupInventoryByDisposition(entries),
    execution_packets: buildMigrationExecutionPackets(entries),
    mutation_policy: {
      mutates_source_tree: false,
      allowed_output_roots: [".nimi/local/state/spec-surface"],
      forbidden_output_roots: [".nimi/spec", ".nimi/contracts", ".nimi/methodology", ".nimi/config"],
    },
  };
}

export async function classifySpecSurface(projectRoot, options = {}) {
  const { entries, errors } = await buildInventory(projectRoot, options);
  return reportFor("classify-spec-tree", errors.length === 0, errors, [], entries, {
    inventory: {
      version: 1,
      inventory: entries,
      disposition_enum: ["keep", "move_package", "move_local", "split", "rewrite", "delete", "block"],
      target_class_enum: [
        "product_authority",
        "product_authority_table",
        "product_admission_registry",
        "thin_guidance",
        "derived_view",
        "spec_generation_state",
        "audit_evidence_state",
        "operational_local_artifact",
        "methodology_authority",
        "nimicoding_managed_projection",
        "host_projection_anchor",
        "candidate_roadmap",
        "support_registry",
        "lifecycle_progress_state",
      ],
      semantic_constraints: [
        "inventory_must_not_modify_files",
        "future_under_spec_must_not_have_keep_disposition",
        "nimicoding_managed_projection_must_not_be_promoted_to_product_authority",
      ],
    },
  });
}

export async function generateSpecMigrationPlan(projectRoot, options = {}) {
  const classification = await classifySpecSurface(projectRoot, options);
  return migrationPlanForInventory(options.rootRef ?? ".nimi/spec", classification.inventory);
}

export async function buildSpecSurfaceInventory(projectRoot, options = {}) {
  const { entries, errors } = await buildInventory(projectRoot, options);
  return {
    contract: SURFACE_RESULT_CONTRACT,
    entries,
    errors,
    summary: summarize(entries),
  };
}

export function isProductAuthoritySurfaceClass(surfaceClass) {
  return [
    "product_authority",
    "product_authority_table",
    "product_admission_registry",
    "thin_guidance",
    "host_projection_anchor",
    "support_registry",
  ].includes(surfaceClass);
}

export async function validatePlacement(projectRoot, options = {}) {
  const { entries, errors } = await buildInventory(projectRoot, options);
  return reportFor("validate-placement", errors.length === 0, errors, [], entries);
}

export async function validateTableFamily(projectRoot, options = {}) {
  const { contracts, entries } = await buildInventory(projectRoot, options);
  const errors = [];
  for (const entry of entries.filter((item) => item.source_path.startsWith(".nimi/spec/")
    && item.source_path.includes("/kernel/tables/")
    && isYamlRef(item.source_path)
    && ["product_authority_table", "support_registry"].includes(item.current_inferred_class))) {
    const text = await readFile(path.join(projectRoot, entry.source_path), "utf8");
    errors.push(...validateTableRef(entry.source_path, yamlForText(text), contracts));
  }
  return reportFor("validate-table-family", errors.length === 0, errors, [], entries);
}

export async function validateProjectionEdges(projectRoot, options = {}) {
  const { entries, contracts } = await buildInventory(projectRoot, options);
  const errors = [];
  const edgeTargets = new Set((contracts.projectionEdge.data?.projection_edges ?? []).map((entry) => String(entry.target_ref)));
  const anchorRef = ".nimi/spec/_meta/nimi-coding-admission-anchor.yaml";
  const overlayRef = ".nimi/config/host-overlay.yaml";
  if (entries.some((entry) => entry.source_path === anchorRef) && !edgeTargets.has(anchorRef)) {
    addError(errors, "missing_projection_edge_for_anchor", anchorRef);
  }
  if (entries.some((entry) => entry.source_path === overlayRef) && !edgeTargets.has(overlayRef)) {
    addError(errors, "missing_projection_edge_for_overlay", overlayRef);
  }
  for (const entry of entries) {
    if (entry.current_inferred_class === "methodology_authority" && entry.source_path.startsWith(".nimi/spec/")) {
      addError(errors, "package_body_promoted_to_product_authority", entry.source_path);
    }
    if (entry.current_inferred_class === "product_authority") {
      const text = await readFile(path.join(projectRoot, entry.source_path), "utf8");
      if (GENERATED_REF_PATTERN.test(text)) {
        addError(errors, "derived_view_referenced_as_authority", entry.source_path);
      }
    }
  }
  return reportFor("validate-projection-edges", errors.length === 0, errors, [], entries);
}

export async function validateGuidanceBodies(projectRoot, options = {}) {
  const { entries } = await buildInventory(projectRoot, options);
  const errors = [];
  for (const entry of entries.filter((item) => item.current_inferred_class === "thin_guidance")) {
    const text = await readFile(path.join(projectRoot, entry.source_path), "utf8");
    if (TEXT_RULE_BODY_PATTERN.test(text)) {
      addError(errors, "guidance_defines_rule_body", entry.source_path);
    }
    if (PRODUCT_RULE_ID_PATTERN.test(text) && !entry.source_path.endsWith("INDEX.md")) {
      addError(errors, "guidance_defines_or_restates_rule_id", entry.source_path);
    }
  }
  return reportFor("validate-guidance-bodies", errors.length === 0, errors, [], entries);
}

export async function validateDomainAdmission(projectRoot, options = {}) {
  const { contracts, entries } = await buildInventory(projectRoot, options);
  const errors = [];
  for (const entry of entries.filter((item) => item.source_path.startsWith(".nimi/spec/"))) {
    errors.push(...validateDomainRef(entry.source_path, contracts));
  }
  return reportFor("validate-domain-admission", errors.length === 0, errors, [], entries);
}

export async function validateTrackedOutputAdmission(projectRoot, options = {}) {
  const { contracts, entries } = await buildInventory(projectRoot, options);
  const admittedRoots = trackedAdmissionRoots(contracts);
  const errors = [];
  for (const entry of entries.filter((item) => isTrackedNonProductRef(item.source_path))) {
    if (!isAdmittedTrackedOutput(entry.source_path, admittedRoots)) {
      addError(errors, "tracked_non_product_without_admission", entry.source_path);
    }
  }
  return reportFor("validate-tracked-output-admission", errors.length === 0, errors, [], entries);
}

export function parseSurfaceValidatorOptions(args) {
  const options = {
    profile: "default",
    rootRef: ".nimi/spec",
    emit: null,
    check: false,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--profile") {
      options.profile = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--root") {
      options.rootRef = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--emit") {
      options.emit = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--strict") {
      options.strict = true;
    } else {
      return { ok: false, error: `unknown option: ${arg}` };
    }
  }

  if (!options.rootRef) {
    return { ok: false, error: "--root must not be empty" };
  }
  return { ok: true, options };
}

export async function writeInventoryIfRequested(report, emitRef, projectRoot) {
  if (!emitRef) {
    return;
  }
  const absolutePath = path.resolve(projectRoot, emitRef);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report.inventory, null, 2)}\n`, "utf8");
}

export async function writeMigrationPlanIfRequested(report, emitRef, projectRoot) {
  if (!emitRef) {
    return;
  }
  const allowedRoot = path.resolve(projectRoot, ".nimi/local/state/spec-surface");
  const absolutePath = path.resolve(projectRoot, emitRef);
  const relativeToAllowedRoot = path.relative(allowedRoot, absolutePath);
  if (
    relativeToAllowedRoot === "" ||
    relativeToAllowedRoot.startsWith("..") ||
    path.isAbsolute(relativeToAllowedRoot)
  ) {
    throw new Error("--emit must target .nimi/local/state/spec-surface/**");
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
