import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DOC_SPEC_AUDIT_RESULT_CONTRACT_REF,
  EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF,
  EXTERNAL_EXECUTION_ARTIFACTS_CONFIG_REF,
  HANDOFF_PAYLOAD_CONTRACT_VERSION,
  HOST_ADAPTER_CONFIG_REF,
  SKILL_RESULT_CONTRACT_REFS,
  SPEC_GENERATION_AUDIT_CONTRACT_REF,
  SPEC_GENERATION_AUDIT_REF,
  SPEC_RECONSTRUCTION_RESULT_CONTRACT_REF,
} from "../constants.mjs";
import {
  loadAuditSweepContract,
  loadDocSpecAuditContract,
  loadExternalHostCompatibilityContract,
  loadHighRiskSchemaContracts,
  loadSpecGenerationInputsConfig,
  loadSpecReconstructionContract,
  loadSpecTreeModelContract,
} from "./contracts.mjs";
import { loadAuditExecutionArtifactsConfig } from "./audit-execution.mjs";
import { inspectDoctorState } from "./doctor.mjs";
import { loadExternalExecutionArtifactsConfig } from "./external-execution.mjs";
import { readTextIfFile } from "./fs-helpers.mjs";
import {
  localize,
  styleHeading,
  styleLabel,
  styleStatus,
} from "./ui.mjs";
import { mergeOrderedPaths, parseSkillSection, parseYamlText, readYamlList } from "./yaml-helpers.mjs";

function translateHandoffReason(reason) {
  const translations = new Map([
    ["Bootstrap or handoff validation is failing; repair doctor errors before exporting handoff payloads", "bootstrap 或 handoff 校验失败；请先修复 doctor 报错，再导出 handoff payload"],
    ["Projects may delegate spec reconstruction to an external AI host when canonical tree work is needed", "当需要 canonical tree 工作时，项目可以将 spec reconstruction 委托给外部 AI host"],
    ["This skill is not allowed in the current lifecycle state", "当前生命周期状态不允许执行该 skill"],
    ["This skill is not allowed in the current authority mode", "当前 authority mode 不允许执行该 skill"],
    ["Skill prerequisites are satisfied by the current project-local truth", "当前项目本地 truth 已满足该 skill 的前置条件"],
  ]);
  const delegatePrefix = "Delegate explicit skill execution for `";
  if (reason.startsWith(delegatePrefix) && reason.endsWith("` to external_ai_host.")) {
    const skillId = reason.slice(delegatePrefix.length, reason.length - "` to external_ai_host.".length);
    return `将 \`${skillId}\` 的显式 skill 执行委托给 external_ai_host。`;
  }
  return translations.get(reason) ?? reason;
}

function commandRuleAllowsCurrentState(rule, doctorResult) {
  if (!rule) {
    return {
      ok: false,
      reason: "This skill is not allowed in the current lifecycle state",
    };
  }

  const treeState = doctorResult.lifecycleState?.treeState;
  const authorityMode = doctorResult.lifecycleState?.authorityMode;
  if (Array.isArray(rule.allowedTreeStates) && rule.allowedTreeStates.length > 0 && !rule.allowedTreeStates.includes(treeState)) {
    return {
      ok: false,
      reason: "This skill is not allowed in the current lifecycle state",
    };
  }

  if (Array.isArray(rule.allowedAuthorityModes) && rule.allowedAuthorityModes.length > 0 && !rule.allowedAuthorityModes.includes(authorityMode)) {
    return {
      ok: false,
      reason: "This skill is not allowed in the current authority mode",
    };
  }

  return {
    ok: true,
    reason: "Skill prerequisites are satisfied by the current project-local truth",
  };
}

function evaluateSkillReadiness(skillId, doctorResult) {
  if (!doctorResult.ok || !doctorResult.handoffReadiness.ok) {
    return {
      ok: false,
      reason: "Bootstrap or handoff validation is failing; repair doctor errors before exporting handoff payloads",
    };
  }

  if (skillId === "spec_reconstruction") {
    return {
      ok: true,
      reason: "Projects may delegate spec reconstruction to an external AI host when canonical tree work is needed",
    };
  }

  const rule = (doctorResult.commandGating?.entries ?? []).find((entry) => entry.command === "handoff" && entry.skill === skillId) ?? null;
  return commandRuleAllowsCurrentState(rule, doctorResult);
}

