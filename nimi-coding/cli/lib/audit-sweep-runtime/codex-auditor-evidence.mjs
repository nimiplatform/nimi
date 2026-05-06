import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { writeJsonRef } from "./common.mjs";
import { validateEvidenceEnvelope } from "./ingest.mjs";
import { buildAuditValidityForEvidence } from "./audit-validity.mjs";
import { isPlainObject } from "../value-helpers.mjs";

const ALLOWED_TOP_LEVEL_FIELDS = new Set(["chunk_id", "auditor", "coverage", "findings"]);
export const P0P1_RULE_CHECK_IDS = [
  "fail_open_or_pseudo_success",
  "partial_coverage_misrepresented_as_complete",
  "authority_boundary_or_private_import_bypass",
  "permission_or_capability_bypass",
  "ungated_destructive_action",
  "provider_or_model_hardcoding",
  "app_local_shadow_truth",
];

function hasUnexpectedTopLevelFields(evidence) {
  return Object.keys(evidence).filter((key) => !ALLOWED_TOP_LEVEL_FIELDS.has(key));
}

function firstJsonObjectPrefix(rawText) {
  const start = rawText.indexOf("{");
  if (start < 0) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < rawText.length; index += 1) {
    const char = rawText[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          jsonText: rawText.slice(start, index + 1),
          trailing: rawText.slice(index + 1),
        };
      }
      if (depth < 0) {
        return null;
      }
    }
  }
  return null;
}

function parseCodexRawJson(rawText) {
  try {
    return { ok: true, value: JSON.parse(rawText) };
  } catch {
    const singleBraceRepair = parseWithUniqueDroppedClosingBrace(rawText);
    if (singleBraceRepair.ok) {
      return singleBraceRepair;
    }
    const prefix = firstJsonObjectPrefix(rawText);
    const trailing = prefix?.trailing?.trim() ?? "";
    if (prefix && /^}*$/.test(trailing)) {
      try {
        return { ok: true, value: JSON.parse(prefix.jsonText), repaired: trailing ? "ignored_trailing_closing_braces" : null };
      } catch {
        // Fall through to the contract error below.
      }
    }
    if (prefix && /^,\s*"findings_count"\s*:\s*\d+\s*[}]\s*$/u.test(trailing)) {
      try {
        const value = JSON.parse(prefix.jsonText);
        if (isPlainObject(value) && hasUnexpectedTopLevelFields(value).length === 0) {
          return { ok: true, value, repaired: "ignored_trailing_findings_count_metadata" };
        }
      } catch {
        // Fall through to the contract error below.
      }
    }
    const duplicateTrailingFieldRepair = parseWithDuplicateTrailingTopLevelFields(prefix, trailing);
    if (duplicateTrailingFieldRepair.ok) {
      return duplicateTrailingFieldRepair;
    }
    return { ok: false, error: "Codex auditor raw output must be exact JSON, without markdown or transcript prose" };
  }
}

function parseWithDuplicateTrailingTopLevelFields(prefix, trailing) {
  if (!prefix || !trailing.startsWith(",") || !trailing.endsWith("}")) {
    return { ok: false };
  }
  try {
    const value = JSON.parse(prefix.jsonText);
    if (!isPlainObject(value) || hasUnexpectedTopLevelFields(value).length > 0) {
      return { ok: false };
    }
    const trailingFields = JSON.parse(`{${trailing.slice(1)}`);
    if (!isPlainObject(trailingFields)) {
      return { ok: false };
    }
    const keys = Object.keys(trailingFields);
    if (keys.length === 0 || keys.some((key) => !ALLOWED_TOP_LEVEL_FIELDS.has(key))) {
      return { ok: false };
    }
    if (!keys.every((key) => isDeepStrictEqual(trailingFields[key], value[key]))) {
      return { ok: false };
    }
    return { ok: true, value, repaired: "ignored_duplicate_trailing_top_level_fields" };
  } catch {
    return { ok: false };
  }
}

