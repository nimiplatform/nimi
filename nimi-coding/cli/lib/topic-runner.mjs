import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runNativeCodexSdkPrompt } from "./codex-sdk-runner.mjs";
import {
  admitWaveInTopic,
  buildTopicRunLedger,
  decideTopicNextStep,
  dispatchTopicPacket,
  freezePacketForTopic,
  initTopicRunLedger,
  loadTopicReport,
  readTopicRunLedger,
  recordTopicRunEvent,
} from "./topic.mjs";

const ADAPTER_IDS = new Set(["codex", "oh_my_codex", "claude"]);

function utcNowNoMillis() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function toPortablePath(value) {
  return value.split(path.sep).join("/");
}

function projectRef(projectRoot, absolutePath) {
  return toPortablePath(path.relative(projectRoot, absolutePath));
}

function hasPlaceholder(value) {
  return /<[^>]+>/.test(value);
}

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function remapTopicRef(ref, fromTopicRef, toTopicRef) {
  if (!ref || !fromTopicRef || !toTopicRef || fromTopicRef === toTopicRef) {
    return ref;
  }
  return ref.startsWith(`${fromTopicRef}/`)
    ? `${toTopicRef}/${ref.slice(fromTopicRef.length + 1)}`
    : ref;
}

function buildGate(decision) {
  if (!decision || decision.stop_class === "continue") {
    return null;
  }
  return {
    stopClass: decision.stop_class,
    reasonCode: decision.reason_code,
    recommendedAction: decision.recommended_action,
    recommendedDecision: decision.recommended_decision,
    recommendationRationale: decision.recommendation_rationale,
    nextCommandRef: decision.next_command_ref,
    blockingChecks: decision.blocking_checks ?? [],
  };
}

function blockedResult(base, error, extra = {}) {
  return {
    ok: false,
    ...base,
    runnerStatus: "blocked",
    stopClass: "blocked",
    recommendedAction: "no_action",
    error,
    circuitBreaker: {
      state: "open",
      reason: error,
    },
    ...extra,
  };
}

async function ensureLedger(projectRoot, topicInput, runId, startedAt) {
  const existing = await readTopicRunLedger(projectRoot, topicInput, runId);
  if (existing.ok) {
    return existing;
  }
  if (!String(existing.error ?? "").includes("not found")) {
    return existing;
  }
  return initTopicRunLedger(projectRoot, topicInput, runId, startedAt);
}

async function writeDecisionArtifact(projectRoot, loaded, runId, decision, eventIndex) {
  const decisionPath = path.join(
    loaded.topicDir,
    `runner-decision-${safeSegment(runId)}-${String(eventIndex).padStart(4, "0")}.json`,
  );
  await writeFile(decisionPath, `${JSON.stringify(decision, null, 2)}\n`, "utf8");
  return projectRef(projectRoot, decisionPath);
}

async function recordRunnerBlocked(projectRoot, options, fields) {
  return recordTopicRunEvent(projectRoot, options.topicInput, {
    runId: options.runId,
    eventKind: "runner_blocked",
    stopClass: "blocked",
    recommendedAction: "no_action",
    sourceRef: fields.sourceRef,
    summary: fields.summary,
    recordedAt: fields.recordedAt,
    waveId: fields.waveId,
    artifactRefs: fields.artifactRefs ?? {},
  });
}

async function rewriteMovedRunEventRef(projectRoot, eventRef, fromTopicRef, toTopicRef, fromRef, toRef) {
  if (fromRef === toRef) {
    return;
  }
  const movedEventRef = remapTopicRef(eventRef, fromTopicRef, toTopicRef);
  const eventPath = path.join(projectRoot, movedEventRef);
  const eventText = await readFile(eventPath, "utf8");
  await writeFile(eventPath, eventText.split(fromRef).join(toRef), "utf8");
}

