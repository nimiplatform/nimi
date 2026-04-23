import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

import { loadTopicRuntimeContracts } from "./contracts.mjs";
import { pathExists, readTextIfFile } from "./fs-helpers.mjs";
import { parseYamlText } from "./yaml-helpers.mjs";

const TOPIC_ROOT = path.join(".nimi", "topics");
const TOPIC_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOPIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WAVE_ID_PATTERN = /^wave-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const DEFAULT_TOPIC_RUNTIME_AUTHORITY = {
  topicStates: ["proposal", "ongoing", "pending", "closed"],
  minimalRequiredFields: [
    "topic_id",
    "state",
    "created_at",
    "last_transition_at",
    "last_transition_reason",
  ],
  enrichedRequiredFields: [
    "title",
    "mode",
    "posture",
    "design_policy",
    "parallel_truth",
    "layering",
    "risk",
    "applicability",
    "entry_justification",
    "execution_mode",
    "selected_next_target",
    "current_true_close_status",
    "forbidden_shortcuts",
  ],
  topicEnums: {
    mode: ["greenfield", "landed", "superseding"],
    posture: ["no_legacy_hard_cut", "backward_compat"],
    designPolicy: ["complete_contract_first", "mvp_incremental"],
    parallelTruth: ["forbidden", "admitted"],
    layering: ["ontology", "time_phased"],
    risk: ["high", "low"],
    applicability: [
      "authority_bearing",
      "high_risk_refactor",
      "multi_wave_iteration",
      "complex_remediation",
    ],
    executionMode: ["inline_manager_worker", "manager_worker_auditor"],
    trueCloseStatus: ["not_started", "pending", "true_closed", "revoked", "superseded"],
  },
  waveStates: [
    "candidate",
    "preflight_draft",
    "preflight_admitted",
    "implementation_admitted",
    "implementation_active",
    "needs_revision",
    "overflowed",
    "continuation_packet_open",
    "closed",
    "retired",
    "superseded",
  ],
  packetRequiredFields: [
    "packet_id",
    "topic_id",
    "wave_id",
    "packet_kind",
    "status",
    "authority_owner",
    "canonical_seams",
    "forbidden_shortcuts",
    "acceptance_invariants",
    "negative_tests",
    "reopen_conditions",
  ],
  packetFreezeAllowedStatuses: ["draft", "preflight", "candidate"],
  resultVerdicts: ["PASS", "NEEDS_REVISION", "FAIL", "OVERFLOW"],
  resultKinds: ["preflight", "implementation", "audit", "judgement"],
  resultVerifiedAtFormat: "iso8601_utc_timestamp",
  closeoutScopes: ["wave", "topic"],
  closureStates: ["open", "closed", "blocked"],
  closeoutDispositions: ["complete", "partial", "deferred"],
  remediationKinds: ["a", "b", "continuation", "execution_state_closure"],
  decisionDispositions: ["retired", "superseded", "unchanged"],
  pendingNoteRequiredFields: [
    "pending_note_id",
    "topic_id",
    "entered_from_state",
    "reason",
    "summary",
    "status",
  ],
  pendingNoteStatuses: ["active", "resumed", "closed"],
  defaultForbiddenShortcuts: [
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
  ],
  recommendedFiles: [
    "README.md",
    "design.md",
    "preflight.md",
    "waves.md",
    "candidate-wave-plan.md",
    "implementation-doctrine.md",
    "admission-checklists.md",
    "manager-session-protocol.md",
    "manager-prompts.md",
  ],
  closureDimensions: ["authority", "semantic", "consumer", "drift_resistance"],
  waveCloseoutEvidence: {
    requirePacketLineage: true,
    requireResultLineage: true,
  },
  trueCloseAuditEvidence: {
    requireWaveCloseoutForClosedWaves: true,
    requirePacketLineageForClosedWaves: true,
    requireResultLineageForClosedWaves: true,
  },
  ignoredTopicValidateSemantics: {
    status: "report_only",
    canonicalSuccess: false,
  },
};

const topicRuntimeAuthorityCache = new Map();
const PENDING_ENTRY_BLOCKER_STATES = new Set([
  "preflight_admitted",
  "implementation_admitted",
  "implementation_active",
  "needs_revision",
  "overflowed",
  "continuation_packet_open",
]);

function formatDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toPortableRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function toStringArray(value, fallback) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value
    .filter((entry) => typeof entry === "string" && entry.length > 0)
    .map((entry) => String(entry));
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

