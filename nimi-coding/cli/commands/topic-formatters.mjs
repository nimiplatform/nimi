import { localize, styleHeading, styleLabel, styleMuted } from "../lib/ui.mjs";

export function buildJsonReport(command, report) {
  return {
    contract: "nimicoding.topic-command-result.v1",
    command,
    ...report,
  };
}
export function writeJson(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
export function formatTopicStatus(report) {
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
export function formatTopicValidate(report) {
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
export function formatNextStep(report) {
  const decision = report.decision;
  const lines = [
    styleHeading(`nimicoding topic run-next-step: ${report.topicId}`),
    "",
    `${styleLabel(localize("Path", "路径"))}: ${report.topicRef}`,
    `${styleLabel(localize("Stop Class", "Stop Class"))}: ${decision.stop_class}`,
    `${styleLabel(localize("Action", "Action"))}: ${decision.recommended_action}`,
    `${styleLabel(localize("Reason", "Reason"))}: ${decision.reason_code}`,
    `${styleLabel(localize("Human Confirmation", "Human Confirmation"))}: ${decision.requires_human_confirmation ? "true" : "false"}`,
    `${styleLabel(localize("Recommendation", "Recommendation"))}: ${decision.recommended_decision}`,
    `${styleLabel(localize("Rationale", "Rationale"))}: ${decision.recommendation_rationale}`,
  ];
  if (decision.next_command_ref) {
    lines.push(`${styleLabel(localize("Next Command", "Next Command"))}: ${decision.next_command_ref}`);
  }
  if (Array.isArray(decision.expected_artifacts) && decision.expected_artifacts.length > 0) {
    lines.push("", styleLabel(localize("Expected Artifacts", "Expected Artifacts")));
    lines.push(...decision.expected_artifacts.map((entry) => `- ${entry}`));
  }
  if (Array.isArray(decision.blocking_checks) && decision.blocking_checks.length > 0) {
    lines.push("", styleLabel(localize("Blocking Checks", "Blocking Checks")));
    lines.push(...decision.blocking_checks.map((entry) => `- [${entry.ok ? "ok" : "fail"}] ${entry.id}: ${entry.reason}`));
  }
  return `${lines.join("\n")}\n`;
}
export function formatRunLedger(report, action) {
  const ledger = report.ledger ?? {};
  const lines = [
    styleHeading(`nimicoding topic run-ledger ${action}: ${report.topicId}`),
    "",
    `${styleLabel(localize("Path", "路径"))}: ${report.topicRef}`,
    `${styleLabel(localize("Run", "Run"))}: ${report.runId}`,
    `${styleLabel(localize("Ledger", "Ledger"))}: ${report.ledgerRef}`,
    `${styleLabel(localize("Status", "Status"))}: ${report.runStatus ?? ledger.run_status}`,
    `${styleLabel(localize("Events", "Events"))}: ${report.eventCount ?? ledger.event_count ?? 0}`,
  ];
  if (report.eventRef) {
    lines.push(`${styleLabel(localize("Event", "Event"))}: ${report.eventRef}`);
  }
  if (ledger.current_human_gate) {
    lines.push(`${styleLabel(localize("Human Gate", "Human Gate"))}: ${ledger.current_human_gate.summary}`);
  }
  return `${lines.join("\n")}\n`;
}
export function formatGraphValidate(report) {
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
export function formatAdmissionValidate(report, waveId) {
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
export function formatClosureValidate(report, waveId) {
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
export function formatWaveMutation(report, action) {
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
export function formatPacketFreeze(report) {
  return `${styleHeading(`nimicoding topic packet freeze: ${report.topicId}`)}
${styleLabel(localize("Path", "路径"))}: ${report.topicRef}
${styleLabel(localize("Packet", "Packet"))}: ${report.packetId}
${styleLabel(localize("Wave", "Wave"))}: ${report.waveId}
${styleLabel(localize("Packet Ref", "Packet 路径"))}: ${report.packetRef}
${styleLabel(localize("Status", "状态"))}: ${report.status}
`;
}
export function formatDispatch(report) {
  return `${styleHeading(`nimicoding topic ${report.role} dispatch: ${report.topicId}`)}
${styleLabel(localize("Path", "路径"))}: ${report.topicRef}
${styleLabel(localize("Packet", "Packet"))}: ${report.packetId}
${styleLabel(localize("Wave", "Wave"))}: ${report.waveId}
${styleLabel(localize("Packet Ref", "Packet 路径"))}: ${report.packetRef}
${styleLabel(localize("Prompt Ref", "Prompt 路径"))}: ${report.promptRef}
${styleLabel(localize("Wave State", "Wave 状态"))}: ${report.waveState}
`;
}
export function formatResultRecord(report) {
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
export function formatDecisionReview(report) {
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
export function formatRemediation(report) {
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
export function formatOverflowContinuation(report) {
  return `${styleHeading(`nimicoding topic overflow continue: ${report.topicId}`)}
${styleLabel(localize("Path", "路径"))}: ${report.topicRef}
${styleLabel(localize("Wave", "Wave"))}: ${report.waveId}
${styleLabel(localize("Overflowed Packet", "Overflowed Packet"))}: ${report.overflowedPacketId}
${styleLabel(localize("Continuation Packet", "Continuation Packet"))}: ${report.continuationPacketId}
${styleLabel(localize("Continuation Ref", "Continuation 路径"))}: ${report.continuationRef}
${styleLabel(localize("Wave State", "Wave 状态"))}: ${report.waveState}
`;
}
export function formatPendingTransition(report, action) {
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
export function formatCloseout(report, scope) {
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
export function formatTrueCloseAudit(report) {
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
export function formatTopicCreate(report) {
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
