import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import { pathExists, readTextIfFile } from "./fs-helpers.mjs";
import { parseYamlText } from "./yaml-helpers.mjs";
import {
  TOPIC_ID_PATTERN,
  TOPIC_ROOT,
  TOPIC_SLUG_PATTERN,
  formatDate,
  loadTopicRuntimeAuthority,
  toPortableRelativePath,
} from "./topic-common.mjs";

export function titleFromSlug(slug) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
export function deriveTopicId(slug, date = new Date()) {
  return TOPIC_ID_PATTERN.test(slug) ? slug : `${formatDate(date)}-${slug}`;
}
export function getTopicRoot(projectRoot) {
  return path.join(projectRoot, TOPIC_ROOT);
}
export function getTopicStateRoot(projectRoot, state) {
  return path.join(getTopicRoot(projectRoot), state);
}
export function isTopicPathInput(value) {
  return typeof value == "string" && (value.includes("/") || value.startsWith("."));
}
export function buildCreatePayload(options, authority) {
  return {
    topic_id: options.topicId,
    state: "proposal",
    created_at: options.today,
    last_transition_at: options.today,
    last_transition_reason: "topic_created_via_nimicoding_topic_create",
    title: options.title,
    mode: options.mode,
    posture: options.posture,
    design_policy: options.designPolicy,
    parallel_truth: options.parallelTruth,
    layering: options.layering,
    risk: options.risk,
    applicability: options.applicability,
    entry_justification: options.justification,
    execution_mode: options.executionMode,
    selected_next_target: "topic_design_baseline",
    current_true_close_status: "not_started",
    forbidden_shortcuts: authority.defaultForbiddenShortcuts,
    waves: [],
  };
}
export function buildReadme(topic) {
  return `# ${topic.title}
State: \`${topic.state}\`
This topic was created by \`nimicoding topic create\`.
## Purpose
TODO: explain why this work needs topic-level governance rather than the ordinary non-topic path.
## Entry Posture
- mode: \`${topic.mode}\`
- posture: \`${topic.posture}\`
- design policy: \`${topic.design_policy}\`
- applicability: \`${topic.applicability}\`
- execution mode: \`${topic.execution_mode}\`
## Current Next Action
- selected_next_target: \`${topic.selected_next_target}\`
- TODO: freeze the first bounded wave target before admission
`;
}
export function buildDesign(topicId) {
  return `# Design
Topic: \`${topicId}\`
This file is the index for split design companions.
- TODO: add subtopic design files as the topic grows
- TODO: keep this file as an index rather than collapsing the whole topic into one document
`;
}
export function buildSimpleCompanion(title, topicId, bullets) {
  return `# ${title}
Topic: \`${topicId}\`
${bullets.map((item) => `- ${item}`).join(`
`)}
`;
}
export async function writeTopicScaffold(topicDir, topic) {
  const files = new Map([
    ["topic.yaml", YAML.stringify(topic)],
    ["README.md", buildReadme(topic)],
    ["design.md", buildDesign(topic.topic_id)],
    ["preflight.md", buildSimpleCompanion("Preflight", topic.topic_id, ["TODO", "TODO"])],
    ["waves.md", buildSimpleCompanion("Waves", topic.topic_id, ["TODO", "TODO"])],
    [
      "candidate-wave-plan.md",
      buildSimpleCompanion("Candidate Wave Plan", topic.topic_id, ["TODO", "TODO"]),
    ],
    ["closeout.md", buildSimpleCompanion("Closeout", topic.topic_id, ["TODO", "TODO"])],
    [
      "implementation-doctrine.md",
      buildSimpleCompanion("Implementation Doctrine", topic.topic_id, ["TODO", "TODO"]),
    ],
    [
      "admission-checklists.md",
      buildSimpleCompanion("Admission Checklists", topic.topic_id, ["TODO", "TODO"]),
    ],
    [
      "manager-session-protocol.md",
      buildSimpleCompanion("Manager Session Protocol", topic.topic_id, ["TODO", "TODO"]),
    ],
    ["manager-prompts.md", buildSimpleCompanion("Manager Prompts", topic.topic_id, ["TODO"])],
  ]);
  await mkdir(topicDir, { recursive: false });
  for (const [fileName, contents] of files.entries())
    await writeFile(path.join(topicDir, fileName), contents, "utf8");
}
export function validateTopicSlug(value) {
  return TOPIC_SLUG_PATTERN.test(value);
}
export function validateTopicId(value) {
  return TOPIC_ID_PATTERN.test(value);
}
export async function findTopicDirectory(projectRoot, input = null) {
  const authority = await loadTopicRuntimeAuthority(projectRoot),
    topicStatePattern = authority.topicStates.join("|");
  if (!input) {
    const current = process.cwd(),
      match = toPortableRelativePath(path.relative(projectRoot, current)).match(
        new RegExp(
          `^\\.nimi/topics/(${topicStatePattern})/(\\d{4}-\\d{2}-\\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)`,
        ),
      );
    return match
      ? {
          ok: true,
          topicDir: path.join(projectRoot, ".nimi", "topics", match[1], match[2]),
          topicId: match[2],
          state: match[1],
        }
      : {
          ok: false,
          error:
            "No topic id or topic path was provided, and the current working directory is not inside a topic root.",
        };
  }
  if (isTopicPathInput(input)) {
    const topicDir = path.resolve(projectRoot, input),
      match = toPortableRelativePath(path.relative(projectRoot, topicDir)).match(
        new RegExp(
          `^\\.nimi/topics/(${topicStatePattern})/(\\d{4}-\\d{2}-\\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)$`,
        ),
      );
    return match
      ? { ok: true, topicDir, topicId: match[2], state: match[1] }
      : { ok: false, error: `Topic path must resolve to .nimi/topics/<state>/<topic-id>: ${input}` };
  }
  const matches = [];
  for (const state of authority.topicStates) {
    const candidate = path.join(getTopicStateRoot(projectRoot, state), input);
    (await pathExists(candidate))?.isDirectory() &&
      matches.push({ state, topicDir: candidate, topicId: input });
  }
  return matches.length === 1
    ? { ok: true, ...matches[0] }
    : matches.length > 1
      ? {
          ok: false,
          error: `Topic id resolves to multiple lifecycle roots and must be disambiguated by path: ${input}`,
        }
      : { ok: false, error: `Topic not found under ${TOPIC_ROOT}: ${input}` };
}
export async function resolveTopicProjectRoot(startDir) {
  let currentDir = path.resolve(startDir);
  for (;;) {
    if ((await pathExists(path.join(currentDir, ".nimi")))?.isDirectory()) return currentDir;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return path.resolve(startDir);
    currentDir = parentDir;
  }
}
export async function loadTopicReport(projectRoot, input = null) {
  const resolved = await findTopicDirectory(projectRoot, input);
  if (!resolved.ok) return resolved;
  const topicYamlPath = path.join(resolved.topicDir, "topic.yaml"),
    topicYamlText = await readTextIfFile(topicYamlPath);
  if (topicYamlText === null)
    return {
      ok: false,
      error: `Missing topic.yaml at ${toPortableRelativePath(path.relative(projectRoot, topicYamlPath))}`,
    };
  const topic = parseYamlText(topicYamlText);
  return !topic || typeof topic != "object"
    ? {
        ok: false,
        error: `topic.yaml is not valid YAML at ${toPortableRelativePath(path.relative(projectRoot, topicYamlPath))}`,
      }
    : { ok: true, ...resolved, topicYamlPath, topicYamlText, topic };
}
export function getTopicWaves(topic) {
  return Array.isArray(topic.waves) ? topic.waves.map((entry) => ({ ...entry })) : [];
}
export function findDeterministicNextWave(topic) {
  const waves = getTopicWaves(topic),
    terminalIds = new Set(
      waves
        .filter((entry) => ["closed", "retired", "superseded"].includes(entry.state))
        .map((entry) => entry.wave_id),
    ),
    ready = waves.filter(
      (entry) =>
        !["closed", "retired", "superseded"].includes(entry.state) &&
        ["candidate", "preflight_draft"].includes(entry.state) &&
        (Array.isArray(entry.deps) ? entry.deps : []).every((dep) => terminalIds.has(dep)),
    );
  return ready.length > 0 ? ready[0] : null;
}
export async function writeTopicYaml(topicYamlPath, topic) {
  await writeFile(topicYamlPath, YAML.stringify(topic), "utf8");
}
export async function moveTopicDirectoryForState(projectRoot, currentDir, topicId, targetState) {
  const targetDir = path.join(getTopicStateRoot(projectRoot, targetState), topicId);
  return currentDir === targetDir
    ? { topicDir: currentDir, topicYamlPath: path.join(currentDir, "topic.yaml") }
    : (await mkdir(path.dirname(targetDir), { recursive: true }),
      await rename(currentDir, targetDir),
      { topicDir: targetDir, topicYamlPath: path.join(targetDir, "topic.yaml") });
}
export function topicHasEnrichedShape(topic, authority) {
  return authority.enrichedRequiredFields.every((field) => {
    const value = topic[field];
    return field === "selected_next_target"
      ? value === null ||
          value === "topic_design_baseline" ||
          (typeof value == "string" && value.length > 0)
      : value != null && value !== "" && (!Array.isArray(value) || value.length > 0);
  });
}
export function buildTopicNow() {
  return formatDate(new Date());
}
export function isIsoUtcTimestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    return false;
  const parsed = new Date(value),
    canonicalValue = value.includes(".") ? value : value.replace("Z", ".000Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === canonicalValue;
}
