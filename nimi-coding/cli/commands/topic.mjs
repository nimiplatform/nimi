import process from "node:process";

import {
  addWaveToTopic,
  closeoutTopicInTopic,
  closeoutWaveInTopic,
  continueTopicOverflow,
  createDecisionReview,
  admitWaveInTopic,
  createTopic,
  deriveCreateDefaults,
  dispatchTopicPacket,
  freezePacketForTopic,
  holdTopicInPending,
  loadTopicRuntimeAuthority,
  openTopicRemediation,
  recordTopicResult,
  resumePendingTopic,
  runTopicTrueCloseAudit,
  resolveTopicProjectRoot,
  selectWaveInTopic,
  validateWaveClosure,
  validateTopicGraph,
  validateTopicId,
  validateTopicRoot,
  validateTopicSlug,
  validateWaveAdmission,
  validateWaveId,
} from "../lib/topic.mjs";
import {
  localize,
  styleHeading,
  styleLabel,
  styleMuted,
} from "../lib/ui.mjs";

const TOPIC_RESULT_KIND_INPUT_ENUM = ["worker", "implementation", "audit", "preflight", "judgement"];

function requireOptionValue(name, next, errorPrefix) {
  if (!next || next.startsWith("--")) {
    return {
      ok: false,
      error: `${localize(
        `${errorPrefix}: ${name} requires a value.`,
        `${errorPrefix}：${name} 需要一个值。`,
      )}\n`,
    };
  }

  return { ok: true };
}

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

function buildJsonReport(command, report) {
  return {
    contract: "nimicoding.topic-command-result.v1",
    command,
    ...report,
  };
}

