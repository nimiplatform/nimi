import path from "node:path";

import {
  assertDesignArtifact,
  FINAL_OUTCOME_STATES,
  inputError,
  loadYamlRef,
  nowIso,
  requireRunId,
  safeDesignId,
  TRANSIENT_STATES,
  writeYamlRef,
} from "./common.mjs";
import {
  decisionQueueRef,
  finalOutcomeState,
  finalStateReportRef,
  isLlmAuditorResult,
  isSyntheticAuditorResult,
  ledgerRef,
  loadInventory,
  loadOrCreateLedger,
  normalizeRevisionEntry,
  packetRef,
  resultRef,
  stopClassForResult,
  updateLedgerHashes,
  validateAuditorResult,
  validateLedger,
  validateOutcome,
  validatePacket,
  validateWave,
  wavePlanRef,
} from "./engine.mjs";

export async function runResultIngest(projectRoot, options) {
  const run = requireRunId(options);
  if (!run.ok) return run;
  if (!options.from) return inputError("nimicoding sweep design refused: result-ingest requires --from.\n");
  const result = await loadYamlRef(projectRoot, options.from) ?? await import("node:fs/promises").then(async ({ readFile }) => {
    const YAML = await import("yaml");
    return YAML.parse(await readFile(path.resolve(projectRoot, options.from), "utf8"));
  }).catch(() => null);
  const errors = validateAuditorResult(result);
  if (errors.length > 0) return inputError(`nimicoding sweep design refused: ${errors.join("; ")}.\n`);
  if (isSyntheticAuditorResult(result) && options.allowSyntheticTrial !== true) {
    return inputError("nimicoding sweep design refused: synthetic_trial results require --allow-synthetic-trial and do not satisfy true LLM closeout.\n");
  }
  if (!safeDesignId(result.packet_id)) return inputError("nimicoding sweep design refused: result packet_id must be a stable id.\n");
  if (!safeDesignId(result.result_id)) return inputError("nimicoding sweep design refused: result_id must be a stable id.\n");
  if (result.run_id !== run.runId) return inputError("nimicoding sweep design refused: result run_id does not match --run-id.\n");
  const packet = await assertDesignArtifact(projectRoot, packetRef(run.runId, result.packet_id), "sweep-design-design-auditor-packet", "design auditor packet");
  if (!packet.ok) return packet;
  if (result.packet_ref !== packet.ref) return inputError("nimicoding sweep design refused: result packet_ref does not match canonical packet artifact.\n");
  const packetErrors = validatePacket(packet.value);
  if (packetErrors.length > 0) return inputError(`nimicoding sweep design refused: ${packetErrors.join("; ")}.\n`);
  const timestamp = options.verifiedAt ?? nowIso();
  const ledger = await loadOrCreateLedger(projectRoot, run.runId, timestamp);
  if (!ledger.ok) return ledger;
  const previousSnapshotHash = ledger.value.ledger_snapshot_hash;
  const normalizedRevisionEntries = [];
  const revisionErrors = [];
  const context = {
    ledger: ledger.value,
    normalized: normalizedRevisionEntries,
    errors: revisionErrors,
    resultId: result.result_id,
    resultArtifactRef: resultRef(run.runId, result.result_id),
    timestamp,
    auditorProvenance: {
      auditor: result.auditor,
      auditor_family: result.auditor_family,
      auditor_mode: result.auditor_mode,
      auditor_result_origin: result.auditor_result_origin,
      session_ref: result.session_ref,
      transcript_ref: result.transcript_ref,
      llm_session_ref: result.llm_session_ref ?? null,
      llm_transcript_ref: result.llm_transcript_ref ?? null,
      llm_prompt_ref: result.llm_prompt_ref ?? null,
      packet_ref: result.packet_ref,
      result_ref: resultRef(run.runId, result.result_id),
    },
  };
  for (const entry of result.revision_entries) {
    normalizedRevisionEntries.push(normalizeRevisionEntry(entry, context));
  }
  if (revisionErrors.length > 0) return inputError(`nimicoding sweep design refused: ${revisionErrors.join("; ")}.\n`);
  const outcomeErrors = [];
  for (const outcome of result.finding_outcomes) {
    validateOutcome(outcome, { errors: outcomeErrors });
  }
  const includedFindingIds = new Set(packet.value.included_finding_ids);
  const outcomeFindingIds = result.finding_outcomes.map((outcome) => outcome.finding_id);
  const uniqueOutcomeFindingIds = new Set(outcomeFindingIds);
  if (uniqueOutcomeFindingIds.size !== outcomeFindingIds.length) {
    outcomeErrors.push("finding_outcomes[] contains duplicate finding_id entries");
  }
  const missingOutcomeIds = packet.value.included_finding_ids.filter((findingId) => !uniqueOutcomeFindingIds.has(findingId));
  if (missingOutcomeIds.length > 0) {
    outcomeErrors.push(`design auditor result is missing final outcomes for included findings: ${missingOutcomeIds.join(", ")}`);
  }
  const outOfPacketOutcomeIds = outcomeFindingIds.filter((findingId) => !includedFindingIds.has(findingId));
  if (outOfPacketOutcomeIds.length > 0) {
    outcomeErrors.push(`design auditor result includes outcomes outside the packet: ${[...new Set(outOfPacketOutcomeIds)].join(", ")}`);
  }
  const normalizedRevisionRefs = new Set(normalizedRevisionEntries.map((entry) => `${ledger.ref}#${entry.revision_entry_id}`));
  for (const outcome of result.finding_outcomes) {
    for (const ref of outcome.revision_ledger_entry_refs ?? []) {
      if (!normalizedRevisionRefs.has(ref)) {
        outcomeErrors.push(`finding_outcomes[] revision_ledger_entry_refs must reference revision entries from this ingest: ${ref}`);
      }
    }
  }
  if (outcomeErrors.length > 0) return inputError(`nimicoding sweep design refused: ${outcomeErrors.join("; ")}.\n`);
  const storedResult = {
    ...result,
    closeout_eligible: isLlmAuditorResult(result),
    ingested_at: timestamp,
    normalized_revision_entry_refs: normalizedRevisionEntries.map((entry) => `${ledger.ref}#${entry.revision_entry_id}`),
  };
  const storedResultRef = await writeYamlRef(projectRoot, resultRef(run.runId, result.result_id), storedResult);
  ledger.value.entries.push(...normalizedRevisionEntries);
  updateLedgerHashes(ledger.value, previousSnapshotHash, timestamp);
  await writeYamlRef(projectRoot, ledger.ref, ledger.value);
  const decisionItems = result.finding_outcomes
    .filter((outcome) => finalOutcomeState(outcome) === "needs_user_decision")
    .map((outcome) => ({
      decision_queue_item_ref: outcome.decision_queue_item_ref,
      finding_id: outcome.finding_id,
      decision_packet_ref: outcome.decision_packet_ref,
      recommended_decision: outcome.recommended_decision,
      queue_status: outcome.queue_status,
      blocked_downstream_wave_refs: outcome.blocked_downstream_wave_refs,
    }));
  if (decisionItems.length > 0 || result.human_decision_requests.length > 0) {
    await writeYamlRef(projectRoot, decisionQueueRef(run.runId), {
      version: 2,
      kind: "sweep-design-decision-queue",
      run_id: run.runId,
      source_design_auditor_result_ref: storedResultRef,
      queue_policy: "focused_mode_stops_immediately_all_mode_batches_until_audit_complete",
      original_findings_mutation_policy: "read_only_never_update_from_sweep_design",
      pending_decision_count: decisionItems.length + result.human_decision_requests.length,
      items: decisionItems,
      human_decision_requests: result.human_decision_requests,
      created_at: timestamp,
    });
  }
  const stopClass = stopClassForResult(result);
  const mode = options.mode ?? result.auditor_mode;
  const focusedStop = mode === "focused" && stopClass;
  return {
    ok: true,
    exitCode: focusedStop ? 2 : 0,
    runId: run.runId,
    resultRef: storedResultRef,
    ledgerRef: ledger.ref,
    revisionEntryCount: normalizedRevisionEntries.length,
    findingOutcomeCount: result.finding_outcomes.length,
    closeoutEligible: isLlmAuditorResult(result),
    stopped: Boolean(focusedStop),
    stopClass: focusedStop ? stopClass : null,
    stopReason: focusedStop ? "focused_mode_requires_manager_or_human_resolution" : null,
  };
}

