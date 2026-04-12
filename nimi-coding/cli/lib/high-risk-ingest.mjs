import path from "node:path";

import {
  EXTERNAL_EXECUTION_ARTIFACTS_CONFIG_REF,
  HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF,
  HIGH_RISK_INGEST_PAYLOAD_CONTRACT_VERSION,
} from "../constants.mjs";
import {
  loadHighRiskExecutionContract,
  validateHighRiskExecutionSummary,
} from "./contracts.mjs";
import {
  loadExternalExecutionArtifactsConfig,
  validateHighRiskExecutionArtifactRefs,
} from "./external-execution.mjs";
import { pathExists } from "./fs-helpers.mjs";
import { inspectDoctorState } from "./doctor.mjs";
import { loadImportedCloseoutOptions } from "./closeout.mjs";
import {
  localize,
  styleCommand,
  styleHeading,
  styleLabel,
  styleStatus,
} from "./ui.mjs";
import {
  validateExecutionPacket,
  validateOrchestrationState,
  validatePrompt,
  validateWorkerOutput,
} from "./validators.mjs";

function translateIngestReason(reason) {
  const translations = new Map([
    ["imported closeout must declare skill high_risk_execution", "导入的 closeout 必须声明 skill 为 high_risk_execution"],
    ["high-risk ingest requires a completed high_risk_execution closeout artifact", "high-risk ingest 需要一个 completed 的 high_risk_execution closeout 产物"],
    ["high-risk ingest requires an imported summary", "high-risk ingest 需要导入的 summary"],
    ["high-risk ingest requires summary.status candidate_ready", "high-risk ingest 需要 summary.status 为 candidate_ready"],
    ["Bootstrap or handoff validation is failing; repair doctor errors before ingesting external execution artifacts", "bootstrap 或 handoff 校验失败；请先修复 doctor 报错，再导入外部执行产物"],
    ["High-risk ingest requires the canonical tree under `.nimi/spec`", "high-risk ingest 需要 `.nimi/spec` 下的 canonical tree"],
    ["One or more external execution candidate artifacts failed mechanical validation", "一个或多个外部执行候选产物未通过机械校验"],
    ["External execution candidate artifacts passed bounded ingest validation", "外部执行候选产物已通过受边界约束的导入校验"],
  ]);
  return translations.get(reason) ?? reason;
}

function projectValidation(ref, report) {
  return {
    ref,
    ok: Boolean(report.ok),
    refusal: report.refusal ?? null,
    errors: report.errors ?? [],
    warnings: report.warnings ?? [],
    ...(report.signal ? { signal: report.signal } : {}),
  };
}

async function validateEvidenceRefs(projectRoot, refs) {
  const results = [];

  for (const ref of refs) {
    const absolutePath = path.resolve(projectRoot, ref);
    const info = await pathExists(absolutePath);
    results.push({
      ref,
      ok: Boolean(info?.isFile()),
      errors: info?.isFile() ? [] : [`missing evidence artifact: ${ref}`],
      warnings: [],
    });
  }

  return results;
}

async function validateReferencedArtifacts(projectRoot, summary) {
  const packetRef = path.resolve(projectRoot, summary.packet_ref);
  const orchestrationStateRef = path.resolve(projectRoot, summary.orchestration_state_ref);
  const promptRef = path.resolve(projectRoot, summary.prompt_ref);
  const workerOutputRef = path.resolve(projectRoot, summary.worker_output_ref);

  const [
    executionPacket,
    orchestrationState,
    prompt,
    workerOutput,
    evidence,
  ] = await Promise.all([
    validateExecutionPacket(packetRef),
    validateOrchestrationState(orchestrationStateRef),
    validatePrompt(promptRef),
    validateWorkerOutput(workerOutputRef),
    validateEvidenceRefs(projectRoot, summary.evidence_refs),
  ]);

  return {
    executionPacket: projectValidation(summary.packet_ref, executionPacket),
    orchestrationState: projectValidation(summary.orchestration_state_ref, orchestrationState),
    prompt: projectValidation(summary.prompt_ref, prompt),
    workerOutput: projectValidation(summary.worker_output_ref, workerOutput),
    evidence,
  };
}