function writeJson(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function formatTopicStatus(report) {
  const lines = [
    styleHeading(`nimicoding topic status: ${report.topicId}`),
    "",
    `${styleLabel(localize("Path", "路径"))}: ${report.topicRef}`,
    `${styleLabel(localize("State", "状态"))}: ${report.state}`,
    `${styleLabel(localize("Schema", "Schema"))}: ${report.schemaMode}`,
    `${styleLabel(localize("Title", "标题"))}: ${report.title ?? localize("none", "无")}`,
    `${styleLabel(localize("Selected Next Target", "当前下一目标"))}: ${report.selectedNextTarget ?? localize("none", "无")}`,
    `${styleLabel(localize("True-Close", "True-Close"))}: ${report.currentTrueCloseStatus ?? localize("none", "无")}`,
    `${styleLabel(localize("Pending Note", "Pending Note"))}: ${report.pendingNoteStatus ?? localize("none", "无")}`,
    `${styleLabel(localize("Migration Posture", "迁移姿态"))}: ${report.migrationPosture ?? localize("none", "无")}`,
    `${styleLabel(localize("Validation Disposition", "校验姿态"))}: ${report.validationDisposition ?? "strict"}`,
    `${styleLabel(localize("Canonical Validated", "Canonical 校验"))}: ${report.canonicalValidated ? "true" : "false"}`,
    `${styleLabel(localize("Ignored By Policy", "策略忽略"))}: ${report.ignoredByPolicy ? "true" : "false"}`,
  ];
  if (report.ignoredByPolicy && report.ignorePolicyReason) {
    lines.push(`${styleLabel(localize("Ignore Reason", "忽略原因"))}: ${report.ignorePolicyReason}`);
  }

  if (report.artifactSummary) {
    lines.push(
      "",
      styleLabel(localize("Artifacts", "Artifacts")),
      `- files=${report.artifactSummary.files} packets=${report.artifactSummary.packets} results=${report.artifactSummary.results} closeouts=${report.artifactSummary.closeouts}`,
      `- decision_reviews=${report.artifactSummary.decision_reviews} remediations=${report.artifactSummary.remediations} overflow_continuations=${report.artifactSummary.overflow_continuations}`,
      `- exec_packs=${report.artifactSummary.exec_packs} true_close_artifacts=${report.artifactSummary.true_close_artifacts}`,
    );
  }

  if (report.featureFlags) {
    lines.push(
      "",
      styleLabel(localize("Feature Flags", "Feature Flags")),
      ...Object.entries(report.featureFlags).map(([key, value]) => `- ${key}: ${value ? "true" : "false"}`),
    );
  }

  if (Array.isArray(report.legacyObservedWaves) && report.legacyObservedWaves.length > 0) {
    lines.push(
      "",
      styleLabel(localize("Observed Waves", "Observed Waves")),
      ...report.legacyObservedWaves.slice(0, 8).map((entry) => (
        `- ${entry.wave_id}: ${entry.observed_lineage} packets=${entry.packets} results=${entry.results} closeouts=${entry.closeouts} exec_packs=${entry.exec_packs}`
      )),
    );
    if (report.legacyObservedWaves.length > 8) {
      lines.push(styleMuted(`- ... ${report.legacyObservedWaves.length - 8} more wave observations`));
    }
  }

  if (report.warnings.length > 0) {
    lines.push(
      "",
      styleLabel(localize("Warnings", "警告")),
      ...report.warnings.map((entry) => styleMuted(`- ${entry}`)),
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatTopicValidate(report) {
  const lines = [
    styleHeading(`nimicoding topic validate: ${report.topicId}`),
    "",
    `${styleLabel(localize("Path", "路径"))}: ${report.topicRef}`,
    `${styleLabel(localize("State", "状态"))}: ${report.state}`,
    `${styleLabel(localize("Schema", "Schema"))}: ${report.schemaMode}`,
    `${styleLabel(localize("Result", "结果"))}: ${report.ok ? localize("ok", "通过") : localize("failed", "失败")}`,
    `${styleLabel(localize("Pending Note", "Pending Note"))}: ${report.pendingNoteStatus ?? localize("none", "无")}`,
    `${styleLabel(localize("Migration Posture", "迁移姿态"))}: ${report.migrationPosture ?? localize("none", "无")}`,
    `${styleLabel(localize("Validation Disposition", "校验姿态"))}: ${report.validationDisposition ?? "strict"}`,
    `${styleLabel(localize("Canonical Validated", "Canonical 校验"))}: ${report.canonicalValidated ? "true" : "false"}`,
    `${styleLabel(localize("Ignored By Policy", "策略忽略"))}: ${report.ignoredByPolicy ? "true" : "false"}`,
    "",
    styleLabel(localize("Checks", "检查项")),
    ...report.checks.map((entry) => `- [${entry.ok ? "ok" : "fail"}] ${entry.id}: ${entry.reason}`),
  ];
  if (report.ignoredByPolicy && report.ignorePolicyReason) {
    lines.push(`${styleLabel(localize("Ignore Reason", "忽略原因"))}: ${report.ignorePolicyReason}`);
  }

  if (report.artifactSummary) {
    lines.push(
      "",
      styleLabel(localize("Artifacts", "Artifacts")),
      `- files=${report.artifactSummary.files} packets=${report.artifactSummary.packets} results=${report.artifactSummary.results} closeouts=${report.artifactSummary.closeouts}`,
      `- decision_reviews=${report.artifactSummary.decision_reviews} remediations=${report.artifactSummary.remediations} overflow_continuations=${report.artifactSummary.overflow_continuations}`,
      `- exec_packs=${report.artifactSummary.exec_packs} true_close_artifacts=${report.artifactSummary.true_close_artifacts}`,
    );
  }

  if (report.featureFlags) {
    lines.push(
      "",
      styleLabel(localize("Feature Flags", "Feature Flags")),
      ...Object.entries(report.featureFlags).map(([key, value]) => `- ${key}: ${value ? "true" : "false"}`),
    );
  }

  if (Array.isArray(report.legacyObservedWaves) && report.legacyObservedWaves.length > 0) {
    lines.push(
      "",
      styleLabel(localize("Observed Waves", "Observed Waves")),
      ...report.legacyObservedWaves.slice(0, 8).map((entry) => (
        `- ${entry.wave_id}: ${entry.observed_lineage} packets=${entry.packets} results=${entry.results} closeouts=${entry.closeouts} exec_packs=${entry.exec_packs}`
      )),
    );
    if (report.legacyObservedWaves.length > 8) {
      lines.push(styleMuted(`- ... ${report.legacyObservedWaves.length - 8} more wave observations`));
    }
  }

  if (report.warnings.length > 0) {
    lines.push(
      "",
      styleLabel(localize("Warnings", "警告")),
      ...report.warnings.map((entry) => styleMuted(`- ${entry}`)),
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatGraphValidate(report) {
  const lines = [
    styleHeading(`nimicoding topic validate graph: ${report.topicId}`),
    "",
    `${styleLabel(localize("Path", "路径"))}: ${report.topicRef}`,
    `${styleLabel(localize("Wave Count", "Wave 数量"))}: ${report.waveCount ?? 0}`,
    `${styleLabel(localize("Result", "结果"))}: ${report.ok ? localize("ok", "通过") : localize("failed", "失败")}`,
    "",
    styleLabel(localize("Checks", "检查项")),
    ...report.checks.map((entry) => `- [${entry.ok ? "ok" : "fail"}] ${entry.id}: ${entry.reason}`),
  ];
  if (report.warnings.length > 0) {
    lines.push("", styleLabel(localize("Warnings", "警告")), ...report.warnings.map((entry) => styleMuted(`- ${entry}`)));
  }
  return `${lines.join("\n")}\n`;
}

function formatAdmissionValidate(report, waveId) {
  const lines = [
    styleHeading(`nimicoding topic validate admission: ${report.topicId} / ${waveId}`),
    "",
    `${styleLabel(localize("Path", "路径"))}: ${report.topicRef}`,
    `${styleLabel(localize("Result", "结果"))}: ${report.ok ? localize("ok", "通过") : localize("failed", "失败")}`,
    "",
    styleLabel(localize("Checks", "检查项")),
    ...report.checks.map((entry) => `- [${entry.ok ? "ok" : "fail"}] ${entry.id}: ${entry.reason}`),
  ];
  if (report.warnings.length > 0) {
    lines.push("", styleLabel(localize("Warnings", "警告")), ...report.warnings.map((entry) => styleMuted(`- ${entry}`)));
  }
  return `${lines.join("\n")}\n`;
}

function formatClosureValidate(report, waveId) {
  const lines = [
    styleHeading(`nimicoding topic validate closure: ${report.topicId} / ${waveId}`),
    "",
    `${styleLabel(localize("Path", "路径"))}: ${report.topicRef}`,
    `${styleLabel(localize("Result", "结果"))}: ${report.ok ? localize("ok", "通过") : localize("failed", "失败")}`,
    "",
    styleLabel(localize("Checks", "检查项")),
    ...report.checks.map((entry) => `- [${entry.ok ? "ok" : "fail"}] ${entry.id}: ${entry.reason}`),
  ];
  if (report.closeoutRef) {
    lines.push("", `${styleLabel(localize("Closeout Ref", "Closeout 路径"))}: ${report.closeoutRef}`);
  }
  if (report.warnings.length > 0) {
    lines.push("", styleLabel(localize("Warnings", "警告")), ...report.warnings.map((entry) => styleMuted(`- ${entry}`)));
  }
  return `${lines.join("\n")}\n`;
}

function formatWaveMutation(report, action) {
  const lines = [
    styleHeading(`nimicoding topic ${action}: ${report.topicId}`),
    "",
    `${styleLabel(localize("Path", "路径"))}: ${report.topicRef}`,
    `${styleLabel(localize("Wave", "Wave"))}: ${report.waveId}`,
  ];
  if (report.waveState) {
    lines.push(`${styleLabel(localize("Wave State", "Wave 状态"))}: ${report.waveState}`);
  }
  if (report.selectedNextTarget) {
    lines.push(`${styleLabel(localize("Selected Next Target", "当前下一目标"))}: ${report.selectedNextTarget}`);
  }
  if (report.state) {
    lines.push(`${styleLabel(localize("Topic State", "Topic 状态"))}: ${report.state}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatPacketFreeze(report) {
  return `${styleHeading(`nimicoding topic packet freeze: ${report.topicId}`)}

${styleLabel(localize("Path", "路径"))}: ${report.topicRef}
${styleLabel(localize("Packet", "Packet"))}: ${report.packetId}
${styleLabel(localize("Wave", "Wave"))}: ${report.waveId}
${styleLabel(localize("Packet Ref", "Packet 路径"))}: ${report.packetRef}
${styleLabel(localize("Status", "状态"))}: ${report.status}
`;
}

function formatDispatch(report) {
  return `${styleHeading(`nimicoding topic ${report.role} dispatch: ${report.topicId}`)}

${styleLabel(localize("Path", "路径"))}: ${report.topicRef}
${styleLabel(localize("Packet", "Packet"))}: ${report.packetId}
${styleLabel(localize("Wave", "Wave"))}: ${report.waveId}
${styleLabel(localize("Packet Ref", "Packet 路径"))}: ${report.packetRef}
${styleLabel(localize("Prompt Ref", "Prompt 路径"))}: ${report.promptRef}
${styleLabel(localize("Wave State", "Wave 状态"))}: ${report.waveState}
`;
}

function formatResultRecord(report) {
  return `${styleHeading(`nimicoding topic result record: ${report.topicId}`)}

${styleLabel(localize("Path", "路径"))}: ${report.topicRef}
${styleLabel(localize("Result", "Result"))}: ${report.resultId}
${styleLabel(localize("Wave", "Wave"))}: ${report.waveId}
${styleLabel(localize("Kind", "类别"))}: ${report.resultKind}
${styleLabel(localize("Verdict", "结论"))}: ${report.verdict}
${styleLabel(localize("Result Ref", "Result 路径"))}: ${report.resultRef}
${styleLabel(localize("Wave State", "Wave 状态"))}: ${report.waveState}
`;
}

function formatDecisionReview(report) {
  const lines = [
    styleHeading(`nimicoding topic decision-review: ${report.topicId}`),
    "",
    `${styleLabel(localize("Path", "路径"))}: ${report.topicRef}`,
    `${styleLabel(localize("Decision Review", "Decision Review"))}: ${report.decisionReviewId}`,
    `${styleLabel(localize("Disposition", "Disposition"))}: ${report.disposition}`,
    `${styleLabel(localize("Review Ref", "Review 路径"))}: ${report.decisionReviewRef}`,
  ];
  if (report.targetWaveId) {
    lines.push(`${styleLabel(localize("Target Wave", "目标 Wave"))}: ${report.targetWaveId}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatRemediation(report) {
  return `${styleHeading(`nimicoding topic remediation open: ${report.topicId}`)}

${styleLabel(localize("Path", "路径"))}: ${report.topicRef}
${styleLabel(localize("Remediation", "Remediation"))}: ${report.remediationId}
${styleLabel(localize("Wave", "Wave"))}: ${report.waveId}
${styleLabel(localize("Kind", "类别"))}: ${report.kind}
${styleLabel(localize("Reason", "原因"))}: ${report.reason}
${styleLabel(localize("Remediation Ref", "Remediation 路径"))}: ${report.remediationRef}
${styleLabel(localize("Wave State", "Wave 状态"))}: ${report.waveState}
`;
}

function formatOverflowContinuation(report) {
  return `${styleHeading(`nimicoding topic overflow continue: ${report.topicId}`)}

${styleLabel(localize("Path", "路径"))}: ${report.topicRef}
${styleLabel(localize("Wave", "Wave"))}: ${report.waveId}
${styleLabel(localize("Overflowed Packet", "Overflowed Packet"))}: ${report.overflowedPacketId}
${styleLabel(localize("Continuation Packet", "Continuation Packet"))}: ${report.continuationPacketId}
${styleLabel(localize("Continuation Ref", "Continuation 路径"))}: ${report.continuationRef}
${styleLabel(localize("Wave State", "Wave 状态"))}: ${report.waveState}
`;
}

function formatPendingTransition(report, action) {
  const lines = [
    styleHeading(`nimicoding topic ${action}: ${report.topicId}`),
    "",
    `${styleLabel(localize("Path", "路径"))}: ${report.topicRef}`,
    `${styleLabel(localize("Topic State", "Topic 状态"))}: ${report.state}`,
    `${styleLabel(localize("Pending Note Ref", "Pending Note 路径"))}: ${report.pendingNoteRef}`,
  ];
  if (report.reason) {
    lines.push(`${styleLabel(localize("Reason", "原因"))}: ${report.reason}`);
  }
  if (report.criteriaMet) {
    lines.push(`${styleLabel(localize("Criteria Met", "条件满足"))}: ${report.criteriaMet}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatCloseout(report, scope) {
  const lines = [
    styleHeading(`nimicoding topic closeout ${scope}: ${report.topicId}`),
    "",
    `${styleLabel(localize("Path", "路径"))}: ${report.topicRef}`,
    `${styleLabel(localize("Closeout Ref", "Closeout 路径"))}: ${report.closeoutRef}`,
  ];
  if (report.waveId) {
    lines.push(`${styleLabel(localize("Wave", "Wave"))}: ${report.waveId}`);
    lines.push(`${styleLabel(localize("Wave State", "Wave 状态"))}: ${report.waveState}`);
  }
  if (report.state) {
    lines.push(`${styleLabel(localize("Topic State", "Topic 状态"))}: ${report.state}`);
  }
  if (report.currentTrueCloseStatus) {
    lines.push(`${styleLabel(localize("True-Close", "True-Close"))}: ${report.currentTrueCloseStatus}`);
  }
  if (report.trueCloseRef) {
    lines.push(`${styleLabel(localize("True-Close Ref", "True-Close 路径"))}: ${report.trueCloseRef}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatTrueCloseAudit(report) {
  const lines = [
    styleHeading(`nimicoding topic true-close-audit: ${report.topicId}`),
    "",
    `${styleLabel(localize("Path", "路径"))}: ${report.topicRef}`,
    `${styleLabel(localize("Status", "状态"))}: ${report.status}`,
    `${styleLabel(localize("Audit Ref", "Audit 路径"))}: ${report.auditRef}`,
    `${styleLabel(localize("Judgement Ref", "Judgement 路径"))}: ${report.judgementRef}`,
    "",
    styleLabel(localize("Checks", "检查项")),
    ...report.checks.map((entry) => `- [${entry.ok ? "ok" : "fail"}] ${entry.id}: ${entry.reason}`),
  ];
  return `${lines.join("\n")}\n`;
}

function formatTopicCreate(report) {
  return `${styleHeading(`nimicoding topic create: ${report.topicId}`)}

${styleLabel(localize("Created", "已创建"))}: ${report.topicRef}
${styleLabel(localize("State", "状态"))}: ${report.state}
${styleLabel(localize("Title", "标题"))}: ${report.title}

${styleMuted(localize(
    "Next step: freeze the first bounded wave before admitted execution.",
    "下一步：在 admitted execution 之前冻结第一个 bounded wave。",
  ))}
`;
}

function parseTopicCreateOptions(args) {
  const [slug, ...rest] = args;
  if (!slug) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic create refused: expected a slug argument.",
        "nimicoding topic create 已拒绝：需要提供 slug 参数。",
      )}\n`,
    };
  }

  if (!validateTopicSlug(slug) && !validateTopicId(slug)) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic create refused: slug must be lowercase kebab-case or a full topic id: ${slug}.`,
        `nimicoding topic create 已拒绝：slug 必须是小写 kebab-case 或完整 topic id：${slug}。`,
      )}\n`,
    };
  }

  const options = {
    slug,
    title: null,
    justification: null,
    mode: null,
    posture: null,
    designPolicy: null,
    parallelTruth: null,
    layering: null,
    risk: null,
    applicability: null,
    executionMode: null,
    json: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--title") {
      const valueCheck = requireOptionValue("--title", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.title = next;
      index += 1;
      continue;
    }

    if (arg === "--justification") {
      const valueCheck = requireOptionValue("--justification", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.justification = next;
      index += 1;
      continue;
    }

    if (arg === "--mode") {
      const valueCheck = requireOptionValue("--mode", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.mode = next;
      index += 1;
      continue;
    }
    if (arg === "--posture") {
      const valueCheck = requireOptionValue("--posture", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = next.replaceAll("-", "_");
      options.posture = normalized;
      index += 1;
      continue;
    }
    if (arg === "--design-policy") {
      const valueCheck = requireOptionValue("--design-policy", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = next.replaceAll("-", "_");
      options.designPolicy = normalized;
      index += 1;
      continue;
    }
    if (arg === "--parallel-truth") {
      const valueCheck = requireOptionValue("--parallel-truth", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = next.replaceAll("-", "_");
      options.parallelTruth = normalized;
      index += 1;
      continue;
    }
    if (arg === "--layering") {
      const valueCheck = requireOptionValue("--layering", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = next.replaceAll("-", "_");
      options.layering = normalized;
      index += 1;
      continue;
    }
    if (arg === "--risk") {
      const valueCheck = requireOptionValue("--risk", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.risk = next;
      index += 1;
      continue;
    }
    if (arg === "--applicability") {
      const valueCheck = requireOptionValue("--applicability", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = next.replaceAll("-", "_");
      options.applicability = normalized;
      index += 1;
      continue;
    }
    if (arg === "--execution-mode") {
      const valueCheck = requireOptionValue("--execution-mode", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = next.replaceAll("-", "_");
      options.executionMode = normalized;
      index += 1;
      continue;
    }

    return {
      ok: false,
      error: `${localize(
        `nimicoding topic create refused: unknown option ${arg}.`,
        `nimicoding topic create 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (!options.justification) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic create refused: --justification is required so topic entry remains explicit.",
        "nimicoding topic create 已拒绝：必须提供 --justification，确保 topic entry 保持显式。",
      )}\n`,
    };
  }

  return {
    ok: true,
    options,
  };
}

function parseTopicReadOptions(args, command) {
  const options = {
    input: null,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (options.input === null) {
      options.input = arg;
      continue;
    }

    return {
      ok: false,
      error: `${localize(
        `nimicoding topic ${command} refused: unexpected argument ${arg}.`,
        `nimicoding topic ${command} 已拒绝：存在未预期参数 ${arg}。`,
      )}\n`,
    };
  }

  return {
    ok: true,
    options,
  };
}

function parseTopicHoldOptions(args) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic hold refused: expected <topic-id> and required options.",
        "nimicoding topic hold 已拒绝：需要 <topic-id> 和必填选项。",
      )}\n`,
    };
  }

  const options = {
    topicInput,
    reason: null,
    summary: null,
    reopenCriteria: null,
    closeTrigger: null,
    json: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--reason") {
      const valueCheck = requireOptionValue("--reason", next, "nimicoding topic hold refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      if (!validateTopicSlug(next)) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding topic hold refused: --reason must be lowercase kebab-case, found ${next}.`,
            `nimicoding topic hold 已拒绝：--reason 必须是小写 kebab-case，当前为 ${next}。`,
          )}\n`,
        };
      }
      options.reason = next;
      index += 1;
      continue;
    }
    if (arg === "--summary") {
      const valueCheck = requireOptionValue("--summary", next, "nimicoding topic hold refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.summary = next;
      index += 1;
      continue;
    }
    if (arg === "--reopen-criteria") {
      const valueCheck = requireOptionValue("--reopen-criteria", next, "nimicoding topic hold refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.reopenCriteria = next;
      index += 1;
      continue;
    }
    if (arg === "--close-trigger") {
      const valueCheck = requireOptionValue("--close-trigger", next, "nimicoding topic hold refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.closeTrigger = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic hold refused: unknown option ${arg}.`,
        `nimicoding topic hold 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (!options.reason || !options.summary) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic hold refused: --reason and --summary are required.",
        "nimicoding topic hold 已拒绝：必须提供 --reason 和 --summary。",
      )}\n`,
    };
  }
  if (!options.reopenCriteria && !options.closeTrigger) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic hold refused: --reopen-criteria or --close-trigger is required.",
        "nimicoding topic hold 已拒绝：必须提供 --reopen-criteria 或 --close-trigger。",
      )}\n`,
    };
  }

  return { ok: true, options };
}

function parseTopicResumeOptions(args) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic resume refused: expected <topic-id> and --criteria-met <text>.",
        "nimicoding topic resume 已拒绝：需要 <topic-id> 和 --criteria-met <text>。",
      )}\n`,
    };
  }

  const options = {
    topicInput,
    criteriaMet: null,
    json: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--criteria-met") {
      const valueCheck = requireOptionValue("--criteria-met", next, "nimicoding topic resume refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.criteriaMet = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic resume refused: unknown option ${arg}.`,
        `nimicoding topic resume 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (!options.criteriaMet) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic resume refused: --criteria-met is required.",
        "nimicoding topic resume 已拒绝：必须提供 --criteria-met。",
      )}\n`,
    };
  }

  return { ok: true, options };
}

