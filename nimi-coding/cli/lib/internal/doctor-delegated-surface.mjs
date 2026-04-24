import path from "node:path";

import {
  AUDIT_SWEEP_RESULT_CONTRACT_REF,
  DOC_SPEC_AUDIT_RESULT_CONTRACT_REF,
  EXTERNAL_EXECUTION_ARTIFACTS_CONFIG_REF,
  EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF,
  HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF,
  HOST_ADAPTER_CONFIG_REF,
  SPEC_RECONSTRUCTION_RESULT_CONTRACT_REF,
} from "../../constants.mjs";
import { readTextIfFile, pathExists } from "../fs-helpers.mjs";
import { arraysEqual } from "../value-helpers.mjs";
import {
  parseSkillSection,
  readYamlList,
  readYamlScalar,
} from "../yaml-helpers.mjs";
import { buildCheck } from "./doctor-state.mjs";

export async function inspectDoctorDelegatedSurface(projectRoot) {
  const checks = [];

  const skillsConfigText = await readTextIfFile(path.join(projectRoot, ".nimi", "config", "skills.yaml"));
  const skillsConfigOk = Boolean(skillsConfigText)
    && skillsConfigText.includes("runtime_installed: false")
    && skillsConfigText.includes("runtime_owner: external_ai_host")
    && skillsConfigText.includes("handoff_contract: .nimi/methodology/skill-handoff.yaml")
    && skillsConfigText.includes(`canonical_host_adapter: ${HOST_ADAPTER_CONFIG_REF}`);
  checks.push(
    buildCheck(
      "skills_contract",
      skillsConfigOk,
      skillsConfigOk
        ? "skills.yaml keeps runtime delegated and handoff-driven"
        : "skills.yaml is missing delegated runtime contract fields",
    ),
  );

  const handoffText = await readTextIfFile(path.join(projectRoot, ".nimi", "methodology", "skill-handoff.yaml"));
  const manifestText = await readTextIfFile(path.join(projectRoot, ".nimi", "config", "skill-manifest.yaml"));
  const hostProfileText = await readTextIfFile(path.join(projectRoot, ".nimi", "config", "host-profile.yaml"));
  const hostAdapterText = await readTextIfFile(path.join(projectRoot, HOST_ADAPTER_CONFIG_REF));
  const runtimeContractText = await readTextIfFile(path.join(projectRoot, ".nimi", "methodology", "skill-runtime.yaml"));
  const installerText = await readTextIfFile(path.join(projectRoot, ".nimi", "config", "skill-installer.yaml"));
  const installerResultText = await readTextIfFile(path.join(projectRoot, ".nimi", "methodology", "skill-installer-result.yaml"));

  const contractRuntimeOwnerValues = [
    readYamlScalar(skillsConfigText, "runtime_owner"),
    readYamlScalar(manifestText, "runtime_owner"),
    readYamlScalar(handoffText, "runtime_owner"),
    readYamlScalar(runtimeContractText, "runtime_owner"),
    readYamlScalar(hostProfileText, "id"),
    readYamlScalar(installerText, "installer_owner"),
  ];
  const contractRuntimeOwnersAligned = contractRuntimeOwnerValues.every((value) => value === "external_ai_host");

  const delegatedModeAligned = [
    readYamlScalar(manifestText, "execution_mode"),
    readYamlScalar(hostProfileText, "execution_mode"),
    readYamlScalar(runtimeContractText, "runtime_mode"),
    readYamlScalar(installerText, "installer_mode"),
  ].every((value) => value === "delegated");

  const selfHostedAligned = [
    readYamlScalar(handoffText, "self_hosted_runtime"),
    readYamlScalar(hostProfileText, "self_hosted"),
    readYamlScalar(runtimeContractText, "self_hosted"),
    readYamlScalar(installerText, "self_hosted"),
  ].every((value) => value === "false");

  checks.push(
    buildCheck(
      "delegated_contract_posture",
      contractRuntimeOwnersAligned && delegatedModeAligned && selfHostedAligned,
      contractRuntimeOwnersAligned && delegatedModeAligned && selfHostedAligned
        ? "Delegated runtime ownership and non-self-hosted posture are consistent across contracts"
        : "Delegated runtime ownership, execution mode, or self-hosted posture drifted across contracts",
    ),
  );

  const referenceChecks = [
    readYamlScalar(manifestText, "runtime_contract_ref") === ".nimi/methodology/skill-runtime.yaml",
    readYamlScalar(manifestText, "host_profile_ref") === ".nimi/config/host-profile.yaml",
    readYamlScalar(manifestText, "installer_ref") === ".nimi/config/skill-installer.yaml",
    readYamlScalar(manifestText, "installer_result_contract_ref") === ".nimi/methodology/skill-installer-result.yaml",
    readYamlScalar(hostProfileText, "runtime_contract_ref") === ".nimi/methodology/skill-runtime.yaml",
    readYamlScalar(hostProfileText, "compatibility_contract_ref") === EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF,
    readYamlScalar(hostProfileText, "installer_ref") === ".nimi/config/skill-installer.yaml",
    readYamlScalar(hostProfileText, "installer_result_contract_ref") === ".nimi/methodology/skill-installer-result.yaml",
    readYamlScalar(hostAdapterText, "runtime_owner") === "external_ai_host",
    readYamlScalar(hostAdapterText, "host_profile_ref") === ".nimi/config/host-profile.yaml",
    readYamlScalar(hostAdapterText, "manifest_ref") === ".nimi/config/skill-manifest.yaml",
    readYamlScalar(hostAdapterText, "artifact_contract_ref") === EXTERNAL_EXECUTION_ARTIFACTS_CONFIG_REF,
    readYamlScalar(hostAdapterText, "handoff_ref") === ".nimi/methodology/skill-handoff.yaml",
    readYamlScalar(runtimeContractText, "manifest_ref") === ".nimi/config/skill-manifest.yaml",
    readYamlScalar(runtimeContractText, "host_profile_ref") === ".nimi/config/host-profile.yaml",
    readYamlScalar(runtimeContractText, "installer_ref") === ".nimi/config/skill-installer.yaml",
    readYamlScalar(runtimeContractText, "installer_result_contract_ref") === ".nimi/methodology/skill-installer-result.yaml",
    readYamlScalar(runtimeContractText, "handoff_ref") === ".nimi/methodology/skill-handoff.yaml",
    readYamlScalar(installerText, "manifest_ref") === ".nimi/config/skill-manifest.yaml",
    readYamlScalar(installerText, "runtime_contract_ref") === ".nimi/methodology/skill-runtime.yaml",
    readYamlScalar(installerText, "host_profile_ref") === ".nimi/config/host-profile.yaml",
    readYamlScalar(installerText, "result_contract_ref") === ".nimi/methodology/skill-installer-result.yaml",
    readYamlScalar(installerResultText, "installer_ref") === ".nimi/config/skill-installer.yaml",
    readYamlScalar(handoffText, "runtime_contract_ref") === ".nimi/methodology/skill-runtime.yaml",
    readYamlScalar(handoffText, "host_profile_ref") === ".nimi/config/host-profile.yaml",
    readYamlScalar(handoffText, "host_compatibility_contract_ref") === EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF,
    readYamlScalar(handoffText, "installer_ref") === ".nimi/config/skill-installer.yaml",
    readYamlScalar(handoffText, "installer_result_contract_ref") === ".nimi/methodology/skill-installer-result.yaml",
    readYamlScalar(handoffText, "exchange_projection_contract_ref") === ".nimi/methodology/skill-exchange-projection.yaml",
  ];
  checks.push(
    buildCheck(
      "contract_reference_alignment",
      referenceChecks.every(Boolean),
      referenceChecks.every(Boolean)
        ? "Manifest, runtime, installer, host-profile, host-adapter, and handoff references are aligned"
        : "Cross-contract reference drift detected between manifest/runtime/installer/host-profile/host-adapter/handoff truth",
    ),
  );

  const manifestSkills = parseSkillSection(manifestText, "skills");
  const expectedSkills = parseSkillSection(skillsConfigText, "expected_skill_surfaces");

  const reconstructionSkill = manifestSkills.find((skill) => skill.id === "spec_reconstruction") ?? null;
  const docAuditSkill = manifestSkills.find((skill) => skill.id === "doc_spec_audit") ?? null;
  const auditSweepSkill = manifestSkills.find((skill) => skill.id === "audit_sweep") ?? null;
  const highRiskSkill = manifestSkills.find((skill) => skill.id === "high_risk_execution") ?? null;
  const resultContractAlignment = reconstructionSkill?.result_contract_ref === SPEC_RECONSTRUCTION_RESULT_CONTRACT_REF
    && docAuditSkill?.result_contract_ref === DOC_SPEC_AUDIT_RESULT_CONTRACT_REF
    && auditSweepSkill?.result_contract_ref === AUDIT_SWEEP_RESULT_CONTRACT_REF
    && highRiskSkill?.result_contract_ref === HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF;
  checks.push(
    buildCheck(
      "skill_result_contract_alignment",
      resultContractAlignment,
      resultContractAlignment
        ? "Skill manifest result contract refs align with the declared machine contracts"
        : "Skill manifest result contract refs drifted away from the declared machine contracts",
    ),
  );

  const hostRequiredContext = readYamlList(hostProfileText, "required_context");
  const handoffRequiredContext = readYamlList(handoffText, "required_context_order");
  const missingHandoffContextEntries = hostRequiredContext.filter((entry) => !handoffRequiredContext.includes(entry));
  const missingHandoffPaths = [];
  for (const relativePath of handoffRequiredContext) {
    const info = await pathExists(path.join(projectRoot, relativePath));
    if (!info) {
      missingHandoffPaths.push(relativePath);
    }
  }
  const handoffContextOk = missingHandoffContextEntries.length === 0 && missingHandoffPaths.length === 0;
  checks.push(
    buildCheck(
      "handoff_context_contract",
      handoffContextOk,
      handoffContextOk
        ? "Handoff context order contains the declared host context and all listed paths exist"
        : [
          missingHandoffContextEntries.length > 0
            ? `handoff context is missing host-required entries: ${missingHandoffContextEntries.join(", ")}`
            : null,
          missingHandoffPaths.length > 0
            ? `handoff context paths are missing on disk: ${missingHandoffPaths.join(", ")}`
            : null,
        ].filter(Boolean).join("; "),
    ),
  );

  const manifestSkillIds = manifestSkills.map((skill) => skill.id);
  const expectedSkillIds = expectedSkills.map((skill) => skill.id);
  const skillSurfaceAligned = arraysEqual(manifestSkillIds, expectedSkillIds);
  checks.push(
    buildCheck(
      "skill_surface_alignment",
      skillSurfaceAligned,
      skillSurfaceAligned
        ? "Manifest skills align with the expected skill surfaces declared in skills.yaml"
        : "Manifest skills and expected skill surfaces drifted out of alignment",
    ),
  );

  const admittedAdapterIds = readYamlList(hostAdapterText, "admitted_adapter_ids");
  const selectedAdapterId = readYamlScalar(hostAdapterText, "selected_adapter_id");
  const adapterSelected = selectedAdapterId !== null && selectedAdapterId !== "none";
  const adapterSelectionValid = selectedAdapterId !== null
    && (!adapterSelected || admittedAdapterIds.includes(selectedAdapterId));
  checks.push(
    buildCheck(
      "host_adapter_contract",
      adapterSelectionValid,
      adapterSelectionValid
        ? adapterSelected
          ? `Host adapter ${selectedAdapterId} is selected and admitted`
          : "No host adapter selected; vendor-neutral delegated host posture remains active"
        : "host-adapter selected_adapter_id must be none or one of admitted_adapter_ids",
    ),
  );

  const adapterBoundaryAligned = readYamlScalar(hostAdapterText, "semantic_review_owner") === "nimicoding_manager"
    && readYamlScalar(hostAdapterText, "handoff_mode") === "prompt_output_evidence_handoff"
    && readYamlScalar(hostAdapterText, "evidence_mode") === "candidate_only";
  checks.push(
    buildCheck(
      "host_adapter_boundary",
      adapterBoundaryAligned,
      adapterBoundaryAligned
        ? "Host adapter boundary keeps semantic review in nimicoding and limits handoff to prompt/output/evidence"
        : "host-adapter boundary drifted away from prompt/output/evidence-only handoff with nimicoding semantic review ownership",
    ),
  );

  const delegatedContracts = {
    runtimeOwner: readYamlScalar(handoffText, "runtime_owner"),
    executionMode: readYamlScalar(runtimeContractText, "runtime_mode"),
    installerMode: readYamlScalar(installerText, "installer_mode"),
    selfHostedRuntime: readYamlScalar(handoffText, "self_hosted_runtime") === "true",
    triggerMode: readYamlScalar(handoffText, "trigger_mode"),
    expectedSkillIds: manifestSkillIds,
    selectedAdapterId,
    admittedAdapterIds,
    adapterHandoffMode: readYamlScalar(hostAdapterText, "handoff_mode"),
    semanticReviewOwner: readYamlScalar(hostAdapterText, "semantic_review_owner"),
  };

  return {
    checks,
    skillsConfigText,
    runtimeInstalled: Boolean(skillsConfigText) && skillsConfigText.includes("runtime_installed: true"),
    handoffText,
    manifestText,
    hostProfileText,
    hostAdapterText,
    runtimeContractText,
    installerText,
    installerResultText,
    contractRuntimeOwnersAligned,
    delegatedModeAligned,
    selfHostedAligned,
    referenceChecks,
    resultContractAlignment,
    handoffContextOk,
    handoffRequiredContext,
    missingHandoffContextEntries,
    missingHandoffPaths,
    manifestSkillIds,
    selectedAdapterId,
    admittedAdapterIds,
    adapterSelected,
    adapterSelectionValid,
    adapterBoundaryAligned,
    delegatedContracts,
  };
}
