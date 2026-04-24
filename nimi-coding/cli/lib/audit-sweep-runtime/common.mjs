import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

import { AUDIT_SWEEP_ARTIFACT_ROOTS } from "../../constants.mjs";
import { pathExists } from "../fs-helpers.mjs";
import { loadYamlFile } from "../yaml-helpers.mjs";
import { isIsoUtcTimestamp, isPlainObject } from "../value-helpers.mjs";

export const DEFAULT_MAX_FILES_PER_CHUNK = 60;
export const DEFAULT_CRITERIA = ["quality"];
export const AUDITABLE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".go",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".proto",
  ".py",
  ".rs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
export const DEFAULT_EXCLUDE_PATTERNS = [
  ".git/",
  ".next/",
  ".nimi/local/",
  ".turbo/",
  "archive/",
  "dist/",
  "generated/",
  "node_modules/",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
];
export const FINDING_SEVERITY = new Set(["critical", "high", "medium", "low"]);
export const FINDING_ACTIONABILITY = new Set(["auto-fix", "needs-decision", "deferred-backlog"]);
export const FINDING_CONFIDENCE = new Set(["high", "medium", "low"]);
export const FINDING_DISPOSITION = new Set(["open", "remediated", "accepted-risk", "false-positive", "deferred-backlog"]);
export const RERUN_VERDICT = new Set(["not_reproduced", "still_reproduced", "manager_accepted", "deferred"]);
export const CHUNK_STATES = new Set(["planned", "dispatched", "ingested", "reviewed", "frozen", "failed", "skipped"]);
export const ACTIVE_CHUNK_STATES = new Set(["planned", "dispatched", "ingested", "reviewed"]);
export const SEVERITY_RANK = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function nowIso() {
  return new Date().toISOString();
}

export function toPosix(filePath) {
  return filePath.split(path.sep).join(path.posix.sep);
}

export function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

export function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function sha256Object(value) {
  return sha256Text(stableJson(value));
}

export function relPath(projectRoot, absolutePath) {
  return toPosix(path.relative(projectRoot, absolutePath));
}

export function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveInsideProject(projectRoot, inputPath, label) {
  const absolutePath = path.resolve(projectRoot, inputPath);
  if (!isPathInside(projectRoot, absolutePath)) {
    return {
      ok: false,
      error: `nimicoding audit-sweep refused: ${label} must stay inside the project root.\n`,
    };
  }

  return {
    ok: true,
    absolutePath,
    ref: relPath(projectRoot, absolutePath),
  };
}

export function normalizeCsv(value, fallback = []) {
  if (!value) {
    return [...fallback];
  }

  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function safeSweepId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,120}$/.test(value)) {
    return null;
  }

  return value;
}

export function deriveSweepId(targetRootRef, date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  const slug = targetRootRef
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "project";
  return `audit-sweep-${day}-${slug}`;
}

export function artifactRef(kind, ...parts) {
  return path.posix.join(AUDIT_SWEEP_ARTIFACT_ROOTS[kind], ...parts);
}

export function artifactPath(projectRoot, ref) {
  return path.join(projectRoot, ...ref.split("/"));
}

export async function writeYamlRef(projectRoot, ref, value) {
  const destination = artifactPath(projectRoot, ref);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, YAML.stringify(value), "utf8");
}