export async function loadTopicRuntimeAuthority(projectRoot) {
  const cached = topicRuntimeAuthorityCache.get(projectRoot);
  if (cached) {
    return cached;
  }

  const loaded = await loadTopicRuntimeContracts(projectRoot);
  const topicSchema = loaded.topicSchema.data ?? {};
  const waveSchema = loaded.waveSchema.data ?? {};
  const packetSchema = loaded.packetSchema.data ?? {};
  const resultSchema = loaded.resultSchema.data ?? {};
  const closeoutSchema = loaded.closeoutSchema.data ?? {};
  const remediationSchema = loaded.remediationSchema.data ?? {};
  const decisionReviewSchema = loaded.decisionReviewSchema.data ?? {};
  const pendingNoteSchema = loaded.pendingNoteSchema.data ?? {};
  const forbiddenShortcutsCatalog = loaded.forbiddenShortcutsCatalog.data ?? {};
  const lifecycleReport = loaded.lifecycleReport.data?.topic_lifecycle_report ?? {};
  const fourClosurePolicy = loaded.fourClosurePolicy.data?.four_closure_policy ?? {};
  const validationPolicy = loaded.validationPolicy.data?.topic_validation_policy ?? {};

  const minimalRequiredFields = toStringArray(
    lifecycleReport.state_evidence?.required_fields,
    DEFAULT_TOPIC_RUNTIME_AUTHORITY.minimalRequiredFields,
  );
  const topicRequiredFields = toStringArray(topicSchema.required, DEFAULT_TOPIC_RUNTIME_AUTHORITY.enrichedRequiredFields);
  const enrichedRequiredFields = topicRequiredFields.filter((field) => !minimalRequiredFields.includes(field));

  const authority = {
    topicStates: toStringArray(topicSchema.state_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicStates),
    minimalRequiredFields,
    enrichedRequiredFields,
    topicEnums: {
      mode: toStringArray(topicSchema.mode_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.mode),
      posture: toStringArray(topicSchema.posture_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.posture),
      designPolicy: toStringArray(topicSchema.design_policy_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.designPolicy),
      parallelTruth: toStringArray(topicSchema.parallel_truth_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.parallelTruth),
      layering: toStringArray(topicSchema.layering_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.layering),
      risk: toStringArray(topicSchema.risk_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.risk),
      applicability: toStringArray(topicSchema.applicability_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.applicability),
      executionMode: toStringArray(topicSchema.execution_mode_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.executionMode),
      trueCloseStatus: toStringArray(
        topicSchema.true_close_status_enum,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.topicEnums.trueCloseStatus,
      ),
    },
    waveStates: toStringArray(waveSchema.state_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.waveStates),
    packetRequiredFields: toStringArray(packetSchema.required, DEFAULT_TOPIC_RUNTIME_AUTHORITY.packetRequiredFields),
    packetFreezeAllowedStatuses: toStringArray(
      packetSchema.freeze_allowed_status_enum,
      DEFAULT_TOPIC_RUNTIME_AUTHORITY.packetFreezeAllowedStatuses,
    ),
    resultVerdicts: toStringArray(resultSchema.verdict_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.resultVerdicts),
    resultKinds: toStringArray(resultSchema.result_kind_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.resultKinds),
    resultVerifiedAtFormat: typeof resultSchema.verified_at_format === "string"
      ? resultSchema.verified_at_format
      : DEFAULT_TOPIC_RUNTIME_AUTHORITY.resultVerifiedAtFormat,
    closeoutScopes: toStringArray(closeoutSchema.scope_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.closeoutScopes),
    closureStates: toStringArray(closeoutSchema.closure_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.closureStates),
    closeoutDispositions: toStringArray(
      closeoutSchema.disposition_enum,
      DEFAULT_TOPIC_RUNTIME_AUTHORITY.closeoutDispositions,
    ),
    remediationKinds: toStringArray(remediationSchema.kind_enum, DEFAULT_TOPIC_RUNTIME_AUTHORITY.remediationKinds),
    decisionDispositions: toStringArray(
      decisionReviewSchema.disposition_enum,
      DEFAULT_TOPIC_RUNTIME_AUTHORITY.decisionDispositions,
    ),
    pendingNoteRequiredFields: toStringArray(
      pendingNoteSchema.required,
      DEFAULT_TOPIC_RUNTIME_AUTHORITY.pendingNoteRequiredFields,
    ),
    pendingNoteStatuses: toStringArray(
      pendingNoteSchema.status_enum,
      DEFAULT_TOPIC_RUNTIME_AUTHORITY.pendingNoteStatuses,
    ),
    defaultForbiddenShortcuts: Array.isArray(forbiddenShortcutsCatalog.entries)
      ? forbiddenShortcutsCatalog.entries
        .map((entry) => (typeof entry?.key === "string" ? entry.key : null))
        .filter(Boolean)
      : DEFAULT_TOPIC_RUNTIME_AUTHORITY.defaultForbiddenShortcuts,
    recommendedFiles: toStringArray(
      lifecycleReport.recommended_files,
      DEFAULT_TOPIC_RUNTIME_AUTHORITY.recommendedFiles,
    ).filter((entry) => !entry.includes("*")),
    closureDimensions: toStringArray(
      fourClosurePolicy.closures,
      DEFAULT_TOPIC_RUNTIME_AUTHORITY.closureDimensions,
    ),
    waveCloseoutEvidence: {
      requirePacketLineage: normalizeBoolean(
        fourClosurePolicy.wave_closeout_evidence?.require_packet_lineage,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.waveCloseoutEvidence.requirePacketLineage,
      ),
      requireResultLineage: normalizeBoolean(
        fourClosurePolicy.wave_closeout_evidence?.require_result_lineage,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.waveCloseoutEvidence.requireResultLineage,
      ),
    },
    trueCloseAuditEvidence: {
      requireWaveCloseoutForClosedWaves: normalizeBoolean(
        fourClosurePolicy.true_close_audit_evidence?.require_wave_closeout_for_closed_waves,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.trueCloseAuditEvidence.requireWaveCloseoutForClosedWaves,
      ),
      requirePacketLineageForClosedWaves: normalizeBoolean(
        fourClosurePolicy.true_close_audit_evidence?.require_packet_lineage_for_closed_waves,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.trueCloseAuditEvidence.requirePacketLineageForClosedWaves,
      ),
      requireResultLineageForClosedWaves: normalizeBoolean(
        fourClosurePolicy.true_close_audit_evidence?.require_result_lineage_for_closed_waves,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.trueCloseAuditEvidence.requireResultLineageForClosedWaves,
      ),
    },
    ignoredTopicValidateSemantics: {
      status: typeof validationPolicy.ignored_topic_validate_semantics?.status === "string"
        ? validationPolicy.ignored_topic_validate_semantics.status
        : DEFAULT_TOPIC_RUNTIME_AUTHORITY.ignoredTopicValidateSemantics.status,
      canonicalSuccess: normalizeBoolean(
        validationPolicy.ignored_topic_validate_semantics?.canonical_success,
        DEFAULT_TOPIC_RUNTIME_AUTHORITY.ignoredTopicValidateSemantics.canonicalSuccess,
      ),
    },
  };

  topicRuntimeAuthorityCache.set(projectRoot, authority);
  return authority;
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function deriveTopicId(slug, date = new Date()) {
  if (TOPIC_ID_PATTERN.test(slug)) {
    return slug;
  }

  return `${formatDate(date)}-${slug}`;
}

function getTopicRoot(projectRoot) {
  return path.join(projectRoot, TOPIC_ROOT);
}

function getTopicStateRoot(projectRoot, state) {
  return path.join(getTopicRoot(projectRoot), state);
}

function isTopicPathInput(value) {
  return typeof value === "string" && (value.includes("/") || value.startsWith("."));
}

function buildCreatePayload(options, authority) {
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

function buildReadme(topic) {
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

function buildDesign(topicId) {
  return `# Design

Topic: \`${topicId}\`

This file is the index for split design companions.

- TODO: add subtopic design files as the topic grows
- TODO: keep this file as an index rather than collapsing the whole topic into one document
`;
}

function buildSimpleCompanion(title, topicId, bullets) {
  return `# ${title}

Topic: \`${topicId}\`

${bullets.map((item) => `- ${item}`).join("\n")}
`;
}

async function writeTopicScaffold(topicDir, topic) {
  const files = new Map([
    ["topic.yaml", YAML.stringify(topic)],
    ["README.md", buildReadme(topic)],
    ["design.md", buildDesign(topic.topic_id)],
    ["preflight.md", buildSimpleCompanion("Preflight", topic.topic_id, [
      "TODO: record spec status, authority owner, work type, and parallel truth",
      "TODO: freeze stop-line and closeout checks before admitted execution",
    ])],
    ["waves.md", buildSimpleCompanion("Waves", topic.topic_id, [
      "TODO: define the program-level wave DAG",
      "TODO: identify the selected next execution target",
    ])],
    ["candidate-wave-plan.md", buildSimpleCompanion("Candidate Wave Plan", topic.topic_id, [
      "TODO: name the first bounded wave",
      "TODO: explain why this is the next owner cut",
    ])],
    ["closeout.md", buildSimpleCompanion("Closeout", topic.topic_id, [
      "TODO: record bounded closure verdicts as the topic exits active execution",
      "TODO: distinguish wave closeout, pending hold, and topic closeout posture",
    ])],
    ["implementation-doctrine.md", buildSimpleCompanion("Implementation Doctrine", topic.topic_id, [
      "TODO: freeze forbidden shortcuts specific to this topic",
      "TODO: explain what would count as a false closure",
    ])],
    ["admission-checklists.md", buildSimpleCompanion("Admission Checklists", topic.topic_id, [
      "TODO: define topic-local admission gates for the first wave",
      "TODO: define stop phrases for non-admissible shortcuts",
    ])],
    ["manager-session-protocol.md", buildSimpleCompanion("Manager Session Protocol", topic.topic_id, [
      "TODO: define manager / worker / auditor role separation for this topic",
      "TODO: record how overflow and remediation will be judged",
    ])],
    ["manager-prompts.md", buildSimpleCompanion("Manager Prompts", topic.topic_id, [
      "TODO: add packet-specific manager prompt baselines once the first wave is admitted",
    ])],
  ]);

  await mkdir(topicDir, { recursive: false });
  for (const [fileName, contents] of files.entries()) {
    await writeFile(path.join(topicDir, fileName), contents, "utf8");
  }
}

export function validateTopicSlug(value) {
  return TOPIC_SLUG_PATTERN.test(value);
}

export function validateTopicId(value) {
  return TOPIC_ID_PATTERN.test(value);
}

export async function findTopicDirectory(projectRoot, input = null) {
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  const topicStatePattern = authority.topicStates.join("|");
  if (!input) {
    const current = process.cwd();
    const relativeCurrent = toPortableRelativePath(path.relative(projectRoot, current));
    const match = relativeCurrent.match(new RegExp(`^\\.nimi/topics/(${topicStatePattern})/(\\d{4}-\\d{2}-\\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)`));
    if (match) {
      return {
        ok: true,
        topicDir: path.join(projectRoot, ".nimi", "topics", match[1], match[2]),
        topicId: match[2],
        state: match[1],
      };
    }

    return {
      ok: false,
      error: "No topic id or topic path was provided, and the current working directory is not inside a topic root.",
    };
  }

  if (isTopicPathInput(input)) {
    const topicDir = path.resolve(projectRoot, input);
    const relative = toPortableRelativePath(path.relative(projectRoot, topicDir));
    const match = relative.match(new RegExp(`^\\.nimi/topics/(${topicStatePattern})/(\\d{4}-\\d{2}-\\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)$`));
    if (!match) {
      return {
        ok: false,
        error: `Topic path must resolve to .nimi/topics/<state>/<topic-id>: ${input}`,
      };
    }

    return {
      ok: true,
      topicDir,
      topicId: match[2],
      state: match[1],
    };
  }

  const matches = [];
  for (const state of authority.topicStates) {
    const candidate = path.join(getTopicStateRoot(projectRoot, state), input);
    const info = await pathExists(candidate);
    if (info?.isDirectory()) {
      matches.push({ state, topicDir: candidate, topicId: input });
    }
  }

  if (matches.length === 1) {
    return {
      ok: true,
      ...matches[0],
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      error: `Topic id resolves to multiple lifecycle roots and must be disambiguated by path: ${input}`,
    };
  }

  return {
    ok: false,
    error: `Topic not found under ${TOPIC_ROOT}: ${input}`,
  };
}

export async function resolveTopicProjectRoot(startDir) {
  let currentDir = path.resolve(startDir);

  while (true) {
    const nimiDir = await pathExists(path.join(currentDir, ".nimi"));
    if (nimiDir?.isDirectory()) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return path.resolve(startDir);
    }
    currentDir = parentDir;
  }
}

export async function loadTopicReport(projectRoot, input = null) {
  const resolved = await findTopicDirectory(projectRoot, input);
  if (!resolved.ok) {
    return resolved;
  }

  const topicYamlPath = path.join(resolved.topicDir, "topic.yaml");
  const topicYamlText = await readTextIfFile(topicYamlPath);
  if (topicYamlText === null) {
    return {
      ok: false,
      error: `Missing topic.yaml at ${toPortableRelativePath(path.relative(projectRoot, topicYamlPath))}`,
    };
  }

  const topic = parseYamlText(topicYamlText);
  if (!topic || typeof topic !== "object") {
    return {
      ok: false,
      error: `topic.yaml is not valid YAML at ${toPortableRelativePath(path.relative(projectRoot, topicYamlPath))}`,
    };
  }

  return {
    ok: true,
    ...resolved,
    topicYamlPath,
    topicYamlText,
    topic,
  };
}

function getTopicWaves(topic) {
  return Array.isArray(topic.waves) ? topic.waves.map((entry) => ({ ...entry })) : [];
}

async function writeTopicYaml(topicYamlPath, topic) {
  await writeFile(topicYamlPath, YAML.stringify(topic), "utf8");
}

async function moveTopicDirectoryForState(projectRoot, currentDir, topicId, targetState) {
  const targetDir = path.join(getTopicStateRoot(projectRoot, targetState), topicId);
  if (currentDir === targetDir) {
    return {
      topicDir: currentDir,
      topicYamlPath: path.join(currentDir, "topic.yaml"),
    };
  }

  await mkdir(path.dirname(targetDir), { recursive: true });
  await rename(currentDir, targetDir);
  return {
    topicDir: targetDir,
    topicYamlPath: path.join(targetDir, "topic.yaml"),
  };
}

function topicHasEnrichedShape(topic, authority) {
  return authority.enrichedRequiredFields.every((field) => {
    const value = topic[field];
    if (field === "selected_next_target") {
      return value === null || value === "topic_design_baseline" || (typeof value === "string" && value.length > 0);
    }
    return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
  });
}

function buildTopicNow() {
  return formatDate(new Date());
}

function isIsoUtcTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

async function collectWaveArtifactEvidence(topicDir, waveId) {
  const entries = await readdir(topicDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  return {
    packetRefs: files.filter((name) => name.startsWith("packet-") && fileReferencesWave(name, waveId)),
    resultRefs: files.filter((name) => name.startsWith("result-") && fileReferencesWave(name, waveId)),
    closeoutRefs: files.filter((name) => name.startsWith("closeout-") && fileReferencesWave(name, waveId)),
    remediationRefs: files.filter((name) => name.includes("remediation") && fileReferencesWave(name, waveId)),
    overflowRefs: files.filter((name) => name.includes("overflow-continuation") && fileReferencesWave(name, waveId)),
  };
}

async function loadPendingNote(topicDir) {
  const notePath = path.join(topicDir, pendingNoteFilename());
  const noteText = await readTextIfFile(notePath);
  if (noteText === null) {
    return {
      ok: false,
      notePath,
      error: `Missing pending note artifact: ${pendingNoteFilename()}`,
    };
  }
  const note = readFrontmatterObject(noteText);
  if (!note) {
    return {
      ok: false,
      notePath,
      error: "Pending note artifact frontmatter is invalid",
    };
  }
  return {
    ok: true,
    notePath,
    note,
  };
}

function getPendingEntryBlockers(topic) {
  return getTopicWaves(topic)
    .filter((entry) => PENDING_ENTRY_BLOCKER_STATES.has(entry.state))
    .map((entry) => `${entry.wave_id}:${entry.state}`);
}

async function loadTopicValidationPolicy(projectRoot) {
  const contracts = await loadTopicRuntimeContracts(projectRoot);
  const parsed = contracts.validationPolicy.data;
  const entries = Array.isArray(parsed?.topic_validation_policy?.ignore_for_default_validate)
    ? parsed.topic_validation_policy.ignore_for_default_validate
    : [];
  const ignoredTopicIds = new Map();
  for (const entry of entries) {
    if (entry && typeof entry.topic_id === "string" && entry.topic_id.length > 0) {
      ignoredTopicIds.set(entry.topic_id, {
        reason: typeof entry.reason === "string" ? entry.reason : null,
        posture: typeof entry.posture === "string" ? entry.posture : null,
      });
    }
  }
  const semantics = parsed?.topic_validation_policy?.ignored_topic_validate_semantics ?? {};
  return {
    ignoredTopicIds,
    ignoredTopicValidateSemantics: {
      status: typeof semantics.status === "string" ? semantics.status : DEFAULT_TOPIC_RUNTIME_AUTHORITY.ignoredTopicValidateSemantics.status,
      canonicalSuccess: typeof semantics.canonical_success === "boolean"
        ? semantics.canonical_success
        : DEFAULT_TOPIC_RUNTIME_AUTHORITY.ignoredTopicValidateSemantics.canonicalSuccess,
    },
  };
}

function extractLegacyWaveIdsFromName(fileName) {
  return Array.from(fileName.matchAll(/wave-\d+[a-z]?(?=-|\.|$)/g), (match) => match[0]);
}

function fileReferencesWave(fileName, waveId) {
  return fileName.includes(waveId) || extractLegacyWaveIdsFromName(fileName).includes(waveId);
}

function buildObservedLineage(entry) {
  if (entry.closeouts > 0) {
    return "closed_lineage";
  }
  if (entry.results > 0) {
    return "result_lineage";
  }
  if (entry.packets > 0) {
    return "packet_lineage";
  }
  if (entry.remediations > 0 || entry.exec_packs > 0 || entry.decision_reviews > 0) {
    return "auxiliary_lineage";
  }
  return "declared_only";
}

function isRecognizedLifecycleArtifactName(fileName) {
  if (!fileName.endsWith(".md")) {
    return true;
  }
  if (fileName.startsWith("packet-")) {
    return (
      /^packet-wave-\d+[a-z]?(?:-[a-z0-9]+)*\.md$/.test(fileName)
      || /^packet-true-close(?:-[a-z0-9]+)*\.md$/.test(fileName)
    );
  }
  if (fileName.startsWith("result-")) {
    return (
      /^result-wave-\d+[a-z]?(?:-[a-z0-9]+)*\.md$/.test(fileName)
      || /^result-topic-true-close(?:-[a-z0-9]+)*\.md$/.test(fileName)
      || /^result-true-close(?:-[a-z0-9]+)*\.md$/.test(fileName)
    );
  }
  if (fileName.startsWith("closeout-")) {
    return (
      /^closeout-wave-\d+[a-z]?(?:-[a-z0-9]+)*\.md$/.test(fileName)
      || /^closeout-topic(?:-[a-z0-9]+)*\.md$/.test(fileName)
      || /^closeout-true-close(?:-[a-z0-9]+)*\.md$/.test(fileName)
    );
  }
  if (fileName.startsWith("decision-review-")) {
    return /^decision-review-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(fileName);
  }
  if (fileName.startsWith("prompt-")) {
    return /^prompt-[a-z0-9-]+-(worker|audit)\.md$/.test(fileName);
  }
  if (fileName.startsWith("overflow-continuation-")) {
    return /^overflow-continuation-wave-\d+[a-z]?(?:-[a-z0-9]+)*\.md$/.test(fileName);
  }
  return true;
}

async function analyzeTopicArtifacts(topicDir, topic) {
  const entries = await readdir(topicDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const packetFiles = files.filter((name) => name.startsWith("packet-") && name.endsWith(".md"));
  const resultFiles = files.filter((name) => name.startsWith("result-") && name.endsWith(".md"));
  const closeoutFiles = files.filter((name) => name.startsWith("closeout-") && name.endsWith(".md"));
  const decisionReviewFiles = files.filter((name) => name.startsWith("decision-review-") && name.endsWith(".md"));
  const remediationFiles = files.filter((name) => name.includes("remediation") && name.endsWith(".md"));
  const overflowFiles = files.filter((name) => name.includes("overflow-continuation") || name.includes("remediation-continuation"));
  const execPackFiles = files.filter((name) => name.includes("exec-pack-") && name.endsWith(".md"));
  const trueCloseFiles = files.filter((name) => (
    name === "topic-true-close-audit.md"
    || name.startsWith("result-topic-true-close")
    || name === "closeout-topic-true-close.md"
  ));
  const ambiguousLifecycleFiles = files.filter((name) => (
    /^(packet|result|closeout|decision-review|prompt|overflow-continuation)-/.test(name)
    && !isRecognizedLifecycleArtifactName(name)
  ));

  const packetWaveIds = new Set(packetFiles.flatMap((name) => extractLegacyWaveIdsFromName(name)));
  const closeoutWaveIds = new Set(closeoutFiles.flatMap((name) => extractLegacyWaveIdsFromName(name)));
  const topicWaveIds = new Set(getTopicWaves(topic).map((entry) => entry.wave_id));
  const knownWaveIds = new Set([...packetWaveIds, ...closeoutWaveIds, ...topicWaveIds]);
  const resultWaveIds = resultFiles.flatMap((name) => extractLegacyWaveIdsFromName(name));
  const unresolvedResultWaveIds = Array.from(new Set(resultWaveIds.filter((waveId) => !knownWaveIds.has(waveId))));
  const closeoutWaveIdsArray = Array.from(closeoutWaveIds);
  const activeWaveCloseoutConflicts = getTopicWaves(topic)
    .filter((entry) => (
      !["closed", "retired", "superseded"].includes(entry.state)
      && closeoutFiles.some((name) => (
        name.includes(entry.wave_id)
        || closeoutWaveIds.has(entry.wave_id)
      ))
    ))
    .map((entry) => `${entry.wave_id}:${entry.state}`);
  const topicHasOpenBlockers = getTopicWaves(topic)
    .some((entry) => !["closed", "retired", "superseded"].includes(entry.state))
    || (typeof topic.selected_next_target === "string"
      && topic.selected_next_target.length > 0
      && topic.selected_next_target !== "topic_design_baseline");
  const prematureTrueClose = trueCloseFiles.length > 0 && topicHasOpenBlockers;
  const observedWaveIds = Array.from(new Set([
    ...Array.from(topicWaveIds),
    ...Array.from(packetWaveIds),
    ...closeoutWaveIdsArray,
    ...resultWaveIds,
    ...files.flatMap((name) => extractLegacyWaveIdsFromName(name)),
  ])).sort();
  const legacyObservedWaves = observedWaveIds.map((waveId) => {
    const observed = {
      wave_id: waveId,
      packets: packetFiles.filter((name) => fileReferencesWave(name, waveId)).length,
      results: resultFiles.filter((name) => fileReferencesWave(name, waveId)).length,
      closeouts: closeoutFiles.filter((name) => fileReferencesWave(name, waveId)).length,
      decision_reviews: decisionReviewFiles.filter((name) => fileReferencesWave(name, waveId)).length,
      remediations: remediationFiles.filter((name) => fileReferencesWave(name, waveId)).length,
      overflow_continuations: overflowFiles.filter((name) => fileReferencesWave(name, waveId)).length,
      exec_packs: execPackFiles.filter((name) => fileReferencesWave(name, waveId)).length,
      declared_in_topic_yaml: topicWaveIds.has(waveId),
    };
    return {
      ...observed,
      observed_lineage: buildObservedLineage(observed),
    };
  });

  return {
    files,
    counts: {
      files: files.length,
      packets: packetFiles.length,
      results: resultFiles.length,
      closeouts: closeoutFiles.length,
      decision_reviews: decisionReviewFiles.length,
      remediations: remediationFiles.length,
      overflow_continuations: overflowFiles.length,
      exec_packs: execPackFiles.length,
      true_close_artifacts: trueCloseFiles.length,
    },
    legacyWaveIds: observedWaveIds,
    legacyObservedWaves,
    featureFlags: {
      decision_review_lineage: decisionReviewFiles.length > 0,
      remediation_lineage: remediationFiles.length > 0,
      overflow_lineage: overflowFiles.length > 0,
      true_close_lineage: trueCloseFiles.length >= 2,
      exec_pack_lineage: execPackFiles.length > 0,
    },
    unresolvedResultWaveIds,
    closeoutWaveIds: closeoutWaveIdsArray,
    ambiguousLifecycleFiles,
    activeWaveCloseoutConflicts,
    prematureTrueClose,
  };
}

export function validateWaveId(value) {
  return WAVE_ID_PATTERN.test(value);
}

function normalizeDeps(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function validateGraphFromTopic(topic) {
  const waves = getTopicWaves(topic);
  const checks = [];
  const warnings = [];
  const waveIds = waves.map((entry) => entry.wave_id);
  const uniqueWaveIds = new Set(waveIds);

  checks.push({
    id: "wave_ids_unique",
    ok: uniqueWaveIds.size === waveIds.length,
    reason: uniqueWaveIds.size === waveIds.length
      ? "wave ids are unique"
      : "duplicate wave ids exist in topic.yaml waves[]",
  });

  const invalidWaveIds = waveIds.filter((entry) => !validateWaveId(entry));
  checks.push({
    id: "wave_ids_valid",
    ok: invalidWaveIds.length === 0,
    reason: invalidWaveIds.length === 0
      ? "wave ids use the canonical wave-<n>-slug shape"
      : `invalid wave ids: ${invalidWaveIds.join(", ")}`,
  });

  const missingDeps = [];
  const selectedWaveIds = [];
  const retiredSelected = [];
  for (const wave of waves) {
    const deps = normalizeDeps(wave.deps);
    for (const dep of deps) {
      if (!uniqueWaveIds.has(dep)) {
        missingDeps.push(`${wave.wave_id}->${dep}`);
      }
    }
    if (wave.selected === true) {
      selectedWaveIds.push(wave.wave_id);
    }
    if (wave.selected === true && ["retired", "superseded"].includes(wave.state)) {
      retiredSelected.push(wave.wave_id);
    }
  }

  checks.push({
    id: "wave_dependencies_resolve",
    ok: missingDeps.length === 0,
    reason: missingDeps.length === 0
      ? "all wave dependencies resolve inside the topic"
      : `missing dependency refs: ${missingDeps.join(", ")}`,
  });

  checks.push({
    id: "selected_wave_unique",
    ok: selectedWaveIds.length <= 1,
    reason: selectedWaveIds.length <= 1
      ? "selected wave is unique"
      : `multiple selected waves exist: ${selectedWaveIds.join(", ")}`,
  });

  const selectedMatchesTopicTarget = selectedWaveIds.length === 0
    ? topic.selected_next_target === "topic_design_baseline" || topic.selected_next_target === null
    : selectedWaveIds[0] === topic.selected_next_target;
  checks.push({
    id: "selected_wave_matches_topic_target",
    ok: selectedMatchesTopicTarget,
    reason: selectedMatchesTopicTarget
      ? "selected wave matches topic.selected_next_target"
      : `selected wave and topic.selected_next_target diverge (${selectedWaveIds[0] ?? "none"} vs ${topic.selected_next_target ?? "none"})`,
  });

  checks.push({
    id: "retired_or_superseded_not_selected",
    ok: retiredSelected.length === 0,
    reason: retiredSelected.length === 0
      ? "retired or superseded waves are not selected"
      : `retired/superseded waves remain selected: ${retiredSelected.join(", ")}`,
  });

  const visiting = new Set();
  const visited = new Set();
  let cycleRef = null;
  const waveMap = new Map(waves.map((wave) => [wave.wave_id, wave]));

  function dfs(waveId, trail = []) {
    if (cycleRef) {
      return;
    }
    if (visiting.has(waveId)) {
      cycleRef = [...trail, waveId].join(" -> ");
      return;
    }
    if (visited.has(waveId)) {
      return;
    }
    visiting.add(waveId);
    const wave = waveMap.get(waveId);
    if (wave) {
      for (const dep of normalizeDeps(wave.deps)) {
        dfs(dep, [...trail, waveId]);
      }
    }
    visiting.delete(waveId);
    visited.add(waveId);
  }

  for (const waveId of waveIds) {
    dfs(waveId);
  }

  checks.push({
    id: "graph_acyclic",
    ok: cycleRef === null,
    reason: cycleRef === null ? "wave graph is acyclic" : `wave graph contains a cycle: ${cycleRef}`,
  });

  if (waves.length === 0) {
    warnings.push("topic has no machine wave registry yet");
  }

  return {
    ok: checks.every((entry) => entry.ok),
    checks,
    warnings,
    waves,
  };
}

export async function validateTopicGraph(projectRoot, input = null) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return {
      ok: false,
      error: loaded.error,
      checks: [],
      warnings: [],
    };
  }

  const rootValidation = await validateTopicRoot(projectRoot, input);
  if (!rootValidation.ok) {
    return rootValidation;
  }

  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority)) {
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
  }

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
  if (!loaded.ok) {
    return {
      ok: false,
      error: loaded.error,
      checks: [],
      warnings: [],
    };
  }

  const graphReport = await validateTopicGraph(projectRoot, input);
  const wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === waveId) ?? null;
  const checks = [...(graphReport.checks ?? [])];
  const warnings = [...(graphReport.warnings ?? [])];

  checks.push({
    id: "wave_exists",
    ok: wave !== null,
    reason: wave ? "wave exists in topic.yaml waves[]" : `wave does not exist: ${waveId}`,
  });

  if (!wave) {
    return {
      ...graphReport,
      ok: false,
      checks,
      warnings,
    };
  }

  const dispatchableState = !["retired", "superseded", "closed", "overflowed"].includes(wave.state);
  checks.push({
    id: "wave_state_dispatchable",
    ok: dispatchableState,
    reason: dispatchableState
      ? "wave state is eligible for admission"
      : `wave state is not admissible: ${wave.state}`,
  });

  checks.push({
    id: "wave_selected",
    ok: wave.selected === true,
    reason: wave.selected === true
      ? "wave is selected"
      : "wave must be selected before admission",
  });

  checks.push({
    id: "selected_target_matches_wave",
    ok: loaded.topic.selected_next_target === waveId,
    reason: loaded.topic.selected_next_target === waveId
      ? "topic.selected_next_target matches the wave"
      : `topic.selected_next_target does not match wave (${loaded.topic.selected_next_target ?? "none"} vs ${waveId})`,
  });

  const waveMap = new Map(getTopicWaves(loaded.topic).map((entry) => [entry.wave_id, entry]));
  const unmetDeps = normalizeDeps(wave.deps).filter((dep) => waveMap.get(dep)?.state !== "closed");
  checks.push({
    id: "upstream_dependencies_closed",
    ok: unmetDeps.length === 0,
    reason: unmetDeps.length === 0
      ? "all upstream dependencies are closed"
      : `upstream dependencies are not closed: ${unmetDeps.join(", ")}`,
  });

  const waveStateAllowedForAdmit = ["candidate", "preflight_draft", "needs_revision"].includes(wave.state);
  checks.push({
    id: "wave_state_allows_preflight_admission",
    ok: waveStateAllowedForAdmit,
    reason: waveStateAllowedForAdmit
      ? "wave state can move to preflight_admitted"
      : `wave state cannot move to preflight_admitted from ${wave.state}`,
  });

  return {
    ...graphReport,
    ok: graphReport.ok && checks.every((entry) => entry.ok),
    checks,
    warnings,
  };
}

