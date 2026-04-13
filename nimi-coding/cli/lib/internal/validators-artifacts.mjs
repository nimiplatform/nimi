import path from "node:path";

import {
  ACCEPTANCE_SCHEMA_REF,
  EXECUTION_PACKET_SCHEMA_REF,
  HIGH_RISK_SCHEMA_SPECS,
  ORCHESTRATION_STATE_SCHEMA_REF,
  PROMPT_SCHEMA_REF,
  WORKER_OUTPUT_SCHEMA_REF,
} from "../../constants.mjs";
import { readTextIfFile } from "../fs-helpers.mjs";
import { isPlainObject } from "../value-helpers.mjs";
import { parseYamlText } from "../yaml-helpers.mjs";
import {
  makeValidatorRefusal,
  VALIDATOR_NATIVE_REFUSAL_CODES,
} from "./validators-shared.mjs";

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

function buildMissingFileReport(filePath, code, label) {
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
    return buildMissingFileReport(filePath, missingCode, label);
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
    return buildMissingFileReport(
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
    return buildMissingFileReport(
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
    return buildMissingFileReport(
      filePath,
      VALIDATOR_NATIVE_REFUSAL_CODES.ACCEPTANCE_MISSING,
      "acceptance",
    );
  }
  return validateAcceptanceText(text, filePath);
}
