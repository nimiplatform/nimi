import path from "node:path";
import { readdir } from "node:fs/promises";

import {
  ACCEPTANCE_SCHEMA_REF,
  EXECUTION_PACKET_SCHEMA_REF,
  HIGH_RISK_SCHEMA_SPECS,
  ORCHESTRATION_STATE_SCHEMA_REF,
  PROMPT_SCHEMA_REF,
  SPEC_GENERATION_AUDIT_CONTRACT_REF,
  SPEC_GENERATION_AUDIT_COVERAGE_STATUS_ENUM,
  SPEC_GENERATION_AUDIT_FILE_REQUIRED_FIELDS,
  SPEC_GENERATION_AUDIT_REF,
  SPEC_GENERATION_AUDIT_REQUIRED_TOP_LEVEL_FIELDS,
  SPEC_GENERATION_AUDIT_SOURCE_BASIS_ENUM,
  WORKER_OUTPUT_SCHEMA_REF,
} from "../constants.mjs";
import {
  loadBlueprintReference,
  loadSpecGenerationAuditContract,
  loadSpecGenerationInputsConfig,
  loadSpecTreeModelContract,
} from "./contracts.mjs";
import { readTextIfFile } from "./fs-helpers.mjs";
import { isPlainObject } from "./value-helpers.mjs";
import { parseYamlText } from "./yaml-helpers.mjs";

const VALIDATOR_CLI_RESULT_CONTRACT = "validator-cli-result.v1";

export const VALIDATOR_NATIVE_REFUSAL_CODES = {
  EXECUTION_PACKET_MISSING: "EXECUTION_PACKET_MISSING",
  EXECUTION_PACKET_INVALID: "EXECUTION_PACKET_INVALID",
  ORCHESTRATION_STATE_MISSING: "ORCHESTRATION_STATE_MISSING",
  ORCHESTRATION_STATE_INVALID: "ORCHESTRATION_STATE_INVALID",
  PROMPT_MISSING: "PROMPT_MISSING",
  PROMPT_INVALID: "PROMPT_INVALID",
  WORKER_OUTPUT_MISSING: "WORKER_OUTPUT_MISSING",
  WORKER_OUTPUT_INVALID: "WORKER_OUTPUT_INVALID",
  RUNNER_SIGNAL_MISSING: "RUNNER_SIGNAL_MISSING",
  RUNNER_SIGNAL_INVALID: "RUNNER_SIGNAL_INVALID",
  ACCEPTANCE_MISSING: "ACCEPTANCE_MISSING",
  ACCEPTANCE_INVALID: "ACCEPTANCE_INVALID",
  SPEC_TREE_MISSING: "SPEC_TREE_MISSING",
  SPEC_TREE_INVALID: "SPEC_TREE_INVALID",
  SPEC_AUDIT_MISSING: "SPEC_AUDIT_MISSING",
  SPEC_AUDIT_INVALID: "SPEC_AUDIT_INVALID",
};

function makeValidatorRefusal(code, message) {
  return { code, message };
}

function normalizeArgv(args) {
  return args[0] === "--" ? args.slice(1) : args;
}

function listMarkdownHeadings(text) {
  return Array.from(text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)).map((match) => match[1]);
}

function missingHeadings(headings, requiredBlocks) {
  const present = new Set(headings);
  return requiredBlocks.filter((block) => !present.has(block));
}

function indexOfHeading(headings, heading) {
  return headings.findIndex((entry) => entry === heading);
}

function extractSectionBody(text, heading) {
  const lines = text.split("\n");
  const headingLine = `## ${heading}`;
  const startIndex = lines.findIndex((line) => line.trim() === headingLine);

  if (startIndex === -1) {
    return null;
  }

  const bodyLines = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## ")) {
      break;
    }
    bodyLines.push(lines[index]);
  }

  return bodyLines.join("\n").trim();
}

function buildYamlMissingReport(filePath, code, label) {
  return {
    ok: false,
    errors: [`missing file: ${filePath}`],
    warnings: [],
    refusal: makeValidatorRefusal(code, `${label} artifact is missing`),
  };
}