export async function writeJsonRef(projectRoot, ref, value) {
  const destination = artifactPath(projectRoot, ref);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function loadYamlRef(projectRoot, ref) {
  return loadYamlFile(artifactPath(projectRoot, ref));
}

export async function loadJsonFile(filePath) {
  try {
    return { ok: true, value: JSON.parse(await readFile(filePath, "utf8")) };
  } catch {
    return { ok: false, error: "must contain valid JSON" };
  }
}

export async function assertExistingFile(filePath, message) {
  const info = await pathExists(filePath);
  if (!info || !info.isFile()) {
    return { ok: false, error: message };
  }
  return { ok: true };
}

export function planRef(sweepId) {
  return artifactRef("plan_ref", `${sweepId}.yaml`);
}

export function chunkRef(sweepId, chunkId) {
  return artifactRef("chunk_refs", sweepId, `${chunkId}.yaml`);
}

export function findingsRef(sweepId) {
  return artifactRef("evidence_refs", sweepId, "findings.yaml");
}

export function runLedgerRef(sweepId) {
  return artifactRef("run_ledger_ref", `${sweepId}.jsonl`);
}

export function reportRef(sweepId, snapshotId) {
  return artifactRef("report_ref", sweepId, `${snapshotId}.md`);
}

export function ledgerRef(sweepId, snapshotId) {
  return artifactRef("ledger_ref", sweepId, `${snapshotId}.yaml`);
}

export function remediationMapRef(sweepId, snapshotId) {
  return artifactRef("remediation_map_ref", sweepId, `${snapshotId}.yaml`);
}

export function auditCloseoutRef(sweepId, snapshotId) {
  return artifactRef("audit_closeout_ref", sweepId, `${snapshotId}.yaml`);
}

export function packetRef(sweepId, chunkId) {
  return artifactRef("packet_ref", sweepId, `${chunkId}.auditor-packet.yaml`);
}

export async function appendRunEvent(projectRoot, sweepId, event) {
  const ref = runLedgerRef(sweepId);
  const destination = artifactPath(projectRoot, ref);
  await mkdir(path.dirname(destination), { recursive: true });
  await appendFile(destination, `${JSON.stringify({
    event_id: sha256Object({ sweepId, event, ordinal_hint: Date.now() }).slice(0, 16),
    sweep_id: sweepId,
    recorded_at: nowIso(),
    ...event,
  })}\n`, "utf8");
  return ref;
}

export async function loadPlan(projectRoot, sweepId) {
  const ref = planRef(sweepId);
  const plan = await loadYamlRef(projectRoot, ref);
  if (!isPlainObject(plan) || plan.kind !== "audit-plan" || plan.sweep_id !== sweepId) {
    return { ok: false, error: `nimicoding audit-sweep refused: plan not found for ${sweepId}.\n` };
  }
  return { ok: true, plan, planRef: ref };
}

export async function loadChunk(projectRoot, sweepId, chunkId) {
  const ref = chunkRef(sweepId, chunkId);
  const chunk = await loadYamlRef(projectRoot, ref);
  if (!isPlainObject(chunk) || chunk.kind !== "audit-chunk" || chunk.sweep_id !== sweepId || chunk.chunk_id !== chunkId) {
    return { ok: false, error: `nimicoding audit-sweep refused: chunk not found for ${sweepId}/${chunkId}.\n` };
  }
  return { ok: true, chunk, chunkRef: ref };
}

export async function loadFindings(projectRoot, sweepId) {
  const ref = findingsRef(sweepId);
  const existing = await loadYamlRef(projectRoot, ref);
  if (isPlainObject(existing) && existing.kind === "audit-findings" && existing.sweep_id === sweepId && Array.isArray(existing.findings)) {
    return { findingsRef: ref, store: existing };
  }

  return {
    findingsRef: ref,
    store: {
      version: 1,
      kind: "audit-findings",
      sweep_id: sweepId,
      findings: [],
      duplicate_count: 0,
      updated_at: nowIso(),
    },
  };
}

export async function loadLatestLedger(projectRoot, sweepId) {
  const latestRef = artifactRef("ledger_ref", sweepId, "latest.yaml");
  const pointer = await loadYamlRef(projectRoot, latestRef);
  if (!isPlainObject(pointer) || typeof pointer.ledger_ref !== "string") {
    return { ok: false, error: `nimicoding audit-sweep refused: latest ledger not found for ${sweepId}.\n` };
  }

  const ledger = await loadYamlRef(projectRoot, pointer.ledger_ref);
  if (!isPlainObject(ledger) || ledger.kind !== "audit-ledger" || ledger.sweep_id !== sweepId) {
    return { ok: false, error: `nimicoding audit-sweep refused: latest ledger is malformed for ${sweepId}.\n` };
  }

  return { ok: true, ledger, ledgerRef: pointer.ledger_ref, pointerRef: latestRef };
}

export function inputError(error) {
  return { ok: false, inputError: true, exitCode: 2, error };
}

export function ensureIsoTimestamp(value, label = "--verified-at") {
  if (!isIsoUtcTimestamp(value)) {
    return inputError(`nimicoding audit-sweep refused: ${label} must be an ISO-8601 UTC timestamp.\n`);
  }
  return null;
}