function getSkillSpecificExpectations(
  skillId,
  resultContractRef,
  specContract,
  auditContract,
  auditSweepContract,
  auditExecutionArtifacts,
  highRiskSchemaContracts,
  externalExecutionArtifacts,
) {
  if (skillId === "spec_reconstruction") {
    return {
      compareTargets: [".nimi/spec"],
      closeoutSummaryFields: specContract.summaryRequiredFields,
      closeoutSummaryStatus: specContract.summaryStatusEnum,
      executionSchemaRefs: [],
      artifactRoots: {},
      expectedArtifactKinds: [],
      skillExpectedResults: [
        "generate_canonical_tree_under_.nimi/spec",
        "establish_kernel_markdown_and_kernel_tables_before_generated_views_or_guides",
        "record_file_level_generation_audit_under_.nimi/spec/_meta/spec-generation-audit.yaml",
        `satisfy_canonical_tree_completion_declared_in_${resultContractRef}`,
      ],
    };
  }

  if (skillId === "doc_spec_audit") {
    return {
      compareTargets: auditContract.defaultComparedPaths,
      closeoutSummaryFields: auditContract.summaryRequiredFields,
      closeoutSummaryStatus: auditContract.summaryStatusEnum,
      executionSchemaRefs: [],
      artifactRoots: {},
      expectedArtifactKinds: [],
      skillExpectedResults: [
        `compare_${auditContract.defaultComparedPaths.join("_and_")}_against_.nimi/spec_truth`,
        `return_local_only_summary_that_satisfies_${resultContractRef}`,
      ],
    };
  }

  if (skillId === "audit_sweep") {
    return {
      compareTargets: [".nimi/spec", ".nimi/contracts", ".nimi/methodology"],
      closeoutSummaryFields: auditSweepContract.summaryRequiredFields,
      closeoutSummaryStatus: auditSweepContract.summaryStatusEnum,
      executionSchemaRefs: [],
      artifactRoots: auditExecutionArtifacts.artifactRoots ?? {},
      expectedArtifactKinds: [
        "audit-plan",
        "audit-chunk",
        "audit-ledger",
        "audit-report",
        "audit-remediation-map",
        "audit-packet",
        "audit-run-ledger",
        "audit-closeout",
      ],
      skillExpectedResults: [
        "freeze_full_coverage_inventory_for_a_declared_target_root",
        "partition_inventory_into_machine_identifiable_audit_chunks",
        `return_local_only_audit_sweep_summary_that_satisfies_${resultContractRef}`,
        "produce_frozen_findings_ledger_and_remediation_map_without_claiming_semantic_closure",
      ],
    };
  }

  if (skillId === "high_risk_execution") {
    const executionSchemaRefs = highRiskSchemaContracts.map((entry) => entry.path);
    return {
      compareTargets: [".nimi/spec", ".nimi/contracts"],
      closeoutSummaryFields: [
        "packet_ref",
        "orchestration_state_ref",
        "prompt_ref",
        "worker_output_ref",
        "evidence_refs",
        "status",
        "summary",
        "verified_at",
      ],
      closeoutSummaryStatus: [
        "candidate_ready",
        "blocked",
        "failed",
      ],
      executionSchemaRefs,
      artifactRoots: externalExecutionArtifacts.artifactRoots ?? {},
      expectedArtifactKinds: [
        "execution-packet",
        "orchestration-state",
        "prompt",
        "worker-output",
        "acceptance",
      ],
      skillExpectedResults: [
        "use_seed_only_execution_contracts_without_claiming_runtime_ownership",
        "produce_packetized_high_risk_execution_artifacts_only_if_the_change_requires_methodology",
        `return_local_only_external_execution_summary_that_satisfies_${resultContractRef}`,
      ],
    };
  }

  return {
    compareTargets: [],
    closeoutSummaryFields: [],
    closeoutSummaryStatus: [],
    executionSchemaRefs: [],
    artifactRoots: {},
    expectedArtifactKinds: [],
    skillExpectedResults: [],
  };
}