export async function addWaveToTopic(projectRoot, input, wave) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return loaded;
  }
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority)) {
    return {
      ok: false,
      error: "Wave commands require an enriched topic root.",
    };
  }

  const waves = getTopicWaves(loaded.topic);
  if (waves.some((entry) => entry.wave_id === wave.wave_id)) {
    return {
      ok: false,
      error: `Wave already exists: ${wave.wave_id}`,
    };
  }
  waves.push(wave);
  const graphPreview = validateGraphFromTopic({
    ...loaded.topic,
    waves,
  });
  const failedCheck = graphPreview.checks.find((entry) => !entry.ok);
  if (failedCheck) {
    return {
      ok: false,
      error: `Wave add refused: ${failedCheck.reason}`,
      checks: graphPreview.checks,
      warnings: graphPreview.warnings,
    };
  }
  loaded.topic.waves = waves;
  await writeTopicYaml(loaded.topicYamlPath, loaded.topic);
  return {
    ok: true,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
    waveId: wave.wave_id,
    waveState: wave.state,
  };
}

export async function selectWaveInTopic(projectRoot, input, waveId) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return loaded;
  }
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority)) {
    return {
      ok: false,
      error: "Wave commands require an enriched topic root.",
    };
  }

  const waves = getTopicWaves(loaded.topic);
  const wave = waves.find((entry) => entry.wave_id === waveId);
  if (!wave) {
    return {
      ok: false,
      error: `Wave not found: ${waveId}`,
    };
  }
  if (["retired", "superseded", "closed", "overflowed"].includes(wave.state)) {
    return {
      ok: false,
      error: `Wave select refused: ${waveId} is not selectable from state ${wave.state}`,
    };
  }

  for (const entry of waves) {
    entry.selected = entry.wave_id === waveId;
  }
  loaded.topic.waves = waves;
  loaded.topic.selected_next_target = waveId;
  loaded.topic.last_transition_at = buildTopicNow();
  loaded.topic.last_transition_reason = `selected_${waveId}_as_next_execution_target`;
  await writeTopicYaml(loaded.topicYamlPath, loaded.topic);
  return {
    ok: true,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
    waveId,
    selectedNextTarget: loaded.topic.selected_next_target,
  };
}