async function loadYamlArtifact(filePath, missingCode, invalidCode, label) {
  const text = await readTextIfFile(filePath);
  if (text === null) {
    return {
      ok: false,
      errors: [`missing file: ${filePath}`],
      warnings: [],
      refusal: makeValidatorRefusal(missingCode, `${label} artifact is missing`),
    };
  }

  const doc = parseYamlText(text);
  if (!isPlainObject(doc)) {
    return {
      ok: false,
      errors: [`invalid YAML document: ${filePath}`],
      warnings: [],
      refusal: makeValidatorRefusal(invalidCode, `${label} artifact is not valid YAML`),
    };
  }

  return { ok: true, doc, text };
}

function ensureStringOrNull(value) {
  return value === null || value === "" || typeof value === "string";
}

function validateExecutionPacketDoc(doc, filePath) {
  const errors = [];
  const warnings = [];
  const spec = HIGH_RISK_SCHEMA_SPECS[EXECUTION_PACKET_SCHEMA_REF];

  for (const field of spec.listFields.required) {
    if (!(field in doc)) {
      errors.push(`missing execution packet field: ${field}`);
    }
  }

  if (doc.status && !spec.listFields.status_enum.includes(String(doc.status))) {
    errors.push(`invalid execution packet status: ${doc.status}`);
  }

  if (!Array.isArray(doc.phases) || doc.phases.length === 0) {
    errors.push("execution packet phases must be a non-empty array");
  } else {
    const phaseIds = new Set();

    for (const phase of doc.phases) {
      if (!isPlainObject(phase)) {
        errors.push("execution packet phases entries must be mappings");
        continue;
      }

      for (const field of spec.listFields.phase_required) {
        if (!(field in phase)) {
          errors.push(`execution packet phase missing field: ${field}`);
        }
      }

      const phaseId = String(phase.phase_id ?? "");
      if (!phaseId) {
        errors.push("execution packet phase_id must be a non-empty string");
      } else if (phaseIds.has(phaseId)) {
        errors.push(`duplicate execution packet phase_id: ${phaseId}`);
      } else {
        phaseIds.add(phaseId);
      }

      for (const key of [
        "authority_refs",
        "write_scope",
        "read_scope",
        "required_checks",
        "completion_criteria",
        "escalation_conditions",
      ]) {
        if (!Array.isArray(phase[key]) || phase[key].length === 0) {
          errors.push(`execution packet phase ${phaseId || "<unknown>"}: ${key} must be a non-empty array`);
        }
      }

      if (
        phase.stop_on_failure
        && !spec.listFields.phase_stop_on_failure_enum.includes(String(phase.stop_on_failure))
      ) {
        errors.push(`execution packet phase ${phaseId || "<unknown>"}: invalid stop_on_failure ${phase.stop_on_failure}`);
      }

      if (!(phase.next_on_success === null || phase.next_on_success === "" || typeof phase.next_on_success === "string")) {
        errors.push(`execution packet phase ${phaseId || "<unknown>"}: next_on_success must be a string or null`);
      }
    }

    if (doc.entry_phase_id && !phaseIds.has(String(doc.entry_phase_id))) {
      errors.push(`execution packet entry_phase_id does not exist in phases: ${doc.entry_phase_id}`);
    }

    for (const phase of doc.phases) {
      if (typeof phase?.next_on_success === "string" && phase.next_on_success !== "" && !phaseIds.has(phase.next_on_success)) {
        errors.push(`execution packet phase ${phase.phase_id || "<unknown>"}: next_on_success target does not exist: ${phase.next_on_success}`);
      }
    }
  }

  if (!isPlainObject(doc.escalation_policy)) {
    errors.push("execution packet escalation_policy must be a mapping");
  } else {
    for (const key of spec.listFields.escalation_policy_required) {
      if (!Array.isArray(doc.escalation_policy[key])) {
        errors.push(`execution packet escalation_policy missing array: ${key}`);
      }
    }
  }

  if (!isPlainObject(doc.notification_settings)) {
    errors.push("execution packet notification_settings must be a mapping");
  } else {
    for (const key of spec.listFields.notification_settings_required) {
      if (typeof doc.notification_settings[key] !== "boolean") {
        errors.push(`execution packet notification_settings.${key} must be boolean`);
      }
    }
  }

  if (!isPlainObject(doc.resume_policy)) {
    errors.push("execution packet resume_policy must be a mapping");
  } else {
    for (const key of spec.listFields.resume_policy_required) {
      if (!Array.isArray(doc.resume_policy[key])) {
        errors.push(`execution packet resume_policy missing array: ${key}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    refusal: errors.length === 0
      ? null
      : makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.EXECUTION_PACKET_INVALID,
        `execution-packet artifact is invalid: ${path.basename(filePath)}`,
      ),
  };
}

function validateOrchestrationStateDoc(doc, filePath) {
  const errors = [];
  const warnings = [];
  const spec = HIGH_RISK_SCHEMA_SPECS[ORCHESTRATION_STATE_SCHEMA_REF];

  for (const field of spec.listFields.required) {
    if (!(field in doc)) {
      errors.push(`missing orchestration state field: ${field}`);
    }
  }

  if (doc.run_status && !spec.listFields.run_status_enum.includes(String(doc.run_status))) {
    errors.push(`invalid orchestration state run_status: ${doc.run_status}`);
  }

  if (Object.prototype.hasOwnProperty.call(doc, "resume_token")) {
    errors.push("orchestration state must not contain resume_token");
  }

  for (const key of ["current_phase_id", "last_completed_phase_id", "awaiting_human_action", "pause_reason"]) {
    if (key in doc && !ensureStringOrNull(doc[key])) {
      errors.push(`orchestration state ${key} must be a string or null`);
    }
  }

  if (doc.run_status === "running" && !(typeof doc.current_phase_id === "string" && doc.current_phase_id.length > 0)) {
    errors.push("running orchestration state requires current_phase_id");
  }

  if (doc.run_status === "paused") {
    if (!(typeof doc.current_phase_id === "string" && doc.current_phase_id.length > 0)) {
      errors.push("paused orchestration state requires current_phase_id");
    }
    if (!(typeof doc.pause_reason === "string" && doc.pause_reason.length > 0)) {
      errors.push("paused orchestration state requires pause_reason");
    }
    if (!(typeof doc.awaiting_human_action === "string" && doc.awaiting_human_action.length > 0)) {
      errors.push("paused orchestration state requires awaiting_human_action");
    }
  }

  if (doc.run_status === "failed" && !(typeof doc.awaiting_human_action === "string" && doc.awaiting_human_action.length > 0)) {
    errors.push("failed orchestration state requires awaiting_human_action");
  }

  if (doc.run_status === "completed") {
    if (!(typeof doc.last_completed_phase_id === "string" && doc.last_completed_phase_id.length > 0)) {
      errors.push("completed orchestration state requires last_completed_phase_id");
    }
    if (!(doc.current_phase_id === null || doc.current_phase_id === "")) {
      errors.push("completed orchestration state must not carry current_phase_id");
    }
    if (!(doc.awaiting_human_action === null || doc.awaiting_human_action === "")) {
      errors.push("completed orchestration state must not carry awaiting_human_action");
    }
    if (!(doc.pause_reason === undefined || doc.pause_reason === null || doc.pause_reason === "")) {
      errors.push("completed orchestration state must not carry pause_reason");
    }
  }

  if ("notification_refs" in doc && doc.notification_refs !== null) {
    if (!Array.isArray(doc.notification_refs)) {
      errors.push("orchestration state notification_refs must be an array when present");
    } else {
      for (const row of doc.notification_refs) {
        if (!isPlainObject(row)) {
          errors.push("orchestration state notification_refs entries must be mappings");
          continue;
        }
        for (const key of spec.listFields.notification_ref_required) {
          if (typeof row[key] !== "string" || row[key].length === 0) {
            errors.push(`orchestration state notification_refs entry missing string field: ${key}`);
          }
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    refusal: errors.length === 0
      ? null
      : makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.ORCHESTRATION_STATE_INVALID,
        `orchestration-state artifact is invalid: ${path.basename(filePath)}`,
      ),
  };
}

function readRunnerSignal(text) {
  const sectionBody = extractSectionBody(text, "Runner Signal");
  if (!sectionBody) {
    return {
      ok: false,
      errors: ["missing worker-output block: Runner Signal"],
      warnings: [],
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.RUNNER_SIGNAL_MISSING,
        "worker-output artifact is missing the required Runner Signal block",
      ),
      signal: null,
    };
  }

  const blockMatch = sectionBody.match(/```ya?ml\s+([\s\S]*?)```/i);
  if (!blockMatch) {
    return {
      ok: false,
      errors: ["runner signal must contain a fenced yaml block"],
      warnings: [],
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.RUNNER_SIGNAL_INVALID,
        "worker-output runner signal is missing a fenced yaml block",
      ),
      signal: null,
    };
  }

  const parsed = parseYamlText(blockMatch[1]);
  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      errors: ["runner signal fenced yaml block must decode to a mapping"],
      warnings: [],
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.RUNNER_SIGNAL_INVALID,
        "worker-output runner signal is not valid yaml mapping data",
      ),
      signal: null,
    };
  }

  return {
    ok: true,
    errors: [],
    warnings: [],
    refusal: null,
    signal: parsed,
  };
}

function validatePromptText(text, filePath) {
  const errors = [];
  const warnings = [];
  const headings = listMarkdownHeadings(text);
  const missingBlocks = missingHeadings(
    headings,
    HIGH_RISK_SCHEMA_SPECS[PROMPT_SCHEMA_REF].listFields.required_blocks,
  );

  for (const block of missingBlocks) {
    errors.push(`missing prompt block: ${block}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    refusal: errors.length === 0
      ? null
      : makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.PROMPT_INVALID,
        `prompt artifact is invalid: ${path.basename(filePath)}`,
      ),
  };
}

function validateWorkerOutputText(text, filePath) {
  const errors = [];
  const warnings = [];
  const headings = listMarkdownHeadings(text);
  const missingBlocks = missingHeadings(
    headings,
    HIGH_RISK_SCHEMA_SPECS[WORKER_OUTPUT_SCHEMA_REF].listFields.required_blocks,
  );

  for (const block of missingBlocks) {
    errors.push(`missing worker-output block: ${block}`);
  }

  const signalReport = readRunnerSignal(text);
  errors.push(...signalReport.errors);
  warnings.push(...signalReport.warnings);

  const refusal = signalReport.refusal
    || (errors.length > 0
      ? makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.WORKER_OUTPUT_INVALID,
        `worker-output artifact is invalid: ${path.basename(filePath)}`,
      )
      : null);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    refusal,
    signal: signalReport.signal,
  };
}