function parseMechanicalCommandRef(commandRef, topicId) {
  if (typeof commandRef !== "string" || commandRef.trim().length === 0) {
    return {
      ok: false,
      error: "topic-runner refused: decision.next_command_ref is empty",
    };
  }
  if (hasPlaceholder(commandRef)) {
    return {
      ok: false,
      error: `topic-runner refused: decision.next_command_ref contains a placeholder: ${commandRef}`,
    };
  }

  const parts = commandRef.trim().split(/\s+/);
  const expectedPrefix = ["nimicoding", "topic"];
  if (parts[0] !== expectedPrefix[0] || parts[1] !== expectedPrefix[1]) {
    return {
      ok: false,
      error: `topic-runner refused: next command is not a package-owned topic command: ${commandRef}`,
    };
  }

  const [domain, action, commandTopicId] = parts.slice(2, 5);
  if (domain === "wave" && action === "admit") {
    const waveId = parts[5] ?? null;
    if (commandTopicId !== topicId) {
      return {
        ok: false,
        error: `topic-runner refused: next command topic ${commandTopicId} does not match ${topicId}`,
      };
    }
    if (!waveId || waveId.startsWith("--")) {
      return {
        ok: false,
        error: `topic-runner refused: wave admit command is missing wave id: ${commandRef}`,
      };
    }
    return {
      ok: true,
      action: "admit_wave",
      waveId,
    };
  }

  if (domain === "packet" && action === "freeze") {
    if (commandTopicId !== topicId) {
      return {
        ok: false,
        error: `topic-runner refused: next command topic ${commandTopicId} does not match ${topicId}`,
      };
    }
    const fromFlagIndex = parts.indexOf("--from");
    const draftPath = fromFlagIndex >= 0 ? parts[fromFlagIndex + 1] : null;
    if (!draftPath || draftPath.startsWith("--")) {
      return {
        ok: false,
        error: `topic-runner refused: packet freeze command is missing --from: ${commandRef}`,
      };
    }
    return {
      ok: true,
      action: "freeze_packet",
      draftPath,
    };
  }

  if (["worker", "audit"].includes(domain) && action === "dispatch") {
    if (commandTopicId !== topicId) {
      return {
        ok: false,
        error: `topic-runner refused: next command topic ${commandTopicId} does not match ${topicId}`,
      };
    }

    const packetFlagIndex = parts.indexOf("--packet");
    const packetId = packetFlagIndex >= 0 ? parts[packetFlagIndex + 1] : null;
    if (!packetId || packetId.startsWith("--")) {
      return {
        ok: false,
        error: `topic-runner refused: dispatch command is missing --packet: ${commandRef}`,
      };
    }

    return {
      ok: true,
      action: domain === "audit" ? "dispatch_audit" : "dispatch_worker",
      role: domain,
      packetId,
    };
  }

  return {
    ok: false,
    error: `topic-runner refused: unsupported mechanical next command: ${commandRef}`,
  };
}

async function executeMechanicalCommand(projectRoot, options, parsedCommand) {
  if (parsedCommand.action === "admit_wave") {
    const report = await admitWaveInTopic(projectRoot, options.topicInput, parsedCommand.waveId);
    return {
      ok: report.ok,
      action: parsedCommand.action,
      report,
      eventKind: "wave_admitted",
      eventSourceRef: report.ok ? `${report.topicRef}/topic.yaml` : null,
      summary: report.ok ? "wave_admit_completed" : "runner_wave_admit_failed",
      artifactRefs: {},
      waveId: report.ok ? report.waveId : parsedCommand.waveId,
      error: report.ok ? null : report.error,
    };
  }

  if (parsedCommand.action === "freeze_packet") {
    const report = await freezePacketForTopic(projectRoot, options.topicInput, parsedCommand.draftPath);
    return {
      ok: report.ok,
      action: parsedCommand.action,
      report,
      eventKind: "packet_frozen",
      eventSourceRef: report.ok ? report.packetRef : null,
      summary: report.ok ? "packet_freeze_completed" : "runner_packet_freeze_failed",
      artifactRefs: report.ok ? { packet_ref: report.packetRef } : {},
      waveId: report.ok ? report.waveId : null,
      error: report.ok ? null : report.error,
    };
  }

  return {
    ok: false,
    action: parsedCommand.action,
    report: null,
    eventKind: null,
    eventSourceRef: null,
    summary: "runner_unsupported_mechanical_command",
    artifactRefs: {},
    waveId: null,
    error: `topic-runner refused: unsupported mechanical action ${parsedCommand.action}`,
  };
}