function parseWithUniqueDroppedClosingBrace(rawText) {
  const candidates = [];
  const candidateKeys = new Set();
  for (let index = 0; index < rawText.length; index += 1) {
    if (rawText[index] !== "}") {
      continue;
    }
    try {
      const value = JSON.parse(`${rawText.slice(0, index)}${rawText.slice(index + 1)}`);
      if (isPlainObject(value) && hasUnexpectedTopLevelFields(value).length === 0) {
        const key = JSON.stringify(value);
        if (!candidateKeys.has(key)) {
          candidateKeys.add(key);
          candidates.push(value);
        }
      }
    } catch {
      // Keep searching for an unambiguous single-token structural repair.
    }
    if (candidates.length > 1) {
      return { ok: false };
    }
  }
  if (candidates.length === 1) {
    return { ok: true, value: candidates[0], repaired: "dropped_single_extra_closing_brace" };
  }
  return { ok: false };
}

function normalizeRefs(refs) {
  return Array.isArray(refs)
    ? refs.map((ref) => typeof ref === "string" ? ref.replace(/\\/g, "/") : ref)
    : [];
}

function uniqueRefs(refs) {
  return [...new Set(refs)].sort();
}

function refsOutsideSet(refs, allowedSet) {
  return refs.filter((ref) => typeof ref !== "string" || !allowedSet.has(ref));
}

function isNonImplementationContextRef(ref) {
  if (typeof ref !== "string") {
    return false;
  }
  const normalized = ref.replace(/\\/g, "/");
  return /(^|\/)AGENTS\.md$/u.test(normalized)
    || /(^|\/)README\.md$/u.test(normalized)
    || normalized.startsWith(".nimi/spec/")
    || normalized.startsWith(".nimi/contracts/")
    || normalized.startsWith(".nimi/methodology/")
    || normalized.startsWith("nimi-coding/methodology/")
    || normalized.startsWith("nimi-coding/spec/");
}

function stripNonImplementationContextRefs(refs, evidenceInventorySet) {
  return refs.filter((ref) => evidenceInventorySet.has(ref) || !isNonImplementationContextRef(ref));
}