export async function runLedgerValidate(projectRoot, options) {
  const run = requireRunId(options);
  if (!run.ok) return run;
  const ledger = await assertDesignArtifact(projectRoot, ledgerRef(run.runId), "sweep-design-revision-ledger", "revision ledger");
  if (!ledger.ok) return ledger;
  const errors = validateLedger(ledger.value);
  if (errors.length > 0) return inputError(`nimicoding sweep design refused: ${errors.join("; ")}.\n`);
  return {
    ok: true,
    exitCode: 0,
    runId: run.runId,
    ledgerRef: ledger.ref,
    revisionEntryCount: ledger.value.entries.length,
    ledgerSnapshotHash: ledger.value.ledger_snapshot_hash,
  };
}

export async function runFinalize(projectRoot, options) {
  const run = requireRunId(options);
  if (!run.ok) return run;
  const inventory = await loadInventory(projectRoot, run.runId);
  if (!inventory.ok) return inventory;
  const ledger = await assertDesignArtifact(projectRoot, ledgerRef(run.runId), "sweep-design-revision-ledger", "revision ledger");
  if (!ledger.ok) return ledger;
  const ledgerErrors = validateLedger(ledger.value);
  if (ledgerErrors.length > 0) return inputError(`nimicoding sweep design refused: ${ledgerErrors.join("; ")}.\n`);
  const outcomes = new Map();
  const resultRefs = new Set();
  const nonLlmResultRefs = [];
  for (const entry of ledger.value.entries) {
    for (const ref of entry.replacement_artifact_refs ?? []) {
      if (ref.includes("/design-auditor-results/")) resultRefs.add(ref);
    }
  }
  for (const ref of resultRefs) {
    const result = await loadYamlRef(projectRoot, ref);
    if (result?.kind !== "sweep-design-design-auditor-result") continue;
    if (!isLlmAuditorResult(result)) nonLlmResultRefs.push(ref);
    for (const outcome of result.finding_outcomes ?? []) {
      outcomes.set(outcome.finding_id, { ...outcome, source_result_ref: ref });
    }
  }
  const findings = inventory.value.findings.map((finding) => {
    const outcome = outcomes.get(finding.finding_id);
    if (!outcome) {
      return {
        finding_id: finding.finding_id,
        state: "raw",
        final_outcome: false,
        transient: true,
        reason: "missing_design_auditor_final_outcome",
      };
    }
    const state = finalOutcomeState(outcome);
    return {
      finding_id: finding.finding_id,
      state,
      final_outcome: FINAL_OUTCOME_STATES.has(state),
      transient: TRANSIENT_STATES.has(state),
      source_result_ref: outcome.source_result_ref,
      design_auditor_packet_ref: outcome.design_auditor_packet_ref,
      revision_ledger_entry_refs: outcome.revision_ledger_entry_refs,
    };
  });
  const transient = findings.filter((finding) => finding.transient || !finding.final_outcome);
  const finalOutcomeComplete = transient.length === 0;
  const llmCloseoutEligible = nonLlmResultRefs.length === 0;
  const complete = finalOutcomeComplete && (llmCloseoutEligible || options.allowSyntheticCloseout === true);
  const artifact = {
    version: 2,
    kind: "sweep-design-final-state-report",
    run_id: run.runId,
    source_inventory_ref: inventory.ref,
    source_revision_ledger_ref: ledger.ref,
    final_state_policy: "every_finding_must_have_final_sweep_design_outcome_with_llm_packet_result_ledger_provenance",
    source_findings_mutation_policy: "read_only_never_update_from_sweep_design",
    complete,
    final_outcome_complete: finalOutcomeComplete,
    llm_closeout_eligible: llmCloseoutEligible,
    non_llm_result_refs: nonLlmResultRefs,
    total_finding_count: findings.length,
    final_finding_count: findings.length - transient.length,
    transient_finding_count: transient.length,
    final_outcome_states: [...FINAL_OUTCOME_STATES].sort(),
    transient_states: [...TRANSIENT_STATES].sort(),
    blocking_findings: transient.map((finding) => ({
      finding_id: finding.finding_id,
      state: finding.state,
      reason: finding.reason ?? "transient_or_missing_final_outcome",
    })),
    findings,
    created_at: options.verifiedAt ?? nowIso(),
  };
  const ref = await writeYamlRef(projectRoot, finalStateReportRef(run.runId), artifact);
  return {
    ok: true,
    exitCode: complete ? 0 : 2,
    runId: run.runId,
    finalStateReportRef: ref,
    finalComplete: complete,
    finalOutcomeComplete,
    llmCloseoutEligible,
    nonLlmResultCount: nonLlmResultRefs.length,
    totalFindingCount: artifact.total_finding_count,
    finalFindingCount: artifact.final_finding_count,
    transientFindingCount: artifact.transient_finding_count,
    stopped: !complete,
    stopClass: complete ? null : finalOutcomeComplete ? "non_llm_result_provenance" : "incomplete_final_state",
    stopReason: complete ? null : finalOutcomeComplete ? "synthetic_or_non_llm_results_do_not_satisfy_true_llm_closeout" : "missing_or_transient_final_outcomes_remaining",
  };
}

