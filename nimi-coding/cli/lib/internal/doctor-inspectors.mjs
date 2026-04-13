import path from "node:path";

import {
  EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF,
  STANDALONE_COMPLETED_SURFACES,
  STANDALONE_COMPLETION_PROFILE,
  STANDALONE_DEFERRED_EXECUTION_SURFACES,
  STANDALONE_PROMOTED_PARITY_GAP_SUMMARY,
} from "../../constants.mjs";
import { readTextIfFile, pathExists } from "../fs-helpers.mjs";
import { arraysEqual } from "../value-helpers.mjs";
import {
  parseYamlText,
} from "../yaml-helpers.mjs";
import { validateDocSpecAuditSummary } from "../contracts.mjs";
import {
  emptyAuditArtifact,
  emptyCanonicalTree,
} from "./doctor-state.mjs";

export function inspectStandaloneCompletionTruth(productScopeText) {
  const parsed = parseYamlText(productScopeText);
  const completion = parsed?.standalone_completion;

  const completionProfile = typeof completion?.profile === "string" ? completion.profile : null;
  const completedSurfaces = Array.isArray(completion?.completed_surfaces)
    ? completion.completed_surfaces.map((entry) => String(entry))
    : [];
  const deferredExecutionSurfaces = Array.isArray(completion?.deferred_execution_surfaces)
    ? completion.deferred_execution_surfaces.map((entry) => String(entry))
    : [];
  const promotedParityGapSummary = Array.isArray(completion?.promoted_parity_gap_summary)
    ? completion.promoted_parity_gap_summary.map((entry) => String(entry))
    : [];

  const ok = completionProfile === STANDALONE_COMPLETION_PROFILE
    && arraysEqual(completedSurfaces, STANDALONE_COMPLETED_SURFACES)
    && arraysEqual(deferredExecutionSurfaces, STANDALONE_DEFERRED_EXECUTION_SURFACES)
    && arraysEqual(promotedParityGapSummary, STANDALONE_PROMOTED_PARITY_GAP_SUMMARY);

  return {
    ok,
    completionProfile,
    completedSurfaces,
    deferredExecutionSurfaces,
    promotedParityGapSummary,
  };
}

export function inspectPackageBoundaryTruth(boundariesText, changePolicyText) {
  const boundaries = parseYamlText(boundariesText);
  const changePolicy = parseYamlText(changePolicyText);

  const boundaryOk = Array.isArray(boundaries?.boundaries)
    && boundaries.boundaries.some((entry) => entry?.boundary === "standalone_boundary_completion_vs_promoted_runtime_parity")
    && Array.isArray(boundaries?.invariants)
    && boundaries.invariants.includes("standalone completion posture remains boundary_complete rather than promoted_runtime_parity")
    && Array.isArray(boundaries?.fail_closed_rules)
    && boundaries.fail_closed_rules.includes("fail if package-owned standalone completion truth drifts into claiming run kernel, provider runtime, scheduler, notification, or automation ownership");

  const runtimeBoundaryWorkType = Array.isArray(changePolicy?.work_types)
    ? changePolicy.work_types.find((entry) => entry?.id === "runtime_boundary_expansion")
    : null;
  const runtimeBoundaryGate = Array.isArray(changePolicy?.authority_gates)
    ? changePolicy.authority_gates.find((entry) => entry?.gate === "runtime_boundary_preservation")
    : null;
  const changePolicyOk = Boolean(runtimeBoundaryWorkType)
    && typeof runtimeBoundaryWorkType.notes === "string"
    && runtimeBoundaryWorkType.notes.includes("topic lifecycle runtime")
    && runtimeBoundaryWorkType.notes.includes("packet-bound run kernel")
    && runtimeBoundaryWorkType.notes.includes("provider execution")
    && Boolean(runtimeBoundaryGate)
    && typeof runtimeBoundaryGate.enforcement === "string"
    && runtimeBoundaryGate.enforcement.includes("boundary-complete standalone");

  return {
    ok: boundaryOk && changePolicyOk,
    boundaryOk,
    changePolicyOk,
  };
}

