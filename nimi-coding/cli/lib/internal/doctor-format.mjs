import {
  localize,
  styleHeading,
  styleLabel,
  styleMuted,
  styleStatus,
} from "../ui.mjs";
import { emptyHostCompatibility } from "./doctor-state.mjs";

const DOCTOR_DETAIL_TRANSLATIONS = new Map([
  [".nimi directory is missing", ".nimi 目录缺失"],
  [".nimi exists but is not a directory", ".nimi 已存在但不是目录"],
  [".nimi directory exists", ".nimi 目录存在"],
  ["Local state directories are present", "本地状态目录已存在"],
  ["Local nimicoding state is ignored by .gitignore", ".gitignore 已忽略本地 nimicoding 状态"],
  ["bootstrap.yaml declares the package bootstrap identity", "bootstrap.yaml 已声明包的 bootstrap 身份"],
  ["bootstrap contract nimicoding.bootstrap version 1 is supported", "bootstrap contract nimicoding.bootstrap version 1 受支持"],
  ["bootstrap-state.yaml matches the bootstrap_only tree-state contract", "bootstrap-state.yaml 符合 bootstrap_only tree-state contract"],
  ["bootstrap-state.yaml matches the canonical_tree_ready tree-state contract", "bootstrap-state.yaml 符合 canonical_tree_ready tree-state contract"],
  ["Product scope declares standalone completion profile boundary_complete", "product scope 声明了 standalone completion profile boundary_complete"],
  [".nimi/spec/_meta/spec-tree-model.yaml declares canonical root .nimi/spec with profile minimal", ".nimi/spec/_meta/spec-tree-model.yaml 声明了 canonical root .nimi/spec，profile 为 minimal"],
  [".nimi/spec/_meta/command-gating-matrix.yaml declares 12 command gating rules", ".nimi/spec/_meta/command-gating-matrix.yaml 声明了 12 条命令 gating 规则"],
  [".nimi/contracts/spec-generation-inputs.schema.yaml is present and structurally valid", ".nimi/contracts/spec-generation-inputs.schema.yaml 已存在且结构有效"],
  [".nimi/contracts/spec-generation-audit.schema.yaml is present and structurally valid", ".nimi/contracts/spec-generation-audit.schema.yaml 已存在且结构有效"],
  [".nimi/config/spec-generation-inputs.yaml declares mixed canonical spec generation inputs", ".nimi/config/spec-generation-inputs.yaml 已声明 mixed canonical spec generation inputs"],
  [".nimi/spec/_meta/blueprint-reference.yaml matches blueprint mode repo_spec_blueprint", ".nimi/spec/_meta/blueprint-reference.yaml 与 blueprint mode repo_spec_blueprint 保持一致"],
  ["Benchmark audit can compare the declared blueprint root against the candidate canonical tree", "benchmark audit 可以比较声明的 blueprint root 与候选 canonical tree"],
  ["Declared canonical tree required files are present", "声明的 canonical tree 必需文件已存在"],
  ["Spec generation audit is present and structurally valid", "spec generation audit 已存在且结构有效"],
  ["No spec generation audit detected yet; it will be required before completed reconstruction closeout", "尚未检测到 spec generation audit；在 completed reconstruction closeout 之前将要求该产物"],
  ["Canonical tree is ready but spec generation audit is still missing or invalid", "canonical tree 已就绪，但 spec generation audit 仍然缺失或无效"],
  ["Command gating matrix includes high_risk_execution closeout readiness", "命令 gating matrix 已包含 high_risk_execution 的 closeout 准入规则"],
  ["bootstrap.yaml was created by nimicoding but is missing bootstrap contract metadata", "bootstrap.yaml 由 nimicoding 创建，但缺少 bootstrap contract 元数据"],
  ["bootstrap.yaml is missing and bootstrap contract compatibility could not be checked", "bootstrap.yaml 缺失，无法检查 bootstrap contract 兼容性"],
  ["bootstrap.yaml declares an unsupported bootstrap contract id or version", "bootstrap.yaml 声明了不受支持的 bootstrap contract id 或 version"],
  ["skills.yaml keeps runtime delegated and handoff-driven", "skills.yaml 保持 runtime 为委托式且以 handoff 驱动"],
  ["Delegated runtime ownership and non-self-hosted posture are consistent across contracts", "各契约中的 delegated runtime ownership 与 non-self-hosted 姿态保持一致"],
  ["Manifest, runtime, installer, host-profile, host-adapter, and handoff references are aligned", "manifest、runtime、installer、host-profile、host-adapter 与 handoff 的引用保持一致"],
  ["Skill manifest result contract refs align with the declared machine contracts", "skill manifest 的 result contract 引用与声明的机器契约保持一致"],
  ["Handoff context order contains the declared host context and all listed paths exist", "handoff context 顺序包含声明的 host context，且所有列出的路径均存在"],
  ["Manifest skills align with the expected skill surfaces declared in skills.yaml", "manifest skills 与 skills.yaml 中声明的 expected skill surfaces 保持一致"],
  ["spec-reconstruction result contract is present and structurally valid", "spec-reconstruction 结果契约存在且结构有效"],
  ["doc-spec-audit result contract is present and structurally valid", "doc-spec-audit 结果契约存在且结构有效"],
  ["audit-sweep result contract is present and structurally valid", "audit-sweep 结果契约存在且结构有效"],
  ["Packaged external host compatibility contract is present and aligned", "包内 external host 兼容契约存在且一致"],
  ["audit execution artifact landing-path contract is present and structurally valid", "audit execution artifact landing-path 契约存在且结构有效"],
  ["high-risk-execution result contract is present and structurally valid", "high-risk-execution 结果契约存在且结构有效"],
  ["Packaged high-risk admission schema contract is present and aligned", "包内 high-risk admission schema 契约存在且一致"],
  ["external execution artifact landing-path contract is present and structurally valid", "external execution artifact landing-path 契约存在且结构有效"],
  ["High-risk execution schema seeds are present and structurally valid", "high-risk execution schema seed 已存在且结构有效"],
  ["Canonical high-risk admissions truth satisfies the packaged admission schema contract", "canonical high-risk admissions truth 满足包内 admission schema 契约"],
  ["No host adapter selected; vendor-neutral delegated host posture remains active", "未选择 host adapter；vendor-neutral 的 delegated host 姿态仍然生效"],
  ["Package-owned adapter profile overlays are present and valid: codex, oh_my_codex, claude", "包内 adapter profile overlay 已存在且有效：codex, oh_my_codex, claude"],
  ["Host adapter boundary keeps semantic review in nimicoding and limits handoff to prompt/output/evidence", "host adapter 边界保持 semantic review 在 nimicoding 内，并将 handoff 限制为 prompt/output/evidence"],
  ["bootstrap-state lifecycle bootstrap_only is aligned with the current canonical tree readiness", "bootstrap-state 的 bootstrap_only lifecycle 与当前 canonical tree readiness 保持一致"],
  ["bootstrap-state lifecycle canonical_tree_ready is aligned with the current canonical tree readiness", "bootstrap-state 的 canonical_tree_ready lifecycle 与当前 canonical tree readiness 保持一致"],
  ["No local doc_spec_audit closeout artifact detected", "未检测到本地 doc_spec_audit closeout 产物"],
  ["Local doc_spec_audit artifact is consistent with the current reconstruction state", "本地 doc_spec_audit 产物与当前重建状态一致"],
  ["Managed AI entrypoint blocks detected in: AGENTS.md, CLAUDE.md", "在 AGENTS.md、CLAUDE.md 中检测到托管 AI 入口块"],
  ["No managed AI entrypoint blocks detected; this is optional", "未检测到托管 AI 入口块；这是可选的"],
]);