function validateAcceptanceText(text, filePath) {
  const errors = [];
  const warnings = [];
  const headings = listMarkdownHeadings(text);
  const spec = HIGH_RISK_SCHEMA_SPECS[ACCEPTANCE_SCHEMA_REF];
  const missingBlocks = missingHeadings(headings, spec.listFields.required_blocks);

  for (const block of missingBlocks) {
    errors.push(`missing acceptance block: ${block}`);
  }

  const requiredOrder = ["Findings", "Current Phase Disposition", "Next Step or Reopen Condition"];
  let previousIndex = -1;
  for (const block of requiredOrder) {
    const currentIndex = indexOfHeading(headings, block);
    if (currentIndex !== -1 && currentIndex < previousIndex) {
      errors.push("acceptance required blocks are out of order");
      break;
    }
    previousIndex = currentIndex === -1 ? previousIndex : currentIndex;
  }

  const dispositionSection = extractSectionBody(text, "Current Phase Disposition");
  if (dispositionSection) {
    const dispositionMatch = dispositionSection.match(/disposition:\s*(\w+)/i);
    if (dispositionMatch) {
      const disposition = dispositionMatch[1].toLowerCase();
      if (!spec.listFields.disposition_enum.includes(disposition)) {
        errors.push(`invalid acceptance disposition: ${disposition}`);
      }
    } else {
      warnings.push("acceptance missing explicit `Disposition:` line in Current Phase Disposition block");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    refusal: errors.length === 0
      ? null
      : makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.ACCEPTANCE_INVALID,
        `acceptance artifact is invalid: ${path.basename(filePath)}`,
      ),
  };
}

