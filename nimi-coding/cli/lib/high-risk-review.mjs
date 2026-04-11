import path from "node:path";

import {
  HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF,
  HIGH_RISK_REVIEW_PAYLOAD_CONTRACT_VERSION,
} from "../constants.mjs";
import { inspectDoctorState } from "./doctor.mjs";
import { readTextIfFile } from "./fs-helpers.mjs";
import {
  localize,
  styleCommand,
  styleHeading,
  styleLabel,
  styleStatus,
} from "./ui.mjs";
import { isPlainObject } from "./value-helpers.mjs";

function translateReviewReason(reason) {
  const translations = new Map([
    ["imported ingest payload must declare contractVersion nimicoding.high-risk-ingest.v1", "导入的 ingest payload 必须声明 contractVersion nimicoding.high-risk-ingest.v1"],
    ["imported ingest payload must declare skill.id high_risk_execution", "导入的 ingest payload 必须声明 skill.id 为 high_risk_execution"],
    ["imported ingest payload must remain localOnly true", "导入的 ingest payload 必须保持 localOnly 为 true"],
    ["review-high-risk-execution requires an ingest payload with ok true", "review-high-risk-execution 需要一个 ok 为 true 的 ingest payload"],
    ["imported ingest payload must include validations", "导入的 ingest payload 必须包含 validations"],
    ["review-high-risk-execution requires all ingest validations to be mechanically ok", "review-high-risk-execution 需要所有 ingest 校验均机械通过"],
    ["Bootstrap or handoff validation is failing; repair doctor errors before projecting review-ready artifacts", "bootstrap 或 handoff 校验失败；请先修复 doctor 报错，再投影 review-ready 产物"],
    ["High-risk review projection requires reconstructed `.nimi/spec/*.yaml` target truth", "high-risk review 投影需要已重建的 `.nimi/spec/*.yaml` target truth"],
    ["Candidate artifacts are ready for manager-owned semantic review", "候选产物已准备好供 manager 执行语义审查"],
  ]);
  return translations.get(reason) ?? reason;
}

