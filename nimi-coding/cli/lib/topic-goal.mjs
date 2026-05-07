import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pathExists, readTextIfFile } from "./fs-helpers.mjs";
import { loadTopicReport, validateTopicGraph, validateTopicRoot } from "./topic.mjs";
import { parseYamlText } from "./yaml-helpers.mjs";
import { loadGovernanceConfig } from "./internal/governance/config.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TOPIC_GOAL_CONTRACT_REF = "nimi-coding/contracts/topic-goal.schema.yaml";
const HOST_TOPIC_GOAL_CONTRACT_REF = ".nimi/contracts/topic-goal.schema.yaml";
const FORBIDDEN_SHORTCUTS_REF = "nimi-coding/contracts/forbidden-shortcuts.catalog.yaml";
const HOST_FORBIDDEN_SHORTCUTS_REF = ".nimi/contracts/forbidden-shortcuts.catalog.yaml";
const GOAL_COMMAND_MAX_CHARS = 1500;

const REQUIRED_ARTIFACTS = [
  "topic.yaml",
  "design.md",
  "waves.md",
  "candidate-wave-plan.md",
  "admission-checklists.md",
  "preflight.md",
  "implementation-doctrine.md",
  "manager-session-protocol.md",
  "manager-prompts.md",
  "closeout.md",
];

const REQUIRED_STOP_KEYS = [
  "mvp_subset_contract",
  "legacy_alias",
  "compat_shim",
  "dual_read",
  "dual_write",
  "placeholder_success",
  "happy_path_only_closure",
  "time_phased_layering",
  "app_local_shadow_truth",
  "silent_owner_cut_reopen",
];

const EXECUTION_STAGE_WAVE_STATES = new Set(["preflight_admitted", "implementation_admitted", "implementation_active"]);
const ADMISSION_READY_WAVE_STATES = new Set(["candidate", "preflight_draft", "needs_revision"]);
const TERMINAL_WAVE_STATES = new Set(["closed", "retired", "superseded"]);
const WAVE_ID_PATTERN = /^wave-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CHECK_REASON = {
  topic_validate_passed: "topic_validate_failed",
  topic_graph_validate_passed: "topic_graph_validate_failed",
  topic_lifecycle_ongoing: "topic_not_ongoing",
  true_close_not_started: "true_close_not_started_required",
  strict_policy_active: "strict_policy_ignored",
  parallel_truth_forbidden: "parallel_truth_not_forbidden",
  profile_resolves: "unknown_profile",
  selected_target_wave_resolves: "selected_target_not_wave",
  selected_wave_single_source: "selected_wave_mismatch",
  wave_option_matches_selected: "wave_override_forbidden",
  selected_wave_executable: "selected_wave_not_executable",
  selected_wave_dependencies_terminal: "dependency_not_terminal",
  selected_wave_goal_present: "missing_primary_closure_goal",
  forbidden_shortcuts_present: "forbidden_shortcuts_incomplete",
  forbidden_shortcuts_catalog_aligned: "forbidden_shortcuts_catalog_drift",
  required_artifacts_present: "required_artifact_missing",
  no_unresolved_placeholders: "unresolved_placeholder",
  stop_line_declared: "stop_line_missing",
  human_gates_declared: "human_gates_missing",
  validation_commands_declared: "validation_commands_missing",
  closeout_criteria_declared: "closeout_criteria_missing",
  authority_owner_declared: "authority_owner_missing",
  work_type_declared: "work_type_missing",
  authority_change_admitted: "authority_alignment_missing",
  host_projection_aligned: "host_projection_drift",
  goal_size_within_limit: "goal_too_large",
};

function toPortableRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function projectRef(projectRoot, absolutePath) {
  return toPortableRelativePath(path.relative(projectRoot, absolutePath));
}

