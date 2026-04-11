import { realpath } from "node:fs/promises";
import path from "node:path";

import {
  CLOSEOUT_PAYLOAD_CONTRACT_VERSION,
  SKILL_RESULT_CONTRACT_REFS,
} from "../constants.mjs";
import {
  loadDocSpecAuditContract,
  loadHighRiskExecutionContract,
  loadSpecReconstructionContract,
  validateDocSpecAuditSummary,
  validateHighRiskExecutionSummary,
  validateSpecReconstructionSummary,
} from "./contracts.mjs";
import { inspectDoctorState } from "./doctor.mjs";
import {
  loadExternalExecutionArtifactsConfig,
  validateHighRiskExecutionArtifactRefs,
} from "./external-execution.mjs";
import { readTextIfFile } from "./fs-helpers.mjs";
import {
  localize,
  styleCommand,
  styleHeading,
  styleLabel,
  styleStatus,
} from "./ui.mjs";
import { isIsoUtcTimestamp, isPlainObject } from "./value-helpers.mjs";
import { parseSkillSection } from "./yaml-helpers.mjs";

function translateCloseoutReason(reason) {
  const translations = new Map([
    ["spec_reconstruction result contract is missing or malformed", "spec_reconstruction 结果契约缺失或格式错误"],
    ["doc_spec_audit result contract is missing or malformed", "doc_spec_audit 结果契约缺失或格式错误"],
    ["high_risk_execution result contract is missing or malformed", "high_risk_execution 结果契约缺失或格式错误"],
    ["Bootstrap or handoff validation is failing; repair doctor errors before projecting closeout results", "bootstrap 或 handoff 校验失败；请先修复 doctor 报错，再投影 closeout 结果"],
    ["Non-completed outcomes may be projected as local-only closeout artifacts", "非 completed 的 outcome 可以仅投影为本地 closeout 产物"],
    ["Completed spec reconstruction requires all declared `.nimi/spec/*.yaml` target truth files to exist and satisfy the section contract", "完成 spec reconstruction 需要所有声明的 `.nimi/spec/*.yaml` target truth 文件存在且满足 section contract"],
    ["Completed spec reconstruction is consistent with reconstructed target truth", "已完成的 spec reconstruction 与重建后的 target truth 一致"],
    ["Completed closeout for this skill requires reconstructed `.nimi/spec/*.yaml` target truth", "该 skill 的 completed closeout 需要已重建的 `.nimi/spec/*.yaml` target truth"],
    ["Completed closeout is consistent with the current project-local truth", "completed closeout 与当前项目本地 truth 一致"],
  ]);

  if (translations.has(reason)) {
    return translations.get(reason);
  }

  const summaryImportPrefix = "summary import is not supported for skill ";
  if (reason.startsWith(summaryImportPrefix)) {
    return `当前不支持为该 skill 导入 summary：${reason.slice(summaryImportPrefix.length)}`;
  }

  const statusPrefix = "high_risk_execution summary.status must be ";
  if (reason.startsWith(statusPrefix)) {
    const suffix = reason.slice(statusPrefix.length);
    const [expectedStatus, outcomePart] = suffix.split(" when outcome is ");
    return `当 outcome 为 ${outcomePart} 时，high_risk_execution 的 summary.status 必须为 ${expectedStatus}`;
  }

  return reason;
}