function validateHighRiskIngestInput(importedOptions, summaryValidation, rootsValidation) {
  if (importedOptions.skill !== "high_risk_execution") {
    return {
      ok: false,
      reason: "imported closeout must declare skill high_risk_execution",
    };
  }

  if (importedOptions.outcome !== "completed") {
    return {
      ok: false,
      reason: "high-risk ingest requires a completed high_risk_execution closeout artifact",
    };
  }

  if (!importedOptions.summary) {
    return {
      ok: false,
      reason: "high-risk ingest requires an imported summary",
    };
  }

  if (!summaryValidation.ok) {
    return summaryValidation;
  }

  if (importedOptions.summary.status !== "candidate_ready") {
    return {
      ok: false,
      reason: "high-risk ingest requires summary.status candidate_ready",
    };
  }

  if (!rootsValidation.ok) {
    return rootsValidation;
  }

  return { ok: true };
}

function evaluateHighRiskIngestReadiness(doctorResult, validations) {
  if (!doctorResult.ok || !doctorResult.handoffReadiness.ok) {
    return {
      ok: false,
      reason: "Bootstrap or handoff validation is failing; repair doctor errors before ingesting external execution artifacts",
    };
  }

  if (doctorResult.lifecycleState?.treeState !== "canonical_tree_ready" || doctorResult.canonicalTree?.requiredFilesValid !== true) {
    return {
      ok: false,
      reason: "High-risk ingest requires canonical_tree_ready with declared canonical files present",
    };
  }

  const mechanicalChecksOk = validations.executionPacket.ok
    && validations.orchestrationState.ok
    && validations.prompt.ok
    && validations.workerOutput.ok
    && validations.evidence.every((entry) => entry.ok);

  if (!mechanicalChecksOk) {
    return {
      ok: false,
      reason: "One or more external execution candidate artifacts failed mechanical validation",
    };
  }

  return {
    ok: true,
    reason: "External execution candidate artifacts passed bounded ingest validation",
  };
}