function parseWaveAddOptions(args) {
  const [topicInput, waveId, slug, ...rest] = args;
  if (!topicInput || !waveId || !slug) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic wave add refused: expected <topic-id> <wave-id> <slug>.",
        "nimicoding topic wave add 已拒绝：需要 <topic-id> <wave-id> <slug>。",
      )}\n`,
    };
  }
  if (!validateWaveId(waveId)) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic wave add refused: invalid wave id ${waveId}. Use wave-<...>.`,
        `nimicoding topic wave add 已拒绝：无效 wave id ${waveId}。请使用 wave-<...>。`,
      )}\n`,
    };
  }
  if (!validateTopicSlug(slug)) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic wave add refused: invalid slug ${slug}.`,
        `nimicoding topic wave add 已拒绝：无效 slug ${slug}。`,
      )}\n`,
    };
  }

  const options = {
    topicInput,
    waveId,
    slug,
    goal: null,
    ownerDomain: null,
    parallelizableAfter: "stable_contract",
    deps: [],
    json: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--goal") {
      const valueCheck = requireOptionValue("--goal", next, "nimicoding topic wave add refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.goal = next;
      index += 1;
      continue;
    }
    if (arg === "--owner-domain") {
      const valueCheck = requireOptionValue("--owner-domain", next, "nimicoding topic wave add refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.ownerDomain = next;
      index += 1;
      continue;
    }
    if (arg === "--parallelizable-after") {
      const valueCheck = requireOptionValue("--parallelizable-after", next, "nimicoding topic wave add refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.parallelizableAfter = next;
      index += 1;
      continue;
    }
    if (arg === "--dep") {
      const valueCheck = requireOptionValue("--dep", next, "nimicoding topic wave add refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.deps.push(next);
      index += 1;
      continue;
    }

    return {
      ok: false,
      error: `${localize(
        `nimicoding topic wave add refused: unknown option ${arg}.`,
        `nimicoding topic wave add 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (!options.goal || !options.ownerDomain) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic wave add refused: --goal and --owner-domain are required.",
        "nimicoding topic wave add 已拒绝：必须提供 --goal 和 --owner-domain。",
      )}\n`,
    };
  }

  return { ok: true, options };
}