export async function runWavePlan(projectRoot, options) {
  const run = requireRunId(options);
  if (!run.ok) return run;
  if (!options.topicId) return inputError("nimicoding sweep design refused: --topic-id is required.\n");
  const ledger = await assertDesignArtifact(projectRoot, ledgerRef(run.runId), "sweep-design-revision-ledger", "revision ledger");
  if (!ledger.ok) return ledger;
  const ledgerErrors = validateLedger(ledger.value);
  if (ledgerErrors.length > 0) return inputError(`nimicoding sweep design refused: ${ledgerErrors.join("; ")}.\n`);
  const waves = [];
  const errors = [];
  const resultRefs = new Set();
  for (const entry of ledger.value.entries) {
    for (const ref of entry.replacement_artifact_refs ?? []) {
      if (ref.includes("/design-auditor-results/")) resultRefs.add(ref);
    }
  }
  for (const ref of resultRefs) {
    const result = await loadYamlRef(projectRoot, ref);
    if (result?.kind !== "sweep-design-design-auditor-result") continue;
    if (!isLlmAuditorResult(result) && options.allowSyntheticTrial !== true) {
      errors.push(`wave-plan result ${ref} is not closeout-eligible LLM provenance; pass --allow-synthetic-trial only for load tests`);
      continue;
    }
    for (const wave of result.wave_changes ?? []) {
      if (wave.state === "ready_for_implementation" || wave.ready_for_implementation_wave === true) {
        validateWave(wave, errors);
        waves.push({ ...wave, source_design_auditor_result_ref: ref });
      }
    }
  }
  if (errors.length > 0) return inputError(`nimicoding sweep design refused: ${errors.join("; ")}.\n`);
  const artifact = {
    version: 2,
    kind: "sweep-design-wave-plan",
    run_id: run.runId,
    topic_id: options.topicId,
    source_revision_ledger_ref: ledger.ref,
    mutates_topic_state: false,
    worker_dispatch_allowed: false,
    wave_count: waves.length,
    waves,
    created_at: options.verifiedAt ?? nowIso(),
  };
  const ref = await writeYamlRef(projectRoot, wavePlanRef(run.runId), artifact);
  return { ok: true, exitCode: 0, runId: run.runId, wavePlanRef: ref, waveCount: waves.length };
}