async function validateCloseoutSummaryForSkill(projectRoot, skillId, summary, verifiedAt) {
  if (summary === undefined) {
    return { ok: true };
  }

  if (skillId === "spec_reconstruction") {
    const contract = await loadSpecReconstructionContract(projectRoot);
    if (!contract.ok) {
      return {
        ok: false,
        reason: "spec_reconstruction result contract is missing or malformed",
      };
    }

    return validateSpecReconstructionSummary(summary, contract, verifiedAt);
  }

  if (skillId === "doc_spec_audit") {
    const contract = await loadDocSpecAuditContract(projectRoot);
    if (!contract.ok) {
      return {
        ok: false,
        reason: "doc_spec_audit result contract is missing or malformed",
      };
    }

    return validateDocSpecAuditSummary(summary, contract, verifiedAt);
  }

  if (skillId === "high_risk_execution") {
    const contract = await loadHighRiskExecutionContract(projectRoot);
    if (!contract.ok) {
      return {
        ok: false,
        reason: "high_risk_execution result contract is missing or malformed",
      };
    }

    const summaryValidation = validateHighRiskExecutionSummary(summary, contract, verifiedAt);
    if (!summaryValidation.ok) {
      return summaryValidation;
    }

    const externalExecutionArtifacts = await loadExternalExecutionArtifactsConfig(projectRoot);
    return validateHighRiskExecutionArtifactRefs(summary, externalExecutionArtifacts);
  }

  return {
    ok: false,
    reason: `summary import is not supported for skill ${skillId}`,
  };
}

function validateOutcomeStatusConsistency(skillId, outcome, summary) {
  if (skillId !== "high_risk_execution" || summary === undefined) {
    return { ok: true };
  }

  const expectedStatusByOutcome = {
    completed: "candidate_ready",
    blocked: "blocked",
    failed: "failed",
  };
  const expectedStatus = expectedStatusByOutcome[outcome];

  if (summary.status !== expectedStatus) {
    return {
      ok: false,
      reason: `high_risk_execution summary.status must be ${expectedStatus} when outcome is ${outcome}`,
    };
  }

  return { ok: true };
}

function evaluateCloseoutReadiness(skillId, outcome, doctorResult) {
  if (!doctorResult.ok || !doctorResult.handoffReadiness.ok) {
    return {
      ok: false,
      reason: "Bootstrap or handoff validation is failing; repair doctor errors before projecting closeout results",
    };
  }

  if (outcome !== "completed") {
    return {
      ok: true,
      reason: "Non-completed outcomes may be projected as local-only closeout artifacts",
    };
  }

  if (skillId === "spec_reconstruction") {
    if (doctorResult.targetTruth.missing.length > 0 || doctorResult.targetTruth.invalid.length > 0) {
      return {
        ok: false,
        reason: "Completed spec reconstruction requires all declared `.nimi/spec/*.yaml` target truth files to exist and satisfy the section contract",
      };
    }

    return {
      ok: true,
      reason: "Completed spec reconstruction is consistent with reconstructed target truth",
    };
  }

  if (skillId === "doc_spec_audit" || skillId === "high_risk_execution") {
    if (doctorResult.targetTruth.missing.length > 0 || doctorResult.targetTruth.invalid.length > 0) {
      return {
        ok: false,
        reason: "Completed closeout for this skill requires reconstructed `.nimi/spec/*.yaml` target truth",
      };
    }
  }

  return {
    ok: true,
    reason: "Completed closeout is consistent with the current project-local truth",
  };
}