function parseWaveActionOptions(args, action) {
  const [topicInput, waveId, ...rest] = args;
  if (!topicInput || !waveId) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic wave ${action} refused: expected <topic-id> <wave-id>.`,
        `nimicoding topic wave ${action} 已拒绝：需要 <topic-id> <wave-id>。`,
      )}\n`,
    };
  }
  const options = { topicInput, waveId, json: false };
  for (const arg of rest) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic wave ${action} refused: unknown option ${arg}.`,
        `nimicoding topic wave ${action} 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  return { ok: true, options };
}

function parsePacketFreezeOptions(args) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic packet freeze refused: expected <topic-id> and --from <draft-path>.",
        "nimicoding topic packet freeze 已拒绝：需要 <topic-id> 和 --from <draft-path>。",
      )}\n`,
    };
  }

  const options = { topicInput, from: null, json: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--from") {
      const valueCheck = requireOptionValue("--from", next, "nimicoding topic packet freeze refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.from = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic packet freeze refused: unknown option ${arg}.`,
        `nimicoding topic packet freeze 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (!options.from) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic packet freeze refused: --from is required.",
        "nimicoding topic packet freeze 已拒绝：必须提供 --from。",
      )}\n`,
    };
  }

  return { ok: true, options };
}

function parseDispatchOptions(args, role) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic ${role} dispatch refused: expected <topic-id> and --packet <packet-id>.`,
        `nimicoding topic ${role} dispatch 已拒绝：需要 <topic-id> 和 --packet <packet-id>。`,
      )}\n`,
    };
  }

  const options = { topicInput, packetId: null, json: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--packet") {
      const valueCheck = requireOptionValue("--packet", next, `nimicoding topic ${role} dispatch refused`);
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.packetId = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic ${role} dispatch refused: unknown option ${arg}.`,
        `nimicoding topic ${role} dispatch 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (!options.packetId) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic ${role} dispatch refused: --packet is required.`,
        `nimicoding topic ${role} dispatch 已拒绝：必须提供 --packet。`,
      )}\n`,
    };
  }

  return { ok: true, options };
}

