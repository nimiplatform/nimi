import { readdir, realpath } from "node:fs/promises";
import path from "node:path";

import {
  CLOSEOUT_PAYLOAD_CONTRACT_VERSION,
  SKILL_RESULT_CONTRACT_REFS,
} from "../constants.mjs";
import {
  loadAuditSweepContract,
  loadDocSpecAuditContract,
  loadHighRiskExecutionContract,
  loadSpecReconstructionContract,
  validateAuditSweepSummary,
  validateDocSpecAuditSummary,
  validateHighRiskExecutionSummary,
  validateSpecReconstructionSummary,
} from "./contracts.mjs";
import { inspectDoctorState } from "./doctor.mjs";
import {
  loadExternalExecutionArtifactsConfig,
  validateHighRiskExecutionArtifactRefs,
} from "./external-execution.mjs";
import { validateAuditSweepArtifacts } from "./audit-sweep-runtime/validators.mjs";
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
    ["audit_sweep result contract is missing or malformed", "audit_sweep 结果契约缺失或格式错误"],
    ["high_risk_execution result contract is missing or malformed", "high_risk_execution 结果契约缺失或格式错误"],
    ["Bootstrap or handoff validation is failing; repair doctor errors before projecting closeout results", "bootstrap 或 handoff 校验失败；请先修复 doctor 报错，再投影 closeout 结果"],
    ["Non-completed outcomes may be projected as local-only closeout artifacts", "非 completed 的 outcome 可以仅投影为本地 closeout 产物"],
    ["Completed closeout is not allowed in the current lifecycle state", "当前生命周期状态不允许完成该 closeout"],
    ["Completed closeout requires declared canonical tree files to be valid", "完成 closeout 需要声明的 canonical tree 文件有效"],
    ["Completed closeout requires a valid `.nimi/spec/_meta/spec-generation-audit.yaml` artifact", "完成 closeout 需要一个有效的 `.nimi/spec/_meta/spec-generation-audit.yaml` 产物"],
    ["Completed doc_spec_audit closeout must compare against `.nimi/spec`", "完成 doc_spec_audit closeout 时必须对 `.nimi/spec` 进行比较"],
    ["Completed high_risk_execution closeout requires canonical admissions truth to remain `.nimi/spec/high-risk-admissions.yaml`", "完成 high_risk_execution closeout 需要 canonical admissions truth 继续落在 `.nimi/spec/high-risk-admissions.yaml`"],
    ["Completed closeout is consistent with the current canonical tree state", "completed closeout 与当前 canonical tree 状态一致"],
  ]);

  if (translations.has(reason)) {
    return translations.get(reason);
  }

  const statusPrefix = " summary.status must be ";
  if (reason.includes(statusPrefix)) {
    const [skillId, suffix] = reason.split(statusPrefix);
    const [expectedStatus, outcomePart] = suffix.split(" when outcome is ");
    return `当 outcome 为 ${outcomePart} 时，${skillId} 的 summary.status 必须为 ${expectedStatus}`;
  }

  const noSummarySuffix = " does not accept summary when outcome is failed";
  if (reason.endsWith(noSummarySuffix)) {
    return `${reason.slice(0, -noSummarySuffix.length)} 在 outcome 为 failed 时不得携带 summary`;
  }

  const summaryImportPrefix = "summary import is not supported for skill ";
  if (reason.startsWith(summaryImportPrefix)) {
    return `当前不支持为该 skill 导入 summary：${reason.slice(summaryImportPrefix.length)}`;
  }

  return reason;
}