export async function validateImportedCloseoutShape(raw, projectRoot) {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding closeout refused: imported closeout JSON must be an object.",
        "nimicoding closeout 已拒绝：导入的 closeout JSON 必须是对象。",
      )}\n`,
    };
  }

  if (raw.projectRoot) {
    let importedProjectRoot;
    let currentProjectRoot;
    try {
      importedProjectRoot = await realpath(raw.projectRoot);
      currentProjectRoot = await realpath(projectRoot);
    } catch {
      return {
        ok: false,
        error: `${localize(
          "nimicoding closeout refused: imported closeout projectRoot could not be resolved.",
          "nimicoding closeout 已拒绝：无法解析导入 closeout 的 projectRoot。",
        )}\n`,
      };
    }

    if (importedProjectRoot !== currentProjectRoot) {
      return {
        ok: false,
        error: `${localize(
          "nimicoding closeout refused: imported closeout projectRoot does not match the current project.",
          "nimicoding closeout 已拒绝：导入 closeout 的 projectRoot 与当前项目不匹配。",
        )}\n`,
      };
    }
  }

  const skillId = typeof raw.skill === "string"
    ? raw.skill
    : raw.skill && typeof raw.skill === "object" && typeof raw.skill.id === "string"
      ? raw.skill.id
      : null;

  if (!skillId) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding closeout refused: imported closeout JSON must declare `skill.id`.",
        "nimicoding closeout 已拒绝：导入的 closeout JSON 必须声明 `skill.id`。",
      )}\n`,
    };
  }

  if (typeof raw.outcome !== "string" || !["completed", "blocked", "failed"].includes(raw.outcome)) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding closeout refused: imported closeout JSON must declare a supported `outcome`.",
        "nimicoding closeout 已拒绝：导入的 closeout JSON 必须声明受支持的 `outcome`。",
      )}\n`,
    };
  }

  if (!isIsoUtcTimestamp(raw.verifiedAt)) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding closeout refused: imported `verifiedAt` must be an ISO-8601 UTC timestamp.",
        "nimicoding closeout 已拒绝：导入的 `verifiedAt` 必须是 ISO-8601 UTC 时间戳。",
      )}\n`,
    };
  }

  if ("localOnly" in raw && raw.localOnly !== true) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding closeout refused: imported closeout JSON cannot claim non-local semantic promotion.",
        "nimicoding closeout 已拒绝：导入的 closeout JSON 不能声明非本地语义提升。",
      )}\n`,
    };
  }

  if ("summary" in raw && !isPlainObject(raw.summary)) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding closeout refused: imported closeout JSON `summary` must be an object when present.",
        "nimicoding closeout 已拒绝：导入的 closeout JSON 中 `summary` 如果存在，必须是对象。",
      )}\n`,
    };
  }

  return {
    ok: true,
    options: {
      skill: skillId,
      outcome: raw.outcome,
      verifiedAt: raw.verifiedAt,
      summary: raw.summary,
    },
  };
}

export async function loadImportedCloseoutOptions(projectRoot, fromPath) {
  const absolutePath = path.resolve(projectRoot, fromPath);
  const rawText = await readTextIfFile(absolutePath);

  if (rawText === null) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding closeout refused: cannot read imported closeout JSON at ${absolutePath}.`,
        `nimicoding closeout 已拒绝：无法读取 ${absolutePath} 处的导入 closeout JSON。`,
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
        `nimicoding closeout refused: imported closeout JSON at ${absolutePath} is invalid JSON.`,
        `nimicoding closeout 已拒绝：${absolutePath} 处的导入 closeout JSON 不是合法 JSON。`,
      )}\n`,
    };
  }

  return validateImportedCloseoutShape(parsed, projectRoot);
}