export async function admitWaveInTopic(projectRoot, input, waveId) {
  const validation = await validateWaveAdmission(projectRoot, input, waveId);
  if (!validation.ok) {
    return validation;
  }

  const loaded = await loadTopicReport(projectRoot, input);
  const waves = getTopicWaves(loaded.topic);
  const wave = waves.find((entry) => entry.wave_id === waveId);
  wave.state = "preflight_admitted";
  loaded.topic.waves = waves;
  let nextState = loaded.topic.state;
  if (["proposal", "pending"].includes(loaded.topic.state)) {
    nextState = "ongoing";
    loaded.topic.state = nextState;
  }
  loaded.topic.last_transition_at = buildTopicNow();
  loaded.topic.last_transition_reason = `wave_${waveId}_preflight_admitted`;
  const moved = await moveTopicDirectoryForState(projectRoot, loaded.topicDir, loaded.topicId, nextState);
  await writeTopicYaml(moved.topicYamlPath, loaded.topic);

  return {
    ok: true,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, moved.topicDir)),
    waveId,
    waveState: wave.state,
    state: loaded.topic.state,
  };
}

function parsePacketDraft(text) {
  if (!text) {
    return null;
  }
  if (text.startsWith("---\n")) {
    const closing = text.indexOf("\n---\n", 4);
    if (closing !== -1) {
      const frontmatter = text.slice(4, closing);
      return parseYamlText(frontmatter);
    }
  }
  return parseYamlText(text);
}

function packetFilenameFromId(packetId) {
  return `packet-${packetId}.md`;
}

function resultFilename(waveId, slug, resultKind) {
  return `result-${waveId}-${slug}-${resultKind}.md`;
}

function decisionReviewFilename(slug) {
  return `decision-review-${slug}.md`;
}

function remediationFilename(waveId, kind, reason) {
  return `packet-${waveId}-remediation-${kind}-${reason}.md`;
}

function overflowContinuationFilename(waveId, continuationPacketId) {
  return `overflow-continuation-${waveId}-${continuationPacketId}.md`;
}

function waveCloseoutFilename(waveId) {
  return `closeout-${waveId}.md`;
}

function topicCloseoutFilename() {
  return "closeout-topic.md";
}

function topicTrueCloseAuditFilename() {
  return "topic-true-close-audit.md";
}

function topicTrueCloseJudgementFilename() {
  return "result-topic-true-close-audit.md";
}

function topicTrueCloseRecordFilename() {
  return "result-topic-true-close.md";
}

function pendingNoteFilename() {
  return "pending-note.md";
}

function pendingNoteMarkdown(note) {
  const frontmatter = YAML.stringify(note).trimEnd();
  return `---\n${frontmatter}\n---\n\n# Pending Note\n\nRecorded by \`nimicoding topic hold\`.\n`;
}

function packetMarkdown(packet) {
  const frontmatter = YAML.stringify(packet).trimEnd();
  return `---\n${frontmatter}\n---\n\n# Packet ${packet.packet_id}\n\nFrozen by \`nimicoding topic packet freeze\`.\n`;
}

export async function freezePacketForTopic(projectRoot, input, draftPath) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return loaded;
  }
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority)) {
    return {
      ok: false,
      error: "Packet freeze requires an enriched topic root.",
    };
  }

  const draftText = await readTextIfFile(path.resolve(projectRoot, draftPath));
  if (draftText === null) {
    return {
      ok: false,
      error: `Draft packet not found: ${draftPath}`,
    };
  }
  const packet = parsePacketDraft(draftText);
  if (!packet || typeof packet !== "object") {
    return {
      ok: false,
      error: `Draft packet is not valid YAML/frontmatter: ${draftPath}`,
    };
  }

  const missingFields = authority.packetRequiredFields.filter((field) => {
    const value = packet[field];
    return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  });
  if (missingFields.length > 0) {
    return {
      ok: false,
      error: `Draft packet is missing required fields: ${missingFields.join(", ")}`,
    };
  }
  if (packet.topic_id !== loaded.topicId) {
    return {
      ok: false,
      error: `Draft packet topic_id does not match topic (${packet.topic_id} vs ${loaded.topicId})`,
    };
  }
  const wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === packet.wave_id);
  if (!wave) {
    return {
      ok: false,
      error: `Draft packet wave_id does not resolve inside the topic: ${packet.wave_id}`,
    };
  }
  if (!authority.packetFreezeAllowedStatuses.includes(packet.status)) {
    return {
      ok: false,
      error: `Draft packet status is not freezeable: ${packet.status}`,
    };
  }

  packet.status = "candidate";
  const packetPath = path.join(loaded.topicDir, packetFilenameFromId(packet.packet_id));
  await writeFile(packetPath, packetMarkdown(packet), "utf8");

  return {
    ok: true,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
    packetId: packet.packet_id,
    packetRef: toPortableRelativePath(path.relative(projectRoot, packetPath)),
    waveId: packet.wave_id,
    status: packet.status,
  };
}

export async function loadTopicPacket(projectRoot, input, packetId) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return loaded;
  }

  const packetPath = path.join(loaded.topicDir, packetFilenameFromId(packetId));
  const packetText = await readTextIfFile(packetPath);
  if (packetText === null) {
    return {
      ok: false,
      error: `Packet not found: ${packetId}`,
    };
  }

  const packet = parsePacketDraft(packetText);
  if (!packet || typeof packet !== "object") {
    return {
      ok: false,
      error: `Packet is not valid YAML/frontmatter: ${packetId}`,
    };
  }

  return {
    ok: true,
    ...loaded,
    packetPath,
    packet,
  };
}

function promptFilename(packetId, role) {
  return `prompt-${packetId}-${role}.md`;
}

function buildDispatchPrompt(packet, topicId, role) {
  return `# ${role === "worker" ? "Worker" : "Audit"} Dispatch

Topic: \`${topicId}\`
Packet: \`${packet.packet_id}\`
Wave: \`${packet.wave_id}\`
Packet Kind: \`${packet.packet_kind}\`
Role: \`${role}\`

Authority Owner:
${(Array.isArray(packet.authority_owner) ? packet.authority_owner : []).map((entry) => `- ${entry}`).join("\n")}

Canonical Seams:
${(Array.isArray(packet.canonical_seams) ? packet.canonical_seams : []).map((entry) => `- ${entry}`).join("\n")}

Forbidden Shortcuts:
${(Array.isArray(packet.forbidden_shortcuts) ? packet.forbidden_shortcuts : []).map((entry) => `- ${entry}`).join("\n")}

Acceptance Invariants:
${(Array.isArray(packet.acceptance_invariants) ? packet.acceptance_invariants : []).map((entry) => `- ${entry}`).join("\n")}

Negative Tests:
${(Array.isArray(packet.negative_tests) ? packet.negative_tests : []).map((entry) => `- ${entry}`).join("\n")}

Reopen Conditions:
${(Array.isArray(packet.reopen_conditions) ? packet.reopen_conditions : []).map((entry) => `- ${entry}`).join("\n")}
`;
}

export async function dispatchTopicPacket(projectRoot, input, packetId, role) {
  const loaded = await loadTopicPacket(projectRoot, input, packetId);
  if (!loaded.ok) {
    return loaded;
  }

  const wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === loaded.packet.wave_id);
  if (!wave) {
    return {
      ok: false,
      error: `Packet wave_id does not resolve inside topic: ${loaded.packet.wave_id}`,
    };
  }
  if (["retired", "superseded", "closed"].includes(wave.state)) {
    return {
      ok: false,
      error: `Wave is not dispatchable: ${wave.wave_id} (${wave.state})`,
    };
  }
  if (!["candidate", "admitted", "preflight", "dispatched"].includes(loaded.packet.status)) {
    return {
      ok: false,
      error: `Packet is not dispatchable from status ${loaded.packet.status}`,
    };
  }

  const promptPath = path.join(loaded.topicDir, promptFilename(packetId, role));
  await writeFile(promptPath, buildDispatchPrompt(loaded.packet, loaded.topicId, role), "utf8");
  loaded.packet.status = "dispatched";
  await writeFile(loaded.packetPath, packetMarkdown(loaded.packet), "utf8");

  if (role === "worker" && ["preflight_admitted", "implementation_admitted", "continuation_packet_open"].includes(wave.state)) {
    wave.state = "implementation_active";
    loaded.topic.waves = getTopicWaves(loaded.topic).map((entry) => (
      entry.wave_id === wave.wave_id ? wave : entry
    ));
    loaded.topic.last_transition_at = buildTopicNow();
    loaded.topic.last_transition_reason = `packet_${packetId}_worker_dispatched`;
    await writeTopicYaml(loaded.topicYamlPath, loaded.topic);
  }

  return {
    ok: true,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
    packetId,
    packetRef: toPortableRelativePath(path.relative(projectRoot, loaded.packetPath)),
    promptRef: toPortableRelativePath(path.relative(projectRoot, promptPath)),
    waveId: wave.wave_id,
    waveState: wave.state,
    role,
  };
}