export async function buildHandoffPayload(projectRoot, skillId) {
  const doctorResult = await inspectDoctorState(projectRoot);
  const manifestText = await readTextIfFile(path.join(projectRoot, ".nimi", "config", "skill-manifest.yaml"));
  const skillsConfigText = await readTextIfFile(path.join(projectRoot, ".nimi", "config", "skills.yaml"));
  const handoffText = await readTextIfFile(path.join(projectRoot, ".nimi", "methodology", "skill-handoff.yaml"));
  const specReconstructionText = await readTextIfFile(path.join(projectRoot, ".nimi", "methodology", "spec-reconstruction.yaml"));
  const specReconstructionDocument = parseYamlText(specReconstructionText);
  const specContract = await loadSpecReconstructionContract(projectRoot);
  const specTreeModel = await loadSpecTreeModelContract(projectRoot);
  const specGenerationInputs = await loadSpecGenerationInputsConfig(projectRoot);
  const auditContract = await loadDocSpecAuditContract(projectRoot);
  const auditSweepContract = await loadAuditSweepContract(projectRoot);
  const hostCompatibilityContract = await loadExternalHostCompatibilityContract(projectRoot);
  const auditExecutionArtifacts = await loadAuditExecutionArtifactsConfig(projectRoot);
  const externalExecutionArtifacts = await loadExternalExecutionArtifactsConfig(projectRoot);
  const highRiskSchemaContracts = await loadHighRiskSchemaContracts(projectRoot);

  const manifestSkills = parseSkillSection(manifestText, "skills");
  const expectedSkills = parseSkillSection(skillsConfigText, "expected_skill_surfaces");
  const manifestSkill = manifestSkills.find((skill) => skill.id === skillId) ?? null;
  const expectedSkill = expectedSkills.find((skill) => skill.id === skillId) ?? null;

  if (!manifestSkill || !expectedSkill) {
    return {
      ok: false,
      exitCode: 1,
      error: `Unknown or undeclared skill id: ${skillId}`,
      availableSkills: manifestSkills.map((skill) => skill.id),
      doctor: doctorResult,
    };
  }

  const readiness = evaluateSkillReadiness(skillId, doctorResult);
  const resultContractRef = manifestSkill.result_contract_ref ?? SKILL_RESULT_CONTRACT_REFS[skillId] ?? null;
  const handoffContextOrder = readYamlList(handoffText, "required_context_order");
  const skillInputs = manifestSkill.inputs ?? [];
  const orderedContext = mergeOrderedPaths(handoffContextOrder, skillInputs, [resultContractRef]);
  const contextWithBlueprint = doctorResult.blueprintReference?.present
    ? mergeOrderedPaths(orderedContext, [doctorResult.blueprintReference.path])
    : orderedContext;
  const hardConstraints = mergeOrderedPaths(
    readYamlList(handoffText, "hard_constraints"),
    skillId === "spec_reconstruction" ? readYamlList(specReconstructionText, "hard_constraints") : [],
  );
  const baseExpectedResults = readYamlList(handoffText, "expected_results");
  const skillSpecific = getSkillSpecificExpectations(
    skillId,
    resultContractRef,
    specContract,
    auditContract,
    auditSweepContract,
    auditExecutionArtifacts,
    highRiskSchemaContracts,
    externalExecutionArtifacts,
  );
  const expectedResults = mergeOrderedPaths(baseExpectedResults, skillSpecific.skillExpectedResults);
  const generationContext = skillId === "spec_reconstruction"
    ? {
      canonicalTargetRoot: specGenerationInputs.canonicalTargetRoot ?? specTreeModel.canonicalRoot ?? ".nimi/spec",
      mode: specGenerationInputs.mode ?? "mixed",
      codeRoots: specGenerationInputs.codeRoots ?? [],
      docsRoots: specGenerationInputs.docsRoots ?? [],
      structureRoots: specGenerationInputs.structureRoots ?? [],
      humanNotePaths: specGenerationInputs.humanNotePaths ?? [],
      benchmarkBlueprintRoot: specGenerationInputs.benchmarkBlueprintRoot ?? doctorResult.blueprintReference?.root ?? null,
      benchmarkMode: specGenerationInputs.benchmarkMode ?? doctorResult.blueprintReference?.mode ?? "none",
      acceptanceMode: specGenerationInputs.acceptanceMode ?? "canonical_tree_validity_without_blueprint",
      generationOrder: specGenerationInputs.generationOrder ?? [],
      inferenceRules: specGenerationInputs.inferenceRules ?? [],
      auditRef: SPEC_GENERATION_AUDIT_REF,
      auditContractRef: SPEC_GENERATION_AUDIT_CONTRACT_REF,
      requiredFileClasses: [
        "INDEX.md",
        "domain kernel/*.md",
        "domain kernel/tables/**",
      ],
      optionalFileClasses: [
        "domain kernel/generated/**",
        "thin domain guides",
      ],
      minimalRequiredOutputs: Array.isArray(specReconstructionDocument?.reconstruction?.target_tree_shape?.minimal_required_outputs)
        ? specReconstructionDocument.reconstruction.target_tree_shape.minimal_required_outputs.map((entry) => String(entry))
        : [],
      minimumGenerationSequence: Array.isArray(specReconstructionDocument?.reconstruction?.target_tree_shape?.minimum_generation_sequence)
        ? specReconstructionDocument.reconstruction.target_tree_shape.minimum_generation_sequence.map((entry) => String(entry))
        : [],
      skeletonRules: Array.isArray(specReconstructionDocument?.reconstruction?.target_tree_shape?.skeleton_rules)
        ? specReconstructionDocument.reconstruction.target_tree_shape.skeleton_rules.map((entry) => String(entry))
        : [],
    }
    : null;

  return {
    contractVersion: HANDOFF_PAYLOAD_CONTRACT_VERSION,
    ok: readiness.ok,
    exitCode: readiness.ok ? 0 : 1,
    projectRoot,
    handoffSurface: {
      authoritativeMode: "json",
      promptMode: "human_projection_only",
      hostStrategy: "host_agnostic_external_host",
      hostCompatibilityRef: EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF,
      supportedHostPosture: hostCompatibilityContract.supportedHostPosture ?? [],
      supportedHostExamples: hostCompatibilityContract.supportedHostExamples ?? [],
      requiredHostBehavior: hostCompatibilityContract.requiredBehavior ?? [],
      forbiddenHostBehavior: hostCompatibilityContract.forbiddenBehavior ?? [],
      hostCompatibilitySummary: doctorResult.hostCompatibility ?? {
        contractRef: EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF,
        supportedHostPosture: hostCompatibilityContract.supportedHostPosture ?? [],
        supportedHostExamples: hostCompatibilityContract.supportedHostExamples ?? [],
        requiredBehavior: hostCompatibilityContract.requiredBehavior ?? [],
        forbiddenBehavior: hostCompatibilityContract.forbiddenBehavior ?? [],
        genericExternalHostCompatible: false,
        namedOverlaySupport: {
          mode: "generic_only",
          admittedOverlayIds: [],
          selectedOverlayId: null,
          selectedOverlayProfileRef: null,
          selectedOverlayHostClass: null,
        },
        futureOnlyHostSurfaces: [],
        nativeReviewSurfaces: [],
      },
    },
    runtimeOwner: doctorResult.delegatedContracts.runtimeOwner,
    triggerMode: doctorResult.delegatedContracts.triggerMode,
    handoffReady: doctorResult.handoffReadiness.ok,
    skill: {
      id: skillId,
      required: expectedSkill.required === "true",
      source: manifestSkill.source ?? "external",
      purpose: expectedSkill.purpose ?? null,
      inputs: skillInputs,
      resultContractRef,
      compareTargets: skillSpecific.compareTargets,
      expectedCloseoutSummaryFields: skillSpecific.closeoutSummaryFields,
      expectedCloseoutSummaryStatus: skillSpecific.closeoutSummaryStatus,
      executionSchemaRefs: skillSpecific.executionSchemaRefs,
      expectedArtifactRoots: skillSpecific.artifactRoots,
      expectedArtifactKinds: skillSpecific.expectedArtifactKinds,
      readiness,
    },
    generationContext,
    contracts: {
      handoffRef: ".nimi/methodology/skill-handoff.yaml",
      runtimeContractRef: ".nimi/methodology/skill-runtime.yaml",
      manifestRef: ".nimi/config/skill-manifest.yaml",
      hostProfileRef: ".nimi/config/host-profile.yaml",
      hostAdapterRef: HOST_ADAPTER_CONFIG_REF,
      externalExecutionArtifactsRef: EXTERNAL_EXECUTION_ARTIFACTS_CONFIG_REF,
      installerRef: ".nimi/config/skill-installer.yaml",
      installerResultContractRef: ".nimi/methodology/skill-installer-result.yaml",
      installerSummaryProjectionContractRef: ".nimi/methodology/skill-installer-summary-projection.yaml",
      exchangeProjectionContractRef: ".nimi/methodology/skill-exchange-projection.yaml",
      reconstructionGuidanceRef: ".nimi/methodology/spec-reconstruction.yaml",
      resultContractRef,
    },
    context: {
      orderedPaths: contextWithBlueprint,
      handoffRequiredContextOrder: handoffContextOrder,
      skillInputs,
    },
    adapter: {
      selectedId: doctorResult.delegatedContracts.selectedAdapterId,
      admittedIds: doctorResult.delegatedContracts.admittedAdapterIds,
      handoffMode: doctorResult.delegatedContracts.adapterHandoffMode,
      semanticReviewOwner: doctorResult.delegatedContracts.semanticReviewOwner,
      profileRef: doctorResult.adapterProfiles.selected?.profileRef ?? null,
      hostClass: doctorResult.adapterProfiles.selected?.hostClass ?? null,
      upstreamSeedProfile: doctorResult.adapterProfiles.selected?.upstreamSeedProfile ?? null,
      purpose: doctorResult.adapterProfiles.selected?.purpose ?? null,
      operationalOwner: doctorResult.adapterProfiles.selected?.operationalOwner ?? [],
      currentGaps: doctorResult.adapterProfiles.selected?.currentGaps ?? [],
      futureSurface: doctorResult.adapterProfiles.selected?.promptHandoff?.futureSurface ?? [],
      futureSurfaceStatus: doctorResult.adapterProfiles.selected?.promptHandoff?.futureSurfaceStatus ?? null,
      nativeReviewBoundary: doctorResult.adapterProfiles.selected?.nativeReviewBoundary ?? null,
      admittedProfiles: doctorResult.adapterProfiles.admitted,
    },
    constraints: hardConstraints,
    expectedResults,
    doctor: {
      ok: doctorResult.ok,
      handoffReadiness: doctorResult.handoffReadiness,
      delegatedContracts: doctorResult.delegatedContracts,
      auditArtifact: doctorResult.auditArtifact,
      highRiskSchemaContracts: highRiskSchemaContracts.map((entry) => ({
        path: entry.path,
        ok: entry.ok,
      })),
    },
    nextAction: readiness.ok
      ? `Delegate explicit skill execution for \`${skillId}\` to ${doctorResult.delegatedContracts.runtimeOwner}.`
      : readiness.reason,
  };
}

