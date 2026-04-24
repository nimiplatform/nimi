import { runBlueprintAudit } from "./commands/blueprint-audit.mjs";
import { runClear } from "./commands/clear.mjs";
import { runCloseout } from "./commands/closeout.mjs";
import { runAdmitHighRiskDecision } from "./commands/admit-high-risk-decision.mjs";
import { runAuditSweep } from "./commands/audit-sweep.mjs";
import { runDecideHighRiskExecution } from "./commands/decide-high-risk-execution.mjs";
import { runDoctor } from "./commands/doctor.mjs";
import { runHandoff } from "./commands/handoff.mjs";
import { runIngestHighRiskExecution } from "./commands/ingest-high-risk-execution.mjs";
import { runReviewHighRiskExecution } from "./commands/review-high-risk-execution.mjs";
import { runStart } from "./commands/start.mjs";
import { runTopic } from "./commands/topic.mjs";
import { runTopicRunnerCommand } from "./commands/topic-runner.mjs";
import { runValidateAcceptance } from "./commands/validate-acceptance.mjs";
import { runGenerateSpecDerivedDocs } from "./commands/generate-spec-derived-docs.mjs";
import { runValidateAiGovernance } from "./commands/validate-ai-governance.mjs";
import { runValidateExecutionPacket } from "./commands/validate-execution-packet.mjs";
import { runValidateOrchestrationState } from "./commands/validate-orchestration-state.mjs";
import { runValidateSpecGovernance } from "./commands/validate-spec-governance.mjs";
import { runValidateSpecAudit } from "./commands/validate-spec-audit.mjs";
import { runValidateSpecTree } from "./commands/validate-spec-tree.mjs";
import { runValidatePrompt } from "./commands/validate-prompt.mjs";
import { runValidateWorkerOutput } from "./commands/validate-worker-output.mjs";
import { helpText } from "./help.mjs";
import { configureCliUi, localize, parseGlobalUiOptions } from "./lib/ui.mjs";
import { VERSION } from "./constants.mjs";

const COMMANDS = {
  start: runStart,
  topic: runTopic,
  "topic-runner": runTopicRunnerCommand,
  clear: runClear,
  doctor: runDoctor,
  "blueprint-audit": runBlueprintAudit,
  handoff: runHandoff,
  closeout: runCloseout,
  "audit-sweep": runAuditSweep,
  "admit-high-risk-decision": runAdmitHighRiskDecision,
  "decide-high-risk-execution": runDecideHighRiskExecution,
  "ingest-high-risk-execution": runIngestHighRiskExecution,
  "review-high-risk-execution": runReviewHighRiskExecution,
  "validate-execution-packet": runValidateExecutionPacket,
  "validate-orchestration-state": runValidateOrchestrationState,
  "validate-spec-governance": runValidateSpecGovernance,
  "validate-spec-audit": runValidateSpecAudit,
  "validate-spec-tree": runValidateSpecTree,
  "generate-spec-derived-docs": runGenerateSpecDerivedDocs,
  "validate-ai-governance": runValidateAiGovernance,
  "validate-prompt": runValidatePrompt,
  "validate-worker-output": runValidateWorkerOutput,
  "validate-acceptance": runValidateAcceptance,
};

export async function runCli(args) {
  const parsedUi = parseGlobalUiOptions(args);
  if (!parsedUi.ok) {
    process.stderr.write(parsedUi.error);
    return 2;
  }

  configureCliUi({
    locale: parsedUi.locale,
    colorEnabled: parsedUi.colorEnabled,
  });

  const [command] = parsedUi.args;
  const rest = parsedUi.args.slice(1);

  if (!command || command === "--help" || command === "-h" || command === "help") {
    if (rest.length > 0) {
      process.stderr.write(localize(
        `nimicoding help refused: unexpected arguments: ${rest.join(" ")}\n`,
        `nimicoding help 拒绝执行：存在未预期参数：${rest.join(" ")}\n`,
      ));
      return 2;
    }
    process.stdout.write(helpText());
    return 0;
  }

  if (command === "--version" || command === "-v" || command === "version") {
    if (rest.length > 0) {
      process.stderr.write(localize(
        `nimicoding version refused: unexpected arguments: ${rest.join(" ")}\n`,
        `nimicoding version 拒绝执行：存在未预期参数：${rest.join(" ")}\n`,
      ));
      return 2;
    }
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const runner = COMMANDS[command];
  if (!runner) {
    process.stderr.write(localize(
      `Unknown command: ${command}\n\n${helpText()}`,
      `未知命令：${command}\n\n${helpText()}`,
    ));
    return 2;
  }

  return runner(rest);
}