function resultMarkdown(result, sourceText) {
  const frontmatter = YAML.stringify(result).trimEnd();
  return `---\n${frontmatter}\n---\n\n# Result ${result.result_id}\n\n${sourceText ?? ""}`.trimEnd() + "\n";
}

export async function recordTopicResult(projectRoot, input, resultKind, verdict, fromPath, verifiedAt) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return loaded;
  }
  const authority = await loadTopicRuntimeAuthority(projectRoot);

  const sourcePath = path.resolve(projectRoot, fromPath);
  const sourceText = await readTextIfFile(sourcePath);
  if (sourceText === null) {
    return {
      ok: false,
      error: `Result source not found: ${fromPath}`,
    };
  }
  if (!authority.resultKinds.includes(resultKind)) {
    return {
      ok: false,
      error: `Unsupported result kind: ${resultKind}`,
    };
  }
  if (!authority.resultVerdicts.includes(verdict)) {
    return {
      ok: false,
      error: `Unsupported result verdict: ${verdict}`,
    };
  }
  if (authority.resultVerifiedAtFormat === "iso8601_utc_timestamp" && !isIsoUtcTimestamp(verifiedAt)) {
    return {
      ok: false,
      error: `Result verified_at must be an ISO-8601 UTC timestamp: ${verifiedAt}`,
    };
  }

  const waveId = loaded.topic.selected_next_target;
  const wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === waveId) ?? null;
  if (!wave) {
    return {
      ok: false,
      error: "Result recording requires a selected wave in topic.selected_next_target",
    };
  }
  const evidence = await collectWaveArtifactEvidence(loaded.topicDir, wave.wave_id);
  if (evidence.packetRefs.length === 0) {
    return {
      ok: false,
      error: `Result recording requires at least one packet lineage for ${wave.wave_id}`,
    };
  }

  const resultId = `${wave.wave_id}-${resultKind}`;
  const result = {
    result_id: resultId,
    topic_id: loaded.topicId,
    wave_id: wave.wave_id,
    result_kind: resultKind,
    verdict,
    verified_at: verifiedAt,
    source_ref: toPortableRelativePath(path.relative(projectRoot, sourcePath)),
  };
  const resultPath = path.join(loaded.topicDir, resultFilename(wave.wave_id, wave.slug, resultKind));
  await writeFile(resultPath, resultMarkdown(result, sourceText), "utf8");

  if (verdict === "OVERFLOW") {
    wave.state = "overflowed";
  } else if (verdict === "NEEDS_REVISION" || verdict === "FAIL") {
    wave.state = "needs_revision";
  } else if (verdict === "PASS" && wave.state === "preflight_admitted") {
    wave.state = "implementation_admitted";
  }
  loaded.topic.waves = getTopicWaves(loaded.topic).map((entry) => (
    entry.wave_id === wave.wave_id ? wave : entry
  ));
  loaded.topic.last_transition_at = buildTopicNow();
  loaded.topic.last_transition_reason = `recorded_${resultKind}_${verdict}_for_${wave.wave_id}`;
  await writeTopicYaml(loaded.topicYamlPath, loaded.topic);

  return {
    ok: true,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
    resultId,
    resultRef: toPortableRelativePath(path.relative(projectRoot, resultPath)),
    waveId: wave.wave_id,
    waveState: wave.state,
    verdict,
    resultKind,
  };
}

function remediationMarkdown(remediation) {
  const frontmatter = YAML.stringify(remediation).trimEnd();
  return `---\n${frontmatter}\n---\n\n# Remediation ${remediation.remediation_id}\n\nOpened by \`nimicoding topic remediation open\`.\n`;
}

export async function openTopicRemediation(projectRoot, input, options) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return loaded;
  }
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority)) {
    return {
      ok: false,
      error: "Remediation commands require an enriched topic root.",
    };
  }
  if (!authority.remediationKinds.includes(options.kind)) {
    return {
      ok: false,
      error: `Unsupported remediation kind: ${options.kind}`,
    };
  }

  const waveId = loaded.topic.selected_next_target;
  const wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === waveId) ?? null;
  if (!wave) {
    return {
      ok: false,
      error: "Remediation open requires a selected wave in topic.selected_next_target",
    };
  }
  if (["retired", "superseded", "closed"].includes(wave.state)) {
    return {
      ok: false,
      error: `Wave is not remediation-eligible: ${wave.wave_id} (${wave.state})`,
    };
  }
  if (options.kind === "continuation" && wave.state !== "overflowed") {
    return {
      ok: false,
      error: `Continuation remediation requires an overflowed wave, found ${wave.state}`,
    };
  }
  if (options.kind === "continuation" && !options.overflowedPacketId) {
    return {
      ok: false,
      error: "Continuation remediation requires --overflowed-packet lineage",
    };
  }
  if (options.overflowedPacketId) {
    const overflowedPacket = await loadTopicPacket(projectRoot, input, options.overflowedPacketId);
    if (!overflowedPacket.ok) {
      return {
        ok: false,
        error: `Overflowed packet lineage could not be loaded: ${options.overflowedPacketId}`,
      };
    }
    if (overflowedPacket.packet.wave_id !== wave.wave_id) {
      return {
        ok: false,
        error: `Overflowed packet does not belong to the selected wave (${overflowedPacket.packet.wave_id} vs ${wave.wave_id})`,
      };
    }
  }

  const remediationId = `${wave.wave_id}-remediation-${options.kind}-${options.reason}`;
  const remediation = {
    remediation_id: remediationId,
    topic_id: loaded.topicId,
    wave_id: wave.wave_id,
    kind: options.kind,
    reason: options.reason,
  };
  if (options.overflowedPacketId) {
    remediation.overflowed_packet_id = options.overflowedPacketId;
  }
  const remediationPath = path.join(loaded.topicDir, remediationFilename(wave.wave_id, options.kind, options.reason));
  await writeFile(remediationPath, remediationMarkdown(remediation), "utf8");

  if (options.kind !== "continuation" && wave.state !== "needs_revision") {
    wave.state = "needs_revision";
    loaded.topic.waves = getTopicWaves(loaded.topic).map((entry) => (
      entry.wave_id === wave.wave_id ? wave : entry
    ));
  }
  loaded.topic.last_transition_at = buildTopicNow();
  loaded.topic.last_transition_reason = `opened_remediation_${options.kind}_${options.reason}_for_${wave.wave_id}`;
  await writeTopicYaml(loaded.topicYamlPath, loaded.topic);

  return {
    ok: true,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
    remediationId,
    remediationRef: toPortableRelativePath(path.relative(projectRoot, remediationPath)),
    waveId: wave.wave_id,
    waveState: wave.state,
    kind: options.kind,
    reason: options.reason,
  };
}

function overflowContinuationMarkdown(continuation) {
  const frontmatter = YAML.stringify(continuation).trimEnd();
  return `---\n${frontmatter}\n---\n\n# Overflow Continuation ${continuation.continuation_packet_id}\n\nRecorded by \`nimicoding topic overflow continue\`.\n`;
}

export async function continueTopicOverflow(projectRoot, input, options) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return loaded;
  }
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority)) {
    return {
      ok: false,
      error: "Overflow continuation requires an enriched topic root.",
    };
  }

  const waveId = loaded.topic.selected_next_target;
  const wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === waveId) ?? null;
  if (!wave) {
    return {
      ok: false,
      error: "Overflow continuation requires a selected wave in topic.selected_next_target",
    };
  }
  if (wave.state !== "overflowed") {
    return {
      ok: false,
      error: `Overflow continuation requires an overflowed wave, found ${wave.state}`,
    };
  }
  if (options.sameOwnerDomain !== true) {
    return {
      ok: false,
      error: "Overflow continuation requires explicit same-owner-domain acknowledgement",
    };
  }

  const overflowedPacket = await loadTopicPacket(projectRoot, input, options.overflowedPacketId);
  if (!overflowedPacket.ok) {
    return {
      ok: false,
      error: `Overflowed packet lineage could not be loaded: ${options.overflowedPacketId}`,
    };
  }
  if (overflowedPacket.packet.wave_id !== wave.wave_id) {
    return {
      ok: false,
      error: `Overflowed packet does not belong to the selected wave (${overflowedPacket.packet.wave_id} vs ${wave.wave_id})`,
    };
  }

  const continuationPacket = await loadTopicPacket(projectRoot, input, options.continuationPacketId);
  if (!continuationPacket.ok) {
    return {
      ok: false,
      error: `Continuation packet could not be loaded: ${options.continuationPacketId}`,
    };
  }
  if (continuationPacket.packet.wave_id !== wave.wave_id) {
    return {
      ok: false,
      error: `Continuation packet does not belong to the selected wave (${continuationPacket.packet.wave_id} vs ${wave.wave_id})`,
    };
  }

  const continuation = {
    topic_id: loaded.topicId,
    wave_id: wave.wave_id,
    overflowed_packet_id: options.overflowedPacketId,
    manager_judgement: options.managerJudgement,
    continuation_packet_id: options.continuationPacketId,
    same_owner_domain: true,
  };
  const continuationPath = path.join(
    loaded.topicDir,
    overflowContinuationFilename(wave.wave_id, options.continuationPacketId),
  );
  await writeFile(continuationPath, overflowContinuationMarkdown(continuation), "utf8");

  wave.state = "continuation_packet_open";
  loaded.topic.waves = getTopicWaves(loaded.topic).map((entry) => (
    entry.wave_id === wave.wave_id ? wave : entry
  ));
  loaded.topic.last_transition_at = buildTopicNow();
  loaded.topic.last_transition_reason = `continued_overflow_for_${wave.wave_id}_via_${options.continuationPacketId}`;
  await writeTopicYaml(loaded.topicYamlPath, loaded.topic);

  return {
    ok: true,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
    waveId: wave.wave_id,
    waveState: wave.state,
    overflowedPacketId: options.overflowedPacketId,
    continuationPacketId: options.continuationPacketId,
    continuationRef: toPortableRelativePath(path.relative(projectRoot, continuationPath)),
  };
}

