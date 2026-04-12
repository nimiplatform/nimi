import { realpath } from "node:fs/promises";
import path from "node:path";

import {
  HIGH_RISK_DECISION_PAYLOAD_CONTRACT_VERSION,
  HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF,
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
import { validateAcceptance } from "./validators.mjs";
import { isIsoUtcTimestamp, isPlainObject } from "./value-helpers.mjs";

function translateDecisionReason(reason) {
  const translations = new Map([
    ["imported review payload must declare contractVersion nimicoding.high-risk-review.v1", "导入的 review payload 必须声明 contractVersion nimicoding.high-risk-review.v1"],
    ["imported review payload must declare skill.id high_risk_execution", "导入的 review payload 必须声明 skill.id 为 high_risk_execution"],
    ["imported review payload must remain localOnly true", "导入的 review payload 必须保持 localOnly 为 true"],
    ["decide-high-risk-execution requires a review payload with ok true", "decide-high-risk-execution 需要一个 ok 为 true 的 review payload"],
    ["decide-high-risk-execution requires reviewStatus ready_for_manager_review", "decide-high-risk-execution 需要 reviewStatus 为 ready_for_manager_review"],
    ["imported review payload must include attachmentRefs", "导入的 review payload 必须包含 attachmentRefs"],
    ["Bootstrap or handoff validation is failing; repair doctor errors before recording a manager decision", "bootstrap 或 handoff 校验失败；请先修复 doctor 报错，再记录 manager decision"],
    ["High-risk decision projection requires reconstructed `.nimi/spec/*.yaml` target truth", "high-risk decision 投影需要已重建的 `.nimi/spec/*.yaml` target truth"],
    ["Acceptance artifact failed mechanical validation", "acceptance 产物未通过机械校验"],
    ["Manager-owned local decision record is ready", "manager 拥有的本地 decision 记录已准备就绪"],
  ]);
  return translations.get(reason) ?? reason;
}

async function loadImportedReviewPayload(projectRoot, fromPath) {
  const absolutePath = path.resolve(projectRoot, fromPath);
  const rawText = await readTextIfFile(absolutePath);

  if (rawText === null) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding decide-high-risk-execution refused: cannot read imported review JSON at ${absolutePath}.`,
        `nimicoding decide-high-risk-execution 已拒绝：无法读取 ${absolutePath} 处的导入 review JSON。`,
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
        `nimicoding decide-high-risk-execution refused: imported review JSON at ${absolutePath} is invalid JSON.`,
        `nimicoding decide-high-risk-execution 已拒绝：${absolutePath} 处的导入 review JSON 不是合法 JSON。`,
      )}\n`,
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding decide-high-risk-execution refused: imported review JSON must be an object.",
        "nimicoding decide-high-risk-execution 已拒绝：导入的 review JSON 必须是对象。",
      )}\n`,
    };
  }

  if (parsed.projectRoot) {
    let importedProjectRoot;
    let currentProjectRoot;
    try {
      importedProjectRoot = await realpath(parsed.projectRoot);
      currentProjectRoot = await realpath(projectRoot);
    } catch {
      return {
        ok: false,
        error: `${localize(
          "nimicoding decide-high-risk-execution refused: imported review projectRoot could not be resolved.",
          "nimicoding decide-high-risk-execution 已拒绝：无法解析导入 review 的 projectRoot。",
        )}\n`,
      };
    }

    if (importedProjectRoot !== currentProjectRoot) {
      return {
        ok: false,
        error: `${localize(
          "nimicoding decide-high-risk-execution refused: imported review projectRoot does not match the current project.",
          "nimicoding decide-high-risk-execution 已拒绝：导入 review 的 projectRoot 与当前项目不匹配。",
        )}\n`,
      };
    }
  }

  return {
    ok: true,
    path: absolutePath,
    payload: parsed,
  };
}

function validateImportedReviewPayload(payload) {
  if (payload.contractVersion !== "nimicoding.high-risk-review.v1") {
    return {
      ok: false,
      reason: "imported review payload must declare contractVersion nimicoding.high-risk-review.v1",
    };
  }

  if (payload.skill?.id !== "high_risk_execution") {
    return {
      ok: false,
      reason: "imported review payload must declare skill.id high_risk_execution",
    };
  }

  if (payload.localOnly !== true) {
    return {
      ok: false,
      reason: "imported review payload must remain localOnly true",
    };
  }

  if (payload.ok !== true) {
    return {
      ok: false,
      reason: "decide-high-risk-execution requires a review payload with ok true",
    };
  }

  if (payload.reviewStatus !== "ready_for_manager_review") {
    return {
      ok: false,
      reason: "decide-high-risk-execution requires reviewStatus ready_for_manager_review",
    };
  }

  if (!isPlainObject(payload.attachmentRefs)) {
    return {
      ok: false,
      reason: "imported review payload must include attachmentRefs",
    };
  }

  return { ok: true };
}

function extractAcceptanceDisposition(text) {
  const match = text.match(/Disposition:\s*(\w+)/i);
  return match ? match[1].toLowerCase() : null;
}

function evaluateDecisionReadiness(doctorResult, acceptanceReport) {
  if (!doctorResult.ok || !doctorResult.handoffReadiness.ok) {
    return {
      ok: false,
      reason: "Bootstrap or handoff validation is failing; repair doctor errors before recording a manager decision",
    };
  }

  if (doctorResult.lifecycleState?.treeState !== "canonical_tree_ready" || doctorResult.canonicalTree?.requiredFilesValid !== true) {
    return {
      ok: false,
      reason: "High-risk decision projection requires canonical_tree_ready with declared canonical files present",
    };
  }

  if (!acceptanceReport.ok) {
    return {
      ok: false,
      reason: "Acceptance artifact failed mechanical validation",
    };
  }

  return {
    ok: true,
    reason: "Manager-owned local decision record is ready",
  };
}

export async function buildHighRiskDecisionPayload(projectRoot, options) {
  const imported = await loadImportedReviewPayload(projectRoot, options.fromPath);
  if (!imported.ok) {
    return {
      ok: false,
      exitCode: 2,
      inputError: true,
      error: imported.error,
    };
  }

  const inputValidation = validateImportedReviewPayload(imported.payload);
  if (!inputValidation.ok) {
    return {
      ok: false,
      exitCode: 2,
      inputError: true,
      error: `${localize(
        `nimicoding decide-high-risk-execution refused: ${inputValidation.reason}.`,
        `nimicoding decide-high-risk-execution 已拒绝：${translateDecisionReason(inputValidation.reason)}。`,
      )}\n`,
    };
  }

  if (!isIsoUtcTimestamp(options.verifiedAt)) {
    return {
      ok: false,
      exitCode: 2,
      inputError: true,
      error: `${localize(
        "nimicoding decide-high-risk-execution refused: --verified-at must be an ISO-8601 UTC timestamp.",
        "nimicoding decide-high-risk-execution 已拒绝：`--verified-at` 必须是 ISO-8601 UTC 时间戳。",
      )}\n`,
    };
  }

  const acceptanceRef = path.resolve(projectRoot, options.acceptancePath);
  const acceptanceText = await readTextIfFile(acceptanceRef);
  if (acceptanceText === null) {
    return {
      ok: false,
      exitCode: 2,
      inputError: true,
      error: `${localize(
        `nimicoding decide-high-risk-execution refused: cannot read acceptance artifact at ${acceptanceRef}.`,
        `nimicoding decide-high-risk-execution 已拒绝：无法读取 ${acceptanceRef} 处的 acceptance 产物。`,
      )}\n`,
    };
  }

  const acceptanceReport = await validateAcceptance(acceptanceRef);
  const disposition = extractAcceptanceDisposition(acceptanceText);
  if (!disposition) {
    return {
      ok: false,
      exitCode: 2,
      inputError: true,
      error: `${localize(
        "nimicoding decide-high-risk-execution refused: acceptance artifact must declare a Disposition line.",
        "nimicoding decide-high-risk-execution 已拒绝：acceptance 产物必须声明一行 `Disposition`。",
      )}\n`,
    };
  }

  const doctorResult = await inspectDoctorState(projectRoot);
  const readiness = evaluateDecisionReadiness(doctorResult, acceptanceReport);
  const artifactPath = path.join(
    projectRoot,
    ".nimi",
    "local",
    "handoff-results",
    "high_risk_execution.decision.json",
  );

  return {
    contractVersion: HIGH_RISK_DECISION_PAYLOAD_CONTRACT_VERSION,
    ok: readiness.ok,
    exitCode: readiness.ok ? 0 : 1,
    projectRoot,
    sourceReviewRef: imported.path,
    localOnly: true,
    artifactPath,
    skill: {
      id: "high_risk_execution",
      resultContractRef: HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF,
    },
    verifiedAt: options.verifiedAt,
    managerReviewOwner: imported.payload.managerReviewOwner ?? doctorResult.delegatedContracts.semanticReviewOwner,
    decisionStatus: readiness.ok ? "manager_decision_recorded" : "blocked",
    acceptanceRef,
    acceptanceDisposition: disposition,
    acceptanceValidation: {
      ok: acceptanceReport.ok,
      refusal: acceptanceReport.refusal ?? null,
      errors: acceptanceReport.errors ?? [],
      warnings: acceptanceReport.warnings ?? [],
    },
    reviewStatus: imported.payload.reviewStatus,
    summary: imported.payload.summary,
    attachmentRefs: imported.payload.attachmentRefs,
    readiness,
    doctor: {
      ok: doctorResult.ok,
      handoffReadiness: doctorResult.handoffReadiness,
      delegatedContracts: doctorResult.delegatedContracts,
    },
    nextAction: readiness.ok
      ? options.writeLocal
        ? `Write the high-risk decision artifact to ${artifactPath}.`
        : "Review the local decision payload or write it locally with `--write-local`."
      : readiness.reason,
  };
}

export function formatHighRiskDecisionPayload(payload) {
  const nextAction = payload.readiness.ok
    ? payload.nextAction.startsWith("Write the high-risk decision artifact to ")
      ? localize(payload.nextAction, `将 high-risk decision 产物写入 ${payload.artifactPath}。`)
      : localize(
        payload.nextAction,
        `检查本地 decision payload，或使用 ${styleCommand("--write-local")} 将其写入本地。`,
      )
    : translateDecisionReason(payload.nextAction);
  const lines = [
    styleHeading(`nimicoding decide-high-risk-execution: ${payload.projectRoot}`),
    "",
    styleLabel(localize("Decision:", "决策：")),
    `  - decision_status: ${payload.decisionStatus}`,
    `  - disposition: ${payload.acceptanceDisposition}`,
    `  - manager_review_owner: ${payload.managerReviewOwner ?? localize("unknown", "未知")}`,
    `  - ready: ${styleStatus(payload.readiness.ok ? "ready" : "needs_attention")}`,
    `  - local_only: ${payload.localOnly ? "true" : "false"}`,
    "",
    styleLabel(localize("Next:", "下一步：")),
    `  - ${nextAction}`,
  ];

  return `${lines.join("\n")}\n`;
}