function normalizeFindingEnvelope(finding, evidenceInventorySet, authorityRefSet = new Set()) {
  if (!isPlainObject(finding)) {
    return finding;
  }
  const severityInput = typeof finding.severity === "string" && finding.severity.trim()
    ? finding.severity
    : typeof finding.priority === "string" && finding.priority.trim()
      ? finding.priority
      : typeof finding.impact === "string" && finding.impact.trim()
        ? finding.impact
        : null;
  const severity = typeof severityInput === "string" ? severityInput.trim().toLowerCase() : "";
  const patch = {};
  if (severity === "p0") {
    patch.severity = "critical";
  }
  if (severity === "p1") {
    patch.severity = "high";
  }
  if (["critical", "high", "medium", "low"].includes(severity)) {
    patch.severity = severity;
  }
  const actionability = typeof finding.actionability === "string"
    ? finding.actionability.trim().toLowerCase().replace(/_/g, "-")
    : "";
  if (!actionability) {
    patch.actionability = "needs-decision";
  }
  if (["needs-fix", "manual-fix", "manual-review", "fix-required", "needs-remediation"].includes(actionability)) {
    patch.actionability = "needs-decision";
  }
  if (actionability === "auto-fix" || actionability === "autofix") {
    patch.actionability = "auto-fix";
  }
  if (actionability === "deferred" || actionability === "backlog" || actionability === "deferred-backlog") {
    patch.actionability = "deferred-backlog";
  }
  const confidence = typeof finding.confidence === "string"
    ? finding.confidence.trim().toLowerCase()
    : "";
  if (!confidence) {
    patch.confidence = "high";
  }
  if (["high", "medium", "low"].includes(confidence)) {
    patch.confidence = confidence;
  }
  if (typeof finding.category !== "string" || !finding.category.trim()) {
    const ruleId = Array.isArray(finding.rule_ids)
      ? finding.rule_ids.find((entry) => typeof entry === "string" && entry.trim())
      : null;
    if (ruleId) {
      patch.category = ruleId.trim();
    } else if (typeof finding.rule_check_id === "string" && finding.rule_check_id.trim()) {
      patch.category = finding.rule_check_id.trim();
    } else if (typeof finding.rule_id === "string" && finding.rule_id.trim()) {
      patch.category = finding.rule_id.trim();
    } else if (typeof finding.defect_class === "string" && finding.defect_class.trim()) {
      patch.category = finding.defect_class.trim();
    }
  }
  if (typeof finding.title !== "string" || !finding.title.trim()) {
    const summary = typeof finding.summary === "string" && finding.summary.trim() ? finding.summary.trim() : null;
    if (summary) {
      patch.title = summary;
    }
  }
  if (typeof finding.description !== "string" || !finding.description.trim()) {
    const reasoning = typeof finding.reasoning === "string" && finding.reasoning.trim()
      ? finding.reasoning.trim()
      : typeof finding.details === "string" && finding.details.trim()
        ? finding.details.trim()
        : typeof finding.summary === "string" && finding.summary.trim()
          ? finding.summary.trim()
        : null;
    if (reasoning) {
      patch.description = reasoning;
    }
  }
  if (!isPlainObject(finding.location) || typeof finding.location.file !== "string" || !finding.location.file.trim()) {
    const location = Array.isArray(finding.locations)
      ? finding.locations.find((entry) => isPlainObject(entry)
        && typeof entry.ref === "string"
        && evidenceInventorySet.has(entry.ref.replace(/\\/g, "/")))
      : null;
    if (location) {
      patch.location = {
        file: location.ref.replace(/\\/g, "/"),
        ...(Number.isInteger(location.line) && location.line > 0 ? { line: location.line } : {}),
        ...(typeof location.symbol === "string" && location.symbol.trim() ? { symbol: location.symbol.trim() } : {}),
      };
    }
    const implementationRefs = normalizeRefs(finding.implementation_refs);
    const locationFile = implementationRefs.find((ref) => evidenceInventorySet.has(ref));
    if (!patch.location && locationFile) {
      patch.location = {
        file: locationFile,
      };
    }
    const authorityRefs = normalizeRefs(finding.authority_refs);
    const authorityLocationFile = authorityRefs.find((ref) => authorityRefSet.has(ref));
    if (!patch.location && authorityLocationFile) {
      patch.location = {
        file: authorityLocationFile,
      };
    }
  }
  if (!isPlainObject(finding.evidence)) {
    const summary = typeof finding.description === "string" && finding.description.trim()
      ? finding.description.trim()
      : typeof finding.impact === "string" && finding.impact.trim()
        ? finding.impact.trim()
        : typeof finding.title === "string" && finding.title.trim()
          ? finding.title.trim()
          : "";
    const auditorReasoning = typeof finding.recommendation === "string" && finding.recommendation.trim()
      ? finding.recommendation.trim()
      : summary;
    if (summary && auditorReasoning) {
      patch.evidence = {
        summary,
        auditor_reasoning: auditorReasoning,
      };
    }
  }
  return Object.keys(patch).length > 0 ? { ...finding, ...patch } : finding;
}

function validateCodexProvenance(evidence, expectedPacketRef) {
  const provenance = evidence?.auditor?.provenance;
  if (!isPlainObject(provenance)) {
    return { ok: false, error: "auditor.provenance is required" };
  }
  if (provenance.kind !== "semantic_audit") {
    return { ok: false, error: "auditor.provenance.kind must be semantic_audit" };
  }
  if (provenance.packet_ref !== expectedPacketRef) {
    return { ok: false, error: "auditor.provenance.packet_ref must match the auditor packet" };
  }
  const tracePresent = ["session_ref", "transcript_ref", "review_ref"]
    .some((field) => typeof provenance[field] === "string" && provenance[field].trim().length > 0);
  if (!tracePresent) {
    return { ok: false, error: "auditor.provenance requires session_ref, transcript_ref, or review_ref" };
  }
  return { ok: true };
}