function normalizeResultKindInput(value) {
  if (value === "worker") {
    return "implementation";
  }
  return value;
}

function parseResultRecordOptions(args) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic result record refused: expected <topic-id> and required options.",
        "nimicoding topic result record 已拒绝：需要 <topic-id> 和必填选项。",
      )}\n`,
    };
  }

  const options = {
    topicInput,
    kind: null,
    verdict: null,
    from: null,
    verifiedAt: null,
    json: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--kind") {
      const valueCheck = requireOptionValue("--kind", next, "nimicoding topic result record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = normalizeResultKindInput(next);
      const enumCheck = validateEnumOption("--kind", next, TOPIC_RESULT_KIND_INPUT_ENUM, "nimicoding topic result record refused");
      if (!enumCheck.ok) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding topic result record refused: unsupported --kind value ${next}.`,
            `nimicoding topic result record 已拒绝：不支持的 --kind 值 ${next}。`,
          )}\n`,
        };
      }
      options.kind = normalized;
      index += 1;
      continue;
    }
    if (arg === "--verdict") {
      const valueCheck = requireOptionValue("--verdict", next, "nimicoding topic result record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.verdict = next;
      index += 1;
      continue;
    }
    if (arg === "--from") {
      const valueCheck = requireOptionValue("--from", next, "nimicoding topic result record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.from = next;
      index += 1;
      continue;
    }
    if (arg === "--verified-at") {
      const valueCheck = requireOptionValue("--verified-at", next, "nimicoding topic result record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.verifiedAt = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic result record refused: unknown option ${arg}.`,
        `nimicoding topic result record 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (!options.kind || !options.verdict || !options.from || !options.verifiedAt) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic result record refused: --kind, --verdict, --from, and --verified-at are required.",
        "nimicoding topic result record 已拒绝：必须提供 --kind、--verdict、--from 和 --verified-at。",
      )}\n`,
    };
  }

  return { ok: true, options };
}