export function formatHandoffPayload(payload) {
  const lines = [
    styleHeading(`nimicoding handoff: ${payload.projectRoot}`),
    "",
    styleLabel(localize("Skill:", "Skill：")),
    `  - id: ${payload.skill.id}`,
    `  - required: ${payload.skill.required ? "true" : "false"}`,
    `  - source: ${payload.skill.source}`,
    `  - purpose: ${payload.skill.purpose ?? localize("unknown", "未知")}`,
    `  - result_contract_ref: ${payload.skill.resultContractRef ?? "none"}`,
    `  - ready: ${styleStatus(payload.skill.readiness.ok ? "ready" : "needs_attention")}`,
    "",
    styleLabel(localize("Runtime:", "运行时：")),
    `  - owner: ${payload.runtimeOwner ?? localize("unknown", "未知")}`,
    `  - trigger_mode: ${payload.triggerMode ?? localize("unknown", "未知")}`,
    `  - handoff_ready: ${payload.handoffReady ? "true" : "false"}`,
    `  - authoritative_mode: ${payload.handoffSurface.authoritativeMode}`,
    `  - prompt_mode: ${payload.handoffSurface.promptMode}`,
    `  - host_compatibility_ref: ${payload.handoffSurface.hostCompatibilityRef}`,
    `  - supported_host_posture: ${payload.handoffSurface.supportedHostPosture.join(", ") || "none"}`,
    `  - generic_external_host_compatible: ${payload.handoffSurface.hostCompatibilitySummary.genericExternalHostCompatible ? "true" : "false"}`,
    `  - named_overlay_mode: ${payload.handoffSurface.hostCompatibilitySummary.namedOverlaySupport.mode}`,
    "",
    styleLabel(localize("Adapter:", "Adapter：")),
    `  - selected_id: ${payload.adapter.selectedId ?? localize("unknown", "未知")}`,
    `  - admitted_ids: ${payload.adapter.admittedIds.length}`,
    `  - handoff_mode: ${payload.adapter.handoffMode ?? localize("unknown", "未知")}`,
    `  - semantic_review_owner: ${payload.adapter.semanticReviewOwner ?? localize("unknown", "未知")}`,
    `  - selected_profile_ref: ${payload.adapter.profileRef ?? "none"}`,
    "",
    styleLabel(localize("Context:", "上下文：")),
    `  - ordered_paths: ${payload.context.orderedPaths.length}`,
    `  - skill_inputs: ${payload.context.skillInputs.length}`,
    "",
  ];

  if (payload.generationContext) {
    lines.push(
      styleLabel(localize("Generation:", "生成：")),
      `  - target_root: ${payload.generationContext.canonicalTargetRoot}`,
      `  - mode: ${payload.generationContext.mode}`,
      `  - benchmark_root: ${payload.generationContext.benchmarkBlueprintRoot ?? "none"}`,
      `  - acceptance_mode: ${payload.generationContext.acceptanceMode}`,
      `  - audit_ref: ${payload.generationContext.auditRef}`,
      `  - code_roots: ${payload.generationContext.codeRoots.length}`,
      `  - docs_roots: ${payload.generationContext.docsRoots.length}`,
      `  - structure_roots: ${payload.generationContext.structureRoots.length}`,
      "",
    );
  }

  lines.push(
    styleLabel(localize("Next:", "下一步：")),
    `  - ${localize(payload.nextAction, translateHandoffReason(payload.nextAction))}`,
  );

  return `${lines.join("\n")}\n`;
}