export function validateCodexAuditorEvidence(evidence, chunk, expectedPacketRef) {
  if (!isPlainObject(evidence)) {
    return { ok: false, error: "Codex auditor output must be a JSON object" };
  }
  if (Object.prototype.hasOwnProperty.call(evidence, "p0p1_rule_checks")) {
    return { ok: false, error: "Codex auditor output must place p0p1_rule_checks under coverage" };
  }
  const unexpectedFields = hasUnexpectedTopLevelFields(evidence);
  if (unexpectedFields.length > 0) {
    return { ok: false, error: `Codex auditor output has unexpected top-level fields: ${unexpectedFields.join(", ")}` };
  }
  if (!isPlainObject(evidence.auditor)
    || typeof evidence.auditor.mode !== "string"
    || !evidence.auditor.mode.trim()
    || typeof evidence.auditor.methodology_ref !== "string"
    || !evidence.auditor.methodology_ref.trim()) {
    return { ok: false, error: "Codex auditor output requires auditor.mode and auditor.methodology_ref" };
  }
  const provenance = validateCodexProvenance(evidence, expectedPacketRef);
  if (!provenance.ok) {
    return provenance;
  }
  const envelope = validateEvidenceEnvelope(evidence, chunk);
  if (!envelope.ok) {
    return envelope;
  }
  const auditValidity = buildAuditValidityForEvidence(chunk, evidence);
  if (auditValidity.posture === "invalid") {
    return {
      ok: false,
      error: `audit evidence is invalid (${auditValidity.blockers.map((blocker) => blocker.id).join(", ")})`,
      auditValidity,
    };
  }
  return { ok: true, auditValidity };
}

function semanticOutputRef(rawOutput, chunk, expectedAuthorityRefs) {
  if (rawOutput?.chunk_id !== chunk.chunk_id) {
    return { ok: false, error: "Codex auditor raw output chunk_id must match the chunk" };
  }
  if (Object.prototype.hasOwnProperty.call(rawOutput, "p0p1_rule_checks")) {
    return { ok: false, error: "Codex auditor output must place p0p1_rule_checks under coverage" };
  }
  const unexpectedFields = hasUnexpectedTopLevelFields(rawOutput);
  if (unexpectedFields.length > 0) {
    return { ok: false, error: `Codex auditor output has unexpected top-level fields: ${unexpectedFields.join(", ")}` };
  }
  if (!isPlainObject(rawOutput.coverage)) {
    return { ok: false, error: "Codex auditor raw output coverage is required" };
  }
  if (!Array.isArray(rawOutput.findings)) {
    return { ok: false, error: "Codex auditor raw output findings must be an array" };
  }
  const outcomes = rawOutput.coverage.authority_outcomes;
  if (!Array.isArray(outcomes)) {
    return { ok: false, error: "Codex auditor raw output coverage.authority_outcomes is required" };
  }
  if (outcomes.length !== expectedAuthorityRefs.length) {
    return { ok: false, error: "Codex auditor raw output must contain one authority_outcome per authority ref" };
  }
  return { ok: true };
}