function parseDecisionReviewOptions(args) {
  const [topicInput, slug, ...rest] = args;
  if (!topicInput || !slug) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic decision-review refused: expected <topic-id> <slug> and required options.",
        "nimicoding topic decision-review 已拒绝：需要 <topic-id> <slug> 和必填选项。",
      )}\n`,
    };
  }

  const options = {
    topicInput,
    slug,
    decision: null,
    replacedScope: null,
    activeReplacementScope: null,
    disposition: "unchanged",
    targetWaveId: null,
    date: new Date().toISOString().slice(0, 10),
    json: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--decision") {
      const valueCheck = requireOptionValue("--decision", next, "nimicoding topic decision-review refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.decision = next;
      index += 1;
      continue;
    }
    if (arg === "--replaced-scope") {
      const valueCheck = requireOptionValue("--replaced-scope", next, "nimicoding topic decision-review refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.replacedScope = next;
      index += 1;
      continue;
    }
    if (arg === "--active-replacement-scope") {
      const valueCheck = requireOptionValue("--active-replacement-scope", next, "nimicoding topic decision-review refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.activeReplacementScope = next;
      index += 1;
      continue;
    }
    if (arg === "--disposition") {
      const valueCheck = requireOptionValue("--disposition", next, "nimicoding topic decision-review refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.disposition = next;
      index += 1;
      continue;
    }
    if (arg === "--target-wave") {
      const valueCheck = requireOptionValue("--target-wave", next, "nimicoding topic decision-review refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      if (!validateWaveId(next)) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding topic decision-review refused: invalid --target-wave value ${next}.`,
            `nimicoding topic decision-review 已拒绝：无效 --target-wave 值 ${next}。`,
          )}\n`,
        };
      }
      options.targetWaveId = next;
      index += 1;
      continue;
    }
    if (arg === "--date") {
      const valueCheck = requireOptionValue("--date", next, "nimicoding topic decision-review refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.date = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic decision-review refused: unknown option ${arg}.`,
        `nimicoding topic decision-review 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (!options.decision || !options.replacedScope || !options.activeReplacementScope) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic decision-review refused: --decision, --replaced-scope, and --active-replacement-scope are required.",
        "nimicoding topic decision-review 已拒绝：必须提供 --decision、--replaced-scope 和 --active-replacement-scope。",
      )}\n`,
    };
  }

  return { ok: true, options };
}

