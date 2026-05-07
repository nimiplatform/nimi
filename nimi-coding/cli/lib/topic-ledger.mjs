import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import { pathExists, readTextIfFile } from "./fs-helpers.mjs";
import { parseYamlText } from "./yaml-helpers.mjs";
import { loadTopicRuntimeAuthority, toPortableRelativePath } from "./topic-common.mjs";
import { isIsoUtcTimestamp, loadTopicReport } from "./topic-scaffold.mjs";
import { readFrontmatterObject } from "./topic-artifacts.mjs";

const RUN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateRunId(value) {
  return typeof value == "string" && RUN_ID_PATTERN.test(value);
}
export function runLedgerFilename(runId) {
  return `run-ledger-${runId}.yaml`;
}
export function runEventFilename(runId, eventIndex, eventKind) {
  return `run-event-${runId}-${String(eventIndex).padStart(4, "0")}-${eventKind}.yaml`;
}
export function stopClassToRunStatus(stopClass) {
  return stopClass === "continue"
    ? "running"
    : stopClass === "require_human_confirmation"
      ? "awaiting_human_confirmation"
      : stopClass === "await_external_evidence"
        ? "awaiting_external_evidence"
        : stopClass === "blocked"
          ? "blocked"
          : stopClass === "completed"
            ? "completed"
            : "blocked";
}
export function retryPostureForEvent(event) {
  return event.stop_class === "require_human_confirmation"
    ? "retry_forbidden_until_human_gate"
    : event.stop_class === "blocked"
      ? "retry_requires_new_packet"
      : event.stop_class === "await_external_evidence"
        ? "retry_allowed_same_command"
        : "not_applicable";
}
export function normalizeArtifactRefs(input) {
  const refs = {};
  for (const [key, value] of Object.entries(input ?? {}))
    typeof key == "string" &&
      key.length > 0 &&
      typeof value == "string" &&
      value.length > 0 &&
      (refs[key] = value);
  return refs;
}
export async function validatePortableRefExists(projectRoot, ref, label) {
  return path.isAbsolute(ref)
    ? `${label} must be project-relative: ${ref}`
    : (await pathExists(path.join(projectRoot, ref)))?.isFile()
      ? null
      : `${label} does not resolve to a file: ${ref}`;
}
export async function loadTopicRunEvents(topicDir, runId) {
  const entries = await readdir(topicDir, { withFileTypes: true }),
    events = [];
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.startsWith(`run-event-${runId}-`) ||
      !entry.name.endsWith(".yaml")
    )
      continue;
    const eventPath = path.join(topicDir, entry.name),
      eventText = await readTextIfFile(eventPath),
      event = parseYamlText(eventText ?? "");
    !event ||
      typeof event != "object" ||
      event.run_id !== runId ||
      events.push({ event, eventRef: entry.name, eventPath });
  }
  return events.sort((left, right) => {
    const leftIndex = Number(left.event.event_index ?? 0),
      rightIndex = Number(right.event.event_index ?? 0);
    return leftIndex - rightIndex || left.eventRef.localeCompare(right.eventRef);
  });
}
export function latestArtifactRef(events, key) {
  for (const entry of [...events].reverse()) {
    const value = entry.event.artifact_refs?.[key];
    if (typeof value == "string" && value.length > 0) return value;
  }
  return null;
}
export function buildCurrentHumanGate(events) {
  const gateClosingEvents = new Set(["human_gate_resolved", "wave_closed", "topic_closed"]);
  for (const entry of [...events].reverse()) {
    const event = entry.event;
    if (gateClosingEvents.has(event.event_kind)) return null;
    if (
      event.stop_class === "require_human_confirmation" ||
      event.event_kind === "human_gate_opened"
    )
      return {
        event_ref: entry.eventRef,
        wave_id: event.wave_id ?? null,
        recommended_action: event.recommended_action,
        summary: event.summary,
        source_ref: event.source_ref,
      };
  }
  return null;
}
export function buildTopicRunLedgerProjection(topic, runId, events, updatedAt) {
  const latest = events.at(-1) ?? null,
    latestEvent = latest?.event ?? null;
  return {
    ledger_id: `${topic.topic_id}:${runId}`,
    topic_id: topic.topic_id,
    run_id: runId,
    kind: "topic-run-ledger",
    run_status: latestEvent ? stopClassToRunStatus(latestEvent.stop_class) : "running",
    event_count: events.length,
    event_refs: events.map((entry) => entry.eventRef),
    latest_event_ref: latest?.eventRef ?? null,
    current_wave_id: latestEvent?.wave_id ?? topic.selected_next_target ?? null,
    latest_decision_ref: latestArtifactRef(events, "decision_ref"),
    latest_packet_ref: latestArtifactRef(events, "packet_ref"),
    latest_prompt_ref: latestArtifactRef(events, "prompt_ref"),
    latest_result_ref: latestArtifactRef(events, "result_ref"),
    latest_closeout_ref: latestArtifactRef(events, "closeout_ref"),
    current_human_gate: buildCurrentHumanGate(events),
    retry_posture: latestEvent ? retryPostureForEvent(latestEvent) : "not_applicable",
    updated_at: updatedAt,
  };
}
export async function writeTopicRunLedger(projectRoot, loaded, runId, events, updatedAt) {
  const ledger = buildTopicRunLedgerProjection(loaded.topic, runId, events, updatedAt),
    ledgerPath = path.join(loaded.topicDir, runLedgerFilename(runId));
  return (
    await writeFile(ledgerPath, YAML.stringify(ledger), "utf8"),
    {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
      runId,
      ledgerRef: toPortableRelativePath(path.relative(projectRoot, ledgerPath)),
      ledger,
    }
  );
}
export async function initTopicRunLedger(projectRoot, input, runId, startedAt = new Date().toISOString()) {
  if (!validateRunId(runId))
    return { ok: false, error: `Topic run ledger refused: invalid run id ${runId}` };
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const ledgerPath = path.join(loaded.topicDir, runLedgerFilename(runId));
  if ((await readTextIfFile(ledgerPath)) !== null)
    return { ok: false, error: `Topic run ledger already exists: ${runId}` };
  const report = await writeTopicRunLedger(projectRoot, loaded, runId, [], startedAt);
  return { ...report, runStatus: report.ledger.run_status, eventCount: report.ledger.event_count };
}
export async function recordTopicRunEvent(projectRoot, input, options) {
  if (!validateRunId(options.runId))
    return { ok: false, error: `Topic run event refused: invalid run id ${options.runId}` };
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!authority.topicRunLedger.eventKinds.includes(options.eventKind))
    return {
      ok: false,
      error: `Topic run event refused: unsupported event kind ${options.eventKind}`,
    };
  if (!authority.topicStepDecision.stopClasses.includes(options.stopClass))
    return {
      ok: false,
      error: `Topic run event refused: unsupported stop class ${options.stopClass}`,
    };
  if (!authority.topicStepDecision.recommendedActions.includes(options.recommendedAction))
    return {
      ok: false,
      error: `Topic run event refused: unsupported recommended action ${options.recommendedAction}`,
    };
  if (!isIsoUtcTimestamp(options.recordedAt))
    return {
      ok: false,
      error: `Topic run event refused: --verified-at must be an ISO-8601 UTC timestamp: ${options.recordedAt}`,
    };
  if (!options.sourceRef || !options.summary)
    return { ok: false, error: "Topic run event refused: --source and --summary are required" };
  const sourceError = await validatePortableRefExists(projectRoot, options.sourceRef, "source_ref");
  if (sourceError) return { ok: false, error: `Topic run event refused: ${sourceError}` };
  const ledgerPath = path.join(loaded.topicDir, runLedgerFilename(options.runId));
  if ((await readTextIfFile(ledgerPath)) === null)
    return {
      ok: false,
      error: `Topic run event refused: run ledger does not exist: ${options.runId}`,
    };
  const artifactRefs = normalizeArtifactRefs(options.artifactRefs),
    invalidArtifactKeys = Object.keys(artifactRefs).filter(
      (key) => !authority.topicRunLedger.artifactRefKeys.includes(key),
    );
  if (invalidArtifactKeys.length > 0)
    return {
      ok: false,
      error: `Topic run event refused: unsupported artifact ref keys: ${invalidArtifactKeys.join(", ")}`,
    };
  for (const [key, ref] of Object.entries(artifactRefs)) {
    const artifactError = await validatePortableRefExists(projectRoot, ref, key);
    if (artifactError) return { ok: false, error: `Topic run event refused: ${artifactError}` };
  }
  const eventIndex = (await loadTopicRunEvents(loaded.topicDir, options.runId)).length + 1,
    event = {
      event_id: `${options.runId}:${String(eventIndex).padStart(4, "0")}:${options.eventKind}`,
      topic_id: loaded.topicId,
      run_id: options.runId,
      event_index: eventIndex,
      event_kind: options.eventKind,
      stop_class: options.stopClass,
      recommended_action: options.recommendedAction,
      wave_id: options.waveId ?? loaded.topic.selected_next_target ?? null,
      source_ref: options.sourceRef,
      summary: options.summary,
      recorded_at: options.recordedAt,
      artifact_refs: artifactRefs,
    },
    eventPath = path.join(
      loaded.topicDir,
      runEventFilename(options.runId, eventIndex, options.eventKind),
    );
  await writeFile(eventPath, YAML.stringify(event), "utf8");
  const updatedEvents = await loadTopicRunEvents(loaded.topicDir, options.runId),
    report = await writeTopicRunLedger(
      projectRoot,
      loaded,
      options.runId,
      updatedEvents,
      options.recordedAt,
    );
  return {
    ...report,
    eventId: event.event_id,
    eventRef: toPortableRelativePath(path.relative(projectRoot, eventPath)),
    runStatus: report.ledger.run_status,
    eventCount: report.ledger.event_count,
  };
}
export async function buildTopicRunLedger(
  projectRoot,
  input,
  runId,
  updatedAt = new Date().toISOString(),
) {
  if (!validateRunId(runId))
    return { ok: false, error: `Topic run ledger refused: invalid run id ${runId}` };
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const ledgerPath = path.join(loaded.topicDir, runLedgerFilename(runId));
  if ((await readTextIfFile(ledgerPath)) === null)
    return { ok: false, error: `Topic run ledger not found: ${runId}` };
  const events = await loadTopicRunEvents(loaded.topicDir, runId),
    report = await writeTopicRunLedger(projectRoot, loaded, runId, events, updatedAt);
  return { ...report, runStatus: report.ledger.run_status, eventCount: report.ledger.event_count };
}
export async function readTopicRunLedger(projectRoot, input, runId) {
  if (!validateRunId(runId))
    return { ok: false, error: `Topic run ledger refused: invalid run id ${runId}` };
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const ledgerPath = path.join(loaded.topicDir, runLedgerFilename(runId)),
    ledgerText = await readTextIfFile(ledgerPath);
  if (ledgerText === null) return { ok: false, error: `Topic run ledger not found: ${runId}` };
  const ledger = parseYamlText(ledgerText);
  return {
    ok: true,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
    runId,
    ledgerRef: toPortableRelativePath(path.relative(projectRoot, ledgerPath)),
    ledger,
    runStatus: ledger.run_status,
    eventCount: ledger.event_count,
  };
}