function normalizeOutcome(rawOutcome, index, authorityRef, evidenceInventorySet) {
  if (!isPlainObject(rawOutcome)) {
    return { ok: false, error: `authority_outcomes[${index}] must be an object` };
  }
  const rawAuthorityRef = typeof rawOutcome.authority_ref === "string" ? rawOutcome.authority_ref.replace(/\\/g, "/") : authorityRef;
  if (rawAuthorityRef !== authorityRef) {
    return { ok: false, error: `authority_outcomes[${index}].authority_ref must match ${authorityRef}` };
  }
  const status = rawOutcome.status ?? "audited";
  if (!["audited", "blocked", "not_applicable"].includes(status)) {
    return { ok: false, error: `authority_outcomes[${index}].status must be audited, blocked, or not_applicable` };
  }
  const inspectedImplementationRefs = uniqueRefs([
    ...normalizeRefs(rawOutcome.inspected_implementation_refs),
    ...normalizeRefs(rawOutcome.implementation_evidence_refs),
  ]);
  const implementationRefs = stripNonImplementationContextRefs(inspectedImplementationRefs, evidenceInventorySet);
  const invalidImplementationRefs = refsOutsideSet(implementationRefs, evidenceInventorySet);
  if (invalidImplementationRefs.length > 0) {
    return {
      ok: false,
      error: `authority_outcomes[${index}] inspected implementation refs must belong to chunk evidence inventory: ${invalidImplementationRefs.join(", ")}`,
    };
  }
  const normalized = {
    authority_ref: authorityRef,
    status,
    evidence_refs: uniqueRefs([authorityRef, ...implementationRefs]),
    implementation_evidence_refs: implementationRefs,
  };
  if (typeof rawOutcome.negative_reasoning === "string" && rawOutcome.negative_reasoning.trim()) {
    normalized.negative_reasoning = rawOutcome.negative_reasoning.trim();
  }
  if (!normalized.negative_reasoning && typeof rawOutcome.reasoning === "string" && rawOutcome.reasoning.trim()) {
    normalized.negative_reasoning = rawOutcome.reasoning.trim();
  }
  if (typeof rawOutcome.reason === "string" && rawOutcome.reason.trim()) {
    normalized.reason = rawOutcome.reason.trim();
  }
  if (typeof rawOutcome.implementation_not_applicable_reason === "string" && rawOutcome.implementation_not_applicable_reason.trim()) {
    normalized.implementation_not_applicable_reason = rawOutcome.implementation_not_applicable_reason.trim();
  }
  if (!normalized.reason && status === "not_applicable" && normalized.implementation_not_applicable_reason) {
    normalized.reason = normalized.implementation_not_applicable_reason;
  }
  if (!normalized.reason && ["blocked", "not_applicable"].includes(status) && normalized.negative_reasoning) {
    normalized.reason = normalized.negative_reasoning;
  }
  return {
    ok: true,
    outcome: normalized,
    inspectedImplementationRefs: implementationRefs,
  };
}