export function formatHandoffPrompt(payload) {
  const isSpecReconstruction = payload.skill.id === "spec_reconstruction" && payload.generationContext;
  const lines = [
    localize(
      `You are the external AI host responsible for the declared \`${payload.skill.id}\` skill in project \`${payload.projectRoot}\`.`,
      `你是外部 AI host，负责项目 \`${payload.projectRoot}\` 中声明的 \`${payload.skill.id}\` skill。`,
    ),
    "",
    localize(
      "Use the JSON handoff payload as the authoritative machine contract.",
      "请将 JSON handoff payload 作为权威机器契约。",
    ),
    localize(
      "Treat this prompt as a human-readable projection of that same contract, not as a replacement runtime owner.",
      "请将这份 prompt 视为同一契约的人类可读投影，而不是替代 runtime owner。",
    ),
    "",
    localize(
      "This handoff surface is host-agnostic. Any external host may consume it if it respects the declared compatibility contract.",
      "这个 handoff surface 是 host-agnostic 的。任何外部 host 只要遵守声明的兼容契约，都可以消费它。",
    ),
    "",
    localize("Read this project-local truth first, in order:", "请优先按顺序阅读这些项目本地 truth："),
    ...payload.context.orderedPaths.map((entry, index) => `${index + 1}. ${entry}`),
    "",
    localize("Operate under these constraints:", "请在以下约束下执行："),
    ...payload.constraints.map((entry) => `- ${entry}`),
    "",
    localize("Expected results:", "预期结果："),
    ...payload.expectedResults.map((entry) => `- ${entry}`),
    "",
    localize("Skill contract:", "Skill 契约："),
    `- ${localize("Skill id", "Skill id")}: ${payload.skill.id}`,
    `- ${localize("Purpose", "用途")}: ${payload.skill.purpose ?? localize("unknown", "未知")}`,
    `- ${localize("Runtime owner", "Runtime owner")}: ${payload.runtimeOwner ?? localize("unknown", "未知")}`,
    `- ${localize("Trigger mode", "触发模式")}: ${payload.triggerMode ?? localize("unknown", "未知")}`,
    `- ${localize("Result contract", "结果契约")}: ${payload.skill.resultContractRef ?? "none"}`,
    `- ${localize("Host compatibility contract", "Host 兼容契约")}: ${payload.handoffSurface.hostCompatibilityRef}`,
    `- ${localize("Host adapter", "Host adapter")}: ${payload.adapter.selectedId ?? "none"}`,
    `- ${localize("Semantic review owner", "语义审查 owner")}: ${payload.adapter.semanticReviewOwner ?? localize("unknown", "未知")}`,
  ];

  if (payload.handoffSurface.supportedHostPosture.length > 0) {
    lines.push(`- ${localize("Supported host posture", "支持的 host 姿态")}: ${payload.handoffSurface.supportedHostPosture.join(", ")}`);
  }
  if (payload.handoffSurface.supportedHostExamples.length > 0) {
    lines.push(`- ${localize("Supported external host examples", "支持的外部 host 示例")}: ${payload.handoffSurface.supportedHostExamples.join(", ")}`);
  }
  if (payload.handoffSurface.requiredHostBehavior.length > 0) {
    lines.push(`- ${localize("Required host behavior", "要求的 host 行为")}: ${payload.handoffSurface.requiredHostBehavior.join(", ")}`);
  }
  if (payload.handoffSurface.forbiddenHostBehavior.length > 0) {
    lines.push(`- ${localize("Forbidden host behavior", "禁止的 host 行为")}: ${payload.handoffSurface.forbiddenHostBehavior.join(", ")}`);
  }
  lines.push(`- ${localize("Generic external host compatible", "通用外部 host 兼容")}: ${payload.handoffSurface.hostCompatibilitySummary.genericExternalHostCompatible ? "true" : "false"}`);
  lines.push(`- ${localize("Named overlay mode", "命名 overlay 模式")}: ${payload.handoffSurface.hostCompatibilitySummary.namedOverlaySupport.mode}`);
  if (payload.handoffSurface.hostCompatibilitySummary.namedOverlaySupport.admittedOverlayIds.length > 0) {
    lines.push(`- ${localize("Admitted named overlays", "已准入的命名 overlay")}: ${payload.handoffSurface.hostCompatibilitySummary.namedOverlaySupport.admittedOverlayIds.join(", ")}`);
  }
  if (payload.handoffSurface.hostCompatibilitySummary.futureOnlyHostSurfaces.length > 0) {
    lines.push(`- ${localize("Future-only host surfaces", "仅未来支持的 host surface")}: ${payload.handoffSurface.hostCompatibilitySummary.futureOnlyHostSurfaces.map((surface) => `${surface.adapterId}:${surface.command}:${surface.status ?? "unknown"}`).join(", ")}`);
  }
  if ((payload.handoffSurface.hostCompatibilitySummary.nativeReviewSurfaces ?? []).length > 0) {
    lines.push(`- ${localize("Native review surfaces", "原生审查 surface")}: ${payload.handoffSurface.hostCompatibilitySummary.nativeReviewSurfaces.map((surface) => `${surface.adapterId}:approval=${surface.approvalReviewScope}:${surface.approvalReviewSemanticEffect},pr=${surface.githubAutoReviewScope}:${surface.githubAutoReviewSemanticEffect}`).join("; ")}`);
  }

  if (payload.adapter.selectedId && payload.adapter.selectedId !== "none") {
    lines.push(`- ${localize("Adapter handoff mode", "Adapter handoff 模式")}: ${payload.adapter.handoffMode ?? localize("unknown", "未知")}`);
    lines.push(`- ${localize("Adapter profile ref", "Adapter profile 引用")}: ${payload.adapter.profileRef ?? localize("unknown", "未知")}`);
    lines.push(`- ${localize("Adapter host class", "Adapter host 类别")}: ${payload.adapter.hostClass ?? localize("unknown", "未知")}`);
    lines.push(`- ${localize("Adapter upstream seed profile", "Adapter 上游 seed profile")}: ${payload.adapter.upstreamSeedProfile ?? localize("unknown", "未知")}`);
    if (payload.adapter.purpose) {
      lines.push(`- ${localize("Adapter purpose", "Adapter 用途")}: ${payload.adapter.purpose}`);
    }
    if (payload.adapter.operationalOwner.length > 0) {
      lines.push(`- ${localize("Adapter operational owner roots", "Adapter operational owner 根")}: ${payload.adapter.operationalOwner.join(", ")}`);
    }
    if (payload.adapter.currentGaps.length > 0) {
      lines.push(`- ${localize("Adapter current gaps", "Adapter 当前缺口")}: ${payload.adapter.currentGaps.join(", ")}`);
    }
    if (payload.adapter.futureSurface.length > 0) {
      lines.push(`- ${localize("Adapter future-only surfaces", "Adapter 仅未来支持的 surface")}: ${payload.adapter.futureSurface.join(", ")}`);
      lines.push(`- ${localize("Adapter future-only surface status", "Adapter 仅未来 surface 状态")}: ${payload.adapter.futureSurfaceStatus ?? localize("unknown", "未知")}`);
    }
    if (payload.adapter.nativeReviewBoundary) {
      lines.push(`- ${localize("Adapter native review boundary", "Adapter 原生审查边界")}: approval=${payload.adapter.nativeReviewBoundary.approvalReview.scope}:${payload.adapter.nativeReviewBoundary.approvalReview.semanticEffect}; pr=${payload.adapter.nativeReviewBoundary.githubAutoReview.scope}:${payload.adapter.nativeReviewBoundary.githubAutoReview.semanticEffect}`);
      lines.push(`- ${localize("Adapter forbidden semantic substitutions", "Adapter 禁止替代的语义动作")}: ${payload.adapter.nativeReviewBoundary.forbiddenSemanticSubstitutions.join(", ")}`);
    }
    lines.push(localize(
      "- The adapter may route execution, but it must not decide semantic acceptance or final disposition.",
      "- Adapter 可以路由执行，但不得决定语义验收或最终 disposition。",
    ));
  }

  if (payload.skill.compareTargets.length > 0) {
    lines.push(`- ${localize("Compare targets", "比较目标")}: ${payload.skill.compareTargets.join(", ")}`);
  }

  if (isSpecReconstruction) {
    lines.push(`- ${localize("Canonical target root", "Canonical 目标根")}: ${payload.generationContext.canonicalTargetRoot}`);
    lines.push(`- ${localize("Generation mode", "生成模式")}: ${payload.generationContext.mode}`);
    lines.push(`- ${localize("Required file classes", "必需文件类别")}: ${payload.generationContext.requiredFileClasses.join(", ")}`);
    lines.push(`- ${localize("Optional file classes", "可选文件类别")}: ${payload.generationContext.optionalFileClasses.join(", ")}`);
    lines.push(`- ${localize("Code roots", "代码根")}: ${payload.generationContext.codeRoots.join(", ") || "none"}`);
    lines.push(`- ${localize("Docs roots", "文档根")}: ${payload.generationContext.docsRoots.join(", ") || "none"}`);
    lines.push(`- ${localize("Structure roots", "结构根")}: ${payload.generationContext.structureRoots.join(", ") || "none"}`);
    lines.push(`- ${localize("Human note paths", "人工说明路径")}: ${payload.generationContext.humanNotePaths.join(", ") || "none"}`);
    lines.push(`- ${localize("Benchmark blueprint root", "Benchmark blueprint root")}: ${payload.generationContext.benchmarkBlueprintRoot ?? "none"}`);
    lines.push(`- ${localize("Acceptance rule", "验收规则")}: ${payload.generationContext.acceptanceMode}`);
    lines.push(`- ${localize("Generation order", "生成顺序")}: ${payload.generationContext.generationOrder.join(", ")}`);
    lines.push(`- ${localize("Audit output", "审计输出")}: ${payload.generationContext.auditRef}`);
    if (payload.generationContext.minimumGenerationSequence.length > 0) {
      lines.push(`- ${localize("Minimum generation sequence", "最小生成顺序")}: ${payload.generationContext.minimumGenerationSequence.join(", ")}`);
    }
    if (payload.generationContext.skeletonRules.length > 0) {
      lines.push(`- ${localize("Skeleton rules", "骨架规则")}: ${payload.generationContext.skeletonRules.join(", ")}`);
    }
  }

  if (payload.skill.expectedCloseoutSummaryFields.length > 0) {
    lines.push(`- ${localize("Expected closeout summary fields", "预期 closeout summary 字段")}: ${payload.skill.expectedCloseoutSummaryFields.join(", ")}`);
  }

  if (payload.skill.expectedCloseoutSummaryStatus.length > 0) {
    lines.push(`- ${localize("Expected closeout summary status", "预期 closeout summary 状态")}: ${payload.skill.expectedCloseoutSummaryStatus.join(", ")}`);
  }

  if (payload.skill.executionSchemaRefs.length > 0) {
    lines.push(`- ${localize("Execution schema refs", "执行 schema 引用")}: ${payload.skill.executionSchemaRefs.join(", ")}`);
  }

  if (Object.keys(payload.skill.expectedArtifactRoots).length > 0) {
    lines.push(`- ${localize("Expected local artifact roots", "预期本地产物根路径")}: ${Object.entries(payload.skill.expectedArtifactRoots).map(([field, value]) => `${field}=${value}`).join("; ")}`);
  }

  if (payload.skill.expectedArtifactKinds.length > 0) {
    lines.push(`- ${localize("Expected artifact kinds", "预期产物类型")}: ${payload.skill.expectedArtifactKinds.join(", ")}`);
  }

  lines.push(
    "",
    localize("Rules:", "规则："),
    localize("- Do not assume local skill installation or self-hosting.", "- 不要假设存在本地 skill 安装或 self-hosting。"),
    localize("- Fail closed on unresolved authority, missing context, or contract drift.", "- 在 authority 未解决、上下文缺失或契约漂移时必须 fail-close。"),
    localize("- Treat `.nimi/**` as the primary truth surface.", "- 将 `.nimi/**` 视为主要 truth surface。"),
  );

  if (isSpecReconstruction) {
    lines.push(localize(
      "- Build the canonical tree directly under `.nimi/spec/**`; do not produce a compact summary as the primary output.",
      "- 直接在 `.nimi/spec/**` 下构建 canonical tree；不要把 compact summary 当作主要输出。",
    ));
    lines.push(localize(
      "- Write `.nimi/spec/_meta/spec-generation-audit.yaml` alongside the canonical tree. Every generated canonical file must record source refs, source basis, and unresolved gaps.",
      "- 在 canonical tree 旁边写出 `.nimi/spec/_meta/spec-generation-audit.yaml`。每个生成的 canonical 文件都必须记录 source refs、source basis 和未解决缺口。",
    ));
    lines.push(localize(
      "- When a benchmark blueprint root is declared, aim for semantic and structural parity with that benchmark rather than byte-for-byte duplication.",
      "- 当声明了 benchmark blueprint root 时，目标应是与该 benchmark 保持语义和结构等价，而不是逐字节复制。",
    ));
    lines.push(localize(
      "- For ordinary projects without a benchmark blueprint, infer the domain set from the declared mixed inputs and build kernel markdown/tables first.",
      "- 对于没有 benchmark blueprint 的普通项目，请根据声明的 mixed inputs 推断域集合，并优先生成 kernel markdown/tables。",
    ));
  }

  lines.push("", localize(payload.nextAction, translateHandoffReason(payload.nextAction)));
  return `${lines.join("\n")}\n`;
}

