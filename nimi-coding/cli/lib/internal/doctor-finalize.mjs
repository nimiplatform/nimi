import path from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  AGENTS_BEGIN,
  AUDIT_SWEEP_RESULT_CONTRACT_REF,
  CLAUDE_BEGIN,
  EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF,
  HIGH_RISK_ADMISSION_CONTRACT_REF,
  STANDALONE_COMPLETION_STATUS,
} from "../../constants.mjs";
import {
  loadAdmittedAdapterProfiles,
  selectAdapterProfile,
} from "../adapter-profiles.mjs";
import {
  loadAuditSweepContract,
  loadDocSpecAuditContract,
  loadExternalHostCompatibilityContract,
  loadHighRiskAdmissionContract,
  loadHighRiskExecutionContract,
  loadHighRiskSchemaContracts,
  loadSpecReconstructionContract,
  validateHighRiskAdmissionsSpec,
} from "../contracts.mjs";
import { loadAuditExecutionArtifactsConfig } from "../audit-execution.mjs";
import { loadExternalExecutionArtifactsConfig } from "../external-execution.mjs";
import { pathExists, readTextIfFile } from "../fs-helpers.mjs";
import { parseYamlText } from "../yaml-helpers.mjs";
import { buildCheck } from "./doctor-state.mjs";
import {
  buildHostCompatibilityReport,
  inspectLocalDocSpecAuditArtifact,
  inspectPackageBoundaryTruth,
} from "./doctor-inspectors.mjs";

const PACKAGE_REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