async function writeHostOutput(projectRoot, options, dispatchReport, hostReport, recordedAt) {
  const outputDir = path.join(projectRoot, ".nimi", "local", "outputs", safeSegment(options.runId));
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(
    outputDir,
    `${safeSegment(dispatchReport.role)}-${safeSegment(dispatchReport.packetId)}.codex-output.json`,
  );
  await writeFile(
    outputPath,
    `${JSON.stringify({
      contract: "nimicoding.topic-runner.host-output.v1",
      topic_id: dispatchReport.topicId,
      run_id: options.runId,
      adapter_id: options.adapter,
      role: dispatchReport.role,
      packet_id: dispatchReport.packetId,
      prompt_ref: dispatchReport.promptRef,
      recorded_at: recordedAt,
      host_report: hostReport,
    }, null, 2)}\n`,
    "utf8",
  );
  return projectRef(projectRoot, outputPath);
}

async function maybeExecuteHost(projectRoot, options, dispatchReport, deps) {
  if (!options.executeHost) {
    return {
      ok: true,
      executed: false,
      hostOutputRef: null,
      hostReport: null,
    };
  }
  if (options.adapter !== "codex") {
    return {
      ok: false,
      error: `topic-runner refused: --execute-host is currently supported only for adapter codex, not ${options.adapter}`,
    };
  }

  const prompt = await readFile(path.join(projectRoot, dispatchReport.promptRef), "utf8");
  const hostReport = await runNativeCodexSdkPrompt({
    prompt,
    threadId: options.threadId,
    codex: deps.codex,
  });
  if (!hostReport.ok) {
    return hostReport;
  }
  const hostOutputRef = await writeHostOutput(projectRoot, options, dispatchReport, hostReport, options.recordedAt);
  return {
    ok: true,
    executed: true,
    hostOutputRef,
    hostReport,
  };
}

