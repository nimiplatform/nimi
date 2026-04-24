import {
  SPEC_GENERATION_AUDIT_REF,
  STANDALONE_COMPLETION_STATUS,
} from "../../constants.mjs";

export function buildCheck(id, ok, detail, severity = ok ? "ok" : "error") {
  return { id, ok, detail, severity };
}

export function emptyDelegatedContracts() {
  return {
    runtimeOwner: null,
    executionMode: null,
    installerMode: null,
    selfHostedRuntime: false,
    triggerMode: null,
    expectedSkillIds: [],
    selectedAdapterId: null,
    admittedAdapterIds: [],
    adapterHandoffMode: null,
    semanticReviewOwner: null,
  };
}

export function emptyHandoffReadiness() {
  return {
    ok: false,
    requiredContextOrder: [],
    missingContextEntries: [],
    missingPaths: [],
  };
}

export function emptyAdapterProfiles() {
  return {
    admitted: [],
    invalid: [],
    selected: null,
  };
}

export function emptyAuditArtifact() {
  return {
    present: false,
    ok: true,
    artifactPath: ".nimi/local/handoff-results/doc_spec_audit.json",
    outcome: null,
    summaryStatus: null,
    verifiedAt: null,
    reason: "No local doc_spec_audit closeout artifact detected",
  };
}

export function emptySpecGenerationAudit() {
  return {
    present: false,
    ok: false,
    auditPath: SPEC_GENERATION_AUDIT_REF,
    validator: "validate-spec-audit",
    summary: null,
    reason: "No spec generation audit detected yet; it will be required before completed reconstruction closeout",
  };
}

export function emptyCompletionPosture() {
  return {
    completionProfile: null,
    completionStatus: STANDALONE_COMPLETION_STATUS.INCOMPLETE,
    completedSurfaces: [],
    deferredExecutionSurfaces: [],
    promotedParityGapSummary: [],
  };
}

export function emptyCanonicalTree() {
  return {
    profile: null,
    canonicalRoot: null,
    requiredFiles: [],
    present: [],
    missing: [],
    invalid: [],
    requiredFilesValid: false,
    ready: false,
  };
}

export function emptyLifecycleState() {
  return {
    mode: null,
    treeState: null,
    authorityMode: null,
    blueprintMode: null,
    reconstructionRequired: false,
    readyForAiReconstruction: false,
    cutoverReadiness: {},
    activeAuthorityRoot: null,
  };
}

export function emptyCommandGating() {
  return {
    ok: false,
    entries: [],
  };
}

export function emptyBlueprintReference() {
  return {
    present: false,
    ok: true,
    mode: null,
    root: null,
    canonicalTargetRoot: null,
    equivalenceContractRef: null,
  };
}

export function emptySpecGenerationInputs() {
  return {
    ok: false,
    mode: null,
    canonicalTargetRoot: null,
    codeRoots: [],
    docsRoots: [],
    structureRoots: [],
    humanNotePaths: [],
    benchmarkBlueprintRoot: null,
    benchmarkMode: null,
    acceptanceMode: null,
    generationOrder: [],
    inferenceRules: [],
  };
}

export function emptyBenchmarkAuditReadiness() {
  return {
    available: false,
    ready: false,
    benchmarkRoot: null,
    acceptanceMode: null,
    reason: "No benchmark blueprint is declared for this project.",
  };
}

export function emptyExecutionContracts() {
  return {
    total: 0,
    valid: 0,
    invalid: [],
    contracts: [],
  };
}

export function emptyHostCompatibility() {
  return {
    contractRef: "unknown",
    supportedHostPosture: [],
    supportedHostExamples: [],
    requiredBehavior: [],
    forbiddenBehavior: [],
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
  };
}

export function createDoctorMissingRootResult(projectRoot, detail, nextStep) {
  return {
    projectRoot,
    ok: false,
    bootstrapPresent: false,
    reconstructionRequired: false,
    runtimeInstalled: false,
    bootstrapContract: {
      status: "missing",
      id: null,
      version: null,
    },
    lifecycleState: emptyLifecycleState(),
    specTreeModel: null,
    specGenerationInputs: emptySpecGenerationInputs(),
    canonicalTree: emptyCanonicalTree(),
    specGenerationAudit: emptySpecGenerationAudit(),
    commandGating: emptyCommandGating(),
    blueprintReference: emptyBlueprintReference(),
    benchmarkAuditReadiness: emptyBenchmarkAuditReadiness(),
    delegatedContracts: emptyDelegatedContracts(),
    adapterProfiles: emptyAdapterProfiles(),
    hostCompatibility: emptyHostCompatibility(),
    ...emptyCompletionPosture(),
    handoffReadiness: emptyHandoffReadiness(),
    checks: [buildCheck("nimi_root", false, detail)],
    auditArtifact: emptyAuditArtifact(),
    executionContracts: emptyExecutionContracts(),
    nextSteps: [nextStep],
  };
}