const DOCTOR_NEXT_STEP_TRANSLATIONS = new Map([
  ["Repair the failing bootstrap checks, then rerun `nimicoding doctor`.", "修复失败的 bootstrap 检查项，然后重新运行 `nimicoding doctor`。"],
  ["Use an external AI host to reconstruct the declared canonical tree under `.nimi/spec`.", "使用外部 AI host 重建声明的 `.nimi/spec` canonical tree。"],
  ["Run `nimicoding blueprint-audit --write-local` after canonical tree generation when a benchmark blueprint is declared.", "当声明了 benchmark blueprint 且 canonical tree 生成完成后，运行 `nimicoding blueprint-audit --write-local`。"],
  ["Run `nimicoding validate-spec-audit` after generating `.nimi/spec/_meta/spec-generation-audit.yaml` for the canonical tree.", "在为 canonical tree 生成 `.nimi/spec/_meta/spec-generation-audit.yaml` 后，运行 `nimicoding validate-spec-audit`。"],
  ["Run `nimicoding handoff --skill doc_spec_audit` and close out the result locally when the audit is complete.", "运行 `nimicoding handoff --skill doc_spec_audit`，并在审计完成后于本地 closeout 结果。"],
  ["Keep runtime ownership delegated; do not assume local skill installation or self-hosting.", "保持 runtime ownership 为 delegated；不要假设本地 skill 安装或 self-hosting。"],
  ["If you want a constrained external execution host, select one in `.nimi/config/host-adapter.yaml`.", "如果你希望使用受约束的外部执行 host，请在 `.nimi/config/host-adapter.yaml` 中选择一个。"],
]);