export function buildHostCompatibilityReport(externalHostCompatibilityContract, adapterProfiles, selectedAdapterId) {
  const admittedOverlayIds = adapterProfiles.admitted.map((profile) => profile.id).filter(Boolean);
  const selectedOverlayId = selectedAdapterId && selectedAdapterId !== "none" ? selectedAdapterId : null;
  const selectedOverlayProfile = adapterProfiles.selected ?? null;
  const futureOnlyHostSurfaces = adapterProfiles.admitted.flatMap((profile) => {
    const commands = profile.promptHandoff?.futureSurface ?? [];
    const status = profile.promptHandoff?.futureSurfaceStatus ?? null;
    return commands.map((command) => ({
      adapterId: profile.id,
      status,
      command,
    }));
  });

  let overlayMode = "generic_only";
  if (admittedOverlayIds.length > 0) {
    overlayMode = selectedOverlayId ? "named_admitted_overlay_selected" : "named_admitted_overlay_available";
  }

  return {
    contractRef: EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF,
    supportedHostPosture: externalHostCompatibilityContract.supportedHostPosture,
    supportedHostExamples: externalHostCompatibilityContract.supportedHostExamples,
    requiredBehavior: externalHostCompatibilityContract.requiredBehavior,
    forbiddenBehavior: externalHostCompatibilityContract.forbiddenBehavior,
    genericExternalHostCompatible: externalHostCompatibilityContract.ok
      && externalHostCompatibilityContract.supportedHostPosture.includes("host_agnostic_external_host"),
    namedOverlaySupport: {
      mode: overlayMode,
      admittedOverlayIds,
      selectedOverlayId,
      selectedOverlayProfileRef: selectedOverlayProfile?.profileRef ?? null,
      selectedOverlayHostClass: selectedOverlayProfile?.hostClass ?? null,
    },
    futureOnlyHostSurfaces,
  };
}

export async function inspectLocalDocSpecAuditArtifact(projectRoot, auditContract) {
  const artifact = emptyAuditArtifact();
  const absolutePath = path.join(projectRoot, artifact.artifactPath);
  const text = await readTextIfFile(absolutePath);
  if (text === null) {
    return artifact;
  }

  artifact.present = true;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    artifact.ok = false;
    artifact.reason = "Local doc_spec_audit closeout artifact is not valid JSON";
    return artifact;
  }

  const skillId = typeof parsed.skill === "string"
    ? parsed.skill
    : parsed.skill && typeof parsed.skill === "object"
      ? parsed.skill.id
      : null;

  if (skillId !== "doc_spec_audit") {
    artifact.ok = false;
    artifact.reason = "Local doc_spec_audit closeout artifact declares the wrong skill id";
    return artifact;
  }

  artifact.outcome = parsed.outcome ?? null;
  artifact.verifiedAt = parsed.verifiedAt ?? null;

  if (!parsed.summary) {
    artifact.reason = `Local doc_spec_audit closeout artifact detected with outcome ${parsed.outcome ?? "unknown"}`;
    return artifact;
  }

  const validation = validateDocSpecAuditSummary(parsed.summary, auditContract, parsed.verifiedAt);
  if (!validation.ok) {
    artifact.ok = false;
    artifact.reason = validation.reason;
    return artifact;
  }

  artifact.summaryStatus = parsed.summary.status;
  artifact.reason = `Local doc_spec_audit closeout artifact detected: outcome ${parsed.outcome}, summary status ${parsed.summary.status}`;
  return artifact;
}

