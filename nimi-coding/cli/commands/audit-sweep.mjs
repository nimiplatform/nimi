import {
  buildAuditSweepCloseoutImport,
  buildAuditSweepLedger,
  buildAuditSweepRemediationMap,
  createAuditSweepPlan,
  admitAuditSweepRemediationMap,
  dispatchAuditSweepChunk,
  formatAuditSweepPayload,
  getAuditSweepStatus,
  ingestAuditSweepChunk,
  resolveAuditSweepFinding,
  reviewAuditSweepChunk,
  skipAuditSweepChunk,
  validateAuditSweepArtifacts,
} from "../lib/audit-sweep.mjs";
import { localize } from "../lib/ui.mjs";

function readRequiredValue(args, index, optionName, commandName) {
  const next = args[index + 1];
  if (!next || next.startsWith("--")) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding audit-sweep ${commandName} refused: ${optionName} requires a value.`,
        `nimicoding audit-sweep ${commandName} 已拒绝：${optionName} 需要一个值。`,
      )}\n`,
    };
  }
  return { ok: true, value: next };
}

function unknownOption(commandName, arg) {
  return {
    ok: false,
    error: `${localize(
      `nimicoding audit-sweep ${commandName} refused: unknown option ${arg}.`,
      `nimicoding audit-sweep ${commandName} 已拒绝：未知选项 ${arg}。`,
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
    const [name, config] = entry;
    const value = readRequiredValue(args, index, arg, commandName);
    if (!value.ok) {
      return value;
    }
    if (config.type === "positive-int") {
      const parsed = Number(value.value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding audit-sweep ${commandName} refused: ${arg} must be a positive integer.`,
            `nimicoding audit-sweep ${commandName} 已拒绝：${arg} 必须是正整数。`,
          )}\n`,
        };
      }
      options[name] = parsed;
    } else {
      options[name] = value.value;
    }
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
        `nimicoding audit-sweep ${commandName} refused: missing required options: ${missing.join(", ")}.`,
        `nimicoding audit-sweep ${commandName} 已拒绝：缺少必填选项：${missing.join(", ")}。`,
      )}\n`,
    };
  }

  return { ok: true, options };
}

function parsePlanOptions(args) {
  return parseOptions(args, "plan", {
    root: { flag: "--root", required: true },
    chunkBasis: { flag: "--chunk-basis" },
    criteria: { flag: "--criteria" },
    exclude: { flag: "--exclude" },
    maxFilesPerChunk: { flag: "--max-files", type: "positive-int" },
    sweepId: { flag: "--sweep-id" },
    json: { default: false },
  });
}

function parseChunkDispatchOptions(args) {
  return parseOptions(args, "chunk dispatch", {
    sweepId: { flag: "--sweep-id", required: true },
    chunkId: { flag: "--chunk-id", required: true },
    dispatchedAt: { flag: "--dispatched-at", required: true },
    auditor: { flag: "--auditor" },
    json: { default: false },
  });
}

function parseChunkIngestOptions(args) {
  return parseOptions(args, "chunk ingest", {
    sweepId: { flag: "--sweep-id", required: true },
    chunkId: { flag: "--chunk-id", required: true },
    fromPath: { flag: "--from", required: true },
    verifiedAt: { flag: "--verified-at", required: true },
    json: { default: false },
  });
}

function parseChunkReviewOptions(args) {
  return parseOptions(args, "chunk review", {
    sweepId: { flag: "--sweep-id", required: true },
    chunkId: { flag: "--chunk-id", required: true },
    verdict: { flag: "--verdict", required: true },
    reviewedAt: { flag: "--reviewed-at", required: true },
    reviewer: { flag: "--reviewer" },
    summary: { flag: "--summary" },
    json: { default: false },
  });
}

function parseChunkSkipOptions(args) {
  return parseOptions(args, "chunk skip", {
    sweepId: { flag: "--sweep-id", required: true },
    chunkId: { flag: "--chunk-id", required: true },
    reason: { flag: "--reason", required: true },
    skippedAt: { flag: "--skipped-at", required: true },
    json: { default: false },
  });
}

function parseLedgerBuildOptions(args) {
  return parseOptions(args, "ledger build", {
    sweepId: { flag: "--sweep-id", required: true },
    verifiedAt: { flag: "--verified-at" },
    json: { default: false },
  });
}

function parseRemediationMapBuildOptions(args) {
  return parseOptions(args, "remediation-map build", {
    sweepId: { flag: "--sweep-id", required: true },
    verifiedAt: { flag: "--verified-at" },
    maxFindingsPerWave: { flag: "--max-findings", type: "positive-int" },
    json: { default: false },
  });
}

function parseRemediationMapAdmitOptions(args) {
  return parseOptions(args, "remediation-map admit", {
    sweepId: { flag: "--sweep-id", required: true },
    topicId: { flag: "--topic-id", required: true },
    json: { default: false },
  });
}

