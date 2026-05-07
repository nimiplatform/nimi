import {
  runAuditorPrompt,
  runFinalize,
  runFixTopic,
  runIntake,
  runLedgerValidate,
  runPacketBuild,
  runPacketBuildBatch,
  runResultIngest,
  runWavePlan,
} from "../lib/sweep-design.mjs";
import { localize } from "../lib/ui.mjs";

function readRequiredValue(args, index, optionName, commandName) {
  const next = args[index + 1];
  if (!next || next.startsWith("--")) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding sweep design ${commandName} refused: ${optionName} requires a value.`,
        `nimicoding sweep design ${commandName} 已拒绝：${optionName} 需要一个值。`,
      )}\n`,
    };
  }
  return { ok: true, value: next };
}

function unknownOption(commandName, arg) {
  return {
    ok: false,
    error: `${localize(
      `nimicoding sweep design ${commandName} refused: unknown option ${arg}.`,
      `nimicoding sweep design ${commandName} 已拒绝：未知选项 ${arg}。`,
    )}\n`,
  };
}

function parseOptions(args, commandName, spec) {
  const options = Object.fromEntries(Object.entries(spec).map(([name, config]) => [name, config.default ?? null]));
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    const entry = Object.entries(spec).find(([, config]) => config.flag === arg);
    if (!entry) {
      return unknownOption(commandName, arg);
    }
    const [name] = entry;
    if (entry[1].type === "boolean") {
      options[name] = true;
      continue;
    }
    const value = readRequiredValue(args, index, arg, commandName);
    if (!value.ok) return value;
    options[name] = value.value;
    index += 1;
  }
  const missing = Object.entries(spec)
    .filter(([, config]) => config.required)
    .filter(([name]) => !options[name])
    .map(([, config]) => config.flag);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding sweep design ${commandName} refused: missing required options: ${missing.join(", ")}.`,
        `nimicoding sweep design ${commandName} 已拒绝：缺少必填选项：${missing.join(", ")}。`,
      )}\n`,
    };
  }
  return { ok: true, options };
}

function parseSweepDesignOptions(args) {
  const [phase] = args;
  if (phase === "intake") {
    return {
      ok: true,
      action: "intake",
      parsed: parseOptions(args.slice(1), "intake", {
        sweepId: { flag: "--sweep-id", required: true },
        runId: { flag: "--run-id" },
        verifiedAt: { flag: "--verified-at" },
        json: { default: false },
      }),
    };
  }
  if (phase === "packet-build") {
    return {
      ok: true,
      action: "packet-build",
      parsed: parseOptions(args.slice(1), "packet-build", {
        runId: { flag: "--run-id", required: true },
        packetId: { flag: "--packet-id", required: true },
        findingId: { flag: "--finding-id" },
        findingIds: { flag: "--finding-ids" },
        explicitQuestion: { flag: "--explicit-question" },
        explicitQuestions: { flag: "--explicit-questions" },
        priorDesignStateRefs: { flag: "--prior-design-state-refs" },
        priorDesignStateMarker: { flag: "--prior-design-state-marker" },
        currentClusterRefs: { flag: "--current-cluster-refs" },
        currentWaveRefs: { flag: "--current-wave-refs" },
        authorityOnly: { flag: "--authority-only", type: "boolean", default: false },
        verifiedAt: { flag: "--verified-at" },
        json: { default: false },
      }),
    };
  }
  if (phase === "packet-build-batch") {
    return {
      ok: true,
      action: "packet-build-batch",
      parsed: parseOptions(args.slice(1), "packet-build-batch", {
        runId: { flag: "--run-id", required: true },
        batchSize: { flag: "--batch-size", required: true },
        findingIds: { flag: "--finding-ids" },
        packetPrefix: { flag: "--packet-prefix" },
        manifestId: { flag: "--manifest-id" },
        explicitQuestion: { flag: "--explicit-question" },
        explicitQuestions: { flag: "--explicit-questions" },
        priorDesignStateRefs: { flag: "--prior-design-state-refs" },
        priorDesignStateMarker: { flag: "--prior-design-state-marker" },
        currentClusterRefs: { flag: "--current-cluster-refs" },
        currentWaveRefs: { flag: "--current-wave-refs" },
        authorityOnly: { flag: "--authority-only", type: "boolean", default: false },
        verifiedAt: { flag: "--verified-at" },
        json: { default: false },
      }),
    };
  }
  if (phase === "result-ingest") {
    return {
      ok: true,
      action: "result-ingest",
      parsed: parseOptions(args.slice(1), "result-ingest", {
        runId: { flag: "--run-id", required: true },
        from: { flag: "--from", required: true },
        mode: { flag: "--mode", default: "focused" },
        allowSyntheticTrial: { flag: "--allow-synthetic-trial", type: "boolean", default: false },
        verifiedAt: { flag: "--verified-at" },
        json: { default: false },
      }),
    };
  }
  if (phase === "auditor-prompt") {
    return {
      ok: true,
      action: "auditor-prompt",
      parsed: parseOptions(args.slice(1), "auditor-prompt", {
        runId: { flag: "--run-id", required: true },
        packetId: { flag: "--packet-id", required: true },
        verifiedAt: { flag: "--verified-at" },
        json: { default: false },
      }),
    };
  }
  if (phase === "finalize") {
    return {
      ok: true,
      action: "finalize",
      parsed: parseOptions(args.slice(1), "finalize", {
        runId: { flag: "--run-id", required: true },
        allowSyntheticCloseout: { flag: "--allow-synthetic-closeout", type: "boolean", default: false },
        verifiedAt: { flag: "--verified-at" },
        json: { default: false },
      }),
    };
  }
  if (phase === "ledger-validate") {
    return {
      ok: true,
      action: "ledger-validate",
      parsed: parseOptions(args.slice(1), "ledger-validate", {
        runId: { flag: "--run-id", required: true },
        verifiedAt: { flag: "--verified-at" },
        json: { default: false },
      }),
    };
  }
  if (phase === "wave-plan") {
    return {
      ok: true,
      action: "wave-plan",
      parsed: parseOptions(args.slice(1), "wave-plan", {
        runId: { flag: "--run-id", required: true },
        topicId: { flag: "--topic-id", required: true },
        allowSyntheticTrial: { flag: "--allow-synthetic-trial", type: "boolean", default: false },
        verifiedAt: { flag: "--verified-at" },
        json: { default: false },
      }),
    };
  }
  if (phase === "fix-topic") {
    return {
      ok: true,
      action: "fix-topic",
      parsed: parseOptions(args.slice(1), "fix-topic", {
        runId: { flag: "--run-id", required: true },
        slug: { flag: "--slug" },
        title: { flag: "--title" },
        admitFirstWave: { flag: "--admit-first-wave", type: "boolean", default: false },
        admitWaveId: { flag: "--admit-wave-id" },
        verifiedAt: { flag: "--verified-at" },
        json: { default: false },
      }),
    };
  }
  return {
    ok: false,
    error: `${localize(
      "nimicoding sweep design refused: expected intake, packet-build, packet-build-batch, auditor-prompt, result-ingest, ledger-validate, finalize, wave-plan, or fix-topic.",
      "nimicoding sweep design 已拒绝：需要 intake、packet-build、packet-build-batch、auditor-prompt、result-ingest、ledger-validate、finalize、wave-plan 或 fix-topic。",
    )}\n`,
  };
}