export function inspectBootstrapStateContract(bootstrapStateText) {
  const parsed = parseYamlText(bootstrapStateText);
  const mode = parsed?.state?.mode ?? null;
  const treeState = parsed?.state?.tree_state ?? null;
  const authorityMode = parsed?.state?.authority_mode === "external_blueprint_active"
    ? "external_authority_active"
    : parsed?.state?.authority_mode ?? null;
  const blueprintMode = parsed?.state?.blueprint_mode ?? null;
  const reconstructionRequired = parsed?.state?.reconstruction_required;
  const readyForAiReconstruction = parsed?.status?.ready_for_ai_reconstruction;
  const lifecycleContract = parsed?.lifecycle_contract ?? null;
  const supportedMode = mode === "bootstrap_only" || mode === "reconstruction_seeded";
  const supportedTreeState = Array.isArray(lifecycleContract?.tree_state_enum)
    ? lifecycleContract.tree_state_enum.includes(treeState)
    : false;
  const supportedAuthorityMode = Array.isArray(lifecycleContract?.authority_mode_enum)
    ? lifecycleContract.authority_mode_enum.includes(authorityMode)
    : false;
  const supportedBlueprintMode = Array.isArray(lifecycleContract?.blueprint_mode_enum)
    ? lifecycleContract.blueprint_mode_enum.includes(blueprintMode)
    : false;
  const legacyModeMapping = Array.isArray(lifecycleContract?.legacy_mode_mapping)
    ? lifecycleContract.legacy_mode_mapping
      .map((entry) => ({
        ...entry,
        authority_mode: entry?.authority_mode === "external_blueprint_active"
          ? "external_authority_active"
          : entry?.authority_mode,
      }))
      .find((entry) => entry?.legacy_mode === mode) ?? null
    : null;
  const modeSpecificContractOk = (
    mode === "bootstrap_only"
      && reconstructionRequired === true
      && readyForAiReconstruction === true
  ) || (
    mode === "reconstruction_seeded"
      && reconstructionRequired === false
      && readyForAiReconstruction === false
  );
  const multiAxisAligned = (
    legacyModeMapping
    && legacyModeMapping.tree_state === treeState
    && legacyModeMapping.authority_mode === authorityMode
    && legacyModeMapping.reconstruction_required === reconstructionRequired
    && legacyModeMapping.ready_for_ai_reconstruction === readyForAiReconstruction
  ) || (
    mode === "reconstruction_seeded"
    && treeState === "canonical_tree_ready"
    && authorityMode === "external_authority_active"
    && reconstructionRequired === false
    && readyForAiReconstruction === false
  ) || (
    mode === "reconstruction_seeded"
    && treeState === "canonical_tree_ready"
    && authorityMode === "canonical_active"
    && reconstructionRequired === false
    && readyForAiReconstruction === false
  );

  return {
    mode,
    treeState,
    authorityMode,
    blueprintMode,
    supportedMode,
    supportedTreeState,
    supportedAuthorityMode,
    supportedBlueprintMode,
    reconstructionRequired,
    readyForAiReconstruction,
    cutoverReadiness: parsed?.cutover_readiness ?? {},
    activeAuthorityRoot: parsed?.status?.active_authority_root ?? null,
    ok: Boolean(bootstrapStateText)
      && supportedMode
      && supportedTreeState
      && supportedAuthorityMode
      && supportedBlueprintMode
      && modeSpecificContractOk
      && multiAxisAligned,
  };
}

export async function inspectCanonicalTree(projectRoot, specTreeModel) {
  if (!specTreeModel.ok) {
    return emptyCanonicalTree();
  }

  const requiredFiles = specTreeModel.requiredFilesByProfile[specTreeModel.profile] ?? [];
  const present = [];
  const missing = [];

  for (const relativePath of requiredFiles) {
    const info = await pathExists(path.join(projectRoot, relativePath));
    if (info && info.isFile()) {
      present.push(relativePath);
    } else {
      missing.push(relativePath);
    }
  }

  return {
    profile: specTreeModel.profile,
    canonicalRoot: specTreeModel.canonicalRoot,
    requiredFiles,
    present,
    missing,
    invalid: [],
    requiredFilesValid: missing.length === 0,
    ready: missing.length === 0,
  };
}