function inferAuditSweepIdFromSummary(summary) {
  if (typeof summary?.ledger_ref !== "string") {
    return null;
  }
  const match = summary.ledger_ref.match(/^\.nimi\/local\/audit\/ledgers\/([^/]+)\/ledger-[a-f0-9]{16}\.yaml$/);
  return match ? match[1] : null;
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

  if (skillId === "audit_sweep") {
    const contract = await loadAuditSweepContract(projectRoot);
    if (!contract.ok) {
      return {
        ok: false,
        reason: "audit_sweep result contract is missing or malformed",
      };
    }

    const summaryValidation = validateAuditSweepSummary(summary, contract, verifiedAt);
    if (!summaryValidation.ok) {
      return summaryValidation;
    }
    const sweepId = inferAuditSweepIdFromSummary(summary);
    if (!sweepId) {
      return {
        ok: false,
        reason: "audit_sweep summary.ledger_ref must identify a local audit sweep ledger",
      };
    }
    const artifactValidation = await validateAuditSweepArtifacts(projectRoot, { sweepId, scope: "closeout" });
    if (!artifactValidation.ok) {
      const failed = artifactValidation.checks.find((entry) => !entry.ok);
      return {
        ok: false,
        reason: `audit_sweep artifact validation failed: ${failed?.reason ?? "unknown failure"}`,
      };
    }
    return { ok: true };
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
  const expectedStatusBySkillAndOutcome = {
    spec_reconstruction: {
      completed: ["reconstructed", "partial"],
      blocked: ["blocked"],
      failed: [],
    },
    doc_spec_audit: {
      completed: ["aligned", "drift_detected"],
      blocked: ["blocked"],
      failed: [],
    },
    audit_sweep: {
      completed: ["candidate_ready", "partial"],
      blocked: ["blocked"],
      failed: [],
    },
    high_risk_execution: {
      completed: ["candidate_ready"],
      blocked: ["blocked"],
      failed: ["failed"],
    },
  };

  const expectedStatuses = expectedStatusBySkillAndOutcome[skillId]?.[outcome];
  if (!expectedStatuses) {
    return { ok: true };
  }

  if (outcome === "failed") {
    if (summary !== undefined) {
      return {
        ok: false,
        reason: `${skillId} does not accept summary when outcome is failed`,
      };
    }
    return { ok: true };
  }

  if (summary === undefined) {
    return { ok: true };
  }

  if (!expectedStatuses.includes(summary.status)) {
    return {
      ok: false,
      reason: `${skillId} summary.status must be ${expectedStatuses.join("|")} when outcome is ${outcome}`,
    };
  }

  return { ok: true };
}

async function collectSpecPaths(rootPath, relativePrefix) {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name);
    const relativePath = path.posix.join(relativePrefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSpecPaths(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

async function synthesizeSpecReconstructionSummary(projectRoot, doctorResult, verifiedAt) {
  const generatedPaths = await collectSpecPaths(path.join(projectRoot, ".nimi", "spec"), ".nimi/spec");
  const auditSummary = doctorResult.specGenerationAudit?.summary ?? {};
  const unresolvedFileCount = Number.isInteger(auditSummary.unresolvedFiles) ? auditSummary.unresolvedFiles : 0;
  const inferredFileCount = Number.isInteger(auditSummary.inferredFiles) ? auditSummary.inferredFiles : 0;
  const placeholderFiles = Number.isInteger(auditSummary.placeholderFiles) ? auditSummary.placeholderFiles : 0;
  const partialFiles = Number.isInteger(auditSummary.partialFiles) ? auditSummary.partialFiles : unresolvedFileCount;
  const shouldBePartial = partialFiles > 0 || unresolvedFileCount > 0 || inferredFileCount > 0;

  return {
    generated_paths: generatedPaths,
    audit_ref: ".nimi/spec/_meta/spec-generation-audit.yaml",
    coverage_summary: {
      complete_files: Math.max(generatedPaths.length - partialFiles - placeholderFiles, 0),
      partial_files: partialFiles,
      placeholder_files: placeholderFiles,
    },
    unresolved_file_count: unresolvedFileCount,
    inferred_file_count: inferredFileCount,
    status: doctorResult.specGenerationAudit?.ok && !shouldBePartial ? "reconstructed" : "partial",
    summary: doctorResult.specGenerationAudit?.ok && !shouldBePartial
      ? "Canonical spec generation completed with file-level audit coverage."
      : "Canonical spec generation is valid, but file-level audit still records inferred or unresolved coverage.",
    verified_at: verifiedAt,
  };
}

function evaluateCloseoutReadiness(skillId, outcome, doctorResult, summary) {
  if (outcome !== "completed") {
    if (!doctorResult.ok || !doctorResult.handoffReadiness.ok) {
      return {
        ok: false,
        reason: "Bootstrap or handoff validation is failing; repair doctor errors before projecting closeout results",
      };
    }
    return {
      ok: true,
      reason: "Non-completed outcomes may be projected as local-only closeout artifacts",
    };
  }

  const rule = (doctorResult.commandGating?.entries ?? []).find((entry) => entry.command === "closeout" && entry.skill === skillId) ?? null;
  if (!rule?.completedRequires) {
    return {
      ok: false,
      reason: "Completed closeout is not allowed in the current lifecycle state",
    };
  }

  const treeState = doctorResult.lifecycleState?.treeState;
  if (rule.completedRequires.tree_state && rule.completedRequires.tree_state !== treeState) {
    return {
      ok: false,
      reason: "Completed closeout is not allowed in the current lifecycle state",
    };
  }

  if (rule.completedRequires.canonical_required_files_valid === true && doctorResult.canonicalTree?.requiredFilesValid !== true) {
    return {
      ok: false,
      reason: "Completed closeout requires declared canonical tree files to be valid",
    };
  }

  if (rule.completedRequires.spec_generation_audit_valid === true && doctorResult.specGenerationAudit?.ok !== true) {
    return {
      ok: false,
      reason: "Completed closeout requires a valid `.nimi/spec/_meta/spec-generation-audit.yaml` artifact",
    };
  }

  if (rule.completedRequires.audit_references_canonical_root === true) {
    const comparedPaths = Array.isArray(summary?.compared_paths) ? summary.compared_paths : [];
    if (!comparedPaths.includes(".nimi/spec")) {
      return {
        ok: false,
        reason: "Completed doc_spec_audit closeout must compare against `.nimi/spec`",
      };
    }
  }

  if (rule.completedRequires.high_risk_admissions_truth_ref) {
    const admissionsTruthPath = rule.completedRequires.high_risk_admissions_truth_ref;
    const expectedAdmissionsPath = doctorResult.commandGating.entries.find(
      (entry) => entry.command === "admit-high-risk-decision" && entry.requires?.canonical_admissions_truth,
    )?.requires?.canonical_admissions_truth ?? ".nimi/spec/high-risk-admissions.yaml";
    if (admissionsTruthPath !== expectedAdmissionsPath) {
      return {
        ok: false,
        reason: "Completed high_risk_execution closeout requires canonical admissions truth to remain `.nimi/spec/high-risk-admissions.yaml`",
      };
    }
  }

  if (!doctorResult.ok || !doctorResult.handoffReadiness.ok) {
    return {
      ok: false,
      reason: "Bootstrap or handoff validation is failing; repair doctor errors before projecting closeout results",
    };
  }

  return {
    ok: true,
    reason: "Completed closeout is consistent with the current canonical tree state",
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
  let effectiveSummary = options.summary;
  if (!effectiveSummary && options.skill === "spec_reconstruction" && options.outcome === "completed") {
    effectiveSummary = await synthesizeSpecReconstructionSummary(projectRoot, doctorResult, options.verifiedAt);
  }
  const summaryValidation = await validateCloseoutSummaryForSkill(
    projectRoot,
    options.skill,
    effectiveSummary,
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
    effectiveSummary,
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

  const readiness = evaluateCloseoutReadiness(options.skill, options.outcome, doctorResult, effectiveSummary);
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
    summary: effectiveSummary,
    contracts: {
      exchangeProjectionContractRef: ".nimi/methodology/skill-exchange-projection.yaml",
      handoffRef: ".nimi/methodology/skill-handoff.yaml",
      resultContractRef,
    },
    readiness,
    doctor: {
      ok: doctorResult.ok,
      handoffReadiness: doctorResult.handoffReadiness,
      delegatedContracts: doctorResult.delegatedContracts,
      specGenerationAudit: doctorResult.specGenerationAudit,
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
    styleLabel(localize("Next:", "下一步：")),
    `  - ${nextAction}`,
  ];

  if (payload.summary?.status) {
    lines.splice(lines.length - 3, 0, "", styleLabel(localize("Summary:", "摘要：")), `  - status: ${payload.summary.status}`);
  }

  return `${lines.join("\n")}\n`;
}
