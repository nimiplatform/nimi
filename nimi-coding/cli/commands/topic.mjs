import process from "node:process";
import {
  addWaveToTopic,
  closeoutTopicInTopic,
  closeoutWaveInTopic,
  continueTopicOverflow,
  createDecisionReview,
  admitWaveInTopic,
  createTopic,
  decideTopicNextStep,
  deriveCreateDefaults,
  dispatchTopicPacket,
  freezePacketForTopic,
  holdTopicInPending,
  initTopicRunLedger,
  loadTopicRuntimeAuthority,
  openTopicRemediation,
  readTopicRunLedger,
  recordTopicResult,
  recordTopicRunEvent,
  resumePendingTopic,
  buildTopicRunLedger,
  runTopicTrueCloseAudit,
  resolveTopicProjectRoot,
  selectWaveInTopic,
  validateWaveClosure,
  validateTopicGraph,
  validateTopicRoot,
  validateWaveAdmission,
} from "../lib/topic.mjs";
import { localize } from "../lib/ui.mjs";
import {
  buildJsonReport,
  formatAdmissionValidate,
  formatCloseout,
  formatClosureValidate,
  formatDecisionReview,
  formatDispatch,
  formatGraphValidate,
  formatNextStep,
  formatOverflowContinuation,
  formatPacketFreeze,
  formatPendingTransition,
  formatRemediation,
  formatResultRecord,
  formatRunLedger,
  formatTopicCreate,
  formatTopicStatus,
  formatTopicValidate,
  formatTrueCloseAudit,
  formatWaveMutation,
  writeJson,
} from "./topic-formatters.mjs";
import {
  parseCloseoutOptions,
  parseDecisionReviewOptions,
  parseDispatchOptions,
  parseGraphValidateOptions,
  parseOverflowContinueOptions,
  parsePacketFreezeOptions,
  parseRemediationOpenOptions,
  parseResultRecordOptions,
  parseRunLedgerOptions,
  parseRunNextStepOptions,
  parseTopicCreateOptions,
  parseTopicHoldOptions,
  parseTopicReadOptions,
  parseTopicResumeOptions,
  parseTrueCloseAuditOptions,
  parseWaveActionOptions,
  parseWaveAddOptions,
} from "./topic-options.mjs";
function validateEnumOption(name, value, allowed, errorPrefix) {
  if (!allowed.includes(value)) {
    return {
      ok: false,
      error: `${localize(
        `${errorPrefix}: unsupported ${name} value ${value}.`,
        `${errorPrefix}：不支持的 ${name} 值 ${value}。`,
      )}\n`,
    };
  }
  return { ok: true };
}
async function runTopicCreate(args) {
  const parsed = parseTopicCreateOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  const createEnumChecks = [
    ["--mode", parsed.options.mode, authority.topicEnums.mode],
    ["--posture", parsed.options.posture, authority.topicEnums.posture],
    ["--design-policy", parsed.options.designPolicy, authority.topicEnums.designPolicy],
    ["--parallel-truth", parsed.options.parallelTruth, authority.topicEnums.parallelTruth],
    ["--layering", parsed.options.layering, authority.topicEnums.layering],
    ["--risk", parsed.options.risk, authority.topicEnums.risk],
    ["--applicability", parsed.options.applicability, authority.topicEnums.applicability],
    ["--execution-mode", parsed.options.executionMode, authority.topicEnums.executionMode],
  ];
  for (const [flag, value, allowed] of createEnumChecks) {
    if (value === null) {
      continue;
    }
    const enumCheck = validateEnumOption(flag, value, allowed, "nimicoding topic create refused");
    if (!enumCheck.ok) {
      process.stderr.write(enumCheck.error);
      return 2;
    }
  }
  const defaults = deriveCreateDefaults(parsed.options);
  const createReport = await createTopic(projectRoot, {
    ...parsed.options,
    ...defaults,
    title: parsed.options.title ?? parsed.options.slug
      .replace(/^\d{4}-\d{2}-\d{2}-/, "")
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
  });
  if (!createReport.ok) {
    process.stderr.write(`${createReport.error}\n`);
    return 1;
  }
  if (parsed.options.json) {
    writeJson(buildJsonReport("topic.create", createReport));
  } else {
    process.stdout.write(formatTopicCreate(createReport));
  }
  return 0;
}
async function runTopicStatus(args) {
  const parsed = parseTopicReadOptions(args, "status");
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const report = await validateTopicRoot(projectRoot, parsed.options.input);
  if (parsed.options.json) {
    writeJson(buildJsonReport("topic.status", report));
  } else if (report.ok) {
    process.stdout.write(formatTopicStatus(report));
  } else {
    process.stderr.write(`${report.error}\n`);
  }
  return report.ok ? 0 : 1;
}
async function runTopicNextStep(args) {
  const parsed = parseRunNextStepOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const report = await decideTopicNextStep(projectRoot, parsed.options.topicInput);
  if (!report.ok) {
    process.stderr.write(`${report.error}\n`);
    return 1;
  }
  if (parsed.options.json) {
    writeJson(buildJsonReport("topic.run-next-step", report));
  } else {
    process.stdout.write(formatNextStep(report));
  }
  return 0;
}
async function runTopicRunLedger(args) {
  const parsed = parseRunLedgerOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const options = parsed.options;
  let report;
  if (options.action === "init") {
    report = await initTopicRunLedger(projectRoot, options.topicInput, options.runId);
  } else if (options.action === "record") {
    report = await recordTopicRunEvent(projectRoot, options.topicInput, {
      runId: options.runId,
      eventKind: options.eventKind,
      stopClass: options.stopClass,
      recommendedAction: options.recommendedAction,
      sourceRef: options.sourceRef,
      summary: options.summary,
      recordedAt: options.verifiedAt,
      waveId: options.waveId,
      artifactRefs: options.artifactRefs,
    });
  } else if (options.action === "build") {
    report = await buildTopicRunLedger(projectRoot, options.topicInput, options.runId);
  } else {
    report = await readTopicRunLedger(projectRoot, options.topicInput, options.runId);
  }
  if (!report.ok) {
    process.stderr.write(`${report.error}\n`);
    return 1;
  }
  if (options.json) {
    writeJson(buildJsonReport(`topic.run-ledger.${options.action}`, report));
  } else {
    process.stdout.write(formatRunLedger(report, options.action));
  }
  return 0;
}
async function runTopicHold(args) {
  const parsed = parseTopicHoldOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const report = await holdTopicInPending(projectRoot, parsed.options.topicInput, parsed.options);
  if (!report.ok) {
    process.stderr.write(`${report.error}\n`);
    return 1;
  }
  if (parsed.options.json) {
    writeJson(buildJsonReport("topic.hold", report));
  } else {
    process.stdout.write(formatPendingTransition(report, "hold"));
  }
  return 0;
}
async function runTopicResume(args) {
  const parsed = parseTopicResumeOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const report = await resumePendingTopic(projectRoot, parsed.options.topicInput, parsed.options);
  if (!report.ok) {
    process.stderr.write(`${report.error}\n`);
    return 1;
  }
  if (parsed.options.json) {
    writeJson(buildJsonReport("topic.resume", report));
  } else {
    process.stdout.write(formatPendingTransition(report, "resume"));
  }
  return 0;
}
async function runTopicValidate(args) {
  if (args[0] === "graph") {
    const parsed = parseGraphValidateOptions(args.slice(1), "validate graph");
    if (!parsed.ok) {
      process.stderr.write(parsed.error);
      return 2;
    }
    const projectRoot = await resolveTopicProjectRoot(process.cwd());
    const report = await validateTopicGraph(projectRoot, parsed.options.topicInput);
    if (parsed.options.json) {
      writeJson(buildJsonReport("topic.validate.graph", report));
    } else if (report.topicId) {
      process.stdout.write(formatGraphValidate(report));
    } else {
      process.stderr.write(`${report.error}\n`);
    }
    return report.ok ? 0 : 1;
  }
  if (args[0] === "admission") {
    const parsed = parseGraphValidateOptions(args.slice(1), "validate admission");
    if (!parsed.ok) {
      process.stderr.write(parsed.error);
      return 2;
    }
    if (!parsed.options.topicInput || !parsed.options.waveId) {
      process.stderr.write(`${localize(
        "nimicoding topic validate admission refused: expected <topic-id> <wave-id>.",
        "nimicoding topic validate admission 已拒绝：需要 <topic-id> <wave-id>。",
      )}\n`);
      return 2;
    }
    const projectRoot = await resolveTopicProjectRoot(process.cwd());
    const report = await validateWaveAdmission(projectRoot, parsed.options.topicInput, parsed.options.waveId);
    if (parsed.options.json) {
      writeJson(buildJsonReport("topic.validate.admission", report));
    } else {
      if (report.topicId) {
        process.stdout.write(formatAdmissionValidate(report, parsed.options.waveId));
      } else {
        process.stderr.write(`${report.error}\n`);
      }
    }
    return report.ok ? 0 : 1;
  }
  if (args[0] === "closure") {
    const parsed = parseGraphValidateOptions(args.slice(1), "validate closure");
    if (!parsed.ok) {
      process.stderr.write(parsed.error);
      return 2;
    }
    if (!parsed.options.topicInput || !parsed.options.waveId) {
      process.stderr.write(`${localize(
        "nimicoding topic validate closure refused: expected <topic-id> <wave-id>.",
        "nimicoding topic validate closure 已拒绝：需要 <topic-id> <wave-id>。",
      )}\n`);
      return 2;
    }
    const projectRoot = await resolveTopicProjectRoot(process.cwd());
    const report = await validateWaveClosure(projectRoot, parsed.options.topicInput, parsed.options.waveId);
    if (parsed.options.json) {
      writeJson(buildJsonReport("topic.validate.closure", report));
    } else if (report.topicId) {
      process.stdout.write(formatClosureValidate(report, parsed.options.waveId));
    } else {
      process.stderr.write(`${report.error}\n`);
    }
    return report.ok ? 0 : 1;
  }
  const parsed = parseTopicReadOptions(args, "validate");
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const report = await validateTopicRoot(projectRoot, parsed.options.input);
  if (parsed.options.json) {
    writeJson(buildJsonReport("topic.validate", report));
  } else if (report.ok) {
    process.stdout.write(formatTopicValidate(report));
  } else {
    process.stderr.write(`${report.error}\n`);
  }
  return report.ok ? 0 : 1;
}
async function runTopicWave(args) {
  const [action, ...rest] = args;
  if (!action) {
    process.stderr.write(`${localize(
      "nimicoding topic wave refused: expected `add`, `select`, or `admit`.",
      "nimicoding topic wave 已拒绝：需要 `add`、`select` 或 `admit`。",
    )}\n`);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  if (action === "add") {
    const parsed = parseWaveAddOptions(rest);
    if (!parsed.ok) {
      process.stderr.write(parsed.error);
      return 2;
    }
    const report = await addWaveToTopic(projectRoot, parsed.options.topicInput, {
      wave_id: parsed.options.waveId,
      slug: parsed.options.slug,
      state: "candidate",
      primary_closure_goal: parsed.options.goal,
      deps: parsed.options.deps,
      owner_domain: parsed.options.ownerDomain,
      parallelizable_after: parsed.options.parallelizableAfter,
      selected: false,
    });
    if (!report.ok) {
      process.stderr.write(`${report.error}\n`);
      return 1;
    }
    if (parsed.options.json) {
      writeJson(buildJsonReport("topic.wave.add", report));
    } else {
      process.stdout.write(formatWaveMutation(report, "wave add"));
    }
    return 0;
  }
  if (action === "select") {
    const parsed = parseWaveActionOptions(rest, "select");
    if (!parsed.ok) {
      process.stderr.write(parsed.error);
      return 2;
    }
    const report = await selectWaveInTopic(projectRoot, parsed.options.topicInput, parsed.options.waveId);
    if (!report.ok) {
      process.stderr.write(`${report.error}\n`);
      return 1;
    }
    if (parsed.options.json) {
      writeJson(buildJsonReport("topic.wave.select", report));
    } else {
      process.stdout.write(formatWaveMutation(report, "wave select"));
    }
    return 0;
  }
  if (action === "admit") {
    const parsed = parseWaveActionOptions(rest, "admit");
    if (!parsed.ok) {
      process.stderr.write(parsed.error);
      return 2;
    }
    const report = await admitWaveInTopic(projectRoot, parsed.options.topicInput, parsed.options.waveId);
    if (!report.ok) {
      if (parsed.options.json) {
        writeJson(buildJsonReport("topic.wave.admit", report));
      } else if (report.checks) {
        process.stdout.write(formatAdmissionValidate(report, parsed.options.waveId));
      } else {
        process.stderr.write(`${report.error}\n`);
      }
      return 1;
    }
    if (parsed.options.json) {
      writeJson(buildJsonReport("topic.wave.admit", report));
    } else {
      process.stdout.write(formatWaveMutation(report, "wave admit"));
    }
    return 0;
  }
  process.stderr.write(`${localize(
    `nimicoding topic wave refused: unknown subcommand ${action}.`,
    `nimicoding topic wave 已拒绝：未知子命令 ${action}。`,
  )}\n`);
  return 2;
}
async function runTopicPacket(args) {
  const [action, ...rest] = args;
  if (action !== "freeze") {
    process.stderr.write(`${localize(
      "nimicoding topic packet refused: expected `freeze`.",
      "nimicoding topic packet 已拒绝：需要 `freeze`。",
    )}\n`);
    return 2;
  }
  const parsed = parsePacketFreezeOptions(rest);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const report = await freezePacketForTopic(projectRoot, parsed.options.topicInput, parsed.options.from);
  if (!report.ok) {
    process.stderr.write(`${report.error}\n`);
    return 1;
  }
  if (parsed.options.json) {
    writeJson(buildJsonReport("topic.packet.freeze", report));
  } else {
    process.stdout.write(formatPacketFreeze(report));
  }
  return 0;
}
async function runTopicDispatch(args, role) {
  const parsed = parseDispatchOptions(args, role);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const report = await dispatchTopicPacket(projectRoot, parsed.options.topicInput, parsed.options.packetId, role);
  if (!report.ok) {
    process.stderr.write(`${report.error}\n`);
    return 1;
  }
  if (parsed.options.json) {
    writeJson(buildJsonReport(`topic.${role}.dispatch`, report));
  } else {
    process.stdout.write(formatDispatch(report));
  }
  return 0;
}
async function runTopicRole(args, role) {
  const [action, ...rest] = args;
  if (action !== "dispatch") {
    process.stderr.write(`${localize(
      `nimicoding topic ${role} refused: expected \`dispatch\`.`,
      `nimicoding topic ${role} 已拒绝：需要 \`dispatch\`。`,
    )}\n`);
    return 2;
  }
  return runTopicDispatch(rest, role);
}
async function runTopicResult(args) {
  const [action, ...rest] = args;
  if (action !== "record") {
    process.stderr.write(`${localize(
      "nimicoding topic result refused: expected `record`.",
      "nimicoding topic result 已拒绝：需要 `record`。",
    )}\n`);
    return 2;
  }
  const parsed = parseResultRecordOptions(rest);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  const verdictCheck = validateEnumOption(
    "--verdict",
    parsed.options.verdict,
    authority.resultVerdicts,
    "nimicoding topic result record refused",
  );
  if (!verdictCheck.ok) {
    process.stderr.write(verdictCheck.error);
    return 2;
  }
  const kindCheck = validateEnumOption(
    "--kind",
    parsed.options.kind,
    authority.resultKinds,
    "nimicoding topic result record refused",
  );
  if (!kindCheck.ok) {
    process.stderr.write(kindCheck.error);
    return 2;
  }
  const report = await recordTopicResult(
    projectRoot,
    parsed.options.topicInput,
    parsed.options.kind,
    parsed.options.verdict,
    parsed.options.from,
    parsed.options.verifiedAt,
  );
  if (!report.ok) {
    process.stderr.write(`${report.error}\n`);
    return 1;
  }
  if (parsed.options.json) {
    writeJson(buildJsonReport("topic.result.record", report));
  } else {
    process.stdout.write(formatResultRecord(report));
  }
  return 0;
}
async function runTopicDecisionReview(args) {
  const parsed = parseDecisionReviewOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  const dispositionCheck = validateEnumOption(
    "--disposition",
    parsed.options.disposition,
    authority.decisionDispositions,
    "nimicoding topic decision-review refused",
  );
  if (!dispositionCheck.ok) {
    process.stderr.write(dispositionCheck.error);
    return 2;
  }
  const report = await createDecisionReview(projectRoot, parsed.options.topicInput, parsed.options.slug, {
    date: parsed.options.date,
    decision: parsed.options.decision,
    replacedScope: parsed.options.replacedScope,
    activeReplacementScope: parsed.options.activeReplacementScope,
    disposition: parsed.options.disposition,
    targetWaveId: parsed.options.targetWaveId,
  });
  if (!report.ok) {
    process.stderr.write(`${report.error}\n`);
    return 1;
  }
  if (parsed.options.json) {
    writeJson(buildJsonReport("topic.decision-review", report));
  } else {
    process.stdout.write(formatDecisionReview(report));
  }
  return 0;
}
async function runTopicRemediation(args) {
  const [action, ...rest] = args;
  if (action !== "open") {
    process.stderr.write(`${localize(
      "nimicoding topic remediation refused: expected `open`.",
      "nimicoding topic remediation 已拒绝：需要 `open`。",
    )}\n`);
    return 2;
  }
  const parsed = parseRemediationOpenOptions(rest);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  const kindCheck = validateEnumOption(
    "--kind",
    parsed.options.kind,
    authority.remediationKinds,
    "nimicoding topic remediation open refused",
  );
  if (!kindCheck.ok) {
    process.stderr.write(kindCheck.error);
    return 2;
  }
  const report = await openTopicRemediation(projectRoot, parsed.options.topicInput, {
    kind: parsed.options.kind,
    reason: parsed.options.reason,
    overflowedPacketId: parsed.options.overflowedPacketId,
  });
  if (!report.ok) {
    process.stderr.write(`${report.error}\n`);
    return 1;
  }
  if (parsed.options.json) {
    writeJson(buildJsonReport("topic.remediation.open", report));
  } else {
    process.stdout.write(formatRemediation(report));
  }
  return 0;
}
async function runTopicOverflow(args) {
  const [action, ...rest] = args;
  if (action !== "continue") {
    process.stderr.write(`${localize(
      "nimicoding topic overflow refused: expected `continue`.",
      "nimicoding topic overflow 已拒绝：需要 `continue`。",
    )}\n`);
    return 2;
  }
  const parsed = parseOverflowContinueOptions(rest);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const report = await continueTopicOverflow(projectRoot, parsed.options.topicInput, {
    continuationPacketId: parsed.options.continuationPacketId,
    overflowedPacketId: parsed.options.overflowedPacketId,
    managerJudgement: parsed.options.managerJudgement,
    sameOwnerDomain: parsed.options.sameOwnerDomain,
  });
  if (!report.ok) {
    process.stderr.write(`${report.error}\n`);
    return 1;
  }
  if (parsed.options.json) {
    writeJson(buildJsonReport("topic.overflow.continue", report));
  } else {
    process.stdout.write(formatOverflowContinuation(report));
  }
  return 0;
}
async function runTopicCloseout(args) {
  const [scope, ...rest] = args;
  if (scope !== "wave" && scope !== "topic") {
    process.stderr.write(`${localize(
      "nimicoding topic closeout refused: expected `wave` or `topic`.",
      "nimicoding topic closeout 已拒绝：需要 `wave` 或 `topic`。",
    )}\n`);
    return 2;
  }
  const parsed = parseCloseoutOptions(rest, scope);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  const closureChecks = [
    ["--authority", parsed.options.authorityClosure],
    ["--semantic", parsed.options.semanticClosure],
    ["--consumer", parsed.options.consumerClosure],
    ["--drift-resistance", parsed.options.driftResistanceClosure],
  ];
  for (const [flag, value] of closureChecks) {
    const enumCheck = validateEnumOption(flag, value, authority.closureStates, `nimicoding topic closeout ${scope} refused`);
    if (!enumCheck.ok) {
      process.stderr.write(enumCheck.error);
      return 2;
    }
  }
  const dispositionCheck = validateEnumOption(
    "--disposition",
    parsed.options.disposition,
    authority.closeoutDispositions,
    `nimicoding topic closeout ${scope} refused`,
  );
  if (!dispositionCheck.ok) {
    process.stderr.write(dispositionCheck.error);
    return 2;
  }
  if (scope === "wave") {
    const report = await closeoutWaveInTopic(projectRoot, parsed.options.topicInput, parsed.options.waveId, parsed.options);
    if (!report.ok) {
      if (parsed.options.json) {
        writeJson(buildJsonReport("topic.closeout.wave", report));
      } else if (report.checks) {
        process.stdout.write(formatClosureValidate(report, parsed.options.waveId));
      } else {
        process.stderr.write(`${report.error}\n`);
      }
      return 1;
    }
    if (parsed.options.json) {
      writeJson(buildJsonReport("topic.closeout.wave", report));
    } else {
      process.stdout.write(formatCloseout(report, "wave"));
    }
    return 0;
  }
  const report = await closeoutTopicInTopic(projectRoot, parsed.options.topicInput, parsed.options);
  if (!report.ok) {
    if (parsed.options.json) {
      writeJson(buildJsonReport("topic.closeout.topic", report));
    } else if (report.checks) {
      process.stdout.write(formatTrueCloseAudit(report));
    } else {
      process.stderr.write(`${report.error}\n`);
    }
    return 1;
  }
  if (parsed.options.json) {
    writeJson(buildJsonReport("topic.closeout.topic", report));
  } else {
    process.stdout.write(formatCloseout(report, "topic"));
  }
  return 0;
}
async function runTopicTrueCloseAuditCommand(args) {
  const parsed = parseTrueCloseAuditOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }
  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const report = await runTopicTrueCloseAudit(projectRoot, parsed.options.topicInput, parsed.options.judgement);
  if (parsed.options.json) {
    writeJson(buildJsonReport("topic.true-close-audit", report));
  } else if (report.topicId) {
    process.stdout.write(formatTrueCloseAudit(report));
  } else {
    process.stderr.write(`${report.error}\n`);
  }
  return report.ok ? 0 : 1;
}
export async function runTopic(args) {
  const [subcommand, ...rest] = args;
  if (!subcommand) {
    process.stderr.write(`${localize(
      "nimicoding topic refused: expected a subcommand (`create`, `status`, `run-next-step`, `run-ledger`, `validate`, `wave`, `packet`, `worker`, `audit`, `result`, `remediation`, `overflow`, `hold`, `resume`, `closeout`, `true-close-audit`, or `decision-review`).",
      "nimicoding topic 已拒绝：需要子命令（`create`、`status`、`run-next-step`、`run-ledger`、`validate`、`wave`、`packet`、`worker`、`audit`、`result`、`remediation`、`overflow`、`hold`、`resume`、`closeout`、`true-close-audit` 或 `decision-review`）。",
    )}\n`);
    return 2;
  }
  if (subcommand === "create") {
    return runTopicCreate(rest);
  }
  if (subcommand === "status") {
    return runTopicStatus(rest);
  }
  if (subcommand === "run-next-step") {
    return runTopicNextStep(rest);
  }
  if (subcommand === "run-ledger") {
    return runTopicRunLedger(rest);
  }
  if (subcommand === "validate") {
    return runTopicValidate(rest);
  }
  if (subcommand === "wave") {
    return runTopicWave(rest);
  }
  if (subcommand === "packet") {
    return runTopicPacket(rest);
  }
  if (subcommand === "worker") {
    return runTopicRole(rest, "worker");
  }
  if (subcommand === "audit") {
    return runTopicRole(rest, "audit");
  }
  if (subcommand === "result") {
    return runTopicResult(rest);
  }
  if (subcommand === "remediation") {
    return runTopicRemediation(rest);
  }
  if (subcommand === "overflow") {
    return runTopicOverflow(rest);
  }
  if (subcommand === "hold") {
    return runTopicHold(rest);
  }
  if (subcommand === "resume") {
    return runTopicResume(rest);
  }
  if (subcommand === "closeout") {
    return runTopicCloseout(rest);
  }
  if (subcommand === "true-close-audit") {
    return runTopicTrueCloseAuditCommand(rest);
  }
  if (subcommand === "decision-review") {
    return runTopicDecisionReview(rest);
  }
  process.stderr.write(`${localize(
    `nimicoding topic refused: unknown subcommand ${subcommand}.`,
    `nimicoding topic 已拒绝：未知子命令 ${subcommand}。`,
  )}\n`);
  return 2;
}
export { parseTopicCreateOptions, parseTopicReadOptions };