function parseFindingResolveOptions(args) {
  return parseOptions(args, "finding resolve", {
    sweepId: { flag: "--sweep-id", required: true },
    findingId: { flag: "--finding-id", required: true },
    disposition: { flag: "--disposition", required: true },
    fromPath: { flag: "--from", required: true },
    verifiedAt: { flag: "--verified-at", required: true },
    json: { default: false },
  });
}

function parseSweepIdOptions(args, commandName, timestampRequired = false) {
  return parseOptions(args, commandName, {
    sweepId: { flag: "--sweep-id", required: true },
    verifiedAt: { flag: "--verified-at", required: timestampRequired },
    json: { default: false },
  });
}

function parseValidateOptions(args) {
  return parseOptions(args, "validate", {
    sweepId: { flag: "--sweep-id", required: true },
    scope: { flag: "--scope", default: "all" },
    json: { default: false },
  });
}

function parseAuditSweepOptions(args) {
  const [command, subcommand] = args;
  if (command === "plan") {
    return { ok: true, action: "plan", parsed: parsePlanOptions(args.slice(1)) };
  }
  if (command === "chunk" && subcommand === "dispatch") {
    return { ok: true, action: "chunk-dispatch", parsed: parseChunkDispatchOptions(args.slice(2)) };
  }
  if (command === "chunk" && subcommand === "ingest") {
    return { ok: true, action: "chunk-ingest", parsed: parseChunkIngestOptions(args.slice(2)) };
  }
  if (command === "chunk" && subcommand === "review") {
    return { ok: true, action: "chunk-review", parsed: parseChunkReviewOptions(args.slice(2)) };
  }
  if (command === "chunk" && subcommand === "skip") {
    return { ok: true, action: "chunk-skip", parsed: parseChunkSkipOptions(args.slice(2)) };
  }
  if (command === "ledger" && subcommand === "build") {
    return { ok: true, action: "ledger-build", parsed: parseLedgerBuildOptions(args.slice(2)) };
  }
  if (command === "remediation-map" && subcommand === "build") {
    return { ok: true, action: "remediation-map-build", parsed: parseRemediationMapBuildOptions(args.slice(2)) };
  }
  if (command === "remediation-map" && subcommand === "admit") {
    return { ok: true, action: "remediation-map-admit", parsed: parseRemediationMapAdmitOptions(args.slice(2)) };
  }
  if (command === "finding" && subcommand === "resolve") {
    return { ok: true, action: "finding-resolve", parsed: parseFindingResolveOptions(args.slice(2)) };
  }
  if (command === "closeout" && subcommand === "summary") {
    return { ok: true, action: "closeout-summary", parsed: parseSweepIdOptions(args.slice(2), "closeout summary", true) };
  }
  if (command === "status") {
    return { ok: true, action: "status", parsed: parseSweepIdOptions(args.slice(1), "status") };
  }
  if (command === "validate") {
    return { ok: true, action: "validate", parsed: parseValidateOptions(args.slice(1)) };
  }

  return {
    ok: false,
    error: `${localize(
      "nimicoding audit-sweep refused: expected one of `plan`, `chunk dispatch`, `chunk ingest`, `chunk review`, `chunk skip`, `ledger build`, `remediation-map build`, `remediation-map admit`, `finding resolve`, `closeout summary`, `status`, or `validate`.",
      "nimicoding audit-sweep 已拒绝：需要使用 `plan`、`chunk dispatch`、`chunk ingest`、`chunk review`、`chunk skip`、`ledger build`、`remediation-map build`、`remediation-map admit`、`finding resolve`、`closeout summary`、`status` 或 `validate`。",
    )}\n`,
  };
}

export async function runAuditSweep(args) {
  const selected = parseAuditSweepOptions(args);
  if (!selected.ok) {
    process.stderr.write(selected.error);
    return 2;
  }
  if (!selected.parsed.ok) {
    process.stderr.write(selected.parsed.error);
    return 2;
  }

  const runners = {
    plan: createAuditSweepPlan,
    "chunk-dispatch": dispatchAuditSweepChunk,
    "chunk-ingest": ingestAuditSweepChunk,
    "chunk-review": reviewAuditSweepChunk,
    "chunk-skip": skipAuditSweepChunk,
    "ledger-build": buildAuditSweepLedger,
    "remediation-map-build": buildAuditSweepRemediationMap,
    "remediation-map-admit": admitAuditSweepRemediationMap,
    "finding-resolve": resolveAuditSweepFinding,
    "closeout-summary": buildAuditSweepCloseoutImport,
    status: getAuditSweepStatus,
    validate: validateAuditSweepArtifacts,
  };
  const payload = await runners[selected.action](process.cwd(), selected.parsed.options);
  if (payload.inputError) {
    process.stderr.write(payload.error);
    return payload.exitCode;
  }
  if (selected.parsed.options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(formatAuditSweepPayload(payload));
  }
  return payload.exitCode;
}

export {
  parseAuditSweepOptions,
  parseChunkDispatchOptions,
  parseChunkIngestOptions,
  parseChunkReviewOptions,
  parseChunkSkipOptions,
  parseFindingResolveOptions,
  parsePlanOptions,
  parseRemediationMapAdmitOptions,
  parseRemediationMapBuildOptions,
  parseValidateOptions,
};