export async function runTopicRunnerStep(projectRoot, options, deps = {}) {
  if (!ADAPTER_IDS.has(options.adapter)) {
    return {
      ok: false,
      error: `topic-runner refused: unsupported adapter ${options.adapter}`,
    };
  }

  const recordedAt = options.verifiedAt ?? utcNowNoMillis();
  const ledger = await ensureLedger(projectRoot, options.topicInput, options.runId, recordedAt);
  if (!ledger.ok) {
    return ledger;
  }

  const loaded = await loadTopicReport(projectRoot, options.topicInput);
  if (!loaded.ok) {
    return loaded;
  }

  const decisionReport = await decideTopicNextStep(projectRoot, options.topicInput);
  if (!decisionReport.ok) {
    return decisionReport;
  }

  const decisionRef = await writeDecisionArtifact(
    projectRoot,
    loaded,
    options.runId,
    decisionReport.decision,
    (ledger.eventCount ?? 0) + 1,
  );
  const decisionEvent = await recordTopicRunEvent(projectRoot, options.topicInput, {
    runId: options.runId,
    eventKind: "decision_emitted",
    stopClass: decisionReport.decision.stop_class,
    recommendedAction: decisionReport.decision.recommended_action,
    sourceRef: decisionRef,
    summary: decisionReport.decision.reason_code,
    recordedAt,
    waveId: decisionReport.decision.wave_id,
    artifactRefs: {
      decision_ref: decisionRef,
    },
  });
  if (!decisionEvent.ok) {
    return decisionEvent;
  }

  if (decisionReport.decision.stop_class !== "continue") {
    return {
      ok: true,
      topicId: decisionReport.topicId,
      topicRef: decisionReport.topicRef,
      runId: options.runId,
      adapter: options.adapter,
      runnerStatus: "stopped",
      executed: false,
      stopClass: decisionReport.decision.stop_class,
      recommendedAction: decisionReport.decision.recommended_action,
      decision: decisionReport.decision,
      gate: buildGate(decisionReport.decision),
      decisionRef,
      ledgerRef: decisionEvent.ledgerRef,
      eventCount: decisionEvent.eventCount,
    };
  }

  const parsedCommand = parseMechanicalCommandRef(
    decisionReport.decision.next_command_ref,
    decisionReport.topicId,
  );
  if (!parsedCommand.ok) {
    const blockedEvent = await recordRunnerBlocked(projectRoot, { ...options, verifiedAt: recordedAt }, {
      sourceRef: decisionRef,
      summary: "runner_refused_next_command",
      recordedAt,
      waveId: decisionReport.decision.wave_id,
      artifactRefs: { decision_ref: decisionRef },
    });
    return blockedResult({
      topicId: decisionReport.topicId,
      topicRef: decisionReport.topicRef,
      runId: options.runId,
      adapter: options.adapter,
      decision: decisionReport.decision,
      decisionRef,
      ledgerRef: blockedEvent.ok ? blockedEvent.ledgerRef : decisionEvent.ledgerRef,
      eventCount: blockedEvent.ok ? blockedEvent.eventCount : decisionEvent.eventCount,
    }, parsedCommand.error);
  }

  if (["admit_wave", "freeze_packet"].includes(parsedCommand.action)) {
    const commandExecution = await executeMechanicalCommand(projectRoot, { ...options, recordedAt }, parsedCommand);
    if (!commandExecution.ok) {
      const blockedEvent = await recordRunnerBlocked(projectRoot, { ...options, verifiedAt: recordedAt }, {
        sourceRef: decisionRef,
        summary: commandExecution.summary,
        recordedAt,
        waveId: commandExecution.waveId ?? decisionReport.decision.wave_id,
        artifactRefs: { decision_ref: decisionRef },
      });
      return blockedResult({
        topicId: decisionReport.topicId,
        topicRef: decisionReport.topicRef,
        runId: options.runId,
        adapter: options.adapter,
        decision: decisionReport.decision,
        decisionRef,
        ledgerRef: blockedEvent.ok ? blockedEvent.ledgerRef : decisionEvent.ledgerRef,
        eventCount: blockedEvent.ok ? blockedEvent.eventCount : decisionEvent.eventCount,
      }, commandExecution.error ?? "topic-runner mechanical command failed");
    }

    const effectiveDecisionRef = remapTopicRef(
      decisionRef,
      decisionReport.topicRef,
      commandExecution.report.topicRef,
    );
    await rewriteMovedRunEventRef(
      projectRoot,
      decisionEvent.eventRef,
      decisionReport.topicRef,
      commandExecution.report.topicRef,
      decisionRef,
      effectiveDecisionRef,
    );
    const artifactRefs = {
      decision_ref: effectiveDecisionRef,
      ...commandExecution.artifactRefs,
    };
    const commandEvent = await recordTopicRunEvent(projectRoot, options.topicInput, {
      runId: options.runId,
      eventKind: commandExecution.eventKind,
      stopClass: "continue",
      recommendedAction: parsedCommand.action,
      sourceRef: commandExecution.eventSourceRef,
      summary: commandExecution.summary,
      recordedAt,
      waveId: commandExecution.waveId,
      artifactRefs,
    });
    if (!commandEvent.ok) {
      return commandEvent;
    }

    return {
      ok: true,
      topicId: commandExecution.report.topicId,
      topicRef: commandExecution.report.topicRef,
      runId: options.runId,
      adapter: options.adapter,
      runnerStatus: "continued",
      executed: true,
      stopClass: "continue",
      recommendedAction: decisionReport.decision.recommended_action,
      decision: decisionReport.decision,
      gate: buildGate(decisionReport.decision),
      decisionRef: effectiveDecisionRef,
      command: commandExecution.report,
      ledgerRef: commandEvent.ledgerRef,
      eventCount: commandEvent.eventCount,
    };
  }

  const dispatchReport = await dispatchTopicPacket(
    projectRoot,
    options.topicInput,
    parsedCommand.packetId,
    parsedCommand.role,
  );
  if (!dispatchReport.ok) {
    const blockedEvent = await recordRunnerBlocked(projectRoot, { ...options, verifiedAt: recordedAt }, {
      sourceRef: decisionRef,
      summary: "runner_dispatch_failed",
      recordedAt,
      waveId: decisionReport.decision.wave_id,
      artifactRefs: { decision_ref: decisionRef },
    });
    return blockedResult({
      topicId: decisionReport.topicId,
      topicRef: decisionReport.topicRef,
      runId: options.runId,
      adapter: options.adapter,
      decision: decisionReport.decision,
      decisionRef,
      ledgerRef: blockedEvent.ok ? blockedEvent.ledgerRef : decisionEvent.ledgerRef,
      eventCount: blockedEvent.ok ? blockedEvent.eventCount : decisionEvent.eventCount,
    }, dispatchReport.error);
  }

  const hostExecution = await maybeExecuteHost(
    projectRoot,
    { ...options, recordedAt },
    dispatchReport,
    deps,
  );
  if (!hostExecution.ok) {
    const blockedEvent = await recordRunnerBlocked(projectRoot, { ...options, verifiedAt: recordedAt }, {
      sourceRef: dispatchReport.promptRef,
      summary: "runner_host_execution_failed",
      recordedAt,
      waveId: dispatchReport.waveId,
      artifactRefs: {
        decision_ref: decisionRef,
        packet_ref: dispatchReport.packetRef,
        prompt_ref: dispatchReport.promptRef,
      },
    });
    return blockedResult({
      topicId: decisionReport.topicId,
      topicRef: decisionReport.topicRef,
      runId: options.runId,
      adapter: options.adapter,
      decision: decisionReport.decision,
      decisionRef,
      dispatch: dispatchReport,
      ledgerRef: blockedEvent.ok ? blockedEvent.ledgerRef : decisionEvent.ledgerRef,
      eventCount: blockedEvent.ok ? blockedEvent.eventCount : decisionEvent.eventCount,
    }, hostExecution.error);
  }

  const artifactRefs = {
    packet_ref: dispatchReport.packetRef,
    prompt_ref: dispatchReport.promptRef,
  };
  if (hostExecution.hostOutputRef) {
    artifactRefs[dispatchReport.role === "audit" ? "audit_output_ref" : "worker_output_ref"] = hostExecution.hostOutputRef;
  }

  const dispatchEvent = await recordTopicRunEvent(projectRoot, options.topicInput, {
    runId: options.runId,
    eventKind: dispatchReport.role === "audit" ? "audit_dispatched" : "worker_dispatched",
    stopClass: "continue",
    recommendedAction: "record_result",
    sourceRef: dispatchReport.promptRef,
    summary: `${dispatchReport.role}_dispatch_completed`,
    recordedAt,
    waveId: dispatchReport.waveId,
    artifactRefs,
  });
  if (!dispatchEvent.ok) {
    return dispatchEvent;
  }

  return {
    ok: true,
    topicId: decisionReport.topicId,
    topicRef: decisionReport.topicRef,
    runId: options.runId,
    adapter: options.adapter,
    runnerStatus: "continued",
    executed: true,
    stopClass: "continue",
    recommendedAction: decisionReport.decision.recommended_action,
    decision: decisionReport.decision,
    gate: buildGate(decisionReport.decision),
    decisionRef,
    dispatch: dispatchReport,
    hostExecution,
    ledgerRef: dispatchEvent.ledgerRef,
    eventCount: dispatchEvent.eventCount,
  };
}