export async function validateExecutionPacket(filePath) {
  const loaded = await loadYamlArtifact(
    filePath,
    VALIDATOR_NATIVE_REFUSAL_CODES.EXECUTION_PACKET_MISSING,
    VALIDATOR_NATIVE_REFUSAL_CODES.EXECUTION_PACKET_INVALID,
    "execution-packet",
  );
  if (!loaded.ok) {
    return loaded;
  }
  return validateExecutionPacketDoc(loaded.doc, filePath);
}

export async function validateOrchestrationState(filePath) {
  const loaded = await loadYamlArtifact(
    filePath,
    VALIDATOR_NATIVE_REFUSAL_CODES.ORCHESTRATION_STATE_MISSING,
    VALIDATOR_NATIVE_REFUSAL_CODES.ORCHESTRATION_STATE_INVALID,
    "orchestration-state",
  );
  if (!loaded.ok) {
    return loaded;
  }
  return validateOrchestrationStateDoc(loaded.doc, filePath);
}

export async function validatePrompt(filePath) {
  const text = await readTextIfFile(filePath);
  if (text === null) {
    return buildYamlMissingReport(
      filePath,
      VALIDATOR_NATIVE_REFUSAL_CODES.PROMPT_MISSING,
      "prompt",
    );
  }
  return validatePromptText(text, filePath);
}

