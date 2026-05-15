import { readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import { readTextIfFile } from "./fs-helpers.mjs";
import { loadTopicRuntimeAuthority, toPortableRelativePath } from "./topic-common.mjs";
import {
  buildTopicNow,
  getTopicWaves,
  loadTopicReport,
  moveTopicDirectoryForState,
  topicHasEnrichedShape,
  writeTopicYaml,
} from "./topic-scaffold.mjs";
import {
  listWavePackets,
  listWaveResults,
  pendingNoteFilename,
  pendingNoteMarkdown,
  readFrontmatterObject,
  topicCloseoutFilename,
  topicTrueCloseAuditFilename,
  topicTrueCloseJudgementFilename,
  topicTrueCloseRecordFilename,
  waveCloseoutFilename,
} from "./topic-artifacts.mjs";
import { collectWaveArtifactEvidence, loadPendingNote, validateWaveId } from "./topic-waves.mjs";

export function closeoutMarkdown(closeout, title) {
  return `---
${YAML.stringify(closeout).trimEnd()}
---

# ${title}

Recorded by \`nimicoding topic closeout\`.
`;
}
export function trueCloseAuditMarkdown(audit, judgementText) {
  return `---
${YAML.stringify(audit).trimEnd()}
---

# Topic True-Close Audit

${judgementText}
`;
}
export function trueCloseRecordMarkdown(record) {
  return `---
${YAML.stringify(record).trimEnd()}
---

# Topic True-Close

Recorded by \`nimicoding topic closeout topic\`.
`;
}
async function collectActiveDeferredBlockers(topicDir) {
  const entries = await readdir(topicDir, { withFileTypes: true }),
    blockers = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("deferred-blocker-") || !entry.name.endsWith(".md"))
      continue;
    const blockerPath = path.join(topicDir, entry.name),
      blockerText = await readTextIfFile(blockerPath),
      blocker = readFrontmatterObject(blockerText ?? "");
    if (!blocker || !["resolved", "closed"].includes(blocker.status)) {
      blockers.push(entry.name);
    }
  }
  return blockers.sort();
}

function packetRequiresPlacementCloseoutEvidence(packet) {
  const searchableFields = [
    ...(Array.isArray(packet?.authority_owner) ? packet.authority_owner : []),
    ...(Array.isArray(packet?.canonical_seams) ? packet.canonical_seams : []),
    ...(Array.isArray(packet?.acceptance_invariants) ? packet.acceptance_invariants : []),
    ...(Array.isArray(packet?.negative_tests) ? packet.negative_tests : []),
    ...(Array.isArray(packet?.reopen_conditions) ? packet.reopen_conditions : []),
  ].join("\n");
  return /placement|surface[-_ ]taxonomy|surface[-_ ]class|classify-spec-tree|validate-placement|closeout_drift_resistance_requires_placement_report/i.test(
    searchableFields,
  );
}

async function waveHasPlacementReportEvidence(projectRoot, topicDir, waveId) {
  const packets = await listWavePackets(topicDir, waveId);
  if (!packets.some(({ packet }) => packetRequiresPlacementCloseoutEvidence(packet))) {
    return { required: false, found: false };
  }

  const results = await listWaveResults(topicDir, waveId);
  const evidenceTexts = [];
  for (const { result, resultPath } of results) {
    const resultText = await readTextIfFile(resultPath);
    evidenceTexts.push(resultText ?? "");
    if (typeof result?.source_ref === "string" && result.source_ref.length > 0) {
      const sourcePath = path.resolve(projectRoot, result.source_ref);
      const sourceText = await readTextIfFile(sourcePath);
      if (sourceText !== null) {
        evidenceTexts.push(sourceText);
      }
    }
  }

  const hasReport = evidenceTexts.some((text) =>
    /nimicoding\.surface-validator-result\.v1|nimicoding\.spec-migration-plan\.v1|classify-spec-tree|generate-spec-migration-plan|validate-placement|validate-table-family|validate-projection-edges|validate-guidance-bodies|validate-domain-admission|validate-tracked-output-admission/i.test(
      text,
    ),
  );
  return { required: true, found: hasReport };
}