function translateDoctorDetail(detail) {
  if (/^All required bootstrap seed files are present \(\d+\/\d+\)$/.test(detail)) {
    return detail.replace("All required bootstrap seed files are present", "所有必需的 bootstrap seed 文件均已存在");
  }

  return DOCTOR_DETAIL_TRANSLATIONS.get(detail) ?? detail;
}

function translateDoctorNextStep(step) {
  return DOCTOR_NEXT_STEP_TRANSLATIONS.get(step) ?? step;
}

function summarizeDoctorState(result) {
  const blockingChecks = result.checks.filter((check) => check.severity === "error");
  const warningChecks = result.checks.filter((check) => check.severity === "warn");
  const importantInfoChecks = result.checks.filter((check) => check.severity === "info").slice(0, 2);

  const bootstrapState = !result.bootstrapPresent
    ? localize("missing", "缺失")
    : result.bootstrapContract.status === "supported"
      ? localize("ready", "就绪")
      : localize("needs attention", "需要关注");

  const canonicalTreeState = !result.specTreeModel?.ok
    ? localize("invalid", "无效")
    : !result.canonicalTree.requiredFilesValid
      ? localize("incomplete", "未完成")
      : localize("ready", "就绪");

  const auditState = !result.specGenerationAudit?.present
    ? localize("not started", "未开始")
    : result.specGenerationAudit?.ok
      ? localize("ready", "就绪")
      : localize("needs attention", "需要关注");
  const benchmarkAuditState = !result.benchmarkAuditReadiness?.available
    ? localize("not declared", "未声明")
    : result.benchmarkAuditReadiness.ready
      ? localize("ready", "就绪")
      : localize("needs attention", "需要关注");

  const entrypointIntegrated = result.checks.some((check) => check.id === "entrypoint_integration" && check.detail.includes("Managed AI entrypoint blocks detected"));

  return {
    blockingChecks,
    warningChecks,
    importantInfoChecks,
    bootstrapState,
    canonicalTreeState,
    auditState,
    benchmarkAuditState,
    entrypointIntegrated,
  };
}