function parseRemediationOpenOptions(args) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic remediation open refused: expected <topic-id> and required options.",
        "nimicoding topic remediation open 已拒绝：需要 <topic-id> 和必填选项。",
      )}\n`,
    };
  }

  const options = {
    topicInput,
    kind: null,
    reason: null,
    overflowedPacketId: null,
    json: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--kind") {
      const valueCheck = requireOptionValue("--kind", next, "nimicoding topic remediation open refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = next.replaceAll("-", "_");
      options.kind = normalized;
      index += 1;
      continue;
    }
    if (arg === "--reason") {
      const valueCheck = requireOptionValue("--reason", next, "nimicoding topic remediation open refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      if (!validateTopicSlug(next)) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding topic remediation open refused: --reason must be lowercase kebab-case, found ${next}.`,
            `nimicoding topic remediation open 已拒绝：--reason 必须是小写 kebab-case，当前为 ${next}。`,
          )}\n`,
        };
      }
      options.reason = next;
      index += 1;
      continue;
    }
    if (arg === "--overflowed-packet") {
      const valueCheck = requireOptionValue("--overflowed-packet", next, "nimicoding topic remediation open refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.overflowedPacketId = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic remediation open refused: unknown option ${arg}.`,
        `nimicoding topic remediation open 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (!options.kind || !options.reason) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic remediation open refused: --kind and --reason are required.",
        "nimicoding topic remediation open 已拒绝：必须提供 --kind 和 --reason。",
      )}\n`,
    };
  }

  return { ok: true, options };
}

function parseOverflowContinueOptions(args) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic overflow continue refused: expected <topic-id> and required options.",
        "nimicoding topic overflow continue 已拒绝：需要 <topic-id> 和必填选项。",
      )}\n`,
    };
  }

  const options = {
    topicInput,
    continuationPacketId: null,
    overflowedPacketId: null,
    managerJudgement: null,
    sameOwnerDomain: false,
    json: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--packet") {
      const valueCheck = requireOptionValue("--packet", next, "nimicoding topic overflow continue refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.continuationPacketId = next;
      index += 1;
      continue;
    }
    if (arg === "--overflowed-packet") {
      const valueCheck = requireOptionValue("--overflowed-packet", next, "nimicoding topic overflow continue refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.overflowedPacketId = next;
      index += 1;
      continue;
    }
    if (arg === "--manager-judgement") {
      const valueCheck = requireOptionValue("--manager-judgement", next, "nimicoding topic overflow continue refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.managerJudgement = next;
      index += 1;
      continue;
    }
    if (arg === "--same-owner-domain") {
      options.sameOwnerDomain = true;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic overflow continue refused: unknown option ${arg}.`,
        `nimicoding topic overflow continue 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (!options.continuationPacketId || !options.overflowedPacketId || !options.managerJudgement || options.sameOwnerDomain !== true) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic overflow continue refused: --packet, --overflowed-packet, --manager-judgement, and --same-owner-domain are required.",
        "nimicoding topic overflow continue 已拒绝：必须提供 --packet、--overflowed-packet、--manager-judgement 和 --same-owner-domain。",
      )}\n`,
    };
  }

  return { ok: true, options };
}

