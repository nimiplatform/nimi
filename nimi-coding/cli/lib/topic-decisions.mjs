import {
  buildDispatchPrompt,
  buildPostUpdateReviewDecision,
  buildPreImplementationDecision,
  loadAuthorityConvergencePolicy,
} from "./authority-convergence.mjs";
import path from "node:path";

import { findUniqueFreezableDraftPacket } from "./topic-draft-packets.mjs";
import { loadTopicRuntimeAuthority, toPortableRelativePath } from "./topic-common.mjs";
import { findDeterministicNextWave, getTopicWaves, loadTopicReport } from "./topic-scaffold.mjs";
import { validateTopicGraph, validateWaveAdmission } from "./topic-waves.mjs";
import { listWavePackets, listWaveResults } from "./topic-artifacts.mjs";

export function buildTopicStepDecision(topic, wave, values) {
  const waveId = wave?.wave_id ?? null;
  return {
    decision_id: `${topic.topic_id}:${waveId ?? "topic"}:${values.reasonCode}`,
    topic_id: topic.topic_id,
    wave_id: waveId,
    decision_kind: "topic_next_step",
    stop_class: values.stopClass,
    recommended_action: values.recommendedAction,
    reason_code: values.reasonCode,
    requires_human_confirmation: values.stopClass === "require_human_confirmation",
    recommended_decision: values.recommendedDecision,
    recommendation_rationale: values.recommendationRationale,
    expected_artifacts: values.expectedArtifacts ?? [],
    next_command_ref: values.nextCommandRef ?? null,
    blocking_checks: values.blockingChecks ?? [],
  };
}
export function commandRef(parts) {
  return ["nimicoding", "topic", ...parts].join(" ");
}
export async function buildDecisionForSelectedWave(projectRoot, loaded, graphReport, wave) {
  const failedGraphChecks = (graphReport.checks ?? []).filter((entry) => !entry.ok);
  if (!graphReport.ok)
    return buildTopicStepDecision(loaded.topic, wave, {
      stopClass: "blocked",
      recommendedAction: "no_action",
      reasonCode: "topic_graph_validation_failed",
      recommendedDecision: "fix_topic_graph_before_continuing",
      recommendationRationale:
        "The wave graph is the dispatch authority for topic execution and must validate before any next step is emitted.",
      blockingChecks: failedGraphChecks,
    });
  if (["closed", "retired", "superseded"].includes(wave.state))
    return buildTopicStepDecision(loaded.topic, wave, {
      stopClass: "blocked",
      recommendedAction: "no_action",
      reasonCode: "selected_wave_is_terminal",
      recommendedDecision: "select_a_non_terminal_wave_or_close_the_topic",
      recommendationRationale: `Selected wave ${wave.wave_id} is ${wave.state} and cannot be dispatched.`,
    });
  if (wave.state === "needs_revision")
    return buildTopicStepDecision(loaded.topic, wave, {
      stopClass: "blocked",
      recommendedAction: "open_remediation",
      reasonCode: "revise",
      recommendedDecision: "fix",
      recommendationRationale: "Block.",
    });
  if (["candidate", "preflight_draft"].includes(wave.state)) {
    const admission = await validateWaveAdmission(projectRoot, loaded.topicId, wave.wave_id);
    return admission.ok
      ? buildTopicStepDecision(loaded.topic, wave, {
          stopClass: "continue",
          recommendedAction: "admit_wave",
          reasonCode: "wave_admission_ready",
          recommendedDecision: "admit_wave",
          recommendationRationale: "Admission is mechanical.",
          nextCommandRef: commandRef(["wave", "admit", loaded.topicId, wave.wave_id]),
        })
      : buildTopicStepDecision(loaded.topic, wave, {
          stopClass: "blocked",
          recommendedAction: "admit_wave",
          reasonCode: "wave_admission_validation_failed",
          recommendedDecision: "repair_admission_blockers",
          recommendationRationale:
            "The selected wave cannot be admitted until its admission checks pass.",
          nextCommandRef: commandRef([
            "validate",
            "admission",
            loaded.topicId,
            wave.wave_id,
            "--json",
          ]),
          blockingChecks: (admission.checks ?? []).filter((entry) => !entry.ok),
        });
  }
  if (
    ["preflight_admitted", "implementation_admitted", "continuation_packet_open"].includes(
      wave.state,
    )
  )
    return buildTopicStepDecision(
      loaded.topic,
      wave,
      await buildPreImplementationDecision({
        projectRoot,
        loaded,
        wave,
        commandRef,
        listWavePackets,
        listWaveResults,
        findUniqueFreezableDraftPacket,
        loadTopicRuntimeAuthority,
      }),
    );
  if (wave.state === "implementation_active") {
    const waveResults = await listWaveResults(loaded.topicDir, wave.wave_id),
      implementationResult = waveResults.find(
        (entry) => entry.result?.result_kind === "implementation",
      );
    if (!implementationResult)
      return buildTopicStepDecision(loaded.topic, wave, {
        stopClass: "await_external_evidence",
        recommendedAction: "record_result",
        reasonCode: "awaiting_implementation_result",
        recommendedDecision: "ingest_the_implementation_result_when_available",
        recommendationRationale:
          "The wave is active, but closeout requires explicit implementation result lineage.",
        expectedArtifacts: ["result-<wave-id>-implementation.md"],
        nextCommandRef: commandRef([
          "result",
          "record",
          loaded.topicId,
          "--kind",
          "implementation",
          "--verdict",
          "<verdict>",
          "--from",
          "<path>",
          "--verified-at",
          "<utc>",
        ]),
      });
    const postUpdateReviewDecision = await buildPostUpdateReviewDecision({
      projectRoot,
      topicDir: loaded.topicDir,
      topicId: loaded.topicId,
      wave,
      packets: await listWavePackets(loaded.topicDir, wave.wave_id),
      results: waveResults,
      policy: await loadAuthorityConvergencePolicy(projectRoot),
      commandRef,
    });
    return postUpdateReviewDecision
      ? buildTopicStepDecision(loaded.topic, wave, postUpdateReviewDecision)
      : buildTopicStepDecision(loaded.topic, wave, {
          stopClass: "continue",
          recommendedAction: "closeout_wave",
          reasonCode: "wave_has_result_lineage_ready_for_closeout",
          recommendedDecision: "closeout_wave",
          recommendationRationale:
            "Wave closeout is a deterministic phase transition once lineage-backed result evidence exists.",
          nextCommandRef: commandRef([
            "closeout",
            "wave",
            loaded.topicId,
            wave.wave_id,
            "--authority",
            "closed",
            "--semantic",
            "closed",
            "--consumer",
            "closed",
            "--drift-resistance",
            "closed",
            "--disposition",
            "complete",
          ]),
        });
  }
  return wave.state === "overflowed"
    ? buildTopicStepDecision(loaded.topic, wave, {
        stopClass: "require_human_confirmation",
        recommendedAction: "continue_overflow",
        reasonCode: "overflow_requires_manager_judgement",
        recommendedDecision: "approve_continuation_only_if_the_same_owner_domain_rule_still_holds",
        recommendationRationale:
          "Overflow is not pass or rollback; continuation requires explicit manager judgement.",
        nextCommandRef: commandRef([
          "overflow",
          "continue",
          loaded.topicId,
          "--packet",
          "<continuation-packet-id>",
          "--overflowed-packet",
          "<packet-id>",
          "--manager-judgement",
          "<text>",
          "--same-owner-domain",
        ]),
      })
    : buildTopicStepDecision(loaded.topic, wave, {
        stopClass: "blocked",
        recommendedAction: "no_action",
        reasonCode: "unsupported_wave_state",
        recommendedDecision: "repair_or_review_the_selected_wave_state",
        recommendationRationale: `No next-step rule is defined for wave state ${wave.state}.`,
      });
}
export async function decideTopicNextStep(projectRoot, input = null) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const { validateTopicRoot } = await import("./topic-root-validation.mjs");
  const rootValidation = await validateTopicRoot(projectRoot, input),
    selectedWave =
      getTopicWaves(loaded.topic).find(
        (entry) => entry.wave_id === loaded.topic.selected_next_target,
      ) ?? null;
  if (!rootValidation.ok)
    return {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
      decision: buildTopicStepDecision(loaded.topic, selectedWave, {
        stopClass: "blocked",
        recommendedAction: "no_action",
        reasonCode: "topic_root_validation_failed",
        recommendedDecision: "repair_topic_root_before_continuing",
        recommendationRationale:
          "The topic root must validate before a next execution step can be selected.",
        blockingChecks: (rootValidation.checks ?? []).filter((entry) => !entry.ok),
      }),
    };
  if (loaded.topic.state === "pending")
    return {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
      decision: buildTopicStepDecision(loaded.topic, selectedWave, {
        stopClass: "await_external_evidence",
        recommendedAction: "resume_topic",
        reasonCode: "topic_pending_wait",
        recommendedDecision: "resume_only_when_the_pending_note_reopen_criteria_are_met",
        recommendationRationale:
          "Pending is an explicit wait state and must not be bypassed by the loop.",
        nextCommandRef: commandRef(["resume", loaded.topicId, "--criteria-met", "<text>"]),
      }),
    };
  if (
    !loaded.topic.selected_next_target ||
    loaded.topic.selected_next_target === "topic_design_baseline"
  ) {
    const allWavesTerminal =
        getTopicWaves(loaded.topic).filter(
          (entry) => !["closed", "retired", "superseded"].includes(entry.state),
        ).length === 0 && getTopicWaves(loaded.topic).length > 0,
      deterministicNextWave = allWavesTerminal ? null : findDeterministicNextWave(loaded.topic);
    return {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
      decision: buildTopicStepDecision(
        loaded.topic,
        deterministicNextWave,
        allWavesTerminal
          ? {
              stopClass: "completed",
              recommendedAction: "closeout_topic",
              reasonCode: "all_waves_terminal",
              recommendedDecision: "run_topic_closeout_and_true_close_checks",
              recommendationRationale:
                "All waves are terminal, so the next step is topic-level closeout review.",
              nextCommandRef: commandRef([
                "closeout",
                "topic",
                loaded.topicId,
                "--authority",
                "closed",
                "--semantic",
                "closed",
                "--consumer",
                "closed",
                "--drift-resistance",
                "closed",
                "--disposition",
                "complete",
              ]),
            }
          : deterministicNextWave
            ? {
                stopClass: "continue",
                recommendedAction: "admit_wave",
                reasonCode: "deterministic_next_wave_ready",
                recommendedDecision: "admit_wave",
                recommendationRationale:
                  "The first dependency-ready non-terminal wave in topic.yaml waves[] order is selected mechanically.",
                nextCommandRef: commandRef([
                  "wave",
                  "admit",
                  loaded.topicId,
                  deterministicNextWave.wave_id,
                ]),
              }
            : {
                stopClass: "require_human_confirmation",
                recommendedAction: "admit_wave",
                reasonCode: "no_selected_next_target",
                recommendedDecision: "select_the_next_wave_or_hold_the_topic",
                recommendationRationale:
                  "The loop cannot choose among possible next waves without manager judgement.",
                nextCommandRef: commandRef(["wave", "select", loaded.topicId, "<wave-id>"]),
              },
      ),
    };
  }
  if (!selectedWave)
    return {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
      decision: buildTopicStepDecision(loaded.topic, null, {
        stopClass: "blocked",
        recommendedAction: "no_action",
        reasonCode: "selected_next_target_does_not_resolve",
        recommendedDecision: "repair_topic_selected_next_target",
        recommendationRationale: `selected_next_target does not resolve to a declared wave: ${loaded.topic.selected_next_target}`,
      }),
    };
  const graphReport = await validateTopicGraph(projectRoot, input);
  return {
    ok: true,
    topicId: loaded.topicId,
    topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
    decision: await buildDecisionForSelectedWave(projectRoot, loaded, graphReport, selectedWave),
  };
}
const RUN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