export async function finalizeDoctorState(projectRoot, bootstrapSurface, delegatedSurface) {
  const checks = [...bootstrapSurface.checks, ...delegatedSurface.checks];

  const specContract = await loadSpecReconstructionContract(projectRoot);
  const auditContract = await loadDocSpecAuditContract(projectRoot);
  const auditSweepContract = await loadAuditSweepContract(projectRoot);
  const externalHostCompatibilityContract = await loadExternalHostCompatibilityContract(projectRoot);
  const highRiskExecutionContract = await loadHighRiskExecutionContract(projectRoot);
  const highRiskAdmissionContract = await loadHighRiskAdmissionContract(projectRoot);
  const auditExecutionArtifacts = await loadAuditExecutionArtifactsConfig(projectRoot);
  const externalExecutionArtifacts = await loadExternalExecutionArtifactsConfig(projectRoot);
  const highRiskSchemaContracts = await loadHighRiskSchemaContracts(projectRoot);
  checks.push(
    buildCheck(
      "spec_reconstruction_result_contract",
      specContract.ok,
      specContract.ok
        ? "spec-reconstruction result contract is present and structurally valid"
        : "spec-reconstruction result contract is missing or malformed",
    ),
  );
  checks.push(
    buildCheck(
      "doc_spec_audit_result_contract",
      auditContract.ok,
      auditContract.ok
        ? "doc-spec-audit result contract is present and structurally valid"
        : "doc-spec-audit result contract is missing or malformed",
    ),
  );
  checks.push(
    buildCheck(
      "audit_sweep_result_contract",
      auditSweepContract.ok,
      auditSweepContract.ok
        ? "audit-sweep result contract is present and structurally valid"
        : `${AUDIT_SWEEP_RESULT_CONTRACT_REF} is missing or malformed`,
    ),
  );
  checks.push(
    buildCheck(
      "external_host_compatibility_contract",
      externalHostCompatibilityContract.ok,
      externalHostCompatibilityContract.ok
        ? "Packaged external host compatibility contract is present and aligned"
        : `${EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF} is missing or malformed`,
    ),
  );
  checks.push(
    buildCheck(
      "high_risk_execution_result_contract",
      highRiskExecutionContract.ok,
      highRiskExecutionContract.ok
        ? "high-risk-execution result contract is present and structurally valid"
        : "high-risk-execution result contract is missing or malformed",
    ),
  );
  checks.push(
    buildCheck(
      "high_risk_admission_contract",
      highRiskAdmissionContract.ok,
      highRiskAdmissionContract.ok
        ? "Packaged high-risk admission schema contract is present and aligned"
        : `${HIGH_RISK_ADMISSION_CONTRACT_REF} is missing or malformed`,
    ),
  );
  checks.push(
    buildCheck(
      "audit_execution_artifacts_contract",
      auditExecutionArtifacts.ok,
      auditExecutionArtifacts.ok
        ? "audit execution artifact landing-path contract is present and structurally valid"
        : "audit execution artifact landing-path contract is missing or malformed",
    ),
  );
  checks.push(
    buildCheck(
      "external_execution_artifacts_contract",
      externalExecutionArtifacts.ok,
      externalExecutionArtifacts.ok
        ? "external execution artifact landing-path contract is present and structurally valid"
        : "external execution artifact landing-path contract is missing or malformed",
    ),
  );
  checks.push(
    buildCheck(
      "high_risk_schema_contracts",
      highRiskSchemaContracts.every((entry) => entry.ok),
      highRiskSchemaContracts.every((entry) => entry.ok)
        ? "High-risk execution schema seeds are present and structurally valid"
        : `High-risk execution schema seeds are missing or malformed: ${highRiskSchemaContracts.filter((entry) => !entry.ok).map((entry) => entry.path).join(", ")}`,
    ),
  );

  let highRiskAdmissionsTruthValid = true;
  const admissionsTruthRef = ".nimi/spec/high-risk-admissions.yaml";
  const admissionsInfo = await pathExists(path.join(projectRoot, admissionsTruthRef));
  if (admissionsInfo && admissionsInfo.isFile()) {
    const admissionsTruthText = await readTextIfFile(path.join(projectRoot, admissionsTruthRef));
    const admissionsTruthParsed = admissionsTruthText ? parseYamlText(admissionsTruthText) : null;
    const admissionsTruthValidation = highRiskAdmissionContract.ok
      ? validateHighRiskAdmissionsSpec(admissionsTruthParsed, highRiskAdmissionContract)
      : {
        ok: false,
        reason: `${HIGH_RISK_ADMISSION_CONTRACT_REF} is missing or malformed`,
      };
    highRiskAdmissionsTruthValid = admissionsTruthValidation.ok;
    checks.push(
      buildCheck(
        "high_risk_admissions_truth",
        admissionsTruthValidation.ok,
        admissionsTruthValidation.ok
          ? "Canonical high-risk admissions truth satisfies the packaged admission schema contract"
          : `Canonical high-risk admissions truth drifted: ${admissionsTruthValidation.reason}`,
      ),
    );
  }

  const adapterProfiles = await loadAdmittedAdapterProfiles(delegatedSurface.admittedAdapterIds);
  adapterProfiles.selected = selectAdapterProfile(adapterProfiles, delegatedSurface.selectedAdapterId);
  const adapterProfilesValid = adapterProfiles.invalid.length === 0;
  checks.push(
    buildCheck(
      "adapter_profile_overlays",
      adapterProfilesValid,
      adapterProfilesValid
        ? adapterProfiles.admitted.length === 0
          ? "No package-owned adapter profile overlays are currently admitted"
          : `Package-owned adapter profile overlays are present and valid: ${adapterProfiles.admitted.map((profile) => profile.id).join(", ")}`
        : `Package-owned adapter profile overlays are missing or malformed: ${adapterProfiles.invalid.map((profile) => `${profile.id} -> ${profile.reason}`).join(", ")}`,
    ),
  );

  const lifecycleAligned = (
    bootstrapSurface.bootstrapStateContract.treeState === "bootstrap_only"
    && bootstrapSurface.canonicalTree.ready === false
  ) || (
    bootstrapSurface.bootstrapStateContract.treeState === "spec_tree_seeded"
    && bootstrapSurface.canonicalTree.ready === false
  ) || (
    bootstrapSurface.bootstrapStateContract.treeState === "canonical_tree_in_progress"
    && bootstrapSurface.canonicalTree.ready === false
  ) || (
    bootstrapSurface.bootstrapStateContract.treeState === "canonical_tree_ready"
    && bootstrapSurface.canonicalTree.requiredFilesValid === true
  );
  checks.push(
    buildCheck(
      "bootstrap_lifecycle_alignment",
      lifecycleAligned,
      lifecycleAligned
        ? `bootstrap-state lifecycle ${bootstrapSurface.bootstrapStateContract.treeState ?? "unknown"} is aligned with the current canonical tree readiness`
        : bootstrapSurface.bootstrapStateContract.treeState === "canonical_tree_ready"
          ? "bootstrap-state declares canonical_tree_ready but required canonical files are still missing"
          : "bootstrap-state lifecycle drifted away from the current canonical tree readiness",
    ),
  );

  const auditArtifact = await inspectLocalDocSpecAuditArtifact(projectRoot, auditContract);
  checks.push({
    id: "doc_spec_audit_artifact",
    ok: !auditArtifact.present || auditArtifact.ok,
    severity: !auditArtifact.present ? "info" : auditArtifact.ok ? "ok" : "warn",
    detail: auditArtifact.reason,
  });

  const auditArtifactConsistent = !auditArtifact.present
    || auditArtifact.outcome !== "completed"
    || bootstrapSurface.canonicalTree.requiredFilesValid;
  checks.push(
    buildCheck(
      "doc_spec_audit_state_alignment",
      auditArtifactConsistent,
      auditArtifactConsistent
        ? "Local doc_spec_audit artifact is consistent with the current reconstruction state"
        : "Completed local doc_spec_audit artifact requires the canonical tree to remain ready",
    ),
  );

  const entrypointStatuses = [];
  for (const [relativePath, beginToken] of [
    ["AGENTS.md", AGENTS_BEGIN],
    ["CLAUDE.md", CLAUDE_BEGIN],
  ]) {
    const entryText = await readTextIfFile(path.join(projectRoot, relativePath));
    if (entryText && entryText.includes(beginToken)) {
      entrypointStatuses.push(relativePath);
    }
  }
  checks.push({
    id: "entrypoint_integration",
    ok: true,
    severity: "info",
    detail: entrypointStatuses.length === 0
      ? "No managed AI entrypoint blocks detected; this is optional"
      : `Managed AI entrypoint blocks detected in: ${entrypointStatuses.join(", ")}`,
  });

  let packageBoundaryTruthOk = true;
  let packageSelfAuditActive = false;
  try {
    packageSelfAuditActive = (await realpath(projectRoot)) === (await realpath(PACKAGE_REPO_ROOT));
  } catch {
    packageSelfAuditActive = false;
  }

  if (packageSelfAuditActive) {
    const boundariesText = await readTextIfFile(path.join(projectRoot, ".nimi", "spec", "boundaries.yaml"));
    const changePolicyText = await readTextIfFile(path.join(projectRoot, ".nimi", "spec", "change-policy.yaml"));
    const packageBoundaryTruth = inspectPackageBoundaryTruth(boundariesText, changePolicyText);
    packageBoundaryTruthOk = packageBoundaryTruth.ok;
    checks.push(
      buildCheck(
        "package_boundary_truth",
        packageBoundaryTruth.ok,
        packageBoundaryTruth.ok
          ? "Repo-local boundaries and change-policy keep runtime surfaces explicitly deferred under the boundary-complete standalone posture"
          : "Repo-local boundaries or change-policy drifted away from the declared boundary-complete standalone posture",
      ),
    );
  }

  const hasErrors = checks.some((check) => check.severity === "error");
  const reconstructionRequired = bootstrapSurface.bootstrapStateContract.reconstructionRequired === true;

  const handoffReadiness = {
    ok: delegatedSurface.handoffContextOk
      && delegatedSurface.referenceChecks.every(Boolean)
      && delegatedSurface.contractRuntimeOwnersAligned
      && delegatedSurface.delegatedModeAligned
      && delegatedSurface.selfHostedAligned
      && bootstrapSurface.completionTruth.ok
      && delegatedSurface.resultContractAlignment
      && delegatedSurface.adapterSelectionValid
      && adapterProfilesValid
      && delegatedSurface.adapterBoundaryAligned
      && specContract.ok
      && auditContract.ok
      && externalHostCompatibilityContract.ok
      && highRiskExecutionContract.ok
      && highRiskAdmissionContract.ok
      && highRiskAdmissionsTruthValid
      && externalExecutionArtifacts.ok
      && packageBoundaryTruthOk
      && bootstrapSurface.specTreeModel.ok
      && bootstrapSurface.specGenerationInputsContract.ok
      && bootstrapSurface.specGenerationAuditContract.ok
      && bootstrapSurface.specGenerationInputs.ok
      && (!bootstrapSurface.canonicalTree.requiredFilesValid || bootstrapSurface.specGenerationAudit.ok)
      && bootstrapSurface.commandGatingMatrix.ok
      && bootstrapSurface.blueprintReferenceAligned
      && lifecycleAligned,
    requiredContextOrder: delegatedSurface.handoffRequiredContext,
    missingContextEntries: delegatedSurface.missingHandoffContextEntries,
    missingPaths: delegatedSurface.missingHandoffPaths,
  };

  const nextSteps = [];
  if (hasErrors) {
    nextSteps.push("Repair the failing bootstrap checks, then rerun `nimicoding doctor`.");
  } else if (!bootstrapSurface.canonicalTree.requiredFilesValid) {
    nextSteps.push("Use an external AI host to reconstruct the declared canonical tree under `.nimi/spec`.");
  }
  if (bootstrapSurface.canonicalTree.requiredFilesValid && bootstrapSurface.benchmarkAuditReadiness.ready) {
    nextSteps.push("Run `nimicoding blueprint-audit --write-local` after canonical tree generation when a benchmark blueprint is declared.");
  }
  if (bootstrapSurface.canonicalTree.requiredFilesValid && !bootstrapSurface.specGenerationAudit.ok) {
    nextSteps.push("Run `nimicoding validate-spec-audit` after generating `.nimi/spec/_meta/spec-generation-audit.yaml` for the canonical tree.");
  }
  if (!auditArtifact.present && bootstrapSurface.canonicalTree.requiredFilesValid) {
    nextSteps.push("Run `nimicoding handoff --skill doc_spec_audit` and close out the result locally when the audit is complete.");
  }
  if (!delegatedSurface.runtimeInstalled) {
    nextSteps.push("Keep runtime ownership delegated; do not assume local skill installation or self-hosting.");
  }
  if (!delegatedSurface.adapterSelected && !hasErrors) {
    nextSteps.push("If you want a constrained external execution host, select one in `.nimi/config/host-adapter.yaml`.");
  }

  const executionContracts = {
    total: highRiskSchemaContracts.length,
    valid: highRiskSchemaContracts.filter((entry) => entry.ok).length,
    invalid: highRiskSchemaContracts
      .filter((entry) => !entry.ok)
      .map((entry) => entry.path),
    contracts: highRiskSchemaContracts.map((entry) => ({
      path: entry.path,
      ok: entry.ok,
    })),
  };

  const completionStatus = !bootstrapSurface.completionTruth.ok || !packageBoundaryTruthOk
    ? STANDALONE_COMPLETION_STATUS.DRIFTED
    : !hasErrors
      ? STANDALONE_COMPLETION_STATUS.COMPLETE
      : STANDALONE_COMPLETION_STATUS.INCOMPLETE;

  const hostCompatibility = buildHostCompatibilityReport(
    externalHostCompatibilityContract,
    adapterProfiles,
    delegatedSurface.selectedAdapterId,
  );

  return {
    projectRoot,
    ok: !hasErrors,
    bootstrapPresent: true,
    reconstructionRequired,
    runtimeInstalled: delegatedSurface.runtimeInstalled,
    bootstrapContract: {
      status: bootstrapSurface.bootstrapCompatibility.status,
      id: bootstrapSurface.bootstrapCompatibility.contractId,
      version: bootstrapSurface.bootstrapCompatibility.contractVersion,
    },
    lifecycleState: {
      mode: bootstrapSurface.bootstrapStateContract.mode,
      treeState: bootstrapSurface.bootstrapStateContract.treeState,
      authorityMode: bootstrapSurface.bootstrapStateContract.authorityMode,
      blueprintMode: bootstrapSurface.bootstrapStateContract.blueprintMode,
      reconstructionRequired: bootstrapSurface.bootstrapStateContract.reconstructionRequired,
      readyForAiReconstruction: bootstrapSurface.bootstrapStateContract.readyForAiReconstruction,
      cutoverReadiness: bootstrapSurface.bootstrapStateContract.cutoverReadiness,
      activeAuthorityRoot: bootstrapSurface.bootstrapStateContract.activeAuthorityRoot,
    },
    specTreeModel: bootstrapSurface.specTreeModel,
    specGenerationInputs: bootstrapSurface.specGenerationInputs,
    canonicalTree: bootstrapSurface.canonicalTree,
    specGenerationAudit: bootstrapSurface.specGenerationAudit,
    commandGating: bootstrapSurface.commandGatingMatrix,
    blueprintReference: bootstrapSurface.blueprintReference,
    benchmarkAuditReadiness: bootstrapSurface.benchmarkAuditReadiness,
    completionProfile: bootstrapSurface.completionTruth.completionProfile,
    completionStatus,
    completedSurfaces: bootstrapSurface.completionTruth.completedSurfaces,
    deferredExecutionSurfaces: bootstrapSurface.completionTruth.deferredExecutionSurfaces,
    promotedParityGapSummary: bootstrapSurface.completionTruth.promotedParityGapSummary,
    hostCompatibility,
    delegatedContracts: delegatedSurface.delegatedContracts,
    adapterProfiles,
    handoffReadiness,
    checks,
    auditArtifact,
    executionContracts,
    nextSteps,
  };
}