function parseCloseoutOptions(args, scope) {
  const [topicInput, maybeWaveId, ...rest] = args;
  if (!topicInput || (scope === "wave" && !maybeWaveId)) {
    return {
      ok: false,
      error: `${localize(
        scope === "wave"
          ? "nimicoding topic closeout wave refused: expected <topic-id> <wave-id> and required closure options."
          : "nimicoding topic closeout topic refused: expected <topic-id> and required closure options.",
        scope === "wave"
          ? "nimicoding topic closeout wave 已拒绝：需要 <topic-id> <wave-id> 和必填 closure 选项。"
          : "nimicoding topic closeout topic 已拒绝：需要 <topic-id> 和必填 closure 选项。",
      )}\n`,
    };
  }

  const options = {
    topicInput,
    waveId: scope === "wave" ? maybeWaveId : null,
    authorityClosure: null,
    semanticClosure: null,
    consumerClosure: null,
    driftResistanceClosure: null,
    disposition: null,
    json: false,
  };

  const remaining = scope === "wave" ? rest : [maybeWaveId, ...rest].filter((entry) => entry !== undefined);
  for (let index = 0; index < remaining.length; index += 1) {
    const arg = remaining[index];
    const next = remaining[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--authority") {
      const valueCheck = requireOptionValue("--authority", next, `nimicoding topic closeout ${scope} refused`);
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.authorityClosure = next;
      index += 1;
      continue;
    }
    if (arg === "--semantic") {
      const valueCheck = requireOptionValue("--semantic", next, `nimicoding topic closeout ${scope} refused`);
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.semanticClosure = next;
      index += 1;
      continue;
    }
    if (arg === "--consumer") {
      const valueCheck = requireOptionValue("--consumer", next, `nimicoding topic closeout ${scope} refused`);
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.consumerClosure = next;
      index += 1;
      continue;
    }
    if (arg === "--drift-resistance") {
      const valueCheck = requireOptionValue("--drift-resistance", next, `nimicoding topic closeout ${scope} refused`);
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.driftResistanceClosure = next;
      index += 1;
      continue;
    }
    if (arg === "--disposition") {
      const valueCheck = requireOptionValue("--disposition", next, `nimicoding topic closeout ${scope} refused`);
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.disposition = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic closeout ${scope} refused: unknown option ${arg}.`,
        `nimicoding topic closeout ${scope} 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (!options.authorityClosure || !options.semanticClosure || !options.consumerClosure || !options.driftResistanceClosure || !options.disposition) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic closeout ${scope} refused: all four closures and --disposition are required.`,
        `nimicoding topic closeout ${scope} 已拒绝：必须提供四个 closure 和 --disposition。`,
      )}\n`,
    };
  }

  return { ok: true, options };
}

function parseTrueCloseAuditOptions(args) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic true-close-audit refused: expected <topic-id> and --judgement <text>.",
        "nimicoding topic true-close-audit 已拒绝：需要 <topic-id> 和 --judgement <text>。",
      )}\n`,
    };
  }

  const options = {
    topicInput,
    judgement: null,
    json: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--judgement") {
      const valueCheck = requireOptionValue("--judgement", next, "nimicoding topic true-close-audit refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.judgement = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic true-close-audit refused: unknown option ${arg}.`,
        `nimicoding topic true-close-audit 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (!options.judgement) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic true-close-audit refused: --judgement is required.",
        "nimicoding topic true-close-audit 已拒绝：必须提供 --judgement。",
      )}\n`,
    };
  }

  return { ok: true, options };
}

function parseGraphValidateOptions(args, commandLabel) {
  const options = { topicInput: null, waveId: null, json: false };
  for (const arg of args) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (options.topicInput === null) {
      options.topicInput = arg;
      continue;
    }
    if (options.waveId === null) {
      options.waveId = arg;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic ${commandLabel} refused: unknown option ${arg}.`,
        `nimicoding topic ${commandLabel} 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  return { ok: true, options };
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
      "nimicoding topic refused: expected a subcommand (`create`, `status`, `validate`, `wave`, `packet`, `worker`, `audit`, `result`, `remediation`, `overflow`, `hold`, `resume`, `closeout`, `true-close-audit`, or `decision-review`).",
      "nimicoding topic 已拒绝：需要子命令（`create`、`status`、`validate`、`wave`、`packet`、`worker`、`audit`、`result`、`remediation`、`overflow`、`hold`、`resume`、`closeout`、`true-close-audit` 或 `decision-review`）。",
    )}\n`);
    return 2;
  }

  if (subcommand === "create") {
    return runTopicCreate(rest);
  }
  if (subcommand === "status") {
    return runTopicStatus(rest);
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

export {
  parseTopicCreateOptions,
  parseTopicReadOptions,
};