export const START_HOST_OPTIONS = [
  {
    id: "generic",
    label: "Generic external host",
    zhLabel: "通用外部 Host",
    description: "works with any compatible AI tool",
    zhDescription: "适用于任意兼容的 AI 工具",
  },
  {
    id: "codex",
    label: "Codex",
    zhLabel: "Codex",
    description: "optimized wording for Codex-style coding hosts",
    zhDescription: "为 Codex 风格编码宿主优化措辞",
  },
  {
    id: "claude",
    label: "Claude",
    zhLabel: "Claude",
    description: "optimized wording for Claude-style coding hosts",
    zhDescription: "为 Claude 风格编码宿主优化措辞",
  },
  {
    id: "oh-my-codex",
    label: "oh-my-codex",
    zhLabel: "oh-my-codex",
    description: "includes the admitted OMX execution boundary reminder",
    zhDescription: "附带已准入 OMX 执行边界提醒",
  },
];

export function getStartHostOption(hostId) {
  return START_HOST_OPTIONS.find((option) => option.id === hostId) ?? null;
}

export function resolveStartHostChoice(explicitHost, payload) {
  if (explicitHost) {
    return explicitHost;
  }

  if (payload.adapter.selectedId === "oh_my_codex") {
    return "oh-my-codex";
  }
  if (payload.adapter.selectedId === "codex") {
    return "codex";
  }
  if (payload.adapter.selectedId === "claude") {
    return "claude";
  }

  return "generic";
}