export async function createDecisionReview(projectRoot, input, slug, options) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return loaded;
  }
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!validateTopicSlug(slug)) {
    return {
      ok: false,
      error: `Decision review slug must be lowercase kebab-case: ${slug}`,
    };
  }
  if (!authority.decisionDispositions.includes(options.disposition)) {
    return {
      ok: false,
      error: `Unsupported decision disposition: ${options.disposition}`,
    };
  }

  const review = {
    decision_review_id: slug,
    topic_id: loaded.topicId,
    date: options.date,
    decision: options.decision,
    replaced_scope: options.replacedScope,
    active_replacement_scope: options.activeReplacementScope,
    disposition: options.disposition,
  };

  if (options.targetWaveId) {
    const targetWave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === options.targetWaveId);
    if (!targetWave) {
      return {
        ok: false,
        error: `Decision review target wave does not exist: ${options.targetWaveId}`,
      };
    }
  }
  if (
    options.activeReplacementScope !== "topic_design_baseline"
    && options.activeReplacementScope !== null
    && !getTopicWaves(loaded.topic).some((entry) => entry.wave_id === options.activeReplacementScope)
  ) {
    return {
      ok: false,
      error: `Decision review active replacement scope must be machine-identifiable: ${options.activeReplacementScope}`,
    };
  }

  const reviewPath = path.join(loaded.topicDir, decisionReviewFilename(slug));
  await writeFile(reviewPath, `---\n${YAML.stringify(review).trimEnd()}\n---\n\n# Decision Review ${slug}\n`, "utf8");

  if (options.targetWaveId) {
    const waves = getTopicWaves(loaded.topic).map((entry) => {
      if (entry.wave_id !== options.targetWaveId) {
        return entry;
      }
      if (options.disposition === "retired") {
        return { ...entry, state: "retired", selected: false };
      }
      if (options.disposition === "superseded") {
        return { ...entry, state: "superseded", selected: false };
      }
      return entry;
    });
    loaded.topic.waves = waves;
    if (loaded.topic.selected_next_target === options.targetWaveId) {
      loaded.topic.selected_next_target = options.activeReplacementScope;
    }
    loaded.topic.last_transition_at = buildTopicNow();
    loaded.topic.last_transition_reason = `decision_review_${slug}`;
    await writeTopicYaml(loaded.topicYamlPath, loaded.topic);
  }

  return {
    ok: true,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
    decisionReviewId: slug,
    decisionReviewRef: toPortableRelativePath(path.relative(projectRoot, reviewPath)),
    disposition: options.disposition,
    targetWaveId: options.targetWaveId ?? null,
  };
}

export async function holdTopicInPending(projectRoot, input, options) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return loaded;
  }
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority)) {
    return {
      ok: false,
      error: "Topic hold requires an enriched topic root.",
    };
  }
  if (loaded.topic.state !== "ongoing") {
    return {
      ok: false,
      error: `Topic hold requires ongoing state, found ${loaded.topic.state}`,
    };
  }
  const blockers = getPendingEntryBlockers(loaded.topic);
  if (blockers.length > 0) {
    return {
      ok: false,
      error: `Topic hold requires no active implementation wave, found ${blockers.join(", ")}`,
    };
  }
  if (!options.reopenCriteria && !options.closeTrigger) {
    return {
      ok: false,
      error: "Topic hold requires explicit reopen criteria or close trigger.",
    };
  }

  const pendingNote = {
    pending_note_id: `pending-${loaded.topicId}`,
    topic_id: loaded.topicId,
    entered_from_state: loaded.topic.state,
    reason: options.reason,
    summary: options.summary,
    status: "active",
  };
  if (options.reopenCriteria) {
    pendingNote.reopen_criteria = options.reopenCriteria;
  }
  if (options.closeTrigger) {
    pendingNote.close_trigger = options.closeTrigger;
  }
  const notePath = path.join(loaded.topicDir, pendingNoteFilename());
  await writeFile(notePath, pendingNoteMarkdown(pendingNote), "utf8");

  loaded.topic.state = "pending";
  loaded.topic.last_transition_at = buildTopicNow();
  loaded.topic.last_transition_reason = `entered_pending_${options.reason}`;
  const moved = await moveTopicDirectoryForState(projectRoot, loaded.topicDir, loaded.topicId, "pending");
  await writeTopicYaml(moved.topicYamlPath, loaded.topic);

  return {
    ok: true,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, moved.topicDir)),
    state: loaded.topic.state,
    pendingNoteRef: toPortableRelativePath(path.relative(projectRoot, path.join(moved.topicDir, pendingNoteFilename()))),
    reason: options.reason,
  };
}

export async function resumePendingTopic(projectRoot, input, options) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return loaded;
  }
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority)) {
    return {
      ok: false,
      error: "Topic resume requires an enriched topic root.",
    };
  }
  if (loaded.topic.state !== "pending") {
    return {
      ok: false,
      error: `Topic resume requires pending state, found ${loaded.topic.state}`,
    };
  }

  const pendingNoteLoaded = await loadPendingNote(loaded.topicDir);
  if (!pendingNoteLoaded.ok) {
    return {
      ok: false,
      error: pendingNoteLoaded.error,
    };
  }
  const pendingNote = pendingNoteLoaded.note;
  if (!pendingNote.reopen_criteria) {
    return {
      ok: false,
      error: "Topic resume requires pending note reopen criteria.",
    };
  }
  const selectedWave = getTopicWaves(loaded.topic).find((entry) => entry.selected === true) ?? null;
  const hasMachineReopenTarget = typeof loaded.topic.selected_next_target === "string"
    && loaded.topic.selected_next_target !== "topic_design_baseline"
    && selectedWave !== null
    && selectedWave.wave_id === loaded.topic.selected_next_target;
  if (!hasMachineReopenTarget) {
    return {
      ok: false,
      error: "Topic resume requires exactly one selected next execution target before reopening.",
    };
  }

  pendingNote.status = "resumed";
  pendingNote.last_resumed_at = buildTopicNow();
  pendingNote.last_resume_reason = options.criteriaMet;
  await writeFile(pendingNoteLoaded.notePath, pendingNoteMarkdown(pendingNote), "utf8");

  loaded.topic.state = "ongoing";
  loaded.topic.last_transition_at = buildTopicNow();
  loaded.topic.last_transition_reason = "resumed_from_pending_after_reopen_criteria_met";
  const moved = await moveTopicDirectoryForState(projectRoot, loaded.topicDir, loaded.topicId, "ongoing");
  await writeTopicYaml(moved.topicYamlPath, loaded.topic);

  return {
    ok: true,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, moved.topicDir)),
    state: loaded.topic.state,
    pendingNoteRef: toPortableRelativePath(path.relative(projectRoot, path.join(moved.topicDir, pendingNoteFilename()))),
    criteriaMet: options.criteriaMet,
  };
}

function closeoutMarkdown(closeout, title) {
  const frontmatter = YAML.stringify(closeout).trimEnd();
  return `---\n${frontmatter}\n---\n\n# ${title}\n\nRecorded by \`nimicoding topic closeout\`.\n`;
}

function trueCloseAuditMarkdown(audit, judgementText) {
  const frontmatter = YAML.stringify(audit).trimEnd();
  return `---\n${frontmatter}\n---\n\n# Topic True-Close Audit\n\n${judgementText}\n`;
}

function trueCloseRecordMarkdown(record) {
  const frontmatter = YAML.stringify(record).trimEnd();
  return `---\n${frontmatter}\n---\n\n# Topic True-Close\n\nRecorded by \`nimicoding topic closeout topic\`.\n`;
}

function readFrontmatterObject(text) {
  const parsed = parsePacketDraft(text);
  return parsed && typeof parsed === "object" ? parsed : null;
}

async function buildWaveClosureChecks(projectRoot, topicDir, topic, wave, closeout) {
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  const evidence = await collectWaveArtifactEvidence(topicDir, wave.wave_id);
  const checks = [];
  checks.push({
    id: "closeout_scope_wave",
    ok: closeout.scope === "wave" && authority.closeoutScopes.includes(closeout.scope),
    reason: closeout.scope === "wave"
      ? "closeout scope is wave"
      : `closeout scope must be wave, found ${closeout.scope ?? "missing"}`,
  });
  checks.push({
    id: "closeout_topic_matches",
    ok: closeout.topic_id === topic.topic_id,
    reason: closeout.topic_id === topic.topic_id
      ? "closeout topic_id matches the topic"
      : `closeout topic_id does not match topic (${closeout.topic_id ?? "missing"} vs ${topic.topic_id})`,
  });

  const closurePairs = authority.closureDimensions.map((dimension) => [`${dimension}_closure`, closeout[`${dimension}_closure`]]);
  for (const [field, value] of closurePairs) {
    checks.push({
      id: `${field}_explicit_closed`,
      ok: value === "closed" && authority.closureStates.includes(value),
      reason: value === "closed"
        ? `${field} is explicitly closed`
        : `${field} must be closed for wave closeout, found ${value ?? "missing"}`,
    });
  }

  checks.push({
    id: "closeout_disposition_complete",
    ok: closeout.disposition === "complete" && authority.closeoutDispositions.includes(closeout.disposition),
    reason: closeout.disposition === "complete"
      ? "closeout disposition is complete"
      : `closeout disposition must be complete for wave closeout, found ${closeout.disposition ?? "missing"}`,
  });

  const activeBlockers = ["needs_revision", "overflowed", "continuation_packet_open"].includes(wave.state);
  checks.push({
    id: "wave_has_no_active_blockers",
    ok: !activeBlockers,
    reason: !activeBlockers
      ? "wave has no active blocker state"
      : `wave remains in an active blocker state: ${wave.state}`,
  });

  const closeableState = ["implementation_active", "closed"].includes(wave.state);
  checks.push({
    id: "wave_state_closeable",
    ok: closeableState,
    reason: closeableState
      ? "wave state remains eligible for closeout"
      : `wave closeout requires implementation_active or closed, found ${wave.state}`,
  });

  if (authority.waveCloseoutEvidence.requirePacketLineage) {
    checks.push({
      id: "wave_packet_lineage_exists",
      ok: evidence.packetRefs.length > 0,
      reason: evidence.packetRefs.length > 0
        ? "wave closeout has packet lineage evidence"
        : `wave closeout requires packet lineage evidence for ${wave.wave_id}`,
    });
  }

  if (authority.waveCloseoutEvidence.requireResultLineage) {
    checks.push({
      id: "wave_result_lineage_exists",
      ok: evidence.resultRefs.length > 0,
      reason: evidence.resultRefs.length > 0
        ? "wave closeout has result lineage evidence"
        : `wave closeout requires result lineage evidence for ${wave.wave_id}`,
    });
  }

  return checks;
}

export async function validateWaveClosure(projectRoot, input, waveId) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return {
      ok: false,
      error: loaded.error,
      checks: [],
      warnings: [],
    };
  }

  const rootValidation = await validateTopicRoot(projectRoot, input);
  const wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === waveId) ?? null;
  const checks = [...(rootValidation.checks ?? [])];
  const warnings = [...(rootValidation.warnings ?? [])];
  checks.push({
    id: "wave_exists",
    ok: wave !== null,
    reason: wave ? "wave exists in topic.yaml waves[]" : `wave does not exist: ${waveId}`,
  });

  if (!wave) {
    return {
      ...rootValidation,
      ok: false,
      checks,
      warnings,
    };
  }

  const closeoutPath = path.join(loaded.topicDir, waveCloseoutFilename(waveId));
  const closeoutText = await readTextIfFile(closeoutPath);
  checks.push({
    id: "wave_closeout_artifact_exists",
    ok: closeoutText !== null,
    reason: closeoutText !== null
      ? "wave closeout artifact exists"
      : `missing wave closeout artifact: ${waveCloseoutFilename(waveId)}`,
  });

  if (closeoutText === null) {
    return {
      ...rootValidation,
      ok: false,
      checks,
      warnings,
      waveId,
    };
  }

  const closeout = readFrontmatterObject(closeoutText);
  checks.push({
    id: "wave_closeout_frontmatter_valid",
    ok: closeout !== null,
    reason: closeout !== null
      ? "wave closeout frontmatter is valid"
      : "wave closeout artifact frontmatter is invalid",
  });

  if (closeout === null) {
    return {
      ...rootValidation,
      ok: false,
      checks,
      warnings,
      waveId,
    };
  }

  checks.push(...await buildWaveClosureChecks(projectRoot, loaded.topicDir, loaded.topic, wave, closeout));
  return {
    ...rootValidation,
    ok: rootValidation.ok && checks.every((entry) => entry.ok),
    checks,
    warnings,
    waveId,
    closeoutRef: toPortableRelativePath(path.relative(projectRoot, closeoutPath)),
  };
}