export async function buildHighRiskIngestPayload(projectRoot, fromPath, options = {}) {
  const sourceCloseoutRef = path.resolve(projectRoot, fromPath);
  const imported = await loadImportedCloseoutOptions(projectRoot, fromPath);
  if (!imported.ok) {
    return {
      ok: false,
      exitCode: 2,
      inputError: true,
      error: imported.error,
    };
  }

  const highRiskContract = await loadHighRiskExecutionContract(projectRoot);
  if (!highRiskContract.ok) {
    return {
      ok: false,
      exitCode: 2,
      inputError: true,
      error: `${localize(
        "nimicoding ingest-high-risk-execution refused: high_risk_execution result contract is missing or malformed.",
        "nimicoding ingest-high-risk-execution 已拒绝：high_risk_execution 结果契约缺失或格式错误。",
      )}\n`,
    };
  }

  const externalExecutionArtifacts = await loadExternalExecutionArtifactsConfig(projectRoot);
  if (!externalExecutionArtifacts.ok) {
    return {
      ok: false,
      exitCode: 2,
      inputError: true,
      error: `${localize(
        "nimicoding ingest-high-risk-execution refused: external execution artifacts config is missing or malformed.",
        "nimicoding ingest-high-risk-execution 已拒绝：external execution artifacts 配置缺失或格式错误。",
      )}\n`,
    };
  }

  const summaryValidation = validateHighRiskExecutionSummary(
    imported.options.summary,
    highRiskContract,
    imported.options.verifiedAt,
  );
  const rootsValidation = imported.options.summary
    ? validateHighRiskExecutionArtifactRefs(imported.options.summary, externalExecutionArtifacts)
    : { ok: true };
  const ingestInputValidation = validateHighRiskIngestInput(
    imported.options,
    summaryValidation,
    rootsValidation,
  );

  if (!ingestInputValidation.ok) {
    return {
      ok: false,
      exitCode: 2,
      inputError: true,
      error: `${localize(
        `nimicoding ingest-high-risk-execution refused: ${ingestInputValidation.reason}.`,
        `nimicoding ingest-high-risk-execution 已拒绝：${translateIngestReason(ingestInputValidation.reason)}。`,
      )}\n`,
    };
  }

  const validations = await validateReferencedArtifacts(projectRoot, imported.options.summary);
  const doctorResult = await inspectDoctorState(projectRoot);
  const readiness = evaluateHighRiskIngestReadiness(doctorResult, validations);
  const artifactPath = path.join(
    projectRoot,
    ".nimi",
    "local",
    "handoff-results",
    "high_risk_execution.ingest.json",
  );

  return {
    contractVersion: HIGH_RISK_INGEST_PAYLOAD_CONTRACT_VERSION,
    ok: readiness.ok,
    exitCode: readiness.ok ? 0 : 1,
    projectRoot,
    sourceCloseoutRef,
    localOnly: true,
    artifactPath,
    skill: {
      id: "high_risk_execution",
      resultContractRef: HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF,
      artifactContractRef: EXTERNAL_EXECUTION_ARTIFACTS_CONFIG_REF,
    },
    outcome: imported.options.outcome,
    verifiedAt: imported.options.verifiedAt,
    summary: imported.options.summary,
    artifactRoots: externalExecutionArtifacts.artifactRoots,
    validations,
    readiness,
    doctor: {
      ok: doctorResult.ok,
      handoffReadiness: doctorResult.handoffReadiness,
      delegatedContracts: doctorResult.delegatedContracts,
    },
    nextAction: readiness.ok
      ? options.writeLocal
        ? `Write the high-risk ingest artifact to ${artifactPath}.`
        : "Review the ingest payload or write it locally with `--write-local`."
      : readiness.reason,
  };
}

export function formatHighRiskIngestPayload(payload) {
  const nextAction = payload.readiness.ok
    ? payload.nextAction.startsWith("Write the high-risk ingest artifact to ")
      ? localize(payload.nextAction, `将 high-risk ingest 产物写入 ${payload.artifactPath}。`)
      : localize(
        payload.nextAction,
        `检查 ingest payload，或使用 ${styleCommand("--write-local")} 将其写入本地。`,
      )
    : translateIngestReason(payload.nextAction);
  const lines = [
    styleHeading(`nimicoding ingest-high-risk-execution: ${payload.projectRoot}`),
    "",
    styleLabel(localize("Source:", "来源：")),
    `  - closeout_ref: ${payload.sourceCloseoutRef}`,
    `  - verified_at: ${payload.verifiedAt}`,
    "",
    styleLabel(localize("Result:", "结果：")),
    `  - ready: ${styleStatus(payload.readiness.ok ? "ready" : "needs_attention")}`,
    `  - local_only: ${payload.localOnly ? "true" : "false"}`,
    "",
    styleLabel(localize("Mechanical Validation:", "机械校验：")),
    `  - execution_packet: ${payload.validations.executionPacket.ok ? "ok" : "invalid"}`,
    `  - orchestration_state: ${payload.validations.orchestrationState.ok ? "ok" : "invalid"}`,
    `  - prompt: ${payload.validations.prompt.ok ? "ok" : "invalid"}`,
    `  - worker_output: ${payload.validations.workerOutput.ok ? "ok" : "invalid"}`,
    `  - evidence: ${payload.validations.evidence.every((entry) => entry.ok) ? "ok" : "invalid"}`,
    "",
    styleLabel(localize("Next:", "下一步：")),
    `  - ${nextAction}`,
  ];

  return `${lines.join("\n")}\n`;
}