export async function buildCloseoutPayload(projectRoot, options) {
  const doctorResult = await inspectDoctorState(projectRoot);
  const manifestText = await readTextIfFile(path.join(projectRoot, ".nimi", "config", "skill-manifest.yaml"));
  const skillsConfigText = await readTextIfFile(path.join(projectRoot, ".nimi", "config", "skills.yaml"));
  const manifestSkills = parseSkillSection(manifestText, "skills");
  const expectedSkills = parseSkillSection(skillsConfigText, "expected_skill_surfaces");
  const manifestSkill = manifestSkills.find((skill) => skill.id === options.skill) ?? null;
  const expectedSkill = expectedSkills.find((skill) => skill.id === options.skill) ?? null;

  if (!manifestSkill || !expectedSkill) {
    return {
      ok: false,
      exitCode: 1,
      error: localize(
        `Unknown or undeclared skill id: ${options.skill}`,
        `未知或未声明的 skill id：${options.skill}`,
      ),
      availableSkills: manifestSkills.map((skill) => skill.id),
      doctor: doctorResult,
    };
  }

  const resultContractRef = manifestSkill.result_contract_ref ?? SKILL_RESULT_CONTRACT_REFS[options.skill] ?? null;
  const summaryValidation = await validateCloseoutSummaryForSkill(
    projectRoot,
    options.skill,
    options.summary,
    options.verifiedAt,
  );

  if (!summaryValidation.ok) {
    return {
      ok: false,
      exitCode: 2,
      inputError: true,
      error: `${localize(
        `nimicoding closeout refused: ${summaryValidation.reason}.`,
        `nimicoding closeout 已拒绝：${translateCloseoutReason(summaryValidation.reason)}。`,
      )}\n`,
    };
  }

  const statusConsistency = validateOutcomeStatusConsistency(
    options.skill,
    options.outcome,
    options.summary,
  );
  if (!statusConsistency.ok) {
    return {
      ok: false,
      exitCode: 2,
      inputError: true,
      error: `${localize(
        `nimicoding closeout refused: ${statusConsistency.reason}.`,
        `nimicoding closeout 已拒绝：${translateCloseoutReason(statusConsistency.reason)}。`,
      )}\n`,
    };
  }

  const readiness = evaluateCloseoutReadiness(options.skill, options.outcome, doctorResult);
  const localArtifactPath = path.join(projectRoot, ".nimi", "local", "handoff-results", `${options.skill}.json`);
  const payload = {
    contractVersion: CLOSEOUT_PAYLOAD_CONTRACT_VERSION,
    ok: readiness.ok,
    exitCode: readiness.ok ? 0 : 1,
    projectRoot,
    skill: {
      id: options.skill,
      required: expectedSkill.required === "true",
      purpose: expectedSkill.purpose ?? null,
      source: manifestSkill.source ?? "external",
      resultContractRef,
    },
    outcome: options.outcome,
    verifiedAt: options.verifiedAt,
    localOnly: true,
    artifactPath: localArtifactPath,
    summary: options.summary,
    contracts: {
      exchangeProjectionContractRef: ".nimi/methodology/skill-exchange-projection.yaml",
      handoffRef: ".nimi/methodology/skill-handoff.yaml",
      resultContractRef,
    },
    readiness,
    targetTruth: doctorResult.targetTruth,
    doctor: {
      ok: doctorResult.ok,
      handoffReadiness: doctorResult.handoffReadiness,
      delegatedContracts: doctorResult.delegatedContracts,
      auditArtifact: doctorResult.auditArtifact,
    },
    nextAction: readiness.ok
      ? options.writeLocal
        ? `Write the closeout artifact to ${localArtifactPath}.`
        : "Review the projected closeout payload or write it locally with `--write-local`."
      : readiness.reason,
  };

  return payload;
}

export function formatCloseoutPayload(payload) {
  const nextAction = !payload.readiness.ok
    ? translateCloseoutReason(payload.nextAction)
    : payload.nextAction.startsWith("Write the closeout artifact to ")
      ? localize(payload.nextAction, `将 closeout 产物写入 ${payload.artifactPath}。`)
      : localize(
        payload.nextAction,
        `检查投影后的 closeout payload，或使用 ${styleCommand("--write-local")} 将其写入本地。`,
      );
  const lines = [
    styleHeading(`nimicoding closeout: ${payload.projectRoot}`),
    "",
    styleLabel(localize("Skill:", "Skill：")),
    `  - id: ${payload.skill.id}`,
    `  - required: ${payload.skill.required ? "true" : "false"}`,
    `  - source: ${payload.skill.source}`,
    `  - purpose: ${payload.skill.purpose ?? localize("unknown", "未知")}`,
    `  - result_contract_ref: ${payload.skill.resultContractRef ?? "none"}`,
    "",
    styleLabel(localize("Result:", "结果：")),
    `  - outcome: ${payload.outcome}`,
    `  - verified_at: ${payload.verifiedAt}`,
    `  - ready: ${styleStatus(payload.readiness.ok ? "ready" : "needs_attention")}`,
    `  - local_only: ${payload.localOnly ? "true" : "false"}`,
    "",
    styleLabel(localize("Target Truth:", "目标 Truth：")),
    `  - present: ${payload.targetTruth.present.length}`,
    `  - missing: ${payload.targetTruth.missing.length}`,
    "",
    styleLabel(localize("Next:", "下一步：")),
    `  - ${nextAction}`,
  ];

  if (payload.summary?.status) {
    lines.splice(lines.length - 3, 0, "", styleLabel(localize("Summary:", "摘要：")), `  - status: ${payload.summary.status}`);
  }

  return `${lines.join("\n")}\n`;
}
