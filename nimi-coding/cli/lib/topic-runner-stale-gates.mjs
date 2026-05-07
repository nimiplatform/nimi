import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import { recordTopicRunEvent } from "./topic.mjs";

function toPortablePath(value) {
  return value.split(path.sep).join("/");
}

function projectRef(projectRoot, absolutePath) {
  return toPortablePath(path.relative(projectRoot, absolutePath));
}

function hasPlaceholder(value) {
  return /<[^>]+>/.test(value);
}

function isConcreteTopicExpectedRef(ref) {
  return typeof ref === "string"
    && ref.length > 0
    && !hasPlaceholder(ref)
    && !path.isAbsolute(ref)
    && !ref.includes("..");
}

async function refExists(projectRoot, ref) {
  try {
    return (await stat(path.join(projectRoot, ref))).isFile();
  } catch {
    return false;
  }
}

async function loadRunEventByRef(loaded, eventRef) {
  if (!eventRef || path.isAbsolute(eventRef) || eventRef.includes("..")) {
    return null;
  }
  try {
    return YAML.parse(await readFile(path.join(loaded.topicDir, eventRef), "utf8"));
  } catch {
    return null;
  }
}

async function loadDecisionByRef(projectRoot, decisionRef) {
  if (!decisionRef || path.isAbsolute(decisionRef) || decisionRef.includes("..")) {
    return null;
  }
  try {
    return JSON.parse(await readFile(path.join(projectRoot, decisionRef), "utf8"));
  } catch {
    return null;
  }
}

async function concreteExpectedArtifactRefs(projectRoot, loaded, expectedArtifacts) {
  const refs = [];
  for (const artifact of expectedArtifacts ?? []) {
    if (!isConcreteTopicExpectedRef(artifact)) {
      return null;
    }
    const absolutePath = path.join(loaded.topicDir, artifact);
    const ref = projectRef(projectRoot, absolutePath);
    if (!await refExists(projectRoot, ref)) {
      return null;
    }
    refs.push(ref);
  }
  return refs.length > 0 ? refs : null;
}

function staleGateCanBeResolvedByEvidence(previousDecision, currentDecision) {
  if (!previousDecision || !currentDecision) return false;
  if (currentDecision.stop_class !== "continue") return false;
  if ((currentDecision.blocking_checks ?? []).length > 0) return false;
  if (previousDecision.stop_class !== "require_human_confirmation") return false;
  if (previousDecision.recommended_action !== "record_result") return false;
  return [
    "implementation_admission_result_required",
    "spec_update_review_required",
  ].includes(previousDecision.reason_code);
}

export async function maybeResolveStaleHumanGate(projectRoot, options, loaded, ledgerReport, currentDecision, recordedAt) {
  const gate = ledgerReport?.ledger?.current_human_gate;
  if (!gate) {
    return { ok: true, ledger: ledgerReport, resolved: false };
  }
  const gateEvent = await loadRunEventByRef(loaded, gate.event_ref);
  const previousDecision = await loadDecisionByRef(projectRoot, gateEvent?.artifact_refs?.decision_ref);
  if (!staleGateCanBeResolvedByEvidence(previousDecision, currentDecision)) {
    return { ok: true, ledger: ledgerReport, resolved: false };
  }
  const expectedRefs = await concreteExpectedArtifactRefs(projectRoot, loaded, previousDecision.expected_artifacts);
  if (!expectedRefs) {
    return { ok: true, ledger: ledgerReport, resolved: false };
  }
  const resultRef = expectedRefs.find((ref) => path.basename(ref).startsWith("result-")) ?? expectedRefs[0];
  const report = await recordTopicRunEvent(projectRoot, options.topicInput, {
    runId: options.runId,
    eventKind: "human_gate_resolved",
    stopClass: "continue",
    recommendedAction: previousDecision.recommended_action,
    sourceRef: resultRef,
    summary: `${previousDecision.reason_code}_resolved_by_existing_evidence`,
    recordedAt,
    waveId: previousDecision.wave_id,
    artifactRefs: resultRef ? { result_ref: resultRef } : {},
  });
  return report.ok
    ? { ok: true, ledger: report, resolved: true, resultRef }
    : report;
}
