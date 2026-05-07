import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadAuthorityConvergencePolicy } from "./authority-convergence.mjs";
import { loadTopicRuntimeContracts } from "./contracts.mjs";
import { readTextIfFile } from "./fs-helpers.mjs";
import { fileReferencesWave } from "./topic-lifecycle-artifacts.mjs";
import {
  DEFAULT_TOPIC_RUNTIME_AUTHORITY,
  PENDING_ENTRY_BLOCKER_STATES,
  WAVE_ID_PATTERN,
  loadTopicRuntimeAuthority,
  toPortableRelativePath,
} from "./topic-common.mjs";
import { pendingNoteFilename, readFrontmatterObject } from "./topic-artifacts.mjs";
import {
  buildTopicNow,
  findDeterministicNextWave,
  getTopicWaves,
  isIsoUtcTimestamp,
  loadTopicReport,
  moveTopicDirectoryForState,
  topicHasEnrichedShape,
  writeTopicYaml,
} from "./topic-scaffold.mjs";

export async function collectWaveArtifactEvidence(topicDir, waveId) {
  const files = (await readdir(topicDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  return {
    packetRefs: files.filter(
      (name) => name.startsWith("packet-") && fileReferencesWave(name, waveId),
    ),
    resultRefs: files.filter(
      (name) => name.startsWith("result-") && fileReferencesWave(name, waveId),
    ),
    closeoutRefs: files.filter(
      (name) => name.startsWith("closeout-") && fileReferencesWave(name, waveId),
    ),
    remediationRefs: files.filter(
      (name) => name.includes("remediation") && fileReferencesWave(name, waveId),
    ),
    overflowRefs: files.filter(
      (name) => name.includes("overflow-continuation") && fileReferencesWave(name, waveId),
    ),
  };
}
export async function loadPendingNote(topicDir) {
  const notePath = path.join(topicDir, pendingNoteFilename()),
    noteText = await readTextIfFile(notePath);
  if (noteText === null)
    return { ok: false, notePath, error: `Missing pending note artifact: ${pendingNoteFilename()}` };
  const note = readFrontmatterObject(noteText);
  return note
    ? { ok: true, notePath, note }
    : { ok: false, notePath, error: "Pending note artifact frontmatter is invalid" };
}
export function getPendingEntryBlockers(topic) {
  return getTopicWaves(topic)
    .filter((entry) => PENDING_ENTRY_BLOCKER_STATES.has(entry.state))
    .map((entry) => `${entry.wave_id}:${entry.state}`);
}
export async function loadTopicValidationPolicy(projectRoot) {
  const parsed = (await loadTopicRuntimeContracts(projectRoot)).validationPolicy.data,
    entries = Array.isArray(parsed?.topic_validation_policy?.ignore_for_default_validate)
      ? parsed.topic_validation_policy.ignore_for_default_validate
      : [],
    ignoredTopicIds = new Map();
  for (const entry of entries)
    entry &&
      typeof entry.topic_id == "string" &&
      entry.topic_id.length > 0 &&
      ignoredTopicIds.set(entry.topic_id, {
        reason: typeof entry.reason == "string" ? entry.reason : null,
        posture: typeof entry.posture == "string" ? entry.posture : null,
      });
  const semantics = parsed?.topic_validation_policy?.ignored_topic_validate_semantics ?? {};
  return {
    ignoredTopicIds,
    ignoredTopicValidateSemantics: {
      status:
        typeof semantics.status == "string"
          ? semantics.status
          : DEFAULT_TOPIC_RUNTIME_AUTHORITY.ignoredTopicValidateSemantics.status,
      canonicalSuccess:
        typeof semantics.canonical_success == "boolean"
          ? semantics.canonical_success
          : DEFAULT_TOPIC_RUNTIME_AUTHORITY.ignoredTopicValidateSemantics.canonicalSuccess,
    },
  };
}
export function validateWaveId(value) {
  return WAVE_ID_PATTERN.test(value);
}
export function normalizeDeps(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}
export function validateGraphFromTopic(topic) {
  const waves = getTopicWaves(topic),
    checks = [],
    warnings = [],
    waveIds = waves.map((entry) => entry.wave_id),
    uniqueWaveIds = new Set(waveIds);
  checks.push({
    id: "wave_ids_unique",
    ok: uniqueWaveIds.size === waveIds.length,
    reason:
      uniqueWaveIds.size === waveIds.length
        ? "wave ids are unique"
        : "duplicate wave ids exist in topic.yaml waves[]",
  });
  const invalidWaveIds = waveIds.filter((entry) => !validateWaveId(entry));
  checks.push({
    id: "wave_ids_valid",
    ok: invalidWaveIds.length === 0,
    reason:
      invalidWaveIds.length === 0
        ? "wave ids use the canonical wave-<n>-slug shape"
        : `invalid wave ids: ${invalidWaveIds.join(", ")}`,
  });
  const missingDeps = [],
    selectedWaveIds = [],
    retiredSelected = [];
  for (const wave of waves) {
    const deps = normalizeDeps(wave.deps);
    for (const dep of deps) uniqueWaveIds.has(dep) || missingDeps.push(`${wave.wave_id}->${dep}`);
    (wave.selected === true && selectedWaveIds.push(wave.wave_id),
      wave.selected === true &&
        ["retired", "superseded"].includes(wave.state) &&
        retiredSelected.push(wave.wave_id));
  }
  (checks.push({
    id: "wave_dependencies_resolve",
    ok: missingDeps.length === 0,
    reason:
      missingDeps.length === 0
        ? "all wave dependencies resolve inside the topic"
        : `missing dependency refs: ${missingDeps.join(", ")}`,
  }),
    checks.push({
      id: "selected_wave_unique",
      ok: selectedWaveIds.length <= 1,
      reason:
        selectedWaveIds.length <= 1
          ? "selected wave is unique"
          : `multiple selected waves exist: ${selectedWaveIds.join(", ")}`,
    }));
  const selectedMatchesTopicTarget =
    selectedWaveIds.length === 0
      ? topic.selected_next_target === "topic_design_baseline" ||
        topic.selected_next_target === null
      : selectedWaveIds[0] === topic.selected_next_target;
  (checks.push({
    id: "selected_wave_matches_topic_target",
    ok: selectedMatchesTopicTarget,
    reason: selectedMatchesTopicTarget
      ? "selected wave matches topic.selected_next_target"
      : `selected wave and topic.selected_next_target diverge (${selectedWaveIds[0] ?? "none"} vs ${topic.selected_next_target ?? "none"})`,
  }),
    checks.push({
      id: "retired_or_superseded_not_selected",
      ok: retiredSelected.length === 0,
      reason:
        retiredSelected.length === 0
          ? "retired or superseded waves are not selected"
          : `retired/superseded waves remain selected: ${retiredSelected.join(", ")}`,
    }));
  const visiting = new Set(),
    visited = new Set();
  let cycleRef = null;
  const waveMap = new Map(waves.map((wave) => [wave.wave_id, wave]));
  function dfs(waveId, trail = []) {
    if (cycleRef) return;
    if (visiting.has(waveId)) {
      cycleRef = [...trail, waveId].join(" -> ");
      return;
    }
    if (visited.has(waveId)) return;
    visiting.add(waveId);
    const wave = waveMap.get(waveId);
    if (wave) for (const dep of normalizeDeps(wave.deps)) dfs(dep, [...trail, waveId]);
    (visiting.delete(waveId), visited.add(waveId));
  }
  for (const waveId of waveIds) dfs(waveId);
  return (
    checks.push({
      id: "graph_acyclic",
      ok: cycleRef === null,
      reason:
        cycleRef === null ? "wave graph is acyclic" : `wave graph contains a cycle: ${cycleRef}`,
    }),
    waves.length === 0 && warnings.push("topic has no machine wave registry yet"),
    { ok: checks.every((entry) => entry.ok), checks, warnings, waves }
  );
}
export async function validateTopicGraph(projectRoot, input = null) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return { ok: false, error: loaded.error, checks: [], warnings: [] };
  const { validateTopicRoot } = await import("./topic-root-validation.mjs");
  const rootValidation = await validateTopicRoot(projectRoot, input);
  if (!rootValidation.ok) return rootValidation;
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority))
    return {
      ...rootValidation,
      ok: false,
      checks: [
        ...rootValidation.checks,
        {
          id: "enriched_topic_required_for_wave_graph",
          ok: false,
          reason: "wave graph commands require an enriched topic root",
        },
      ],
      warnings: rootValidation.warnings,
    };
  const graph = validateGraphFromTopic(loaded.topic);
  return {
    ...rootValidation,
    ok: rootValidation.ok && graph.ok,
    checks: [...rootValidation.checks, ...graph.checks],
    warnings: [...rootValidation.warnings, ...graph.warnings],
    waveCount: graph.waves.length,
  };
}
export async function validateWaveAdmission(projectRoot, input, waveId) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return { ok: false, error: loaded.error, checks: [], warnings: [] };
  const graphReport = await validateTopicGraph(projectRoot, input),
    wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === waveId) ?? null,
    checks = [...(graphReport.checks ?? [])],
    warnings = [...(graphReport.warnings ?? [])];
  if (
    (checks.push({
      id: "wave_exists",
      ok: wave !== null,
      reason: wave ? "wave exists in topic.yaml waves[]" : `wave does not exist: ${waveId}`,
    }),
    !wave)
  )
    return { ...graphReport, ok: false, checks, warnings };
  const dispatchableState = !["retired", "superseded", "closed", "overflowed"].includes(wave.state);
  (checks.push({
    id: "wave_state_dispatchable",
    ok: dispatchableState,
    reason: dispatchableState
      ? "wave state is eligible for admission"
      : `wave state is not admissible: ${wave.state}`,
  }),
    checks.push({
      id: "wave_selected",
      ok: wave.selected === true,
      reason: wave.selected === true ? "wave is selected" : "wave must be selected before admission",
    }),
    checks.push({
      id: "selected_target_matches_wave",
      ok: loaded.topic.selected_next_target === waveId,
      reason:
        loaded.topic.selected_next_target === waveId
          ? "topic.selected_next_target matches the wave"
          : `topic.selected_next_target does not match wave (${loaded.topic.selected_next_target ?? "none"} vs ${waveId})`,
    }));
  const waveMap = new Map(getTopicWaves(loaded.topic).map((entry) => [entry.wave_id, entry])),
    unmetDeps = normalizeDeps(wave.deps).filter((dep) => waveMap.get(dep)?.state !== "closed");
  checks.push({
    id: "upstream_dependencies_closed",
    ok: unmetDeps.length === 0,
    reason:
      unmetDeps.length === 0
        ? "all upstream dependencies are closed"
        : `upstream dependencies are not closed: ${unmetDeps.join(", ")}`,
  });
  const waveStateAllowedForAdmit = ["candidate", "preflight_draft", "needs_revision"].includes(
    wave.state,
  );
  return (
    checks.push({
      id: "wave_state_allows_preflight_admission",
      ok: waveStateAllowedForAdmit,
      reason: waveStateAllowedForAdmit
        ? "wave state can move to preflight_admitted"
        : `wave state cannot move to preflight_admitted from ${wave.state}`,
    }),
    { ...graphReport, ok: graphReport.ok && checks.every((entry) => entry.ok), checks, warnings }
  );
}
export async function addWaveToTopic(projectRoot, input, wave) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority))
    return { ok: false, error: "Wave commands require an enriched topic root." };
  const waves = getTopicWaves(loaded.topic);
  if (waves.some((entry) => entry.wave_id === wave.wave_id))
    return { ok: false, error: `Wave already exists: ${wave.wave_id}` };
  waves.push(wave);
  const graphPreview = validateGraphFromTopic({ ...loaded.topic, waves }),
    failedCheck = graphPreview.checks.find((entry) => !entry.ok);
  return failedCheck
    ? {
        ok: false,
        error: `Wave add refused: ${failedCheck.reason}`,
        checks: graphPreview.checks,
        warnings: graphPreview.warnings,
      }
    : ((loaded.topic.waves = waves),
      await writeTopicYaml(loaded.topicYamlPath, loaded.topic),
      {
        ok: true,
        topicId: loaded.topicId,
        topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
        waveId: wave.wave_id,
        waveState: wave.state,
      });
}
export async function selectWaveInTopic(projectRoot, input, waveId) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority))
    return { ok: false, error: "Wave commands require an enriched topic root." };
  const waves = getTopicWaves(loaded.topic),
    wave = waves.find((entry) => entry.wave_id === waveId);
  if (!wave) return { ok: false, error: `Wave not found: ${waveId}` };
  if (["retired", "superseded", "closed", "overflowed"].includes(wave.state))
    return {
      ok: false,
      error: `Wave select refused: ${waveId} is not selectable from state ${wave.state}`,
    };
  for (const entry of waves) entry.selected = entry.wave_id === waveId;
  return (
    (loaded.topic.waves = waves),
    (loaded.topic.selected_next_target = waveId),
    (loaded.topic.last_transition_at = buildTopicNow()),
    (loaded.topic.last_transition_reason = `selected_${waveId}_as_next_execution_target`),
    await writeTopicYaml(loaded.topicYamlPath, loaded.topic),
    {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
      waveId,
      selectedNextTarget: loaded.topic.selected_next_target,
    }
  );
}
export async function admitWaveInTopic(projectRoot, input, waveId) {
  let validation = await validateWaveAdmission(projectRoot, input, waveId);
  if (!validation.ok) {
    const loadedForSelection = await loadTopicReport(projectRoot, input),
      wavesForSelection = getTopicWaves(loadedForSelection.topic),
      waveForSelection = wavesForSelection.find((entry) => entry.wave_id === waveId),
      terminalIds = new Set(
        wavesForSelection
          .filter((entry) => ["closed", "retired", "superseded"].includes(entry.state))
          .map((entry) => entry.wave_id),
      ),
      depsClosed =
        waveForSelection &&
        (Array.isArray(waveForSelection.deps) ? waveForSelection.deps : []).every((dep) =>
          terminalIds.has(dep),
        ),
      canSelectForAdmission =
        loadedForSelection.ok &&
        (loadedForSelection.topic.selected_next_target === null ||
          loadedForSelection.topic.selected_next_target === "topic_design_baseline") &&
        waveForSelection &&
        ["candidate", "preflight_draft", "needs_revision"].includes(waveForSelection.state) &&
        depsClosed;
    if (canSelectForAdmission) {
      const selected = await selectWaveInTopic(projectRoot, input, waveId);
      if (!selected.ok) return selected;
      validation = await validateWaveAdmission(projectRoot, input, waveId);
    }
  }
  if (!validation.ok) return validation;
  const loaded = await loadTopicReport(projectRoot, input),
    waves = getTopicWaves(loaded.topic),
    wave = waves.find((entry) => entry.wave_id === waveId);
  ((wave.state = "preflight_admitted"), (loaded.topic.waves = waves));
  let nextState = loaded.topic.state;
  (["proposal", "pending"].includes(loaded.topic.state) &&
    ((nextState = "ongoing"), (loaded.topic.state = nextState)),
    (loaded.topic.last_transition_at = buildTopicNow()),
    (loaded.topic.last_transition_reason = `wave_${waveId}_preflight_admitted`));
  const moved = await moveTopicDirectoryForState(
    projectRoot,
    loaded.topicDir,
    loaded.topicId,
    nextState,
  );
  return (
    await writeTopicYaml(moved.topicYamlPath, loaded.topic),
    {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, moved.topicDir)),
      waveId,
      waveState: wave.state,
      state: loaded.topic.state,
    }
  );
}