export async function validateWorkerOutput(filePath) {
  const text = await readTextIfFile(filePath);
  if (text === null) {
    return buildYamlMissingReport(
      filePath,
      VALIDATOR_NATIVE_REFUSAL_CODES.WORKER_OUTPUT_MISSING,
      "worker-output",
    );
  }
  return validateWorkerOutputText(text, filePath);
}

export async function validateAcceptance(filePath) {
  const text = await readTextIfFile(filePath);
  if (text === null) {
    return buildYamlMissingReport(
      filePath,
      VALIDATOR_NATIVE_REFUSAL_CODES.ACCEPTANCE_MISSING,
      "acceptance",
    );
  }
  return validateAcceptanceText(text, filePath);
}

function posixRelative(targetRoot, absolutePath) {
  return path.relative(targetRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

async function collectTreeFiles(rootPath) {
  const text = await readTextIfFile(path.join(rootPath, "INDEX.md"));
  if (text === null) {
    const info = await readTextIfFile(rootPath);
    if (info !== null) {
      return [];
    }
  }

  async function walk(currentPath) {
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return [];
    }

    const files = [];
    for (const entry of entries) {
      const childPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walk(childPath));
      } else if (entry.isFile()) {
        files.push(posixRelative(rootPath, childPath));
      }
    }
    return files.sort();
  }

  return walk(rootPath);
}

