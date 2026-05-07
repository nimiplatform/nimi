import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

import { pathExists } from "../fs-helpers.mjs";
import { isPlainObject } from "../value-helpers.mjs";

export const DESIGN_ROOT = ".nimi/local/sweep-design";
export const DESIGN_STATES = new Set([
  "raw",
  "confirmed",
  "duplicate",
  "superseded",
  "false_positive",
  "needs_more_audit",
  "needs_user_decision",
  "needs_authority_alignment",
  "needs_design",
  "ready_for_implementation_wave",
  "blocked",
]);
export const TERMINAL_STATES = new Set(["duplicate", "superseded", "false_positive"]);
export const TRANSIENT_STATES = new Set(["raw", "confirmed", "needs_design"]);
export const FINAL_OUTCOME_STATES = new Set([
  "duplicate",
  "superseded",
  "false_positive",
  "needs_more_audit",
  "needs_user_decision",
  "needs_authority_alignment",
  "ready_for_implementation_wave",
  "blocked",
]);
export const AUDITOR_FAMILIES = new Set([
  "anthropic_claude",
  "openai_gpt",
  "openai_codex",
  "google_gemini",
  "xai_grok",
  "meta_llama",
  "mistral",
  "other",
]);
export const AUDITOR_MODES = new Set(["focused", "all", "degraded"]);
export const AUDITOR_RESULT_ORIGINS = new Set(["llm_session", "external_llm_session", "synthetic_trial"]);
export const LLM_AUDITOR_RESULT_ORIGINS = new Set(["llm_session", "external_llm_session"]);
export const PRIOR_DESIGN_STATE_MARKERS = new Set([
  "empty",
  "present",
  "partial",
  "superseded_by_later_audit",
  "evidence_gap",
]);
export const REVISION_TYPES = new Set([
  "finding_state_revision",
  "duplicate_judgement",
  "superseded_judgement",
  "cluster_create",
  "cluster_merge",
  "cluster_split",
  "cluster_retire",
  "cluster_reopen",
  "finding_move",
  "wave_create",
  "wave_merge",
  "wave_split",
  "wave_retract",
  "wave_demote",
  "wave_block",
  "wave_implementation_ready",
  "wave_dependency_rewrite",
  "wave_validation_or_closeout_strengthening",
  "decision_packet_create",
  "extra_audit_request_create",
  "extra_audit_request_close",
  "human_decision_request_create",
  "human_decision_request_resolve",
  "final_state_projection_update",
  "user_decision_queue_rewrite",
]);

export function toPosix(filePath) {
  return filePath.split(path.sep).join(path.posix.sep);
}

export function relPath(projectRoot, absolutePath) {
  return toPosix(path.relative(projectRoot, absolutePath));
}

export function safeDesignId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,140}$/.test(value)) {
    return null;
  }
  return value;
}

export function deriveRunId(sweepId) {
  return `sweep-design-${String(sweepId).replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
}

export function designRef(runId, ...parts) {
  return path.posix.join(DESIGN_ROOT, runId, ...parts);
}

export function artifactPath(projectRoot, ref) {
  return path.join(projectRoot, ...ref.split("/"));
}

export function inputError(error) {
  return { ok: false, inputError: true, exitCode: 2, error };
}

export async function loadYamlPath(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return YAML.parse(text);
  } catch {
    return null;
  }
}

export function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Object(value) {
  return sha256Text(stableStringify(value));
}

export async function loadYamlRef(projectRoot, ref) {
  return loadYamlPath(artifactPath(projectRoot, ref));
}

export async function writeYamlRef(projectRoot, ref, value) {
  const destination = artifactPath(projectRoot, ref);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, YAML.stringify(value, { aliasDuplicateObjects: false }), "utf8");
  return ref;
}

export async function assertDesignArtifact(projectRoot, ref, kind, label) {
  const value = await loadYamlRef(projectRoot, ref);
  if (!isPlainObject(value) || value.kind !== kind) {
    return inputError(`nimicoding sweep design refused: ${label} is missing or malformed.\n`);
  }
  return { ok: true, value, ref };
}

export function auditFindingsRef(sweepId) {
  return `.nimi/local/audit/evidence/${sweepId}/findings.yaml`;
}

export async function loadAuditFindings(projectRoot, sweepId) {
  const ref = auditFindingsRef(sweepId);
  const sourcePath = artifactPath(projectRoot, ref);
  const info = await pathExists(sourcePath);
  if (!info || !info.isFile()) {
    return inputError(`nimicoding sweep design refused: audit findings not found for ${sweepId}.\n`);
  }
  const sourceText = await readFile(sourcePath, "utf8");
  const store = YAML.parse(sourceText);
  if (!isPlainObject(store) || store.kind !== "audit-findings" || store.sweep_id !== sweepId || !Array.isArray(store.findings)) {
    return inputError(`nimicoding sweep design refused: audit findings are malformed for ${sweepId}.\n`);
  }
  return { ok: true, ref, store, sourceSha256: sha256Text(sourceText) };
}

export function findingOwnerDomain(finding) {
  if (typeof finding.owner_domain === "string" && finding.owner_domain.length > 0) {
    return finding.owner_domain;
  }
  const file = finding.location?.file;
  if (typeof file === "string" && file.includes("/")) {
    return file.split("/")[0];
  }
  return "root";
}

export function findingAuthorityRef(finding) {
  return finding.root_cause?.authority_ref ?? finding.authority_ref ?? null;
}

export function findingRepairTarget(finding) {
  return finding.root_cause?.repair_target ?? finding.location?.file ?? null;
}

export function findingCodeRefs(finding) {
  return [
    finding.location?.file,
    ...(Array.isArray(finding.implementation_refs) ? finding.implementation_refs : []),
  ].filter((value, index, array) => typeof value === "string" && value.length > 0 && array.indexOf(value) === index);
}

export function normalizeFindingForDesign(finding, sourceFindingsRef) {
  return {
    finding_id: finding.id,
    source_audit_sweep_id: finding.sweep_id,
    source_chunk_id: finding.chunk_id ?? null,
    source_finding_ref: `${sourceFindingsRef}#${finding.id}`,
    fingerprint: finding.fingerprint ?? null,
    severity: finding.severity ?? null,
    category: finding.category ?? null,
    actionability: finding.actionability ?? null,
    confidence: finding.confidence ?? null,
    title: finding.title ?? null,
    owner_domain: findingOwnerDomain(finding),
    authority_ref: findingAuthorityRef(finding),
    evidence_refs: Array.isArray(finding.implementation_refs) ? finding.implementation_refs : [],
    repair_target: findingRepairTarget(finding),
    location: finding.location ?? null,
    root_cause_key: finding.root_cause?.key ?? null,
    contract_seam: finding.root_cause?.contract_seam ?? null,
    impact: finding.impact ?? null,
  };
}

export function requireRunId(options) {
  const runId = safeDesignId(options.runId);
  if (!runId) {
    return inputError("nimicoding sweep design refused: --run-id is required.\n");
  }
  return { ok: true, runId };
}

export function nowIso() {
  return new Date().toISOString();
}

export function slug(value) {
  return String(value ?? "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}