export function formatStartPastePrompt(payload, options) {
  const hostId = options.hostId ?? "generic";
  const jsonRef = options.jsonRef;
  const host = getStartHostOption(hostId) ?? getStartHostOption("generic");
  const hostHeading = {
    generic: localize("Task package for external AI host", "面向外部 AI Host 的任务包"),
    codex: localize("Task package for Codex", "面向 Codex 的任务包"),
    claude: localize("Task package for Claude", "面向 Claude 的任务包"),
    "oh-my-codex": localize("Task package for oh-my-codex", "面向 oh-my-codex 的任务包"),
  }[hostId] ?? localize("Task package for external AI host", "面向外部 AI Host 的任务包");

  const lines = [
    `${hostHeading}:`,
    localize(`- Task: \`${payload.skill.id}\``, `- 任务：\`${payload.skill.id}\``),
    localize(`- Task file: \`${jsonRef}\``, `- 任务文件：\`${jsonRef}\``),
    localize(`- Output format: \`${payload.skill.resultContractRef ?? "the declared result contract"}\``, `- 输出格式：\`${payload.skill.resultContractRef ?? "声明的结果契约"}\``),
    localize(
      "Use this order:",
      "执行顺序：",
    ),
    localize(
      `1. Read \`${jsonRef}\` first. This file is the source of truth for this task.`,
      `1. 先读取 \`${jsonRef}\`。这个文件是该任务的权威来源。`,
    ),
    localize(
      "2. Use the ordered context paths, constraints, and result requirements declared there.",
      "2. 按其中声明的上下文顺序、约束和结果要求执行。",
    ),
    localize(
      "3. Treat `.nimi/**` as the main source of project rules. If required context is missing or inconsistent, stop and report it.",
      "3. 将 `.nimi/**` 视为项目规则的主要来源。如果缺少必要上下文或内容不一致，就停止并报告。",
    ),
    localize(
      `4. Complete \`${payload.skill.id}\` and return the result in \`${payload.skill.resultContractRef ?? "the declared result contract"}\` format.`,
      `4. 完成 \`${payload.skill.id}\`，并按 \`${payload.skill.resultContractRef ?? "声明的结果契约"}\` 格式返回结果。`,
    ),
  ];

  if (payload.skill.id === "spec_reconstruction" && payload.generationContext) {
    lines.splice(3, 0, localize(
      `- Canonical target root: \`${payload.generationContext.canonicalTargetRoot}\``,
      `- Canonical 目标根：\`${payload.generationContext.canonicalTargetRoot}\``,
    ));
    lines.splice(4, 0, localize(
      `- Audit file: \`${payload.generationContext.auditRef}\``,
      `- 审计文件：\`${payload.generationContext.auditRef}\``,
    ));
    lines.push(localize(
      `5. Inspect the declared source materials: code roots (${payload.generationContext.codeRoots.join(", ") || "none"}), docs roots (${payload.generationContext.docsRoots.join(", ") || "none"}), structure roots (${payload.generationContext.structureRoots.join(", ") || "none"}).`,
      `5. 检查声明的源材料：代码根（${payload.generationContext.codeRoots.join(", ") || "none"}）、文档根（${payload.generationContext.docsRoots.join(", ") || "none"}）、结构根（${payload.generationContext.structureRoots.join(", ") || "none"}）。`,
    ));
    lines.push(localize(
      `6. Build real canonical files first: ${payload.generationContext.requiredFileClasses.join(", ")}.`,
      `6. 先生成真实 canonical 文件：${payload.generationContext.requiredFileClasses.join(", ")}。`,
    ));
    if (payload.generationContext.minimumGenerationSequence.length > 0) {
      lines.push(localize(
        `6a. Start with this minimum skeleton: ${payload.generationContext.minimumGenerationSequence.join(", ")}.`,
        `6a. 先从这组最小骨架开始：${payload.generationContext.minimumGenerationSequence.join(", ")}。`,
      ));
    }
    lines.push(localize(
      `7. Write \`${payload.generationContext.auditRef}\` for every generated canonical file. Record source refs, source basis, and unresolved gaps explicitly.`,
      `7. 为每个生成的 canonical 文件写入 \`${payload.generationContext.auditRef}\`。显式记录 source refs、source basis 和未解决缺口。`,
    ));
    if (payload.generationContext.skeletonRules.length > 0) {
      lines.push(localize(
        `7a. Apply these skeleton rules: ${payload.generationContext.skeletonRules.join(", ")}.`,
        `7a. 应用这些骨架规则：${payload.generationContext.skeletonRules.join(", ")}。`,
      ));
    }
    lines.push(localize(
      "7b. If the first pass reaches a valid minimal skeleton but still contains explicit inferred or unresolved areas, keep the audit explicit and return a partial reconstruction result instead of claiming full completion.",
      "7b. 如果第一轮只达到有效的最小骨架，但仍包含显式的 inferred 或 unresolved 区域，请保持审计显式，并返回 partial reconstruction 结果，而不是宣称完全完成。",
    ));
    if (payload.generationContext.benchmarkBlueprintRoot) {
      lines.push(localize(
        `8. Use benchmark root \`${payload.generationContext.benchmarkBlueprintRoot}\` as an acceptance benchmark. Aim for semantic and structural parity; do not optimize for file-by-file copying.`,
        `8. 将 benchmark root \`${payload.generationContext.benchmarkBlueprintRoot}\` 作为验收基准。目标是语义和结构等价；不要追求逐文件复制。`,
      ));
    } else {
      lines.push(localize(
        "8. No benchmark blueprint is declared. Infer the domain set from the mixed inputs and keep the canonical tree explicit and fail-closed.",
        "8. 当前没有声明 benchmark blueprint。请根据 mixed inputs 推断域集合，并保持 canonical tree 显式且 fail-close。",
      ));
    }
  }

  if (hostId === "oh-my-codex") {
    lines.push(localize(
      "Additional OMX rule: keep `.omx/**` and external execution state operational only. Do not write semantic truth directly into `.nimi/spec/**`.",
      "额外 OMX 规则：将 `.omx/**` 和外部执行状态保持为 operational only。不要直接把语义 truth 写入 `.nimi/spec/**`。",
    ));
  }
  if (hostId === "codex") {
    lines.push(localize(
      "Additional Codex rule: use the native Codex SDK boundary for execution. Do not route this through oh-my-codex or shell out to the Codex CLI.",
      "额外 Codex 规则：执行时使用原生 Codex SDK 边界。不要经由 oh-my-codex，也不要 shell 到 Codex CLI。",
    ));
  }

  lines.push(localize(
    `Host profile: ${host.label}.`,
    `Host 配置：${host.zhLabel}。`,
  ));

  return `${lines.join("\n")}\n`;
}

function toPortablePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function buildHandoffArtifactRefs(skillId) {
  const safeSkillId = skillId.replace(/[^A-Za-z0-9._-]/g, "-");
  return {
    jsonRef: path.join(".nimi", "local", "handoff", `${safeSkillId}.json`),
    promptRef: path.join(".nimi", "local", "handoff", `${safeSkillId}.prompt.md`),
  };
}

export async function writeHandoffPromptArtifacts(projectRoot, payload) {
  const refs = buildHandoffArtifactRefs(payload.skill.id);
  const absoluteJsonPath = path.join(projectRoot, refs.jsonRef);
  const absolutePromptPath = path.join(projectRoot, refs.promptRef);

  await mkdir(path.dirname(absoluteJsonPath), { recursive: true });
  await writeFile(absoluteJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(absolutePromptPath, formatHandoffPrompt(payload), "utf8");

  return {
    jsonRef: toPortablePath(refs.jsonRef),
    promptRef: toPortablePath(refs.promptRef),
  };
}

export async function writeHandoffJsonArtifact(projectRoot, payload) {
  const refs = buildHandoffArtifactRefs(payload.skill.id);
  const absoluteJsonPath = path.join(projectRoot, refs.jsonRef);

  await mkdir(path.dirname(absoluteJsonPath), { recursive: true });
  await writeFile(absoluteJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return {
    jsonRef: toPortablePath(refs.jsonRef),
  };
}