export async function closeoutWaveInTopic(projectRoot, input, waveId, options) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return loaded;
  }
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority)) {
    return {
      ok: false,
      error: "Wave closeout requires an enriched topic root.",
    };
  }

  const wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === waveId) ?? null;
  if (!wave) {
    return {
      ok: false,
      error: `Wave not found: ${waveId}`,
    };
  }

  const closeout = {
    closeout_id: waveId,
    topic_id: loaded.topicId,
    scope: "wave",
    authority_closure: options.authorityClosure,
    semantic_closure: options.semanticClosure,
    consumer_closure: options.consumerClosure,
    drift_resistance_closure: options.driftResistanceClosure,
    disposition: options.disposition,
  };
  const checks = await buildWaveClosureChecks(projectRoot, loaded.topicDir, loaded.topic, wave, closeout);
  if (!checks.every((entry) => entry.ok)) {
    return {
      ok: false,
      error: `Wave closeout refused: ${checks.find((entry) => !entry.ok)?.reason ?? "closure validation failed"}`,
      checks,
      warnings: [],
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
      waveId,
    };
  }

  const closeoutPath = path.join(loaded.topicDir, waveCloseoutFilename(waveId));
  await writeFile(closeoutPath, closeoutMarkdown(closeout, `Wave Closeout ${waveId}`), "utf8");

  wave.state = "closed";
  wave.selected = false;
  loaded.topic.waves = getTopicWaves(loaded.topic).map((entry) => (
    entry.wave_id === waveId ? wave : entry
  ));
  if (loaded.topic.selected_next_target === waveId) {
    loaded.topic.selected_next_target = null;
  }
  loaded.topic.last_transition_at = buildTopicNow();
  loaded.topic.last_transition_reason = `closed_${waveId}`;
  await writeTopicYaml(loaded.topicYamlPath, loaded.topic);

  return {
    ok: true,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
    waveId,
    waveState: wave.state,
    closeoutRef: toPortableRelativePath(path.relative(projectRoot, closeoutPath)),
  };
}

async function buildTrueCloseAuditChecks(projectRoot, topicDir, topic) {
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  const waves = getTopicWaves(topic);
  const checks = [];
  const nonTerminalWaves = waves
    .filter((entry) => !["closed", "retired", "superseded"].includes(entry.state))
    .map((entry) => `${entry.wave_id}:${entry.state}`);
  checks.push({
    id: "all_waves_terminal",
    ok: nonTerminalWaves.length === 0,
    reason: nonTerminalWaves.length === 0
      ? "all waves are closed, retired, or superseded"
      : `non-terminal waves remain: ${nonTerminalWaves.join(", ")}`,
  });
  const selectedActive = waves.filter((entry) => entry.selected === true).map((entry) => entry.wave_id);
  checks.push({
    id: "no_selected_wave_remains",
    ok: selectedActive.length === 0,
    reason: selectedActive.length === 0
      ? "no selected wave remains active"
      : `selected waves remain: ${selectedActive.join(", ")}`,
  });
  checks.push({
    id: "selected_target_cleared",
    ok: topic.selected_next_target === null || topic.selected_next_target === "topic_design_baseline",
    reason: topic.selected_next_target === null || topic.selected_next_target === "topic_design_baseline"
      ? "selected_next_target is cleared for topic closeout"
      : `selected_next_target remains active: ${topic.selected_next_target}`,
  });

  for (const wave of waves.filter((entry) => entry.state === "closed")) {
    const evidence = await collectWaveArtifactEvidence(topicDir, wave.wave_id);
    if (authority.trueCloseAuditEvidence.requireWaveCloseoutForClosedWaves) {
      checks.push({
        id: `wave_closeout_exists_${wave.wave_id}`,
        ok: evidence.closeoutRefs.length > 0,
        reason: evidence.closeoutRefs.length > 0
          ? `${wave.wave_id} has closeout evidence`
          : `${wave.wave_id} is closed but has no wave closeout evidence`,
      });
    }
    if (authority.trueCloseAuditEvidence.requirePacketLineageForClosedWaves) {
      checks.push({
        id: `wave_packet_lineage_exists_${wave.wave_id}`,
        ok: evidence.packetRefs.length > 0,
        reason: evidence.packetRefs.length > 0
          ? `${wave.wave_id} has packet lineage evidence`
          : `${wave.wave_id} is closed but has no packet lineage evidence`,
      });
    }
    if (authority.trueCloseAuditEvidence.requireResultLineageForClosedWaves) {
      checks.push({
        id: `wave_result_lineage_exists_${wave.wave_id}`,
        ok: evidence.resultRefs.length > 0,
        reason: evidence.resultRefs.length > 0
          ? `${wave.wave_id} has result lineage evidence`
          : `${wave.wave_id} is closed but has no result lineage evidence`,
      });
    }
  }
  return checks;
}

export async function runTopicTrueCloseAudit(projectRoot, input, judgementText) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return loaded;
  }
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority)) {
    return {
      ok: false,
      error: "True-close audit requires an enriched topic root.",
    };
  }

  const checks = await buildTrueCloseAuditChecks(projectRoot, loaded.topicDir, loaded.topic);
  const passed = checks.every((entry) => entry.ok);
  const auditPath = path.join(loaded.topicDir, topicTrueCloseAuditFilename());
  const judgementPath = path.join(loaded.topicDir, topicTrueCloseJudgementFilename());
  const audit = {
    topic_id: loaded.topicId,
    status: passed ? "passed" : "pending",
    checks,
  };
  await writeFile(auditPath, trueCloseAuditMarkdown(audit, judgementText), "utf8");
  await writeFile(
    judgementPath,
    `---\n${YAML.stringify({
      topic_id: loaded.topicId,
      status: passed ? "passed" : "pending",
      judgement: judgementText,
    }).trimEnd()}\n---\n\n# Topic True-Close Audit Result\n`,
    "utf8",
  );

  loaded.topic.last_transition_at = buildTopicNow();
  loaded.topic.last_transition_reason = "ran_topic_true_close_audit";
  if (passed) {
    loaded.topic.current_true_close_status = "pending";
  }
  await writeTopicYaml(loaded.topicYamlPath, loaded.topic);

  return {
    ok: passed,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
    status: passed ? "passed" : "pending",
    auditRef: toPortableRelativePath(path.relative(projectRoot, auditPath)),
    judgementRef: toPortableRelativePath(path.relative(projectRoot, judgementPath)),
    checks,
    warnings: [],
  };
}

export async function closeoutTopicInTopic(projectRoot, input, options) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return loaded;
  }
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority)) {
    return {
      ok: false,
      error: "Topic closeout requires an enriched topic root.",
    };
  }

  let pendingNoteLoaded = null;
  if (loaded.topic.state === "pending") {
    pendingNoteLoaded = await loadPendingNote(loaded.topicDir);
    if (!pendingNoteLoaded.ok) {
      return {
        ok: false,
        error: `Topic closeout from pending requires a pending note artifact: ${pendingNoteLoaded.error}`,
      };
    }
    if (typeof pendingNoteLoaded.note.close_trigger !== "string" || pendingNoteLoaded.note.close_trigger.length === 0) {
      return {
        ok: false,
        error: "Topic closeout from pending requires an explicit close trigger in pending-note.md.",
      };
    }
  }

  const auditPath = path.join(loaded.topicDir, topicTrueCloseAuditFilename());
  const judgementPath = path.join(loaded.topicDir, topicTrueCloseJudgementFilename());
  const auditText = await readTextIfFile(auditPath);
  const judgementText = await readTextIfFile(judgementPath);
  if (auditText === null || judgementText === null) {
    return {
      ok: false,
      error: "Topic closeout requires a recorded true-close audit and judgement.",
    };
  }
  const audit = readFrontmatterObject(auditText);
  if (!audit || audit.status !== "passed") {
    return {
      ok: false,
      error: "Topic closeout requires a passed true-close audit.",
    };
  }

  const auditChecks = await buildTrueCloseAuditChecks(projectRoot, loaded.topicDir, loaded.topic);
  if (!auditChecks.every((entry) => entry.ok)) {
    return {
      ok: false,
      error: `Topic closeout refused: ${auditChecks.find((entry) => !entry.ok)?.reason ?? "true-close checks failed"}`,
      checks: auditChecks,
      warnings: [],
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
    };
  }

  const closeout = {
    closeout_id: loaded.topicId,
    topic_id: loaded.topicId,
    scope: "topic",
    authority_closure: options.authorityClosure,
    semantic_closure: options.semanticClosure,
    consumer_closure: options.consumerClosure,
    drift_resistance_closure: options.driftResistanceClosure,
    disposition: options.disposition,
  };
  const closureFields = [
    closeout.authority_closure,
    closeout.semantic_closure,
    closeout.consumer_closure,
    closeout.drift_resistance_closure,
  ];
  if (closureFields.some((entry) => entry !== "closed") || closeout.disposition !== "complete") {
    return {
      ok: false,
      error: "Topic closeout requires all four closures to be closed and disposition=complete.",
    };
  }

  const closeoutPath = path.join(loaded.topicDir, topicCloseoutFilename());
  await writeFile(closeoutPath, closeoutMarkdown(closeout, "Topic Closeout"), "utf8");

  const trueCloseRecordPath = path.join(loaded.topicDir, topicTrueCloseRecordFilename());
  await writeFile(trueCloseRecordPath, trueCloseRecordMarkdown({
    topic_id: loaded.topicId,
    status: "passed",
    audit_ref: toPortableRelativePath(path.relative(projectRoot, auditPath)),
    judgement_ref: toPortableRelativePath(path.relative(projectRoot, judgementPath)),
  }), "utf8");

  loaded.topic.state = "closed";
  loaded.topic.current_true_close_status = "true_closed";
  loaded.topic.last_transition_at = buildTopicNow();
  loaded.topic.last_transition_reason = "closed_topic_after_true_close";
  const moved = await moveTopicDirectoryForState(projectRoot, loaded.topicDir, loaded.topicId, "closed");
  await writeTopicYaml(moved.topicYamlPath, loaded.topic);
  if (pendingNoteLoaded?.ok) {
    pendingNoteLoaded.note.status = "closed";
    pendingNoteLoaded.note.closed_at = buildTopicNow();
    await writeFile(path.join(moved.topicDir, pendingNoteFilename()), pendingNoteMarkdown(pendingNoteLoaded.note), "utf8");
  }

  return {
    ok: true,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, moved.topicDir)),
    state: loaded.topic.state,
    closeoutRef: toPortableRelativePath(path.relative(projectRoot, path.join(moved.topicDir, topicCloseoutFilename()))),
    trueCloseRef: toPortableRelativePath(path.relative(projectRoot, path.join(moved.topicDir, topicTrueCloseRecordFilename()))),
    currentTrueCloseStatus: loaded.topic.current_true_close_status,
  };
}