export async function buildWaveClosureChecks(projectRoot, topicDir, topic, wave, closeout) {
  const authority = await loadTopicRuntimeAuthority(projectRoot),
    evidence = await collectWaveArtifactEvidence(topicDir, wave.wave_id),
    placementEvidence = closeout.drift_resistance_closure === "closed"
      ? await waveHasPlacementReportEvidence(projectRoot, topicDir, wave.wave_id)
      : { required: false, found: false },
    checks = [];
  (checks.push({
    id: "closeout_scope_wave",
    ok: closeout.scope === "wave" && authority.closeoutScopes.includes(closeout.scope),
    reason:
      closeout.scope === "wave"
        ? "closeout scope is wave"
        : `closeout scope must be wave, found ${closeout.scope ?? "missing"}`,
  }),
    checks.push({
      id: "closeout_topic_matches",
      ok: closeout.topic_id === topic.topic_id,
      reason:
        closeout.topic_id === topic.topic_id
          ? "closeout topic_id matches the topic"
          : `closeout topic_id does not match topic (${closeout.topic_id ?? "missing"} vs ${topic.topic_id})`,
    }));
  const closurePairs = authority.closureDimensions.map((dimension) => [
    `${dimension}_closure`,
    closeout[`${dimension}_closure`],
  ]);
  for (const [field, value] of closurePairs)
    checks.push({
      id: `${field}_explicit_closed`,
      ok: value === "closed" && authority.closureStates.includes(value),
      reason:
        value === "closed"
          ? `${field} is explicitly closed`
          : `${field} must be closed for wave closeout, found ${value ?? "missing"}`,
    });
  checks.push({
    id: "closeout_disposition_complete",
    ok:
      closeout.disposition === "complete" &&
      authority.closeoutDispositions.includes(closeout.disposition),
    reason:
      closeout.disposition === "complete"
        ? "closeout disposition is complete"
        : `closeout disposition must be complete for wave closeout, found ${closeout.disposition ?? "missing"}`,
  });
  if (placementEvidence.required) {
    checks.push({
      id: "drift_resistance_has_placement_report",
      ok: placementEvidence.found,
      reason: placementEvidence.found
        ? "drift-resistance closure has recorded placement validation evidence"
        : "drift-resistance closure requires recorded placement validation evidence for this packet",
    });
  }
  const activeBlockers = ["needs_revision", "overflowed", "continuation_packet_open"].includes(
    wave.state,
  );
  checks.push({
    id: "wave_has_no_active_blockers",
    ok: !activeBlockers,
    reason: activeBlockers
      ? `wave remains in an active blocker state: ${wave.state}`
      : "wave has no active blocker state",
  });
  const closeableState = ["implementation_active", "preflight_admitted", "closed"].includes(
    wave.state,
  );
  return (
    checks.push({
      id: "wave_state_closeable",
      ok: closeableState,
      reason: closeableState
        ? "wave state remains eligible for closeout"
        : `wave closeout requires implementation_active, preflight_admitted, or closed, found ${wave.state}`,
    }),
    authority.waveCloseoutEvidence.requirePacketLineage &&
      checks.push({
        id: "wave_packet_lineage_exists",
        ok: evidence.packetRefs.length > 0,
        reason:
          evidence.packetRefs.length > 0
            ? "wave closeout has packet lineage evidence"
            : `wave closeout requires packet lineage evidence for ${wave.wave_id}`,
      }),
    authority.waveCloseoutEvidence.requireResultLineage &&
      checks.push({
        id: "wave_result_lineage_exists",
        ok: evidence.resultRefs.length > 0,
        reason:
          evidence.resultRefs.length > 0
            ? "wave closeout has result lineage evidence"
            : `wave closeout requires result lineage evidence for ${wave.wave_id}`,
      }),
    checks
  );
}
export async function validateWaveClosure(projectRoot, input, waveId) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return { ok: false, error: loaded.error, checks: [], warnings: [] };
  const { validateTopicRoot } = await import("./topic-root-validation.mjs");
  const rootValidation = await validateTopicRoot(projectRoot, input),
    wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === waveId) ?? null,
    checks = [...(rootValidation.checks ?? [])],
    warnings = [...(rootValidation.warnings ?? [])];
  if (
    (checks.push({
      id: "wave_exists",
      ok: wave !== null,
      reason: wave ? "wave exists in topic.yaml waves[]" : `wave does not exist: ${waveId}`,
    }),
    !wave)
  )
    return { ...rootValidation, ok: false, checks, warnings };
  const closeoutPath = path.join(loaded.topicDir, waveCloseoutFilename(waveId)),
    closeoutText = await readTextIfFile(closeoutPath);
  if (
    (checks.push({
      id: "wave_closeout_artifact_exists",
      ok: closeoutText !== null,
      reason:
        closeoutText !== null
          ? "wave closeout artifact exists"
          : `missing wave closeout artifact: ${waveCloseoutFilename(waveId)}`,
    }),
    closeoutText === null)
  )
    return { ...rootValidation, ok: false, checks, warnings, waveId };
  const closeout = readFrontmatterObject(closeoutText);
  return (
    checks.push({
      id: "wave_closeout_frontmatter_valid",
      ok: closeout !== null,
      reason:
        closeout !== null
          ? "wave closeout frontmatter is valid"
          : "wave closeout artifact frontmatter is invalid",
    }),
    closeout === null
      ? { ...rootValidation, ok: false, checks, warnings, waveId }
      : (checks.push(
          ...(await buildWaveClosureChecks(
            projectRoot,
            loaded.topicDir,
            loaded.topic,
            wave,
            closeout,
          )),
        ),
        {
          ...rootValidation,
          ok: rootValidation.ok && checks.every((entry) => entry.ok),
          checks,
          warnings,
          waveId,
          closeoutRef: toPortableRelativePath(path.relative(projectRoot, closeoutPath)),
        })
  );
}
export async function closeoutWaveInTopic(projectRoot, input, waveId, options) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority))
    return { ok: false, error: "Wave closeout requires an enriched topic root." };
  const wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === waveId) ?? null;
  if (!wave) return { ok: false, error: `Wave not found: ${waveId}` };
  const closeout = {
      closeout_id: waveId,
      topic_id: loaded.topicId,
      scope: "wave",
      authority_closure: options.authorityClosure,
      semantic_closure: options.semanticClosure,
      consumer_closure: options.consumerClosure,
      drift_resistance_closure: options.driftResistanceClosure,
      disposition: options.disposition,
    },
    checks = await buildWaveClosureChecks(
      projectRoot,
      loaded.topicDir,
      loaded.topic,
      wave,
      closeout,
    );
  if (!checks.every((entry) => entry.ok))
    return {
      ok: false,
      error: `Wave closeout refused: ${checks.find((entry) => !entry.ok)?.reason ?? "closure validation failed"}`,
      checks,
      warnings: [],
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
      waveId,
    };
  const closeoutPath = path.join(loaded.topicDir, waveCloseoutFilename(waveId));
  return (
    await writeFile(closeoutPath, closeoutMarkdown(closeout, `Wave Closeout ${waveId}`), "utf8"),
    (wave.state = "closed"),
    (wave.selected = false),
    (loaded.topic.waves = getTopicWaves(loaded.topic).map((entry) =>
      entry.wave_id === waveId ? wave : entry,
    )),
    loaded.topic.selected_next_target === waveId && (loaded.topic.selected_next_target = null),
    (loaded.topic.last_transition_at = buildTopicNow()),
    (loaded.topic.last_transition_reason = `closed_${waveId}`),
    await writeTopicYaml(loaded.topicYamlPath, loaded.topic),
    {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
      waveId,
      waveState: wave.state,
      closeoutRef: toPortableRelativePath(path.relative(projectRoot, closeoutPath)),
    }
  );
}
export async function buildTrueCloseAuditChecks(projectRoot, topicDir, topic) {
  const authority = await loadTopicRuntimeAuthority(projectRoot),
    waves = getTopicWaves(topic),
    checks = [],
    activeDeferredBlockers = await collectActiveDeferredBlockers(topicDir),
    nonTerminalWaves = waves
      .filter((entry) => !["closed", "retired", "superseded"].includes(entry.state))
      .map((entry) => `${entry.wave_id}:${entry.state}`);
  checks.push({
    id: "all_waves_terminal",
    ok: nonTerminalWaves.length === 0,
    reason:
      nonTerminalWaves.length === 0
        ? "all waves are closed, retired, or superseded"
        : `non-terminal waves remain: ${nonTerminalWaves.join(", ")}`,
  });
  checks.push({
    id: "no_active_deferred_blockers",
    ok: activeDeferredBlockers.length === 0,
    reason:
      activeDeferredBlockers.length === 0
        ? "no active deferred blocker artifacts remain"
        : `active deferred blocker artifacts remain: ${activeDeferredBlockers.join(", ")}`,
  });
  const selectedActive = waves
    .filter((entry) => entry.selected === true)
    .map((entry) => entry.wave_id);
  (checks.push({
    id: "no_selected_wave_remains",
    ok: selectedActive.length === 0,
    reason:
      selectedActive.length === 0
        ? "no selected wave remains active"
        : `selected waves remain: ${selectedActive.join(", ")}`,
  }),
    checks.push({
      id: "selected_target_cleared",
      ok:
        topic.selected_next_target === null ||
        topic.selected_next_target === "topic_design_baseline",
      reason:
        topic.selected_next_target === null ||
        topic.selected_next_target === "topic_design_baseline"
          ? "selected_next_target is cleared for topic closeout"
          : `selected_next_target remains active: ${topic.selected_next_target}`,
    }));
  for (const wave of waves.filter((entry) => entry.state === "closed")) {
    const evidence = await collectWaveArtifactEvidence(topicDir, wave.wave_id);
    (authority.trueCloseAuditEvidence.requireWaveCloseoutForClosedWaves &&
      checks.push({
        id: `wave_closeout_exists_${wave.wave_id}`,
        ok: evidence.closeoutRefs.length > 0,
        reason:
          evidence.closeoutRefs.length > 0
            ? `${wave.wave_id} has closeout evidence`
            : `${wave.wave_id} is closed but has no wave closeout evidence`,
      }),
      authority.trueCloseAuditEvidence.requirePacketLineageForClosedWaves &&
        checks.push({
          id: `wave_packet_lineage_exists_${wave.wave_id}`,
          ok: evidence.packetRefs.length > 0,
          reason:
            evidence.packetRefs.length > 0
              ? `${wave.wave_id} has packet lineage evidence`
              : `${wave.wave_id} is closed but has no packet lineage evidence`,
        }),
      authority.trueCloseAuditEvidence.requireResultLineageForClosedWaves &&
        checks.push({
          id: `wave_result_lineage_exists_${wave.wave_id}`,
          ok: evidence.resultRefs.length > 0,
          reason:
            evidence.resultRefs.length > 0
              ? `${wave.wave_id} has result lineage evidence`
              : `${wave.wave_id} is closed but has no result lineage evidence`,
        }));
  }
  return checks;
}
export async function runTopicTrueCloseAudit(projectRoot, input, judgementText) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority))
    return { ok: false, error: "True-close audit requires an enriched topic root." };
  const checks = await buildTrueCloseAuditChecks(projectRoot, loaded.topicDir, loaded.topic),
    passed = checks.every((entry) => entry.ok),
    auditPath = path.join(loaded.topicDir, topicTrueCloseAuditFilename()),
    judgementPath = path.join(loaded.topicDir, topicTrueCloseJudgementFilename()),
    audit = { topic_id: loaded.topicId, status: passed ? "passed" : "pending", checks };
  return (
    await writeFile(auditPath, trueCloseAuditMarkdown(audit, judgementText), "utf8"),
    await writeFile(
      judgementPath,
      `---
${YAML.stringify({ topic_id: loaded.topicId, status: passed ? "passed" : "pending", judgement: judgementText }).trimEnd()}
---

# Topic True-Close Audit Result
`,
      "utf8",
    ),
    (loaded.topic.last_transition_at = buildTopicNow()),
    (loaded.topic.last_transition_reason = "ran_topic_true_close_audit"),
    passed && (loaded.topic.current_true_close_status = "pending"),
    await writeTopicYaml(loaded.topicYamlPath, loaded.topic),
    {
      ok: passed,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
      status: passed ? "passed" : "pending",
      auditRef: toPortableRelativePath(path.relative(projectRoot, auditPath)),
      judgementRef: toPortableRelativePath(path.relative(projectRoot, judgementPath)),
      checks,
      warnings: [],
    }
  );
}
export async function closeoutTopicInTopic(projectRoot, input, options) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority))
    return { ok: false, error: "Topic closeout requires an enriched topic root." };
  let pendingNoteLoaded = null;
  if (loaded.topic.state === "pending") {
    if (((pendingNoteLoaded = await loadPendingNote(loaded.topicDir)), !pendingNoteLoaded.ok))
      return {
        ok: false,
        error: `Topic closeout from pending requires a pending note artifact: ${pendingNoteLoaded.error}`,
      };
    if (
      typeof pendingNoteLoaded.note.close_trigger != "string" ||
      pendingNoteLoaded.note.close_trigger.length === 0
    )
      return {
        ok: false,
        error: "Topic closeout from pending requires an explicit close trigger in pending-note.md.",
      };
  }
  const auditPath = path.join(loaded.topicDir, topicTrueCloseAuditFilename()),
    judgementPath = path.join(loaded.topicDir, topicTrueCloseJudgementFilename()),
    auditText = await readTextIfFile(auditPath),
    judgementText = await readTextIfFile(judgementPath);
  if (auditText === null || judgementText === null)
    return { ok: false, error: "Topic closeout requires a recorded true-close audit and judgement." };
  const audit = readFrontmatterObject(auditText);
  if (!audit || audit.status !== "passed")
    return { ok: false, error: "Topic closeout requires a passed true-close audit." };
  const auditChecks = await buildTrueCloseAuditChecks(projectRoot, loaded.topicDir, loaded.topic);
  if (!auditChecks.every((entry) => entry.ok))
    return {
      ok: false,
      error: `Topic closeout refused: ${auditChecks.find((entry) => !entry.ok)?.reason ?? "true-close checks failed"}`,
      checks: auditChecks,
      warnings: [],
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
    };
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
  if (
    [
      closeout.authority_closure,
      closeout.semantic_closure,
      closeout.consumer_closure,
      closeout.drift_resistance_closure,
    ].some((entry) => entry !== "closed") ||
    closeout.disposition !== "complete"
  )
    return {
      ok: false,
      error: "Topic closeout requires all four closures to be closed and disposition=complete.",
    };
  const closeoutPath = path.join(loaded.topicDir, topicCloseoutFilename());
  await writeFile(closeoutPath, closeoutMarkdown(closeout, "Topic Closeout"), "utf8");
  const trueCloseRecordPath = path.join(loaded.topicDir, topicTrueCloseRecordFilename());
  (await writeFile(
    trueCloseRecordPath,
    trueCloseRecordMarkdown({
      topic_id: loaded.topicId,
      status: "passed",
      audit_ref: toPortableRelativePath(path.relative(projectRoot, auditPath)),
      judgement_ref: toPortableRelativePath(path.relative(projectRoot, judgementPath)),
    }),
    "utf8",
  ),
    (loaded.topic.state = "closed"),
    (loaded.topic.current_true_close_status = "true_closed"),
    (loaded.topic.last_transition_at = buildTopicNow()),
    (loaded.topic.last_transition_reason = "closed_topic_after_true_close"));
  const moved = await moveTopicDirectoryForState(
    projectRoot,
    loaded.topicDir,
    loaded.topicId,
    "closed",
  );
  return (
    await writeTopicYaml(moved.topicYamlPath, loaded.topic),
    pendingNoteLoaded?.ok &&
      ((pendingNoteLoaded.note.status = "closed"),
      (pendingNoteLoaded.note.closed_at = buildTopicNow()),
      await writeFile(
        path.join(moved.topicDir, pendingNoteFilename()),
        pendingNoteMarkdown(pendingNoteLoaded.note),
        "utf8",
      )),
    {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, moved.topicDir)),
      state: loaded.topic.state,
      closeoutRef: toPortableRelativePath(
        path.relative(projectRoot, path.join(moved.topicDir, topicCloseoutFilename())),
      ),
      trueCloseRef: toPortableRelativePath(
        path.relative(projectRoot, path.join(moved.topicDir, topicTrueCloseRecordFilename())),
      ),
      currentTrueCloseStatus: loaded.topic.current_true_close_status,
    }
  );
}
