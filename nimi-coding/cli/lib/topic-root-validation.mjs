import path from "node:path";

import { pathExists } from "./fs-helpers.mjs";
import { analyzeTopicArtifacts } from "./topic-lifecycle-artifacts.mjs";
import { DEFAULT_TOPIC_RUNTIME_AUTHORITY, loadTopicRuntimeAuthority, toPortableRelativePath } from "./topic-common.mjs";
import {
  getTopicWaves,
  loadTopicReport,
  topicHasEnrichedShape,
  validateTopicId,
} from "./topic-scaffold.mjs";
import {
  getPendingEntryBlockers,
  loadPendingNote,
  loadTopicValidationPolicy,
} from "./topic-waves.mjs";

export async function validateTopicRoot(projectRoot, input = null) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return { ok: false, error: loaded.error, checks: [], warnings: [] };
  const { topicDir, topicId, state, topic } = loaded,
    authority = await loadTopicRuntimeAuthority(projectRoot),
    validationPolicy = await loadTopicValidationPolicy(projectRoot),
    ignoredByPolicy = validationPolicy.ignoredTopicIds.get(topicId) ?? null,
    checks = [],
    warnings = [],
    relativeTopicDir = toPortableRelativePath(path.relative(projectRoot, topicDir)),
    artifactAnalysis = await analyzeTopicArtifacts(topicDir, topic),
    pendingNoteLoaded = await loadPendingNote(topicDir),
    topicIdMatchesFolder = topic.topic_id === topicId;
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
    return value == null || value === "";
  });
  checks.push({
    id: "minimal_state_evidence",
    ok: missingMinimalFields.length === 0,
    reason:
      missingMinimalFields.length === 0
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
  for (const fileName of authority.recommendedFiles)
    (await pathExists(path.join(topicDir, fileName)))?.isFile() ||
      missingRecommendedFiles.push(fileName);
  missingRecommendedFiles.length > 0 &&
    warnings.push(
      `recommended topic companion files are missing: ${missingRecommendedFiles.join(", ")}`,
    );
  const missingEnrichedFields = authority.enrichedRequiredFields.filter((field) => {
      const value = topic[field];
      return field === "selected_next_target"
        ? !(
            value === null ||
            value === "topic_design_baseline" ||
            (typeof value == "string" && value.length > 0)
          )
        : value == null || value === "" || (Array.isArray(value) && value.length === 0);
    }),
    enumViolations = [];
  if (
    (topic.mode !== void 0 &&
      !authority.topicEnums.mode.includes(topic.mode) &&
      enumViolations.push(`mode=${topic.mode}`),
    topic.posture !== void 0 &&
      !authority.topicEnums.posture.includes(topic.posture) &&
      enumViolations.push(`posture=${topic.posture}`),
    topic.design_policy !== void 0 &&
      !authority.topicEnums.designPolicy.includes(topic.design_policy) &&
      enumViolations.push(`design_policy=${topic.design_policy}`),
    topic.parallel_truth !== void 0 &&
      !authority.topicEnums.parallelTruth.includes(topic.parallel_truth) &&
      enumViolations.push(`parallel_truth=${topic.parallel_truth}`),
    topic.layering !== void 0 &&
      !authority.topicEnums.layering.includes(topic.layering) &&
      enumViolations.push(`layering=${topic.layering}`),
    topic.risk !== void 0 &&
      !authority.topicEnums.risk.includes(topic.risk) &&
      enumViolations.push(`risk=${topic.risk}`),
    topic.applicability !== void 0 &&
      !authority.topicEnums.applicability.includes(topic.applicability) &&
      enumViolations.push(`applicability=${topic.applicability}`),
    topic.execution_mode !== void 0 &&
      !authority.topicEnums.executionMode.includes(topic.execution_mode) &&
      enumViolations.push(`execution_mode=${topic.execution_mode}`),
    topic.current_true_close_status !== void 0 &&
      !authority.topicEnums.trueCloseStatus.includes(topic.current_true_close_status) &&
      enumViolations.push(`current_true_close_status=${topic.current_true_close_status}`),
    missingEnrichedFields.length > 0 &&
      warnings.push(
        `topic.yaml is using the legacy minimal shape and is missing enriched fields: ${missingEnrichedFields.join(", ")}`,
      ),
    enumViolations.length > 0 &&
      warnings.push(
        `topic.yaml contains values outside the current enriched enums: ${enumViolations.join(", ")}`,
      ),
    checks.push({
      id: "packet_wave_lineage_resolves",
      ok: artifactAnalysis.unresolvedPacketWaveRefs.length === 0,
      reason:
        artifactAnalysis.unresolvedPacketWaveRefs.length === 0
          ? "packet artifacts resolve to exactly one declared wave lineage"
          : `packet artifacts do not resolve to exactly one declared wave lineage: ${artifactAnalysis.unresolvedPacketWaveRefs.join(", ")}`,
    }),
    checks.push({
      id: "result_wave_lineage_resolves",
      ok: artifactAnalysis.unresolvedResultWaveIds.length === 0,
      reason:
        artifactAnalysis.unresolvedResultWaveIds.length === 0
          ? "result artifacts resolve to exactly one declared wave lineage"
          : `result artifacts do not resolve to exactly one declared wave lineage: ${artifactAnalysis.unresolvedResultWaveIds.join(", ")}`,
    }),
    checks.push({
      id: "closeout_wave_lineage_resolves",
      ok: artifactAnalysis.unresolvedCloseoutWaveRefs.length === 0,
      reason:
        artifactAnalysis.unresolvedCloseoutWaveRefs.length === 0
          ? "closeout artifacts resolve to exactly one declared wave lineage"
          : `closeout artifacts do not resolve to exactly one declared wave lineage: ${artifactAnalysis.unresolvedCloseoutWaveRefs.join(", ")}`,
    }),
    topic.state === "pending")
  ) {
    const pendingNote = pendingNoteLoaded.ok ? pendingNoteLoaded.note : null;
    if (
      (checks.push({
        id: "pending_note_exists",
        ok: pendingNoteLoaded.ok,
        reason: pendingNoteLoaded.ok ? "pending note artifact exists" : pendingNoteLoaded.error,
      }),
      pendingNote)
    ) {
      const pendingNoteMissingFields = authority.pendingNoteRequiredFields.filter((field) => {
        const value = pendingNote[field];
        return value == null || value === "";
      });
      (checks.push({
        id: "pending_note_required_fields",
        ok: pendingNoteMissingFields.length === 0,
        reason:
          pendingNoteMissingFields.length === 0
            ? "pending note contains required fields"
            : `pending note is missing required fields: ${pendingNoteMissingFields.join(", ")}`,
      }),
        checks.push({
          id: "pending_note_topic_matches",
          ok: pendingNote.topic_id === topicId,
          reason:
            pendingNote.topic_id === topicId
              ? "pending note topic_id matches the topic"
              : `pending note topic_id does not match topic (${pendingNote.topic_id ?? "missing"} vs ${topicId})`,
        }),
        checks.push({
          id: "pending_note_status_active",
          ok:
            pendingNote.status === "active" &&
            authority.pendingNoteStatuses.includes(pendingNote.status),
          reason:
            pendingNote.status === "active"
              ? "pending note remains active while topic is pending"
              : `pending note status must be active while pending, found ${pendingNote.status ?? "missing"}`,
        }),
        checks.push({
          id: "pending_note_reopen_or_close_defined",
          ok:
            typeof pendingNote.reopen_criteria == "string" ||
            typeof pendingNote.close_trigger == "string",
          reason:
            typeof pendingNote.reopen_criteria == "string" ||
            typeof pendingNote.close_trigger == "string"
              ? "pending note declares reopen criteria or close trigger"
              : "pending note must declare reopen criteria or close trigger",
        }));
    }
    const pendingBlockers = getPendingEntryBlockers(topic);
    checks.push({
      id: "pending_has_no_active_implementation_wave",
      ok: pendingBlockers.length === 0,
      reason:
        pendingBlockers.length === 0
          ? "pending topic has no active implementation wave"
          : `pending topic still has active implementation waves: ${pendingBlockers.join(", ")}`,
    });
  }
  ignoredByPolicy
    ? (warnings.push(
        `topic is ignored by default strict validate policy: ${ignoredByPolicy.reason ?? topicId}`,
      ),
      checks.push({
        id: "strict_validate_policy_ignored",
        ok: true,
        reason: `strict topic rails skipped by policy (${ignoredByPolicy.posture ?? "ignored"})`,
      }))
    : (checks.push({
        id: "artifact_naming_unambiguous",
        ok: artifactAnalysis.ambiguousLifecycleFiles.length === 0,
        reason:
          artifactAnalysis.ambiguousLifecycleFiles.length === 0
            ? "lifecycle artifact naming remains unambiguous"
            : `ambiguous lifecycle artifact names: ${artifactAnalysis.ambiguousLifecycleFiles.join(", ")}`,
      }),
      checks.push({
        id: "no_active_wave_closeout_conflict",
        ok: artifactAnalysis.activeWaveCloseoutConflicts.length === 0,
        reason:
          artifactAnalysis.activeWaveCloseoutConflicts.length === 0
            ? "no closeout artifact claims closure for an active wave"
            : `closeout artifacts exist for non-terminal waves: ${artifactAnalysis.activeWaveCloseoutConflicts.join(", ")}`,
      }),
      checks.push({
        id: "true_close_not_premature",
        ok: !artifactAnalysis.prematureTrueClose,
        reason: artifactAnalysis.prematureTrueClose
          ? "true-close artifacts exist while open blockers remain"
          : "true-close artifacts do not coexist with known open blockers",
      }));
  const ok = checks.every((entry) => entry.ok),
    schemaMode =
      missingEnrichedFields.length === 0 && enumViolations.length === 0
        ? "enriched"
        : "legacy_minimal",
    migrationPosture =
      schemaMode === "legacy_minimal" && artifactAnalysis.counts.files > 0
        ? "explicit_legacy_reconstruction_required"
        : "not_required",
    validationDisposition = ignoredByPolicy
      ? validationPolicy.ignoredTopicValidateSemantics.status
      : "strict",
    canonicalValidated = ignoredByPolicy
      ? validationPolicy.ignoredTopicValidateSemantics.canonicalSuccess
      : ok;
  return {
    ok,
    topicId,
    topicDir,
    topicRef: relativeTopicDir,
    state,
    schemaMode,
    selectedNextTarget:
      typeof topic.selected_next_target == "string" ? topic.selected_next_target : null,
    currentTrueCloseStatus:
      typeof topic.current_true_close_status == "string" ? topic.current_true_close_status : null,
    title: typeof topic.title == "string" ? topic.title : null,
    pendingNoteStatus:
      pendingNoteLoaded.ok && typeof pendingNoteLoaded.note.status == "string"
        ? pendingNoteLoaded.note.status
        : null,
    missingEnrichedFields,
    artifactSummary: artifactAnalysis.counts,
    waveIds: artifactAnalysis.waveIds,
    observedWaves: artifactAnalysis.observedWaves,
    featureFlags: artifactAnalysis.featureFlags,
    unresolvedPacketWaveRefs: artifactAnalysis.unresolvedPacketWaveRefs,
    unresolvedResultWaveIds: artifactAnalysis.unresolvedResultWaveIds,
    unresolvedCloseoutWaveRefs: artifactAnalysis.unresolvedCloseoutWaveRefs,
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