function formatDoctorResultVerbose(result) {
  const hostCompatibility = result.hostCompatibility ?? emptyHostCompatibility();
  const lines = [
    styleHeading(`nimicoding doctor: ${result.projectRoot}`),
    "",
    styleLabel(localize("Overall:", "总体：")),
    `  - ${localize("status", "状态")}: ${styleStatus(result.ok ? "ok" : "needs_attention")}`,
    `  - bootstrap_present: ${result.bootstrapPresent ? "true" : "false"}`,
    `  - reconstruction_required: ${result.reconstructionRequired ? "true" : "false"}`,
    `  - runtime_installed: ${result.runtimeInstalled ? "true" : "false"}`,
    `  - handoff_ready: ${result.handoffReadiness.ok ? "true" : "false"}`,
    `  - tree_state: ${result.lifecycleState.treeState ?? "unknown"}`,
    `  - authority_mode: ${result.lifecycleState.authorityMode ?? "unknown"}`,
    `  - blueprint_mode: ${result.lifecycleState.blueprintMode ?? "unknown"}`,
    "",
    styleLabel(localize("Bootstrap:", "Bootstrap：")),
    `  - contract_status: ${result.bootstrapContract.status}`,
    `  - contract_id: ${result.bootstrapContract.id ?? "unknown"}`,
    `  - contract_version: ${result.bootstrapContract.version ?? "unknown"}`,
    "",
    styleLabel(localize("Completion Posture:", "完成姿态：")),
    `  - profile: ${result.completionProfile ?? "unknown"}`,
    `  - ${localize("status", "状态")}: ${styleStatus(result.completionStatus ?? "unknown")}`,
    `  - completed_surfaces: ${result.completedSurfaces.length}`,
    "",
    styleLabel(localize("Supported Host Posture:", "支持的 Host 姿态：")),
    `  - contract_ref: ${hostCompatibility.contractRef ?? "unknown"}`,
    `  - supported_host_posture: ${hostCompatibility.supportedHostPosture.join(", ") || "none"}`,
    `  - supported_host_examples: ${hostCompatibility.supportedHostExamples.join(", ") || "none"}`,
    `  - required_behavior: ${hostCompatibility.requiredBehavior.length}`,
    `  - forbidden_behavior: ${hostCompatibility.forbiddenBehavior.length}`,
    `  - generic_external_host_compatible: ${hostCompatibility.genericExternalHostCompatible ? "true" : "false"}`,
    `  - named_overlay_mode: ${hostCompatibility.namedOverlaySupport.mode}`,
    `  - admitted_named_overlays: ${hostCompatibility.namedOverlaySupport.admittedOverlayIds.join(", ") || "none"}`,
    `  - selected_named_overlay: ${hostCompatibility.namedOverlaySupport.selectedOverlayId ?? "none"}`,
    "",
    styleLabel(localize("Delegated Contracts:", "委托契约：")),
    `  - runtime_owner: ${result.delegatedContracts.runtimeOwner ?? "unknown"}`,
    `  - runtime_mode: ${result.delegatedContracts.executionMode ?? "unknown"}`,
    `  - installer_mode: ${result.delegatedContracts.installerMode ?? "unknown"}`,
    `  - self_hosted_runtime: ${result.delegatedContracts.selfHostedRuntime ? "true" : "false"}`,
    `  - trigger_mode: ${result.delegatedContracts.triggerMode ?? "unknown"}`,
    `  - selected_adapter_id: ${result.delegatedContracts.selectedAdapterId ?? "unknown"}`,
    `  - admitted_adapter_ids: ${result.delegatedContracts.admittedAdapterIds.length}`,
    `  - adapter_handoff_mode: ${result.delegatedContracts.adapterHandoffMode ?? "unknown"}`,
    `  - semantic_review_owner: ${result.delegatedContracts.semanticReviewOwner ?? "unknown"}`,
    "",
    styleLabel(localize("Adapter Profiles:", "Adapter 配置：")),
    `  - admitted: ${result.adapterProfiles.admitted.length}`,
    `  - invalid: ${result.adapterProfiles.invalid.length}`,
    `  - selected_profile_ref: ${result.adapterProfiles.selected?.profileRef ?? "none"}`,
    `  - selected_host_class: ${result.adapterProfiles.selected?.hostClass ?? "none"}`,
    "",
    styleLabel(localize("Checks:", "检查项：")),
  ];

  for (const check of result.checks) {
    const marker = check.severity === "error"
      ? "fail"
      : check.severity === "warn"
        ? "warn"
        : check.severity === "info"
          ? "info"
          : "ok";
    lines.push(`  - [${marker}] ${localize(check.detail, translateDoctorDetail(check.detail))}`);
  }

  lines.push("", styleLabel(localize("Canonical Tree:", "Canonical Tree：")));
  lines.push(`  - profile: ${result.canonicalTree.profile ?? "unknown"}`);
  lines.push(`  - required_files: ${result.canonicalTree.requiredFiles.length}`);
  lines.push(`  - present: ${result.canonicalTree.present.length}`);
  lines.push(`  - missing: ${result.canonicalTree.missing.length}`);
  lines.push(`  - ready: ${result.canonicalTree.ready ? "true" : "false"}`);

  lines.push("", styleLabel(localize("Generation Inputs:", "生成输入：")));
  lines.push(`  - mode: ${result.specGenerationInputs.mode ?? "unknown"}`);
  lines.push(`  - code_roots: ${result.specGenerationInputs.codeRoots.length}`);
  lines.push(`  - docs_roots: ${result.specGenerationInputs.docsRoots.length}`);
  lines.push(`  - structure_roots: ${result.specGenerationInputs.structureRoots.length}`);
  lines.push(`  - human_note_paths: ${result.specGenerationInputs.humanNotePaths.length}`);
  lines.push(`  - benchmark_mode: ${result.specGenerationInputs.benchmarkMode ?? "unknown"}`);
  lines.push(`  - benchmark_root: ${result.benchmarkAuditReadiness.benchmarkRoot ?? "none"}`);
  lines.push(`  - acceptance_mode: ${result.specGenerationInputs.acceptanceMode ?? "unknown"}`);

  lines.push("", styleLabel(localize("Audit:", "审计：")));
  lines.push(`  - spec_generation_audit_present: ${result.specGenerationAudit.present ? "true" : "false"}`);
  lines.push(`  - spec_generation_audit_ok: ${result.specGenerationAudit.ok ? "true" : "false"}`);
  lines.push(`  - required_audited_files: ${result.specGenerationAudit.summary?.requiredAuditedFiles ?? 0}`);
  lines.push(`  - unresolved_files: ${result.specGenerationAudit.summary?.unresolvedFiles ?? 0}`);
  lines.push(`  - inferred_files: ${result.specGenerationAudit.summary?.inferredFiles ?? 0}`);
  lines.push(`  - doc_spec_audit_artifact_present: ${result.auditArtifact.present ? "true" : "false"}`);
  lines.push(`  - doc_spec_audit_artifact_ok: ${result.auditArtifact.ok ? "true" : "false"}`);

  lines.push("", styleLabel(localize("Execution Contracts:", "执行契约：")));
  lines.push(`  - total: ${result.executionContracts.total}`);
  lines.push(`  - valid: ${result.executionContracts.valid}`);
  lines.push(`  - invalid: ${result.executionContracts.invalid.length}`);

  lines.push("", styleLabel(localize("Handoff:", "Handoff：")));
  lines.push(`  - required_context_order: ${result.handoffReadiness.requiredContextOrder.length}`);
  lines.push(`  - missing_context_entries: ${result.handoffReadiness.missingContextEntries.length}`);
  lines.push(`  - missing_paths: ${result.handoffReadiness.missingPaths.length}`);

  if (result.nextSteps.length > 0) {
    lines.push("", styleLabel(localize("Next:", "下一步：")));
    for (const step of result.nextSteps) {
      lines.push(`  - ${localize(step, translateDoctorNextStep(step))}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function formatDoctorResult(result, options = {}) {
  if (options.verbose) {
    return formatDoctorResultVerbose(result);
  }

  const summary = summarizeDoctorState(result);
  const lines = [
    styleHeading(`nimicoding doctor: ${result.projectRoot}`),
    "",
    styleLabel(localize("Summary:", "摘要：")),
    `  - ${localize("status", "状态")}: ${styleStatus(result.ok ? "ok" : "needs_attention")}`,
    `  - ${localize("bootstrap", "bootstrap")}: ${summary.bootstrapState}`,
    `  - ${localize("project rules", "项目规则")}: ${summary.canonicalTreeState} (${localize("present", "已存在")} ${result.canonicalTree.present.length}, ${localize("missing", "缺失")} ${result.canonicalTree.missing.length})`,
    `  - ${localize("lifecycle", "生命周期")}: ${result.lifecycleState.treeState ?? "unknown"} / ${result.lifecycleState.authorityMode ?? "unknown"}`,
    `  - ${localize("benchmark audit", "benchmark 审计")}: ${summary.benchmarkAuditState}`,
    `  - ${localize("generation audit", "生成审计")}: ${summary.auditState}`,
    `  - ${localize("AI entry files", "AI 入口文件")}: ${summary.entrypointIntegrated ? localize("connected", "已接入") : localize("not connected", "未接入")}`,
    `  - ${localize("handoff", "handoff")}: ${result.handoffReadiness.ok ? localize("ready", "就绪") : localize("needs attention", "需要关注")}`,
  ];

  lines.push("", styleLabel(localize("Checks:", "检查项：")));
  if (summary.blockingChecks.length === 0 && summary.warningChecks.length === 0) {
    lines.push(`  - ${localize("No blocking issues found.", "没有发现阻塞问题。")}`);
  } else {
    for (const check of [...summary.blockingChecks, ...summary.warningChecks]) {
      const marker = check.severity === "error" ? "fail" : "warn";
      lines.push(`  - [${marker}] ${localize(check.detail, translateDoctorDetail(check.detail))}`);
    }
  }

  if (summary.importantInfoChecks.length > 0) {
    lines.push("", styleLabel(localize("Notes:", "说明：")));
    for (const check of summary.importantInfoChecks) {
      lines.push(`  - ${localize(check.detail, translateDoctorDetail(check.detail))}`);
    }
  }

  if (result.nextSteps.length > 0) {
    lines.push("", styleLabel(localize("Next:", "下一步：")));
    for (const step of result.nextSteps) {
      lines.push(`  - ${localize(step, translateDoctorNextStep(step))}`);
    }
  }

  lines.push("", styleMuted(localize("Need internal contract detail? Run `nimicoding doctor --verbose`.", "如果你需要内部契约细节，请运行 `nimicoding doctor --verbose`。")));
  return `${lines.join("\n")}\n`;
}