function normalizeRuleChecks(rawRuleChecks, evidenceInventorySet, authorityRefSet) {
  if (rawRuleChecks === undefined) {
    return { ok: true, ruleChecks: [], implementationRefs: [] };
  }
  if (!Array.isArray(rawRuleChecks)) {
    return { ok: false, error: "coverage.p0p1_rule_checks must be an array when present" };
  }
  const ruleChecks = [];
  const implementationRefs = [];
  const checkedIds = [];
  for (const [index, rawCheck] of rawRuleChecks.entries()) {
    if (!isPlainObject(rawCheck)) {
      return { ok: false, error: `coverage.p0p1_rule_checks[${index}] must be an object` };
    }
    const id = typeof rawCheck.id === "string" ? rawCheck.id : "";
    if (!P0P1_RULE_CHECK_IDS.includes(id)) {
      return { ok: false, error: `coverage.p0p1_rule_checks[${index}].id is not a required P0/P1 rule id` };
    }
    checkedIds.push(id);
    if (!["checked", "not_applicable"].includes(rawCheck.status)) {
      return { ok: false, error: `coverage.p0p1_rule_checks[${index}].status must be checked or not_applicable` };
    }
    if (typeof rawCheck.negative_reasoning !== "string" || !rawCheck.negative_reasoning.trim()) {
      return { ok: false, error: `coverage.p0p1_rule_checks[${index}].negative_reasoning is required` };
    }
    const rawRefs = stripNonImplementationContextRefs(uniqueRefs(normalizeRefs(rawCheck.implementation_refs)), evidenceInventorySet);
    const refs = rawRefs.filter((ref) => evidenceInventorySet.has(ref));
    const invalidRawRefs = rawRefs.filter((ref) => !evidenceInventorySet.has(ref) && !authorityRefSet.has(ref));
    if (rawCheck.status === "checked" && refs.length === 0) {
      return { ok: false, error: `coverage.p0p1_rule_checks[${index}].implementation_refs is required when status is checked` };
    }
    if (invalidRawRefs.length > 0) {
      return {
        ok: false,
        error: `coverage.p0p1_rule_checks[${index}].implementation_refs must belong to chunk evidence inventory: ${invalidRawRefs.join(", ")}`,
      };
    }
    implementationRefs.push(...refs);
    ruleChecks.push({
      id,
      status: rawCheck.status,
      implementation_refs: refs,
      negative_reasoning: rawCheck.negative_reasoning.trim(),
    });
  }
  const missingRuleCheckIds = P0P1_RULE_CHECK_IDS.filter((id) => !checkedIds.includes(id));
  if (missingRuleCheckIds.length > 0) {
    return { ok: false, error: `coverage.p0p1_rule_checks must include every required P0/P1 rule id: missing ${missingRuleCheckIds.join(", ")}` };
  }
  return { ok: true, ruleChecks, implementationRefs: uniqueRefs(implementationRefs) };
}

function deriveP0P1NegativeReasoningFromRuleChecks(ruleChecks) {
  const reasons = uniqueRefs(ruleChecks
    .map((check) => typeof check.negative_reasoning === "string" ? check.negative_reasoning.trim() : "")
    .filter(Boolean));
  if (reasons.length === 0) {
    return null;
  }
  return reasons.join(" ");
}