function emitResult(result, json) {
  if (result.inputError) {
    process.stderr.write(result.error);
    return result.exitCode ?? 2;
  }
  if (!result.ok) {
    process.stderr.write(result.error ?? "nimicoding sweep design failed.\n");
    return result.exitCode ?? 1;
  }
  if (json) {
    process.stdout.write(`${JSON.stringify({ command: "sweep.design", ...result }, null, 2)}\n`);
  } else {
    const lines = ["sweep design result"];
    for (const [label, value] of [
      ["run", result.runId],
      ["inventory", result.inventoryRef],
      ["ledger", result.ledgerRef],
      ["packet", result.packetRef],
      ["auditor prompt", result.promptRef],
      ["auditor result", result.resultRef],
      ["decision queue", result.decisionQueueRef],
      ["final state report", result.finalStateReportRef],
      ["wave plan", result.wavePlanRef],
      ["topic", result.topicRef],
      ["sweep fix source", result.sourceRef],
      ["wave catalog", result.waveCatalogRef],
    ]) {
      if (value !== undefined && value !== null) {
        lines.push(`${label}: ${value}`);
      }
    }
    for (const [label, value] of [
      ["findings", result.findingCount],
      ["finding outcomes", result.findingOutcomeCount],
      ["revision entries", result.revisionEntryCount],
      ["total findings", result.totalFindingCount],
      ["final findings", result.finalFindingCount],
      ["transient findings", result.transientFindingCount],
      ["waves", result.waveCount],
      ["admitted wave", result.admittedWaveId],
      ["stop class", result.stopClass],
      ["stop reason", result.stopReason],
    ]) {
      if (value !== undefined && value !== null) {
        lines.push(`${label}: ${value}`);
      }
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  }
  return result.exitCode ?? 0;
}

export async function runSweepDesign(args) {
  const parsedAction = parseSweepDesignOptions(args);
  if (!parsedAction.ok) {
    process.stderr.write(parsedAction.error);
    return 2;
  }
  if (!parsedAction.parsed.ok) {
    process.stderr.write(parsedAction.parsed.error);
    return 2;
  }
  const options = parsedAction.parsed.options;
  const projectRoot = process.cwd();
  const actions = {
    intake: runIntake,
    "packet-build": runPacketBuild,
    "packet-build-batch": runPacketBuildBatch,
    "auditor-prompt": runAuditorPrompt,
    "result-ingest": runResultIngest,
    "ledger-validate": runLedgerValidate,
    finalize: runFinalize,
    "wave-plan": runWavePlan,
    "fix-topic": runFixTopic,
  };
  return emitResult(await actions[parsedAction.action](projectRoot, options), options.json);
}