function packagePath(relativePath) {
  return path.join(PACKAGE_ROOT, relativePath.replace(/^nimi-coding\//, ""));
}

function check(id, ok, message, extra = {}) {
  return {
    id,
    status: ok ? "pass" : "fail",
    severity: ok ? "info" : "blocking",
    message,
    ...extra,
  };
}

function sectionText(markdown, sectionTitle) {
  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|$(?![\\s\\S]))`, "im"));
  return match ? match[1].trim() : "";
}

function hasSectionBullet(markdown, sectionTitle) {
  return /^[-*]\s+\S/m.test(sectionText(markdown, sectionTitle));
}

function hasUnresolvedPlaceholder(text) {
  return /(?<![A-Za-z-])(?:TODO|TBD|FIXME|XXX)(?![A-Za-z-])/i.test(text)
    || /<\s*(?:placeholder|place-holder|fill-me|missing)\s*>/i.test(text)
    || /\?\?\?/.test(text);
}

function normalizeCommandText(command) {
  return String(command ?? "").replace(/\s+/g, " ").trim();
}

function validationCommandScope(command) {
  const scopeMatch = command.match(/(?:^|\s)--scope\s+([^\s]+)/u);
  if (scopeMatch) {
    return scopeMatch[1];
  }
  if (command.includes("topic validate graph")) {
    return "graph";
  }
  if (command.includes("topic validate")) {
    return "topic";
  }
  if (command.includes("test")) {
    return "test";
  }
  return "selected wave";
}

function validationCommandEntry(command) {
  const normalized = normalizeCommandText(command);
  return {
    command: normalized,
    cwd: ".",
    profile: null,
    scope: validationCommandScope(normalized),
    required: true,
    expected_exit_code: 0,
  };
}

function mergeValidationCommandEntries(entries) {
  const seen = new Set();
  const output = [];
  for (const entry of entries) {
    if (!entry.command || seen.has(entry.command)) {
      continue;
    }
    seen.add(entry.command);
    output.push(entry);
  }
  return output;
}

function parseValidationCommands(artifactTexts) {
  const commands = [];
  const commandPattern = /\b(?:pnpm|npm|npx|node|go|cargo)\s+[^\n`]+/g;
  for (const { text } of artifactTexts) {
    for (const match of text.matchAll(commandPattern)) {
      const command = normalizeCommandText(match[0].replace(/[.)\]]+$/u, ""));
      if (command.includes("<") || command.includes("topic goal")) {
        continue;
      }
      if (command.length > 0 && !commands.includes(command)) {
        commands.push(command);
      }
    }
  }
  return commands.map(validationCommandEntry);
}

function selectedWaveValidationCommands(selectedWave) {
  const commands = [
    ...(Array.isArray(selectedWave?.validation_commands) ? selectedWave.validation_commands : []),
    ...(Array.isArray(selectedWave?.source_sweep_design?.validation_commands) ? selectedWave.source_sweep_design.validation_commands : []),
  ];
  return commands
    .map(normalizeCommandText)
    .filter((command) => command.length > 0)
    .map(validationCommandEntry);
}