function normalizeCodexSemanticOutput(rawOutput, chunk, options) {
  if (!isPlainObject(rawOutput)) {
    return { ok: false, error: "Codex auditor output must be a JSON object" };
  }
  const authorityRefs = chunk.authority_refs ?? chunk.files;
  const semanticShape = semanticOutputRef(rawOutput, chunk, authorityRefs);
  if (!semanticShape.ok) {
    return semanticShape;
  }

  const evidenceInventory = chunk.planning_basis === "spec_authority" ? (chunk.evidence_inventory ?? []) : (chunk.files ?? []);
  const evidenceInventorySet = new Set(evidenceInventory);
  const authorityRefSet = new Set(authorityRefs);
  const outcomes = [];
  const inspectedRefs = [];
  for (const [index, authorityRef] of authorityRefs.entries()) {
    const rawOutcome = rawOutput.coverage.authority_outcomes[index];
    const normalized = normalizeOutcome(rawOutcome, index, authorityRef, evidenceInventorySet);
    if (!normalized.ok) {
      return normalized;
    }
    outcomes.push(normalized.outcome);
    inspectedRefs.push(...normalized.inspectedImplementationRefs);
  }

  const ruleChecks = normalizeRuleChecks(rawOutput.coverage.p0p1_rule_checks, evidenceInventorySet, authorityRefSet);
  if (!ruleChecks.ok) {
    return ruleChecks;
  }
  const p0p1EvidenceRefs = uniqueRefs([
    ...inspectedRefs,
    ...ruleChecks.implementationRefs,
    ...normalizeRefs(rawOutput.coverage.p0p1_evidence_refs),
    ...normalizeRefs(rawOutput.coverage.inspected_implementation_refs),
  ]);
  const normalizedP0P1EvidenceRefs = stripNonImplementationContextRefs(p0p1EvidenceRefs, evidenceInventorySet);
  const invalidP0P1EvidenceRefs = refsOutsideSet(normalizedP0P1EvidenceRefs, evidenceInventorySet);
  if (invalidP0P1EvidenceRefs.length > 0) {
    return {
      ok: false,
      error: `coverage inspected implementation refs must belong to chunk evidence inventory: ${invalidP0P1EvidenceRefs.join(", ")}`,
    };
  }

  const evidence = {
    chunk_id: chunk.chunk_id,
    auditor: {
      id: typeof rawOutput.auditor?.id === "string" && rawOutput.auditor.id.trim() ? rawOutput.auditor.id : options.auditorId,
      mode: "codex_semantic_audit",
      methodology_ref: "nimi-coding/methodology/audit-sweep-p0p1-recall.yaml",
      provenance: {
        kind: "semantic_audit",
        packet_ref: options.packetRef,
        session_ref: options.sessionRef,
        transcript_ref: options.transcriptRef,
      },
    },
    coverage: {
      files: chunk.files,
      authority_refs: authorityRefs,
      evidence_files: evidenceInventory,
      authority_outcomes: outcomes,
      p0p1_evidence_refs: normalizedP0P1EvidenceRefs,
      p0p1_rule_checks: ruleChecks.ruleChecks,
    },
    findings: rawOutput.findings.map((finding) => normalizeFindingEnvelope(finding, evidenceInventorySet, authorityRefSet)),
  };
  if (typeof rawOutput.coverage.p0p1_negative_reasoning === "string" && rawOutput.coverage.p0p1_negative_reasoning.trim()) {
    evidence.coverage.p0p1_negative_reasoning = rawOutput.coverage.p0p1_negative_reasoning.trim();
  } else if (evidence.findings.length === 0) {
    const derivedReasoning = deriveP0P1NegativeReasoningFromRuleChecks(ruleChecks.ruleChecks);
    if (derivedReasoning) {
      evidence.coverage.p0p1_negative_reasoning = derivedReasoning;
    }
  }
  if (typeof rawOutput.coverage.p0p1_implementation_not_applicable_reason === "string" && rawOutput.coverage.p0p1_implementation_not_applicable_reason.trim()) {
    evidence.coverage.p0p1_implementation_not_applicable_reason = rawOutput.coverage.p0p1_implementation_not_applicable_reason.trim();
  }
  if (!evidence.coverage.p0p1_implementation_not_applicable_reason && evidenceInventory.length === 0) {
    const outcomeReasons = outcomes
      .map((outcome) => outcome.implementation_not_applicable_reason)
      .filter((reason) => typeof reason === "string" && reason.trim().length > 0);
    if (outcomeReasons.length > 0) {
      evidence.coverage.p0p1_implementation_not_applicable_reason = uniqueRefs(outcomeReasons).join(" ");
    }
  }
  return { ok: true, evidence };
}

export async function extractCodexAuditorEvidenceFile(projectRoot, options) {
  let rawText = "";
  try {
    rawText = await readFile(options.rawOutputPath, "utf8");
  } catch {
    return { ok: false, error: "Codex auditor raw output file is missing" };
  }
  const parsedRaw = parseCodexRawJson(rawText);
  if (!parsedRaw.ok) {
    return parsedRaw;
  }
  const parsed = parsedRaw.value;

  const normalized = normalizeCodexSemanticOutput(parsed, options.chunk, {
    packetRef: options.packetRef,
    sessionRef: options.sessionRef,
    transcriptRef: options.transcriptRef,
    auditorId: options.auditorId,
  });
  if (!normalized.ok) {
    return normalized;
  }
  const validation = validateCodexAuditorEvidence(normalized.evidence, options.chunk, options.packetRef);
  if (!validation.ok) {
    return validation;
  }

  await writeJsonRef(projectRoot, options.evidenceRef, normalized.evidence);
  return {
    ok: true,
    evidence: normalized.evidence,
    evidenceRef: options.evidenceRef,
    auditValidity: validation.auditValidity,
  };
}