async function loadImportedIngestPayload(projectRoot, fromPath) {
  const absolutePath = path.resolve(projectRoot, fromPath);
  const rawText = await readTextIfFile(absolutePath);

  if (rawText === null) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding review-high-risk-execution refused: cannot read imported ingest JSON at ${absolutePath}.`,
        `nimicoding review-high-risk-execution 已拒绝：无法读取 ${absolutePath} 处的导入 ingest JSON。`,
      )}\n`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      error: `${localize(
        `nimicoding review-high-risk-execution refused: imported ingest JSON at ${absolutePath} is invalid JSON.`,
        `nimicoding review-high-risk-execution 已拒绝：${absolutePath} 处的导入 ingest JSON 不是合法 JSON。`,
      )}\n`,
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding review-high-risk-execution refused: imported ingest JSON must be an object.",
        "nimicoding review-high-risk-execution 已拒绝：导入的 ingest JSON 必须是对象。",
      )}\n`,
    };
  }

  return {
    ok: true,
    path: absolutePath,
    payload: parsed,
  };
}

function validateImportedIngestPayload(payload) {
  if (payload.contractVersion !== "nimicoding.high-risk-ingest.v1") {
    return {
      ok: false,
      reason: "imported ingest payload must declare contractVersion nimicoding.high-risk-ingest.v1",
    };
  }

  if (payload.skill?.id !== "high_risk_execution") {
    return {
      ok: false,
      reason: "imported ingest payload must declare skill.id high_risk_execution",
    };
  }

  if (payload.localOnly !== true) {
    return {
      ok: false,
      reason: "imported ingest payload must remain localOnly true",
    };
  }

  if (payload.ok !== true) {
    return {
      ok: false,
      reason: "review-high-risk-execution requires an ingest payload with ok true",
    };
  }

  const validations = payload.validations;
  if (!isPlainObject(validations)) {
    return {
      ok: false,
      reason: "imported ingest payload must include validations",
    };
  }

  const requiredValidationKeys = [
    "executionPacket",
    "orchestrationState",
    "prompt",
    "workerOutput",
    "evidence",
  ];
  for (const key of requiredValidationKeys) {
    if (!(key in validations)) {
      return {
        ok: false,
        reason: `imported ingest payload validations are missing ${key}`,
      };
    }
  }

  if (
    validations.executionPacket?.ok !== true
    || validations.orchestrationState?.ok !== true
    || validations.prompt?.ok !== true
    || validations.workerOutput?.ok !== true
    || !Array.isArray(validations.evidence)
    || validations.evidence.some((entry) => !entry || entry.ok !== true)
  ) {
    return {
      ok: false,
      reason: "review-high-risk-execution requires all ingest validations to be mechanically ok",
    };
  }

  return { ok: true };
}

function evaluateHighRiskReviewReadiness(doctorResult) {
  if (!doctorResult.ok || !doctorResult.handoffReadiness.ok) {
    return {
      ok: false,
      reason: "Bootstrap or handoff validation is failing; repair doctor errors before projecting review-ready artifacts",
    };
  }

  if (doctorResult.targetTruth.missing.length > 0 || doctorResult.targetTruth.invalid.length > 0) {
    return {
      ok: false,
      reason: "High-risk review projection requires reconstructed `.nimi/spec/*.yaml` target truth",
    };
  }

  return {
    ok: true,
    reason: "Candidate artifacts are ready for manager-owned semantic review",
  };
}

export async function buildHighRiskReviewPayload(projectRoot, fromPath, options = {}) {
  const imported = await loadImportedIngestPayload(projectRoot, fromPath);
  if (!imported.ok) {
    return {
      ok: false,
      exitCode: 2,
      inputError: true,
      error: imported.error,
    };
  }

  const inputValidation = validateImportedIngestPayload(imported.payload);
  if (!inputValidation.ok) {
    return {
      ok: false,
      exitCode: 2,
      inputError: true,
      error: `${localize(
        `nimicoding review-high-risk-execution refused: ${inputValidation.reason}.`,
        `nimicoding review-high-risk-execution 已拒绝：${translateReviewReason(inputValidation.reason)}。`,
      )}\n`,
    };
  }

  const doctorResult = await inspectDoctorState(projectRoot);
  const readiness = evaluateHighRiskReviewReadiness(doctorResult);
  const artifactPath = path.join(
    projectRoot,
    ".nimi",
    "local",
    "handoff-results",
    "high_risk_execution.review.json",
  );

  return {
    contractVersion: HIGH_RISK_REVIEW_PAYLOAD_CONTRACT_VERSION,
    ok: readiness.ok,
    exitCode: readiness.ok ? 0 : 1,
    projectRoot,
    sourceIngestRef: imported.path,
    localOnly: true,
    artifactPath,
    skill: {
      id: "high_risk_execution",
      resultContractRef: HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF,
    },
    verifiedAt: imported.payload.verifiedAt,
    reviewStatus: readiness.ok ? "ready_for_manager_review" : "blocked",
    managerReviewOwner: doctorResult.delegatedContracts.semanticReviewOwner,
    summary: imported.payload.summary,
    attachmentRefs: {
      packet_ref: imported.payload.summary.packet_ref,
      orchestration_state_ref: imported.payload.summary.orchestration_state_ref,
      prompt_ref: imported.payload.summary.prompt_ref,
      worker_output_ref: imported.payload.summary.worker_output_ref,
      evidence_refs: imported.payload.summary.evidence_refs,
    },
    ingestValidations: imported.payload.validations,
    readiness,
    doctor: {
      ok: doctorResult.ok,
      handoffReadiness: doctorResult.handoffReadiness,
      delegatedContracts: doctorResult.delegatedContracts,
    },
    nextAction: readiness.ok
      ? options.writeLocal
        ? `Write the high-risk review artifact to ${artifactPath}.`
        : "Review the review-ready payload or write it locally with `--write-local`."
      : readiness.reason,
  };
}

export function formatHighRiskReviewPayload(payload) {
  const nextAction = payload.readiness.ok
    ? payload.nextAction.startsWith("Write the high-risk review artifact to ")
      ? localize(payload.nextAction, `将 high-risk review 产物写入 ${payload.artifactPath}。`)
      : localize(
        payload.nextAction,
        `检查 review-ready payload，或使用 ${styleCommand("--write-local")} 将其写入本地。`,
      )
    : translateReviewReason(payload.nextAction);
  const lines = [
    styleHeading(`nimicoding review-high-risk-execution: ${payload.projectRoot}`),
    "",
    styleLabel(localize("Result:", "结果：")),
    `  - review_status: ${payload.reviewStatus}`,
    `  - manager_review_owner: ${payload.managerReviewOwner ?? localize("unknown", "未知")}`,
    `  - ready: ${styleStatus(payload.readiness.ok ? "ready" : "needs_attention")}`,
    `  - local_only: ${payload.localOnly ? "true" : "false"}`,
    "",
    styleLabel(localize("Next:", "下一步：")),
    `  - ${nextAction}`,
  ];

  return `${lines.join("\n")}\n`;
}