export async function runTopicRunner(projectRoot, options, deps = {}) {
  const maxSteps = Number.isInteger(options.maxSteps) && options.maxSteps > 0
    ? options.maxSteps
    : 20;
  const steps = [];
  for (let index = 0; index < maxSteps; index += 1) {
    const step = await runTopicRunnerStep(projectRoot, options, deps);
    steps.push(step);
    if (!step.ok || step.runnerStatus !== "continued") {
      return {
        ...step,
        mode: "run",
        steps,
        stepCount: steps.length,
      };
    }
  }

  const recordedAt = options.verifiedAt ?? utcNowNoMillis();
  const latestStep = steps.at(-1) ?? null;
  const blockedEvent = latestStep?.decisionRef
    ? await recordRunnerBlocked(projectRoot, { ...options, verifiedAt: recordedAt }, {
      sourceRef: latestStep.decisionRef,
      summary: "runner_max_steps_exhausted",
      recordedAt,
      waveId: latestStep.decision?.wave_id ?? null,
      artifactRefs: { decision_ref: latestStep.decisionRef },
    })
    : null;
  const ledger = await buildTopicRunLedger(projectRoot, options.topicInput, options.runId, recordedAt);
  return blockedResult({
    mode: "run",
    topicId: latestStep?.topicId ?? null,
    topicRef: latestStep?.topicRef ?? null,
    runId: options.runId,
    adapter: options.adapter,
    steps,
    stepCount: steps.length,
    ledgerRef: blockedEvent?.ok ? blockedEvent.ledgerRef : ledger.ok ? ledger.ledgerRef : null,
    eventCount: blockedEvent?.ok ? blockedEvent.eventCount : ledger.ok ? ledger.eventCount : null,
  }, `topic-runner refused: max steps exhausted (${maxSteps})`, {
    circuitBreaker: {
      state: "open",
      reason: "max_steps_exhausted",
      maxSteps,
    },
  });
}