function escapeRegexLiteral(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(pattern) {
  const DOUBLE_STAR_SLASH = "__DOUBLE_STAR_SLASH__";
  const DOUBLE_STAR = "__DOUBLE_STAR__";
  const SINGLE_STAR = "__SINGLE_STAR__";

  let source = pattern
    .replaceAll("**/", DOUBLE_STAR_SLASH)
    .replaceAll("**", DOUBLE_STAR)
    .replaceAll("*", SINGLE_STAR);

  source = escapeRegexLiteral(source)
    .replaceAll(DOUBLE_STAR_SLASH, "(?:.*/)?")
    .replaceAll(DOUBLE_STAR, ".*")
    .replaceAll(SINGLE_STAR, "[^/]*");

  return new RegExp(`^${source}$`);
}

function compilePathClassMatchers(specTreeModel) {
  const classes = [
    ...specTreeModel.normativeClasses.map((entry) => ({ ...entry, category: "normative" })),
    ...specTreeModel.derivedClasses.map((entry) => ({ ...entry, category: "derived" })),
    ...specTreeModel.guidanceClasses.map((entry) => ({ ...entry, category: "guidance" })),
  ];

  return classes.map((entry) => ({
    ...entry,
    includeMatchers: entry.pathPatterns.map(globToRegex),
    excludeMatchers: (entry.excludedPathPatterns ?? []).map(globToRegex),
  }));
}

function isAllowedTopLevelSupportFile(relativePath) {
  return [
    "INDEX.md",
    "bootstrap-state.yaml",
    "product-scope.yaml",
    "high-risk-admissions.yaml",
  ].includes(relativePath);
}

function classifySpecTreeFiles(canonicalRoot, files, specTreeModel) {
  const matchers = compilePathClassMatchers(specTreeModel);
  const classifications = [];
  const unexpected = [];
  const conflicts = [];

  for (const relativePath of files) {
    const canonicalRelativePath = path.posix.join(canonicalRoot, relativePath);

    if (relativePath.startsWith("_meta/")) {
      classifications.push({ path: relativePath, classId: "_meta", category: "meta" });
      continue;
    }

    if (isAllowedTopLevelSupportFile(relativePath)) {
      classifications.push({ path: relativePath, classId: "support", category: "support" });
      continue;
    }

    const matched = matchers.filter((matcher) => (
      matcher.includeMatchers.some((regex) => regex.test(canonicalRelativePath))
      && !matcher.excludeMatchers.some((regex) => regex.test(canonicalRelativePath))
    ));

    if (matched.length === 0) {
      unexpected.push(relativePath);
      continue;
    }

    if (matched.length > 1) {
      conflicts.push({
        path: relativePath,
        classes: matched.map((entry) => entry.id),
      });
      continue;
    }

    classifications.push({
      path: relativePath,
      classId: matched[0].id,
      category: matched[0].category,
    });
  }

  return {
    classifications,
    unexpected,
    conflicts,
  };
}

export async function validateSpecTree(rootPath, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const specTreeModel = await loadSpecTreeModelContract(projectRoot);
  const errors = [];
  const warnings = [];

  if (!specTreeModel.ok) {
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

function classifyAuditCoveredFiles(files, specTreeModel) {
  const classifications = classifySpecTreeFiles(specTreeModel.canonicalRoot, files, specTreeModel);
  const auditedFiles = classifications.classifications.filter((entry) => (
    entry.category !== "meta"
    && (
      entry.category !== "support"
      || entry.path === "INDEX.md"
    )
  ));
  return {
    classifications,
    auditedFiles,
  };
}

function isSourceRefWithinDeclaredRoots(sourceRef, declaredInputs) {
  const roots = [
    ...declaredInputs.code_roots,
    ...declaredInputs.docs_roots,
    ...declaredInputs.structure_roots,
    ...(declaredInputs.benchmark_blueprint_root ? [declaredInputs.benchmark_blueprint_root] : []),
  ];

  if (declaredInputs.human_note_paths.includes(sourceRef)) {
    return true;
  }

  return roots.some((root) => (
    root === "."
      ? !path.posix.isAbsolute(sourceRef)
      : sourceRef === root || sourceRef.startsWith(`${root}/`)
  ));
}

function isDeclaredInputsCompatibleWithConfig(declaredInputs, generationInputs, blueprintReference) {
  const benchmarkRoot = generationInputs.benchmarkBlueprintRoot ?? blueprintReference.root ?? null;

  const rootsAlign = (declaredRoots, configuredRoots) => declaredRoots.every((entry) => configuredRoots.includes(entry));

  return rootsAlign(declaredInputs.code_roots, generationInputs.codeRoots ?? [])
    && rootsAlign(declaredInputs.docs_roots, generationInputs.docsRoots ?? [])
    && rootsAlign(declaredInputs.structure_roots, generationInputs.structureRoots ?? [])
    && rootsAlign(declaredInputs.human_note_paths, generationInputs.humanNotePaths ?? [])
    && (
      declaredInputs.benchmark_blueprint_root === null
        ? benchmarkRoot === null
        : declaredInputs.benchmark_blueprint_root === benchmarkRoot
    );
}

export async function validateSpecAudit(auditPath, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const specTreeModel = await loadSpecTreeModelContract(projectRoot);
  const specGenerationInputs = await loadSpecGenerationInputsConfig(projectRoot);
  const blueprintReference = await loadBlueprintReference(projectRoot);
  const auditContract = await loadSpecGenerationAuditContract(projectRoot);
  const errors = [];
  const warnings = [];

  if (!specTreeModel.ok) {
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

  if (parsed.version !== 1) {
    errors.push("spec generation audit version must be 1");
  }

  if (String(parsed.contract_ref ?? "") !== SPEC_GENERATION_AUDIT_CONTRACT_REF) {
    errors.push(`spec generation audit contract_ref must be ${SPEC_GENERATION_AUDIT_CONTRACT_REF}`);
  }

  const missingTopLevelFields = SPEC_GENERATION_AUDIT_REQUIRED_TOP_LEVEL_FIELDS.filter((field) => !(field in audit));
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

  if (String(audit.generation_mode ?? "") !== "mixed") {
    errors.push("spec generation audit generation_mode must be `mixed`");
  }
  if (String(audit.canonical_target_root ?? "") !== specTreeModel.canonicalRoot) {
    errors.push(`spec generation audit canonical_target_root must be ${specTreeModel.canonicalRoot}`);
  }
  if (String(audit.declared_profile ?? "") !== specTreeModel.profile) {
    errors.push(`spec generation audit declared_profile must be ${specTreeModel.profile}`);
  }
  if (!isDeclaredInputsCompatibleWithConfig(declaredInputs, specGenerationInputs, blueprintReference)) {
    errors.push("spec generation audit input_roots must stay within the declared generation inputs and optional benchmark root");
  }

  const canonicalRootPath = path.resolve(projectRoot, specTreeModel.canonicalRoot);
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

  const { auditedFiles, classifications } = classifyAuditCoveredFiles(treeFiles, specTreeModel);
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

  const auditEntryByRelativePath = new Map();
  for (const entry of fileEntries) {
    if (!isPlainObject(entry)) {
      errors.push("spec generation audit file entries must be mappings");
      continue;
    }

    const missingEntryFields = SPEC_GENERATION_AUDIT_FILE_REQUIRED_FIELDS.filter((field) => !(field in entry));
    if (missingEntryFields.length > 0) {
      errors.push(`spec generation audit file entry is missing required fields: ${missingEntryFields.join(", ")}`);
      continue;
    }

    const canonicalPath = String(entry.canonical_path ?? "");
    if (!canonicalPath.startsWith(`${specTreeModel.canonicalRoot}/`) && canonicalPath !== `${specTreeModel.canonicalRoot}/INDEX.md`) {
      errors.push(`spec generation audit canonical_path must stay under ${specTreeModel.canonicalRoot}: ${canonicalPath}`);
      continue;
    }

    const relativePath = path.posix.relative(specTreeModel.canonicalRoot, canonicalPath);
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
  const requiredFiles = (specTreeModel.requiredFilesByProfile[specTreeModel.profile] ?? [])
    .map((entry) => path.posix.relative(specTreeModel.canonicalRoot, entry))
    .filter((entry) => !entry.startsWith("_meta/"));

  for (const classifiedFile of auditedFiles) {
    const auditEntry = auditEntryByRelativePath.get(classifiedFile.path);
    if (!auditEntry) {
      missingAuditEntries.push(classifiedFile.path);
      continue;
    }

    if (auditEntry.file_class !== classifiedFile.classId && !(classifiedFile.path === "INDEX.md" && auditEntry.file_class === "index")) {
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
      canonicalRoot: specTreeModel.canonicalRoot,
      declaredProfile: specTreeModel.profile,
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

export function buildValidatorCliReport(validator, filePath, report) {
  return {
    contract: VALIDATOR_CLI_RESULT_CONTRACT,
    validator,
    target_ref: filePath,
    ok: Boolean(report.ok),
    refusal: report.refusal || null,
    errors: report.errors || [],
    warnings: report.warnings || [],
    ...(report.summary ? { summary: report.summary } : {}),
    ...(report.signal ? { signal: report.signal } : {}),
  };
}

export async function runValidatorCommand(args, validator, validate) {
  const normalizedArgv = normalizeArgv(args);
  const [filePath, ...rest] = normalizedArgv;

  if (!filePath || rest.length > 0) {
    process.stderr.write(`nimicoding ${validator} refused: expected exactly one path argument.\n`);
    return 2;
  }

  const targetPath = path.resolve(process.cwd(), filePath);
  const report = await validate(targetPath);
  const cliReport = buildValidatorCliReport(validator, targetPath, report);
  process.stdout.write(`${JSON.stringify(cliReport, null, 2)}\n`);
  return report.ok ? 0 : 1;
}
