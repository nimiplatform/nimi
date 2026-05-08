import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import { buildDispatchPrompt } from "./authority-convergence.mjs";
import { readTextIfFile } from "./fs-helpers.mjs";
import { loadTopicRuntimeAuthority, toPortableRelativePath } from "./topic-common.mjs";
import {
  buildTopicNow,
  getTopicWaves,
  isIsoUtcTimestamp,
  loadTopicReport,
  moveTopicDirectoryForState,
  validateTopicSlug,
  topicHasEnrichedShape,
  writeTopicYaml,
} from "./topic-scaffold.mjs";
import {
  loadTopicPacket,
  decisionReviewFilename,
  overflowContinuationFilename,
  packetMarkdown,
  pendingNoteFilename,
  pendingNoteMarkdown,
  remediationFilename,
  resultFilename,
} from "./topic-artifacts.mjs";
import {
  collectWaveArtifactEvidence,
  getPendingEntryBlockers,
  loadPendingNote,
  validateWaveId,
} from "./topic-waves.mjs";

export function promptFilename(packetId, role) {
  return `prompt-${packetId}-${role}.md`;
}
export async function dispatchTopicPacket(projectRoot, input, packetId, role) {
  const loaded = await loadTopicPacket(projectRoot, input, packetId);
  if (!loaded.ok) return loaded;
  const wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === loaded.packet.wave_id);
  if (!wave)
    return {
      ok: false,
      error: `Packet wave_id does not resolve inside topic: ${loaded.packet.wave_id}`,
    };
  if (["retired", "superseded", "closed"].includes(wave.state))
    return { ok: false, error: `Wave is not dispatchable: ${wave.wave_id} (${wave.state})` };
  if (!["candidate", "admitted", "preflight", "dispatched"].includes(loaded.packet.status))
    return { ok: false, error: `Packet is not dispatchable from status ${loaded.packet.status}` };
  const promptPath = path.join(loaded.topicDir, promptFilename(packetId, role));
  return (
    await writeFile(promptPath, buildDispatchPrompt(loaded.packet, loaded.topicId, role), "utf8"),
    (loaded.packet.status = "dispatched"),
    await writeFile(loaded.packetPath, packetMarkdown(loaded.packet), "utf8"),
    role === "worker" &&
      ["preflight_admitted", "implementation_admitted", "continuation_packet_open"].includes(
        wave.state,
      ) &&
      ((wave.state = "implementation_active"),
      (loaded.topic.waves = getTopicWaves(loaded.topic).map((entry) =>
        entry.wave_id === wave.wave_id ? wave : entry,
      )),
      (loaded.topic.last_transition_at = buildTopicNow()),
      (loaded.topic.last_transition_reason = `packet_${packetId}_worker_dispatched`),
      await writeTopicYaml(loaded.topicYamlPath, loaded.topic)),
    {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
      packetId,
      packetRef: toPortableRelativePath(path.relative(projectRoot, loaded.packetPath)),
      promptRef: toPortableRelativePath(path.relative(projectRoot, promptPath)),
      waveId: wave.wave_id,
      waveState: wave.state,
      role,
    }
  );
}
export function resultMarkdown(result, sourceText) {
  return (
    `---
${YAML.stringify(result).trimEnd()}
---

# Result ${result.result_id}

${sourceText ?? ""}`.trimEnd() +
    `
`
  );
}
export async function recordTopicResult(projectRoot, input, resultKind, verdict, fromPath, verifiedAt) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const authority = await loadTopicRuntimeAuthority(projectRoot),
    sourcePath = path.resolve(projectRoot, fromPath),
    sourceText = await readTextIfFile(sourcePath);
  if (sourceText === null) return { ok: false, error: `Result source not found: ${fromPath}` };
  if (!authority.resultKinds.includes(resultKind))
    return { ok: false, error: `Unsupported result kind: ${resultKind}` };
  if (!authority.resultVerdicts.includes(verdict))
    return { ok: false, error: `Unsupported result verdict: ${verdict}` };
  if (
    authority.resultVerifiedAtFormat === "iso8601_utc_timestamp" &&
    !isIsoUtcTimestamp(verifiedAt)
  )
    return { ok: false, error: `Result verified_at must be an ISO-8601 UTC timestamp: ${verifiedAt}` };
  const waveId = loaded.topic.selected_next_target,
    wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === waveId) ?? null;
  if (!wave)
    return {
      ok: false,
      error: "Result recording requires a selected wave in topic.selected_next_target",
    };
  if ((await collectWaveArtifactEvidence(loaded.topicDir, wave.wave_id)).packetRefs.length === 0)
    return {
      ok: false,
      error: `Result recording requires at least one packet lineage for ${wave.wave_id}`,
    };
  const resultId = `${wave.wave_id}-${resultKind}`,
    result = {
      result_id: resultId,
      topic_id: loaded.topicId,
      wave_id: wave.wave_id,
      result_kind: resultKind,
      verdict,
      verified_at: verifiedAt,
      source_ref: toPortableRelativePath(path.relative(projectRoot, sourcePath)),
    },
    resultPath = path.join(loaded.topicDir, resultFilename(wave.wave_id, wave.slug, resultKind));
  return (
    await writeFile(resultPath, resultMarkdown(result, sourceText), "utf8"),
    verdict === "OVERFLOW"
      ? (wave.state = "overflowed")
      : verdict === "NEEDS_REVISION" || verdict === "FAIL"
        ? (wave.state = "needs_revision")
        : verdict === "PASS" &&
          resultKind[0] === "p" &&
          wave.state === "preflight_admitted" &&
          (wave.state = "implementation_admitted"),
    (loaded.topic.waves = getTopicWaves(loaded.topic).map((entry) =>
      entry.wave_id === wave.wave_id ? wave : entry,
    )),
    (loaded.topic.last_transition_at = buildTopicNow()),
    (loaded.topic.last_transition_reason = `recorded_${resultKind}_${verdict}_for_${wave.wave_id}`),
    await writeTopicYaml(loaded.topicYamlPath, loaded.topic),
    {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
      resultId,
      resultRef: toPortableRelativePath(path.relative(projectRoot, resultPath)),
      waveId: wave.wave_id,
      waveState: wave.state,
      verdict,
      resultKind,
    }
  );
}
export function remediationMarkdown(remediation) {
  return `---
${YAML.stringify(remediation).trimEnd()}
---

# Remediation ${remediation.remediation_id}

Opened by \`nimicoding topic remediation open\`.
`;
}
export async function openTopicRemediation(projectRoot, input, options) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority))
    return { ok: false, error: "Remediation commands require an enriched topic root." };
  if (!authority.remediationKinds.includes(options.kind))
    return { ok: false, error: `Unsupported remediation kind: ${options.kind}` };
  const waveId = loaded.topic.selected_next_target,
    wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === waveId) ?? null;
  if (!wave)
    return {
      ok: false,
      error: "Remediation open requires a selected wave in topic.selected_next_target",
    };
  if (["retired", "superseded", "closed"].includes(wave.state))
    return { ok: false, error: `Wave is not remediation-eligible: ${wave.wave_id} (${wave.state})` };
  if (options.kind === "continuation" && wave.state !== "overflowed")
    return {
      ok: false,
      error: `Continuation remediation requires an overflowed wave, found ${wave.state}`,
    };
  if (options.kind === "continuation" && !options.overflowedPacketId)
    return { ok: false, error: "Continuation remediation requires --overflowed-packet lineage" };
  if (options.overflowedPacketId) {
    const overflowedPacket = await loadTopicPacket(projectRoot, input, options.overflowedPacketId);
    if (!overflowedPacket.ok)
      return {
        ok: false,
        error: `Overflowed packet lineage could not be loaded: ${options.overflowedPacketId}`,
      };
    if (overflowedPacket.packet.wave_id !== wave.wave_id)
      return {
        ok: false,
        error: `Overflowed packet does not belong to the selected wave (${overflowedPacket.packet.wave_id} vs ${wave.wave_id})`,
      };
  }
  const remediationId = `${wave.wave_id}-remediation-${options.kind}-${options.reason}`,
    remediation = {
      remediation_id: remediationId,
      topic_id: loaded.topicId,
      wave_id: wave.wave_id,
      kind: options.kind,
      reason: options.reason,
    };
  options.overflowedPacketId && (remediation.overflowed_packet_id = options.overflowedPacketId);
  const remediationPath = path.join(
    loaded.topicDir,
    remediationFilename(wave.wave_id, options.kind, options.reason),
  );
  return (
    await writeFile(remediationPath, remediationMarkdown(remediation), "utf8"),
    options.kind !== "continuation" &&
      wave.state !== "needs_revision" &&
      ((wave.state = "needs_revision"),
      (loaded.topic.waves = getTopicWaves(loaded.topic).map((entry) =>
        entry.wave_id === wave.wave_id ? wave : entry,
      ))),
    (loaded.topic.last_transition_at = buildTopicNow()),
    (loaded.topic.last_transition_reason = `opened_remediation_${options.kind}_${options.reason}_for_${wave.wave_id}`),
    await writeTopicYaml(loaded.topicYamlPath, loaded.topic),
    {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
      remediationId,
      remediationRef: toPortableRelativePath(path.relative(projectRoot, remediationPath)),
      waveId: wave.wave_id,
      waveState: wave.state,
      kind: options.kind,
      reason: options.reason,
    }
  );
}
export function overflowContinuationMarkdown(continuation) {
  return `---
${YAML.stringify(continuation).trimEnd()}
---

# Overflow Continuation ${continuation.continuation_packet_id}

Recorded by \`nimicoding topic overflow continue\`.
`;
}
export async function continueTopicOverflow(projectRoot, input, options) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority))
    return { ok: false, error: "Overflow continuation requires an enriched topic root." };
  const waveId = loaded.topic.selected_next_target,
    wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === waveId) ?? null;
  if (!wave)
    return {
      ok: false,
      error: "Overflow continuation requires a selected wave in topic.selected_next_target",
    };
  if (wave.state !== "overflowed")
    return {
      ok: false,
      error: `Overflow continuation requires an overflowed wave, found ${wave.state}`,
    };
  if (options.sameOwnerDomain !== true)
    return {
      ok: false,
      error: "Overflow continuation requires explicit same-owner-domain acknowledgement",
    };
  const overflowedPacket = await loadTopicPacket(projectRoot, input, options.overflowedPacketId);
  if (!overflowedPacket.ok)
    return {
      ok: false,
      error: `Overflowed packet lineage could not be loaded: ${options.overflowedPacketId}`,
    };
  if (overflowedPacket.packet.wave_id !== wave.wave_id)
    return {
      ok: false,
      error: `Overflowed packet does not belong to the selected wave (${overflowedPacket.packet.wave_id} vs ${wave.wave_id})`,
    };
  const continuationPacket = await loadTopicPacket(
    projectRoot,
    input,
    options.continuationPacketId,
  );
  if (!continuationPacket.ok)
    return {
      ok: false,
      error: `Continuation packet could not be loaded: ${options.continuationPacketId}`,
    };
  if (continuationPacket.packet.wave_id !== wave.wave_id)
    return {
      ok: false,
      error: `Continuation packet does not belong to the selected wave (${continuationPacket.packet.wave_id} vs ${wave.wave_id})`,
    };
  const continuation = {
      topic_id: loaded.topicId,
      wave_id: wave.wave_id,
      overflowed_packet_id: options.overflowedPacketId,
      manager_judgement: options.managerJudgement,
      continuation_packet_id: options.continuationPacketId,
      same_owner_domain: true,
    },
    continuationPath = path.join(
      loaded.topicDir,
      overflowContinuationFilename(wave.wave_id, options.continuationPacketId),
    );
  return (
    await writeFile(continuationPath, overflowContinuationMarkdown(continuation), "utf8"),
    (wave.state = "continuation_packet_open"),
    (loaded.topic.waves = getTopicWaves(loaded.topic).map((entry) =>
      entry.wave_id === wave.wave_id ? wave : entry,
    )),
    (loaded.topic.last_transition_at = buildTopicNow()),
    (loaded.topic.last_transition_reason = `continued_overflow_for_${wave.wave_id}_via_${options.continuationPacketId}`),
    await writeTopicYaml(loaded.topicYamlPath, loaded.topic),
    {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
      waveId: wave.wave_id,
      waveState: wave.state,
      overflowedPacketId: options.overflowedPacketId,
      continuationPacketId: options.continuationPacketId,
      continuationRef: toPortableRelativePath(path.relative(projectRoot, continuationPath)),
    }
  );
}
export async function createDecisionReview(projectRoot, input, slug, options) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!validateTopicSlug(slug))
    return { ok: false, error: `Decision review slug must be lowercase kebab-case: ${slug}` };
  if (!authority.decisionDispositions.includes(options.disposition))
    return { ok: false, error: `Unsupported decision disposition: ${options.disposition}` };
  const review = {
    decision_review_id: slug,
    topic_id: loaded.topicId,
    date: options.date,
    decision: options.decision,
    replaced_scope: options.replacedScope,
    active_replacement_scope: options.activeReplacementScope,
    disposition: options.disposition,
  };
  if (
    options.targetWaveId &&
    !getTopicWaves(loaded.topic).find((entry) => entry.wave_id === options.targetWaveId)
  )
    return { ok: false, error: `Decision review target wave does not exist: ${options.targetWaveId}` };
  if (
    options.activeReplacementScope !== "topic_design_baseline" &&
    options.activeReplacementScope !== null &&
    !getTopicWaves(loaded.topic).some((entry) => entry.wave_id === options.activeReplacementScope)
  )
    return {
      ok: false,
      error: `Decision review active replacement scope must be machine-identifiable: ${options.activeReplacementScope}`,
    };
  const reviewPath = path.join(loaded.topicDir, decisionReviewFilename(slug));
  if (
    (await writeFile(
      reviewPath,
      `---
${YAML.stringify(review).trimEnd()}
---

# Decision Review ${slug}
`,
      "utf8",
    ),
    options.targetWaveId)
  ) {
    const waves = getTopicWaves(loaded.topic).map((entry) =>
      entry.wave_id === options.targetWaveId
        ? options.disposition === "retired"
          ? { ...entry, state: "retired", selected: false }
          : options.disposition === "superseded"
            ? { ...entry, state: "superseded", selected: false }
            : entry
        : entry.wave_id === options.activeReplacementScope
          ? { ...entry, selected: true }
          : loaded.topic.selected_next_target === options.targetWaveId
            ? { ...entry, selected: false }
            : entry,
    );
    ((loaded.topic.waves = waves),
      loaded.topic.selected_next_target === options.targetWaveId &&
        (loaded.topic.selected_next_target = options.activeReplacementScope),
      (loaded.topic.last_transition_at = buildTopicNow()),
      (loaded.topic.last_transition_reason = `decision_review_${slug}`),
      await writeTopicYaml(loaded.topicYamlPath, loaded.topic));
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
  if (!loaded.ok) return loaded;
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority))
    return { ok: false, error: "Topic hold requires an enriched topic root." };
  if (loaded.topic.state !== "ongoing")
    return { ok: false, error: `Topic hold requires ongoing state, found ${loaded.topic.state}` };
  const blockers = getPendingEntryBlockers(loaded.topic);
  if (blockers.length > 0)
    return {
      ok: false,
      error: `Topic hold requires no active implementation wave, found ${blockers.join(", ")}`,
    };
  if (!options.reopenCriteria && !options.closeTrigger)
    return { ok: false, error: "Topic hold requires explicit reopen criteria or close trigger." };
  const pendingNote = {
    pending_note_id: `pending-${loaded.topicId}`,
    topic_id: loaded.topicId,
    entered_from_state: loaded.topic.state,
    reason: options.reason,
    summary: options.summary,
    status: "active",
  };
  (options.reopenCriteria && (pendingNote.reopen_criteria = options.reopenCriteria),
    options.closeTrigger && (pendingNote.close_trigger = options.closeTrigger));
  const notePath = path.join(loaded.topicDir, pendingNoteFilename());
  (await writeFile(notePath, pendingNoteMarkdown(pendingNote), "utf8"),
    (loaded.topic.state = "pending"),
    (loaded.topic.last_transition_at = buildTopicNow()),
    (loaded.topic.last_transition_reason = `entered_pending_${options.reason}`));
  const moved = await moveTopicDirectoryForState(
    projectRoot,
    loaded.topicDir,
    loaded.topicId,
    "pending",
  );
  return (
    await writeTopicYaml(moved.topicYamlPath, loaded.topic),
    {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, moved.topicDir)),
      state: loaded.topic.state,
      pendingNoteRef: toPortableRelativePath(
        path.relative(projectRoot, path.join(moved.topicDir, pendingNoteFilename())),
      ),
      reason: options.reason,
    }
  );
}
export async function resumePendingTopic(projectRoot, input, options) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority))
    return { ok: false, error: "Topic resume requires an enriched topic root." };
  if (loaded.topic.state !== "pending")
    return { ok: false, error: `Topic resume requires pending state, found ${loaded.topic.state}` };
  const pendingNoteLoaded = await loadPendingNote(loaded.topicDir);
  if (!pendingNoteLoaded.ok) return { ok: false, error: pendingNoteLoaded.error };
  const pendingNote = pendingNoteLoaded.note;
  if (!pendingNote.reopen_criteria)
    return { ok: false, error: "Topic resume requires pending note reopen criteria." };
  const selectedWave = getTopicWaves(loaded.topic).find((entry) => entry.selected === true) ?? null;
  if (
    !(
      typeof loaded.topic.selected_next_target == "string" &&
      loaded.topic.selected_next_target !== "topic_design_baseline" &&
      selectedWave !== null &&
      selectedWave.wave_id === loaded.topic.selected_next_target
    )
  )
    return {
      ok: false,
      error: "Topic resume requires exactly one selected next execution target before reopening.",
    };
  ((pendingNote.status = "resumed"),
    (pendingNote.last_resumed_at = buildTopicNow()),
    (pendingNote.last_resume_reason = options.criteriaMet),
    await writeFile(pendingNoteLoaded.notePath, pendingNoteMarkdown(pendingNote), "utf8"),
    (loaded.topic.state = "ongoing"),
    (loaded.topic.last_transition_at = buildTopicNow()),
    (loaded.topic.last_transition_reason = "resumed_from_pending_after_reopen_criteria_met"));
  const moved = await moveTopicDirectoryForState(
    projectRoot,
    loaded.topicDir,
    loaded.topicId,
    "ongoing",
  );
  return (
    await writeTopicYaml(moved.topicYamlPath, loaded.topic),
    {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, moved.topicDir)),
      state: loaded.topic.state,
      pendingNoteRef: toPortableRelativePath(
        path.relative(projectRoot, path.join(moved.topicDir, pendingNoteFilename())),
      ),
      criteriaMet: options.criteriaMet,
    }
  );
}