export async function validateTopicRoot(projectRoot, input = null) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) {
    return {
      ok: false,
      error: loaded.error,
      checks: [],
      warnings: [],
    };
  }

  const { topicDir, topicId, state, topic } = loaded;
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  const validationPolicy = await loadTopicValidationPolicy(projectRoot);
  const ignoredByPolicy = validationPolicy.ignoredTopicIds.get(topicId) ?? null;
  const checks = [];
  const warnings = [];
  const relativeTopicDir = toPortableRelativePath(path.relative(projectRoot, topicDir));
  const artifactAnalysis = await analyzeTopicArtifacts(topicDir, topic);
  const pendingNoteLoaded = await loadPendingNote(topicDir);

  const topicIdMatchesFolder = topic.topic_id === topicId;
  checks.push({
    id: "topic_id_matches_folder",
    ok: topicIdMatchesFolder,
    reason: topicIdMatchesFolder
      ? "topic.yaml topic_id matches the topic folder"
      : `topic.yaml topic_id does not match folder name (${topic.topic_id ?? "missing"} vs ${topicId})`,
  });

  const stateMatchesRoot = topic.state === state;
  checks.push({
    id: "state_matches_root",
    ok: stateMatchesRoot,
    reason: stateMatchesRoot
      ? "topic.yaml state matches the lifecycle root"
      : `topic.yaml state does not match lifecycle root (${topic.state ?? "missing"} vs ${state})`,
  });

  const missingMinimalFields = authority.minimalRequiredFields.filter((field) => {
    const value = topic[field];
    return value === undefined || value === null || value === "";
  });
  checks.push({
    id: "minimal_state_evidence",
    ok: missingMinimalFields.length === 0,
    reason: missingMinimalFields.length === 0
      ? "topic.yaml contains the required lifecycle evidence fields"
      : `topic.yaml is missing required lifecycle evidence fields: ${missingMinimalFields.join(", ")}`,
  });

  const topicIdFormatValid = validateTopicId(topicId);
  checks.push({
    id: "topic_id_format",
    ok: topicIdFormatValid,
    reason: topicIdFormatValid
      ? "topic id remains date-first and sortable"
      : `topic id is not date-first and sortable: ${topicId}`,
  });

  const missingRecommendedFiles = [];
  for (const fileName of authority.recommendedFiles) {
    const info = await pathExists(path.join(topicDir, fileName));
    if (!info?.isFile()) {
      missingRecommendedFiles.push(fileName);
    }
  }
  if (missingRecommendedFiles.length > 0) {
    warnings.push(`recommended topic companion files are missing: ${missingRecommendedFiles.join(", ")}`);
  }

  const missingEnrichedFields = authority.enrichedRequiredFields.filter((field) => {
    const value = topic[field];
    if (field === "selected_next_target") {
      return !(value === null || value === "topic_design_baseline" || (typeof value === "string" && value.length > 0));
    }
    return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  });

  const enumViolations = [];
  if (topic.mode !== undefined && !authority.topicEnums.mode.includes(topic.mode)) {
    enumViolations.push(`mode=${topic.mode}`);
  }
  if (topic.posture !== undefined && !authority.topicEnums.posture.includes(topic.posture)) {
    enumViolations.push(`posture=${topic.posture}`);
  }
  if (topic.design_policy !== undefined && !authority.topicEnums.designPolicy.includes(topic.design_policy)) {
    enumViolations.push(`design_policy=${topic.design_policy}`);
  }
  if (topic.parallel_truth !== undefined && !authority.topicEnums.parallelTruth.includes(topic.parallel_truth)) {
    enumViolations.push(`parallel_truth=${topic.parallel_truth}`);
  }
  if (topic.layering !== undefined && !authority.topicEnums.layering.includes(topic.layering)) {
    enumViolations.push(`layering=${topic.layering}`);
  }
  if (topic.risk !== undefined && !authority.topicEnums.risk.includes(topic.risk)) {
    enumViolations.push(`risk=${topic.risk}`);
  }
  if (topic.applicability !== undefined && !authority.topicEnums.applicability.includes(topic.applicability)) {
    enumViolations.push(`applicability=${topic.applicability}`);
  }
  if (topic.execution_mode !== undefined && !authority.topicEnums.executionMode.includes(topic.execution_mode)) {
    enumViolations.push(`execution_mode=${topic.execution_mode}`);
  }
  if (topic.current_true_close_status !== undefined && !authority.topicEnums.trueCloseStatus.includes(topic.current_true_close_status)) {
    enumViolations.push(`current_true_close_status=${topic.current_true_close_status}`);
  }

  if (missingEnrichedFields.length > 0) {
    warnings.push(`topic.yaml is using the legacy minimal shape and is missing enriched fields: ${missingEnrichedFields.join(", ")}`);
  }
  if (enumViolations.length > 0) {
    warnings.push(`topic.yaml contains values outside the current enriched enums: ${enumViolations.join(", ")}`);
  }

  checks.push({
    id: "result_wave_lineage_resolves",
    ok: artifactAnalysis.unresolvedResultWaveIds.length === 0,
    reason: artifactAnalysis.unresolvedResultWaveIds.length === 0
      ? "result artifacts resolve to known wave lineage"
      : `result artifacts reference unknown wave lineage: ${artifactAnalysis.unresolvedResultWaveIds.join(", ")}`,
  });

  if (topic.state === "pending") {
    const pendingNote = pendingNoteLoaded.ok ? pendingNoteLoaded.note : null;
    checks.push({
      id: "pending_note_exists",
      ok: pendingNoteLoaded.ok,
      reason: pendingNoteLoaded.ok
        ? "pending note artifact exists"
        : pendingNoteLoaded.error,
    });
    if (pendingNote) {
      const pendingNoteMissingFields = authority.pendingNoteRequiredFields.filter((field) => {
        const value = pendingNote[field];
        return value === undefined || value === null || value === "";
      });
      checks.push({
        id: "pending_note_required_fields",
        ok: pendingNoteMissingFields.length === 0,
        reason: pendingNoteMissingFields.length === 0
          ? "pending note contains required fields"
          : `pending note is missing required fields: ${pendingNoteMissingFields.join(", ")}`,
      });
      checks.push({
        id: "pending_note_topic_matches",
        ok: pendingNote.topic_id === topicId,
        reason: pendingNote.topic_id === topicId
          ? "pending note topic_id matches the topic"
          : `pending note topic_id does not match topic (${pendingNote.topic_id ?? "missing"} vs ${topicId})`,
      });
      checks.push({
        id: "pending_note_status_active",
        ok: pendingNote.status === "active" && authority.pendingNoteStatuses.includes(pendingNote.status),
        reason: pendingNote.status === "active"
          ? "pending note remains active while topic is pending"
          : `pending note status must be active while pending, found ${pendingNote.status ?? "missing"}`,
      });
      checks.push({
        id: "pending_note_reopen_or_close_defined",
        ok: typeof pendingNote.reopen_criteria === "string" || typeof pendingNote.close_trigger === "string",
        reason: typeof pendingNote.reopen_criteria === "string" || typeof pendingNote.close_trigger === "string"
          ? "pending note declares reopen criteria or close trigger"
          : "pending note must declare reopen criteria or close trigger",
      });
    }

    const pendingBlockers = getPendingEntryBlockers(topic);
    checks.push({
      id: "pending_has_no_active_implementation_wave",
      ok: pendingBlockers.length === 0,
      reason: pendingBlockers.length === 0
        ? "pending topic has no active implementation wave"
        : `pending topic still has active implementation waves: ${pendingBlockers.join(", ")}`,
    });
  }

  if (ignoredByPolicy) {
    warnings.push(`topic is ignored by default strict validate policy: ${ignoredByPolicy.reason ?? topicId}`);
    checks.push({
      id: "strict_validate_policy_ignored",
      ok: true,
      reason: `strict topic rails skipped by policy (${ignoredByPolicy.posture ?? "ignored"})`,
    });
  } else {
    checks.push({
      id: "artifact_naming_unambiguous",
      ok: artifactAnalysis.ambiguousLifecycleFiles.length === 0,
      reason: artifactAnalysis.ambiguousLifecycleFiles.length === 0
        ? "lifecycle artifact naming remains unambiguous"
        : `ambiguous lifecycle artifact names: ${artifactAnalysis.ambiguousLifecycleFiles.join(", ")}`,
    });

    checks.push({
      id: "no_active_wave_closeout_conflict",
      ok: artifactAnalysis.activeWaveCloseoutConflicts.length === 0,
      reason: artifactAnalysis.activeWaveCloseoutConflicts.length === 0
        ? "no closeout artifact claims closure for an active wave"
        : `closeout artifacts exist for non-terminal waves: ${artifactAnalysis.activeWaveCloseoutConflicts.join(", ")}`,
    });

    checks.push({
      id: "true_close_not_premature",
      ok: !artifactAnalysis.prematureTrueClose,
      reason: !artifactAnalysis.prematureTrueClose
        ? "true-close artifacts do not coexist with known open blockers"
        : "true-close artifacts exist while open blockers remain",
    });
  }

  const ok = checks.every((entry) => entry.ok);
  const schemaMode = missingEnrichedFields.length === 0 && enumViolations.length === 0 ? "enriched" : "legacy_minimal";
  const migrationPosture = schemaMode === "legacy_minimal" && artifactAnalysis.counts.files > 0
    ? "explicit_legacy_reconstruction_required"
    : "not_required";
  const validationDisposition = ignoredByPolicy
    ? validationPolicy.ignoredTopicValidateSemantics.status
    : "strict";
  const canonicalValidated = ignoredByPolicy
    ? validationPolicy.ignoredTopicValidateSemantics.canonicalSuccess
    : ok;

  return {
    ok,
    topicId,
    topicDir,
    topicRef: relativeTopicDir,
    state,
    schemaMode,
    selectedNextTarget: typeof topic.selected_next_target === "string" ? topic.selected_next_target : null,
    currentTrueCloseStatus: typeof topic.current_true_close_status === "string" ? topic.current_true_close_status : null,
    title: typeof topic.title === "string" ? topic.title : null,
    pendingNoteStatus: pendingNoteLoaded.ok && typeof pendingNoteLoaded.note.status === "string"
      ? pendingNoteLoaded.note.status
      : null,
    missingEnrichedFields,
    artifactSummary: artifactAnalysis.counts,
    legacyWaveIds: artifactAnalysis.legacyWaveIds,
    legacyObservedWaves: artifactAnalysis.legacyObservedWaves,
    featureFlags: artifactAnalysis.featureFlags,
    migrationPosture,
    validationDisposition,
    canonicalValidated,
    ignoredByPolicy: ignoredByPolicy !== null,
    ignorePolicyReason: ignoredByPolicy?.reason ?? null,
    ignorePolicyPosture: ignoredByPolicy?.posture ?? null,
    checks,
    warnings,
  };
}

export async function createTopic(projectRoot, options) {
  const topicId = deriveTopicId(options.slug, options.now ?? new Date());
  const today = formatDate(options.now ?? new Date());
  const topicDir = path.join(getTopicStateRoot(projectRoot, "proposal"), topicId);
  const topicDirInfo = await pathExists(topicDir);
  if (topicDirInfo) {
    return {
      ok: false,
      error: `Topic already exists: ${toPortableRelativePath(path.relative(projectRoot, topicDir))}`,
    };
  }

  await mkdir(getTopicStateRoot(projectRoot, "proposal"), { recursive: true });
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  const topic = buildCreatePayload({
    topicId,
    today,
    title: options.title,
    mode: options.mode,
    posture: options.posture,
    designPolicy: options.designPolicy,
    parallelTruth: options.parallelTruth,
    layering: options.layering,
    risk: options.risk,
    applicability: options.applicability,
    justification: options.justification,
    executionMode: options.executionMode,
  }, authority);
  await writeTopicScaffold(topicDir, topic);

  return {
    ok: true,
    topicId,
    topicDir,
    topicRef: toPortableRelativePath(path.relative(projectRoot, topicDir)),
    state: "proposal",
    title: topic.title,
  };
}

export function deriveCreateDefaults(options) {
  const mode = options.mode ?? "greenfield";
  const posture = options.posture ?? (mode === "landed" ? "backward_compat" : "no_legacy_hard_cut");
  return {
    mode,
    posture,
    designPolicy: options.designPolicy ?? "complete_contract_first",
    parallelTruth: options.parallelTruth ?? "forbidden",
    layering: options.layering ?? "ontology",
    risk: options.risk ?? "high",
    applicability: options.applicability ?? "authority_bearing",
    executionMode: options.executionMode ?? "manager_worker_auditor",
  };
}