function parseHumanGates(preflightText) {
  return sectionText(preflightText, "Human Gates")
    .split("\n")
    .map((line) => line.match(/^[-*]\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean);
}

async function resolveProfile(projectRoot, requestedProfile) {
  const governance = await loadGovernanceConfig(projectRoot);
  const hostText = await readTextIfFile(path.join(projectRoot, ".nimi", "config", "host-profile.yaml"))
    ?? await readTextIfFile(path.join(PACKAGE_ROOT, "config", "host-profile.yaml"));
  const hostProfile = parseYamlText(hostText)?.host_profile?.id ?? null;
  const defaultProfile = governance.ok ? governance.config.profileId : hostProfile;
  const effectiveProfile = requestedProfile ?? defaultProfile;
  return {
    ok: typeof effectiveProfile === "string"
      && effectiveProfile.length > 0
      && effectiveProfile === defaultProfile,
    profile: effectiveProfile,
    defaultProfile,
  };
}

async function loadForbiddenShortcutsCatalog(projectRoot) {
  const canonicalText = await readTextIfFile(packagePath(FORBIDDEN_SHORTCUTS_REF));
  const hostText = await readTextIfFile(path.join(projectRoot, HOST_FORBIDDEN_SHORTCUTS_REF));
  const catalog = parseYamlText(canonicalText);
  const keys = Array.isArray(catalog?.entries)
    ? catalog.entries.map((entry) => entry?.key).filter((key) => typeof key === "string")
    : [];
  return {
    keys,
    aligned: hostText === null || hostText === canonicalText,
  };
}

async function loadSourceArtifacts(topicDir) {
  const artifactTexts = [];
  const missing = [];
  for (const fileName of REQUIRED_ARTIFACTS) {
    const artifactPath = path.join(topicDir, fileName);
    const text = await readTextIfFile(artifactPath);
    if (text === null) {
      missing.push(fileName);
    } else {
      artifactTexts.push({ ref: fileName, text });
    }
  }
  return { artifactTexts, missing };
}

function fileReferencesWave(fileName, waveId) {
  return fileName.includes(waveId) || fileName.includes(waveId.replace(/^wave-/, "wave-"));
}

async function collectLineageArtifacts(topicDir, waveIds) {
  const entries = await readdir(topicDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^(packet|result|closeout)-/.test(name))
    .filter((name) => waveIds.some((waveId) => fileReferencesWave(name, waveId)))
    .sort();
}

function selectedWaveResolution(topic) {
  const waves = Array.isArray(topic.waves) ? topic.waves : [];
  const selectedTarget = typeof topic.selected_next_target === "string" ? topic.selected_next_target : null;
  const matchingWaves = selectedTarget === null ? [] : waves.filter((wave) => wave.wave_id === selectedTarget);
  const selectedWaves = waves.filter((wave) => wave.selected === true);
  const terminalIds = new Set(waves.filter((wave) => TERMINAL_WAVE_STATES.has(wave.state)).map((wave) => wave.wave_id));
  const allWavesTerminal = waves.length > 0 && waves.every((wave) => TERMINAL_WAVE_STATES.has(wave.state));
  const deterministicNextWave = allWavesTerminal ? null : waves.find((wave) => {
    if (TERMINAL_WAVE_STATES.has(wave.state)) return false;
    if (!ADMISSION_READY_WAVE_STATES.has(wave.state)) return false;
    const deps = Array.isArray(wave.deps) ? wave.deps : [];
    return deps.every((dep) => terminalIds.has(dep));
  }) ?? null;
  const selectedWave = matchingWaves.length === 1 ? matchingWaves[0] : null;
  const executionStartWave = selectedWave ?? deterministicNextWave;
  return {
    waves,
    selectedTarget,
    selectedWave,
    executionStartWave,
    deterministicNextWave,
    allWavesTerminal,
    matchingWaveCount: matchingWaves.length,
    selectedWaves,
  };
}

function dependencyEvidence(lineageRefs, depId) {
  return lineageRefs.some((ref) => fileReferencesWave(ref, depId) && /^(result|closeout)-/.test(ref));
}

function buildGoalCommand(topicId, executionStartWave, sourceArtifacts) {
  const artifactList = sourceArtifacts.map((ref) => path.basename(ref)).join(", ");
  const cursorClause = executionStartWave
    ? `, starting at execution cursor ${executionStartWave.wave_id}`
    : "";
  return `/goal Execute topic ${topicId} to completion${cursorClause}. This is a topic-level goal: do not mark complete after a single wave closeout. Use nimicoding topic-runner run ${topicId} --run-id <run-id> --adapter codex to advance deterministic wave admission, preflight, implementation, validation, result recording, wave closeout, and next-wave selection. Treat ${artifactList} as the execution contract. Wave closeout is a validation boundary only. Complete only after all waves are terminal and topic true-close/closeout evidence is recorded. Stop only for declared human gates, authority/scope changes, lowered gates, destructive evidence deletion, unresolved blockers, or required contract changes.`;
}

async function checkHostProjection(projectRoot) {
  const canonicalText = await readTextIfFile(packagePath(TOPIC_GOAL_CONTRACT_REF));
  const hostPath = path.join(projectRoot, HOST_TOPIC_GOAL_CONTRACT_REF);
  const hostInfo = await pathExists(hostPath);
  if (!hostInfo) {
    return { ok: true, message: "host topic-goal projection is absent" };
  }
  const hostText = await readTextIfFile(hostPath);
  return {
    ok: canonicalText !== null && hostText === canonicalText,
    message: canonicalText !== null && hostText === canonicalText
      ? "host topic-goal schema projection matches the package contract"
      : "host topic-goal schema projection differs from the package contract",
  };
}

function buildStateHash(artifactTexts, extraTexts) {
  const hash = createHash("sha256");
  for (const artifact of [...artifactTexts, ...extraTexts].sort((a, b) => a.ref.localeCompare(b.ref))) {
    hash.update(artifact.ref);
    hash.update("\0");
    hash.update(artifact.text ?? "");
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function buildTopicGoal(projectRoot, options) {
  const loaded = await loadTopicReport(projectRoot, options.topicInput);
  if (!loaded.ok) {
    return {
      inputError: true,
      ok: false,
      error: loaded.error,
    };
  }

  const topicReport = await validateTopicRoot(projectRoot, options.topicInput);
  const graphReport = await validateTopicGraph(projectRoot, options.topicInput);
  const profile = await resolveProfile(projectRoot, options.profile);
  const { artifactTexts, missing } = await loadSourceArtifacts(loaded.topicDir);
  const textByRef = new Map(artifactTexts.map((artifact) => [artifact.ref, artifact.text]));
  const resolution = selectedWaveResolution(loaded.topic);
  const lineageWaveIds = [
    ...new Set([
      resolution.selectedTarget,
      resolution.executionStartWave?.wave_id,
      ...resolution.waves.flatMap((wave) => Array.isArray(wave.deps) ? wave.deps : []),
    ].filter(Boolean)),
  ];
  const lineageRefs = await collectLineageArtifacts(loaded.topicDir, lineageWaveIds);
  const lineageTexts = [];
  for (const ref of lineageRefs) {
    const text = await readTextIfFile(path.join(loaded.topicDir, ref));
    lineageTexts.push({ ref, text: text ?? "" });
  }
  const sourceArtifacts = [...REQUIRED_ARTIFACTS, ...lineageRefs];
  const sourceArtifactTexts = [...artifactTexts, ...lineageTexts];
  const validationCommands = mergeValidationCommandEntries([
    ...selectedWaveValidationCommands(resolution.executionStartWave),
    ...parseValidationCommands(sourceArtifactTexts.filter((artifact) => artifact.ref !== "topic.yaml")),
  ]);
  const humanGates = parseHumanGates(textByRef.get("preflight.md") ?? "");
  const forbiddenCatalog = await loadForbiddenShortcutsCatalog(projectRoot);
  const hostProjection = await checkHostProjection(projectRoot);
  const executionStartWave = resolution.executionStartWave;
  const deps = Array.isArray(executionStartWave?.deps) ? executionStartWave.deps : [];
  const depFailures = deps.filter((depId) => {
    const depWave = resolution.waves.find((wave) => wave.wave_id === depId);
    return !depWave || !TERMINAL_WAVE_STATES.has(depWave.state) || !dependencyEvidence(lineageRefs, depId);
  });
  const selectedTargetReady = resolution.selectedTarget === null || resolution.selectedTarget === "topic_design_baseline"
    ? resolution.deterministicNextWave !== null || resolution.allWavesTerminal
    : resolution.matchingWaveCount === 1 && WAVE_ID_PATTERN.test(resolution.selectedTarget);
  const selectedWaveSourceReady = resolution.selectedTarget === null || resolution.selectedTarget === "topic_design_baseline"
    ? resolution.selectedWaves.length === 0
    : resolution.selectedWaves.length === 1 && resolution.selectedWaves[0]?.wave_id === resolution.selectedTarget;
  const executionStartWaveReady = executionStartWave
    ? EXECUTION_STAGE_WAVE_STATES.has(executionStartWave.state) || ADMISSION_READY_WAVE_STATES.has(executionStartWave.state)
    : resolution.allWavesTerminal;
  const executionStartGoalPresent = executionStartWave
    ? typeof executionStartWave.primary_closure_goal === "string" && executionStartWave.primary_closure_goal.trim().length > 0
    : resolution.allWavesTerminal;
  const commands = validationCommands.map((entry) => entry.command);

  const checks = [
    check("topic_validate_passed", topicReport.ok === true, topicReport.ok ? "topic validate passes" : topicReport.error ?? "topic validate failed"),
    check("topic_graph_validate_passed", graphReport.ok === true, graphReport.ok ? "topic validate graph passes" : graphReport.error ?? "topic validate graph failed"),
    check("topic_lifecycle_ongoing", loaded.topic.state === "ongoing", `topic state is ${loaded.topic.state ?? "missing"}`),
    check("true_close_not_started", loaded.topic.current_true_close_status === "not_started", `current_true_close_status is ${loaded.topic.current_true_close_status ?? "missing"}`),
    check("strict_policy_active", topicReport.ignoredByPolicy !== true, topicReport.ignoredByPolicy ? "topic root is ignored by strict validation policy" : "topic root is under strict validation policy"),
    check("parallel_truth_forbidden", loaded.topic.parallel_truth === "forbidden", `parallel_truth is ${loaded.topic.parallel_truth ?? "missing"}`),
    check("profile_resolves", profile.ok, profile.ok ? `profile resolves as ${profile.profile}` : `unknown or mismatched profile ${profile.profile ?? "missing"}`),
    check("selected_target_wave_resolves", selectedTargetReady, resolution.selectedTarget ? `selected_next_target is ${resolution.selectedTarget}` : `execution cursor is ${executionStartWave?.wave_id ?? (resolution.allWavesTerminal ? "topic closeout" : "missing")}`),
    check("selected_wave_single_source", selectedWaveSourceReady, `selected waves: ${resolution.selectedWaves.map((wave) => wave.wave_id).join(", ") || "none"}`),
    check("wave_option_matches_selected", options.wave === null || options.wave === executionStartWave?.wave_id, options.wave === null ? "no wave assertion provided" : `--wave is ${options.wave}`),
    check("selected_wave_executable", executionStartWaveReady, executionStartWave ? `execution cursor wave state is ${executionStartWave.state}` : resolution.allWavesTerminal ? "topic is ready for topic closeout" : "execution cursor does not resolve"),
    check("selected_wave_dependencies_terminal", depFailures.length === 0, depFailures.length === 0 ? "selected wave dependencies are terminal by lifecycle evidence" : `dependencies are not terminal by evidence: ${depFailures.join(", ")}`),
    check("selected_wave_goal_present", executionStartGoalPresent, executionStartWave?.primary_closure_goal ? "execution cursor declares primary_closure_goal" : resolution.allWavesTerminal ? "all waves terminal; topic closeout is the next goal" : "execution cursor is missing primary_closure_goal"),
    check("forbidden_shortcuts_present", REQUIRED_STOP_KEYS.every((key) => (loaded.topic.forbidden_shortcuts ?? []).includes(key)) && REQUIRED_STOP_KEYS.every((key) => forbiddenCatalog.keys.includes(key)), "topic forbidden_shortcuts include required package catalog keys"),
    check("forbidden_shortcuts_catalog_aligned", forbiddenCatalog.aligned, forbiddenCatalog.aligned ? "host forbidden-shortcuts projection is aligned or absent" : "host forbidden-shortcuts projection differs from package catalog"),
    check("required_artifacts_present", missing.length === 0, missing.length === 0 ? "all required artifacts are present" : `missing artifacts: ${missing.join(", ")}`),
    check("no_unresolved_placeholders", sourceArtifactTexts.every(({ text }) => !hasUnresolvedPlaceholder(text)), "required artifacts contain no frozen placeholder markers"),
    check("stop_line_declared", hasSectionBullet(textByRef.get("preflight.md") ?? "", "Stop Line"), "preflight.md declares Stop Line bullets"),
    check("human_gates_declared", humanGates.length > 0, humanGates.length > 0 ? "preflight.md declares Human Gates bullets" : "preflight.md does not declare Human Gates bullets"),
    check("validation_commands_declared", commands.some((command) => command.includes("topic validate ")) && commands.some((command) => command.includes("topic validate graph")), "validation command evidence includes topic validate and topic validate graph"),
    check("closeout_criteria_declared", /Wave-1 Closeout Requirements/i.test(textByRef.get("closeout.md") ?? "") && /\bcomplete\b/i.test(textByRef.get("closeout.md") ?? "") && /\bpartial\b/i.test(textByRef.get("closeout.md") ?? "") && (/\bblocked\b/i.test(textByRef.get("closeout.md") ?? "") || /Non-Closure Conditions/i.test(textByRef.get("closeout.md") ?? "") || /Do not close if/i.test(textByRef.get("closeout.md") ?? "")) && /\bpending\b/i.test(textByRef.get("closeout.md") ?? ""), "closeout.md declares selected-wave criteria and complete/partial/blocked/pending states"),
    check("authority_owner_declared", sectionText(textByRef.get("preflight.md") ?? "", "Authority Owner").length > 0, "preflight.md declares Authority Owner"),
    check("work_type_declared", sectionText(textByRef.get("preflight.md") ?? "", "Work Type").length > 0, "preflight.md declares Work Type"),
    check("authority_change_admitted", !/authority ownership changes? (?:are )?in scope/i.test(textByRef.get("preflight.md") ?? "") || /\.nimi\/spec\//.test(textByRef.get("preflight.md") ?? ""), "authority-changing work is either out of scope or cites .nimi/spec alignment"),
    check("host_projection_aligned", hostProjection.ok, hostProjection.message),
  ];

  const preliminaryOk = checks.every((entry) => entry.status === "pass");
  const preliminaryGoal = preliminaryOk ? buildGoalCommand(loaded.topicId, executionStartWave, sourceArtifacts) : null;
  checks.push(check("goal_size_within_limit", preliminaryGoal === null || preliminaryGoal.length <= GOAL_COMMAND_MAX_CHARS, preliminaryGoal === null ? "goal size check skipped until readiness passes" : `goal command length is ${preliminaryGoal.length}`));

  const readinessOk = checks.every((entry) => entry.status === "pass");
  const goalCommand = readinessOk ? preliminaryGoal : null;
  return {
    ok: readinessOk,
    topic_id: loaded.topicId,
    topic_ref: projectRef(projectRoot, loaded.topicDir),
    topic_state: loaded.topic.state ?? null,
    true_close_status: loaded.topic.current_true_close_status ?? null,
    profile: profile.profile ?? null,
    selected_next_target: loaded.topic.selected_next_target ?? null,
    selected_wave_id: executionStartWave?.wave_id ?? null,
    execution_start_wave_id: executionStartWave?.wave_id ?? null,
    topic_state_hash: buildStateHash(sourceArtifactTexts, [
      { ref: TOPIC_GOAL_CONTRACT_REF, text: await readTextIfFile(packagePath(TOPIC_GOAL_CONTRACT_REF)) ?? "" },
    ]),
    readiness: {
      ok: readinessOk,
      checks,
    },
    goal_command: goalCommand,
    source_artifacts: sourceArtifacts,
    validation_commands: validationCommands,
    human_gates: humanGates,
    refusal_reasons: checks
      .filter((entry) => entry.status === "fail")
      .map((entry) => CHECK_REASON[entry.id])
      .filter(Boolean),
  };
}
