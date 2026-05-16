import path from "node:path";

import {
  BLUEPRINT_REFERENCE_REF,
  COMMAND_GATING_MATRIX_REF,
  LOCAL_GITIGNORE_ENTRIES,
  PACKAGE_NAME,
  REQUIRED_LOCAL_DIRS,
  SPEC_GENERATION_AUDIT_CONTRACT_REF,
  SPEC_GENERATION_AUDIT_REF,
  SPEC_GENERATION_INPUTS_CONTRACT_REF,
  SPEC_GENERATION_INPUTS_REF,
  SPEC_TREE_MODEL_REF,
} from "../../constants.mjs";
import { getBootstrapSeedEntries } from "../../seeds/bootstrap.mjs";
import { inspectBootstrapCompatibility } from "../bootstrap.mjs";
import {
  findCommandGatingRule,
  loadBlueprintReference,
  loadCommandGatingMatrix,
  loadSpecGenerationAuditContract,
  loadSpecGenerationInputsConfig,
  loadSpecGenerationInputsContract,
  loadSpecTreeModelContract,
} from "../contracts.mjs";
import { pathExists, readTextIfFile } from "../fs-helpers.mjs";
import { validateSpecAudit } from "../validators.mjs";
import {
  readYamlScalar,
} from "../yaml-helpers.mjs";
import {
  buildCheck,
  createDoctorMissingRootResult,
  emptySpecGenerationAudit,
} from "./doctor-state.mjs";
import {
  inspectBootstrapStateContract,
  inspectCanonicalTree,
  inspectStandaloneCompletionTruth,
} from "./doctor-inspectors.mjs";

export async function inspectDoctorBootstrapSurface(projectRoot) {
  const nimiRoot = path.join(projectRoot, ".nimi");
  const checks = [];

  const nimiInfo = await pathExists(nimiRoot);
  if (!nimiInfo) {
    return {
      done: true,
      result: createDoctorMissingRootResult(
        projectRoot,
        ".nimi directory is missing",
        "Run `nimicoding start` to seed the project-local .nimi bootstrap truth.",
      ),
    };
  }

  if (!nimiInfo.isDirectory()) {
    return {
      done: true,
      result: createDoctorMissingRootResult(
        projectRoot,
        ".nimi exists but is not a directory",
        "Replace the non-directory `.nimi` path, then rerun `nimicoding start`.",
      ),
    };
  }

  checks.push(buildCheck("nimi_root", true, ".nimi directory exists"));

  const seedEntries = await getBootstrapSeedEntries();
  const missingBootstrapFiles = [];
  const driftedPackageCanonicalFiles = [];
  for (const entry of seedEntries) {
    const absolutePath = path.join(projectRoot, entry.outputRelativePath);
    const info = await pathExists(absolutePath);
    if (!info || !info.isFile()) {
      missingBootstrapFiles.push(entry.outputRelativePath);
      continue;
    }
    if (entry.ownership !== "package_canonical") {
      continue;
    }
    const actual = await readTextIfFile(absolutePath);
    if (actual !== entry.content) {
      driftedPackageCanonicalFiles.push(entry.outputRelativePath);
    }
  }
  checks.push(
    buildCheck(
      "bootstrap_seed_files",
      missingBootstrapFiles.length === 0,
      missingBootstrapFiles.length === 0
        ? `All bootstrap seed files declared by the seed projection policy are present (${seedEntries.length}/${seedEntries.length})`
        : `Missing bootstrap seed files declared by the seed projection policy: ${missingBootstrapFiles.join(", ")}`,
    ),
  );
  checks.push({
    id: "bootstrap_seed_package_canonical_in_sync",
    ok: true,
    severity: driftedPackageCanonicalFiles.length === 0 ? "ok" : "warn",
    detail: driftedPackageCanonicalFiles.length === 0
      ? "All package_canonical seed files match package source byte-for-byte"
      : `package_canonical seed files diverge from package source; run \`nimicoding sync --apply\` to refresh, or \`nimicoding sync --check\` for the authoritative gate: ${driftedPackageCanonicalFiles.join(", ")}`,
  });

  const missingLocalDirs = [];
  for (const relativePath of REQUIRED_LOCAL_DIRS) {
    const info = await pathExists(path.join(projectRoot, relativePath));
    if (!info || !info.isDirectory()) {
      missingLocalDirs.push(relativePath);
    }
  }
  checks.push({
    id: "local_state_dirs",
    ok: true,
    severity: missingLocalDirs.length === 0 ? "ok" : "warn",
    detail: missingLocalDirs.length === 0
      ? "Local state directories are present"
      : `Local state directories are absent and can be recreated on demand: ${missingLocalDirs.join(", ")}`,
  });

  const gitignoreText = await readTextIfFile(path.join(projectRoot, ".gitignore"));
  const missingGitignoreEntries = gitignoreText === null
    ? LOCAL_GITIGNORE_ENTRIES.slice()
    : LOCAL_GITIGNORE_ENTRIES.filter((entry) => !gitignoreText.includes(entry));
  checks.push(
    buildCheck(
      "gitignore_local_state",
      missingGitignoreEntries.length === 0,
      missingGitignoreEntries.length === 0
        ? "Local nimicoding state is ignored by .gitignore"
        : `.gitignore is missing local-state entries: ${missingGitignoreEntries.join(", ")}`,
    ),
  );

  const bootstrapConfigText = await readTextIfFile(path.join(projectRoot, ".nimi", "config", "bootstrap.yaml"));
  const bootstrapIdentityOk = Boolean(bootstrapConfigText)
    && readYamlScalar(bootstrapConfigText, "initialized_by") === PACKAGE_NAME
    && Boolean(readYamlScalar(bootstrapConfigText, "cli_version"));
  checks.push(
    buildCheck(
      "bootstrap_config_contract",
      bootstrapIdentityOk,
      bootstrapIdentityOk
        ? "bootstrap.yaml declares the package bootstrap identity"
        : "bootstrap.yaml is missing or does not match the package bootstrap identity",
    ),
  );

  const bootstrapCompatibility = await inspectBootstrapCompatibility(projectRoot);
  checks.push({
    id: "bootstrap_contract_version",
    ok: bootstrapCompatibility.status !== "unsupported",
    severity: bootstrapCompatibility.status === "supported"
      ? "ok"
      : bootstrapCompatibility.status === "legacy"
        ? "warn"
        : bootstrapCompatibility.status === "missing"
          ? "warn"
          : "error",
    detail: bootstrapCompatibility.status === "supported"
      ? `bootstrap contract ${bootstrapCompatibility.contractId} version ${bootstrapCompatibility.contractVersion} is supported`
      : bootstrapCompatibility.status === "legacy"
        ? "bootstrap.yaml was created by nimicoding but is missing bootstrap contract metadata"
        : bootstrapCompatibility.status === "missing"
          ? "bootstrap.yaml is missing and bootstrap contract compatibility could not be checked"
          : "bootstrap.yaml declares an unsupported bootstrap contract id or version",
  });

  const specGenerationInputsContract = await loadSpecGenerationInputsContract(projectRoot);
  const specGenerationAuditContract = await loadSpecGenerationAuditContract(projectRoot);
  const specGenerationInputs = await loadSpecGenerationInputsConfig(projectRoot);
  const usesV2SurfaceModel = specGenerationInputs.ok && specGenerationInputs.mode === "class_filtered";

  const bootstrapStateText = await readTextIfFile(path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml"));
  const bootstrapStateContract = inspectBootstrapStateContract(bootstrapStateText);
  checks.push(
    buildCheck(
      "bootstrap_state_contract",
      usesV2SurfaceModel || bootstrapStateContract.ok,
      usesV2SurfaceModel
        ? "v2 host-local surface model does not require .nimi/spec/bootstrap-state.yaml"
        : bootstrapStateContract.ok
        ? `bootstrap-state.yaml matches the ${bootstrapStateContract.treeState} tree-state contract`
        : "bootstrap-state.yaml is missing required lifecycle fields or declares an unsupported lifecycle state",
      usesV2SurfaceModel ? "info" : undefined,
    ),
  );

  const productScopeText = await readTextIfFile(path.join(projectRoot, ".nimi", "spec", "product-scope.yaml"));
  const completionTruth = inspectStandaloneCompletionTruth(productScopeText);
  checks.push(
    buildCheck(
      "standalone_completion_truth",
      usesV2SurfaceModel || completionTruth.ok,
      usesV2SurfaceModel
        ? "v2 host-local surface model does not require .nimi/spec/product-scope.yaml"
        : completionTruth.ok
        ? `Product scope declares standalone completion profile ${completionTruth.completionProfile}`
        : "product-scope.yaml is missing or drifted from the package-owned standalone completion truth",
      usesV2SurfaceModel ? "info" : undefined,
    ),
  );

  const specTreeModel = await loadSpecTreeModelContract(projectRoot);
  checks.push(
    buildCheck(
      "spec_tree_model_contract",
      usesV2SurfaceModel || specTreeModel.ok,
      usesV2SurfaceModel
        ? ".nimi/contracts/surface-taxonomy.schema.yaml supplies the v2 spec surface profile"
        : specTreeModel.ok
        ? `${SPEC_TREE_MODEL_REF} declares canonical root ${specTreeModel.canonicalRoot} with profile ${specTreeModel.profile}`
        : `${SPEC_TREE_MODEL_REF} is missing or malformed`,
      usesV2SurfaceModel ? "ok" : undefined,
    ),
  );

  checks.push(
    buildCheck(
      "spec_generation_inputs_contract",
      specGenerationInputsContract.ok,
      specGenerationInputsContract.ok
        ? `${SPEC_GENERATION_INPUTS_CONTRACT_REF} is present and structurally valid`
        : `${SPEC_GENERATION_INPUTS_CONTRACT_REF} is missing or malformed`,
    ),
  );

  checks.push(
    buildCheck(
      "spec_generation_audit_contract",
      specGenerationAuditContract.ok,
      specGenerationAuditContract.ok
        ? `${SPEC_GENERATION_AUDIT_CONTRACT_REF} is present and structurally valid`
        : `${SPEC_GENERATION_AUDIT_CONTRACT_REF} is missing or malformed`,
    ),
  );

  checks.push(
    buildCheck(
      "spec_generation_inputs_config",
      specGenerationInputs.ok,
      specGenerationInputs.ok
        ? `${SPEC_GENERATION_INPUTS_REF} declares ${specGenerationInputs.mode} canonical spec generation inputs`
        : `${SPEC_GENERATION_INPUTS_REF} is missing or malformed`,
    ),
  );

  const commandGatingMatrix = await loadCommandGatingMatrix(projectRoot);
  checks.push(
    buildCheck(
      "command_gating_matrix_contract",
      usesV2SurfaceModel || commandGatingMatrix.ok,
      usesV2SurfaceModel
        ? "v2 workflow gates are provided by project-local .nimi/contracts and .nimi/methodology"
        : commandGatingMatrix.ok
        ? `${COMMAND_GATING_MATRIX_REF} declares ${commandGatingMatrix.entries.length} command gating rules`
        : `${COMMAND_GATING_MATRIX_REF} is missing or malformed`,
      usesV2SurfaceModel ? "ok" : undefined,
    ),
  );

  const blueprintReference = await loadBlueprintReference(projectRoot);
  const blueprintReferenceExpected = usesV2SurfaceModel
    ? specGenerationInputs.benchmarkMode !== "none" || typeof specGenerationInputs.benchmarkBlueprintRoot === "string"
    : bootstrapStateContract.blueprintMode !== "none";
  const expectedBlueprintCanonicalRoot = usesV2SurfaceModel
    ? specGenerationInputs.canonicalTargetRoot
    : specTreeModel.canonicalRoot;
  const blueprintReferenceAligned = !blueprintReferenceExpected
    ? !blueprintReference.present
    : blueprintReference.present
      && blueprintReference.ok
      && (usesV2SurfaceModel || blueprintReference.mode === bootstrapStateContract.blueprintMode)
      && blueprintReference.canonicalTargetRoot === expectedBlueprintCanonicalRoot;
  checks.push(
    buildCheck(
      "blueprint_reference_contract",
      blueprintReferenceAligned,
      blueprintReferenceExpected
        ? blueprintReferenceAligned
          ? `${BLUEPRINT_REFERENCE_REF} matches blueprint mode ${bootstrapStateContract.blueprintMode}`
          : `${BLUEPRINT_REFERENCE_REF} is required and must match the declared blueprint mode`
        : "No explicit project-local blueprint reference is declared",
      blueprintReferenceExpected
        ? (blueprintReferenceAligned ? "ok" : "error")
        : "info",
    ),
  );

  const benchmarkRoot = specGenerationInputs.benchmarkBlueprintRoot ?? blueprintReference.root ?? null;
  const benchmarkAvailable = typeof benchmarkRoot === "string" && benchmarkRoot.length > 0;
  const benchmarkAuditReadiness = {
    available: benchmarkAvailable,
    ready: benchmarkAvailable && Boolean(
      specGenerationInputs.ok
      && (usesV2SurfaceModel || specTreeModel.ok)
      && (
        specGenerationInputs.benchmarkMode === "none"
          ? !blueprintReference.present
          : blueprintReference.present
            && blueprintReference.ok
            && blueprintReference.root === benchmarkRoot
      ),
    ),
    benchmarkRoot,
    acceptanceMode: specGenerationInputs.acceptanceMode ?? null,
    reason: typeof benchmarkRoot === "string" && benchmarkRoot.length > 0
      ? "Benchmark audit can compare the declared blueprint root against the candidate canonical tree"
      : "No benchmark blueprint is declared for this project.",
  };
  checks.push({
    id: "benchmark_audit_readiness",
    ok: !benchmarkAuditReadiness.available || benchmarkAuditReadiness.ready,
    severity: benchmarkAuditReadiness.available
      ? benchmarkAuditReadiness.ready ? "ok" : "warn"
      : "info",
    detail: benchmarkAuditReadiness.reason,
  });

  const canonicalTree = await inspectCanonicalTree(projectRoot, specTreeModel);
  checks.push({
    id: "canonical_tree_progress",
    ok: true,
    severity: canonicalTree.requiredFilesValid
      ? "ok"
      : bootstrapStateContract.treeState === "bootstrap_only"
        ? "info"
        : "warn",
    detail: canonicalTree.requiredFilesValid
      ? "Declared canonical tree required files are present"
      : `Canonical tree required files are still missing: ${canonicalTree.missing.join(", ")}`,
  });

  const specGenerationAuditRef = usesV2SurfaceModel
    ? ".nimi/local/state/spec-generation/spec-generation-audit.yaml"
    : SPEC_GENERATION_AUDIT_REF;
  const specGenerationAuditInfo = await pathExists(path.join(projectRoot, specGenerationAuditRef));
  let specGenerationAudit = emptySpecGenerationAudit();
  specGenerationAudit.auditPath = specGenerationAuditRef;
  if (specGenerationAuditInfo?.isFile()) {
    const specGenerationAuditReport = await validateSpecAudit(
      path.join(projectRoot, specGenerationAuditRef),
      { projectRoot },
    );
    specGenerationAudit = {
      present: true,
      ok: specGenerationAuditReport.ok,
      auditPath: specGenerationAuditRef,
      validator: "validate-spec-audit",
      summary: specGenerationAuditReport.summary ?? null,
      reason: specGenerationAuditReport.ok
        ? "Spec generation audit is present and structurally valid"
        : specGenerationAuditReport.errors.join("; "),
    };
  }
  const specGenerationAuditCheckSeverity = !specGenerationAudit.present
    ? canonicalTree.requiredFilesValid ? "error" : "info"
    : specGenerationAudit.ok ? "ok" : canonicalTree.requiredFilesValid ? "error" : "warn";
  checks.push({
    id: "spec_generation_audit",
    ok: !specGenerationAudit.present ? !canonicalTree.requiredFilesValid : specGenerationAudit.ok,
    severity: specGenerationAuditCheckSeverity,
    detail: !specGenerationAudit.present
      ? canonicalTree.requiredFilesValid
        ? "Canonical tree is ready but spec generation audit is still missing or invalid"
        : specGenerationAudit.reason
      : specGenerationAudit.ok
        ? specGenerationAudit.reason
        : `Canonical tree is ready but spec generation audit is still missing or invalid: ${specGenerationAudit.reason}`,
  });

  const highRiskCloseoutGate = findCommandGatingRule(commandGatingMatrix, "closeout", "high_risk_execution");
  checks.push(
    buildCheck(
      "high_risk_closeout_gate",
      usesV2SurfaceModel || Boolean(highRiskCloseoutGate?.completedRequires?.tree_state === "canonical_tree_ready"),
      usesV2SurfaceModel
        ? "v2 high-risk closeout gates are contract-driven by project-local .nimi/contracts"
        : highRiskCloseoutGate
        ? "Command gating matrix includes high_risk_execution closeout readiness"
        : "command gating matrix is missing closeout gating for high_risk_execution",
      usesV2SurfaceModel ? "ok" : undefined,
    ),
  );

  return {
    done: false,
    projectRoot,
    checks,
    bootstrapCompatibility,
    bootstrapStateContract,
    completionTruth,
    specTreeModel,
    specGenerationInputsContract,
    specGenerationAuditContract,
    specGenerationInputs,
    commandGatingMatrix,
    blueprintReference,
    blueprintReferenceAligned,
    canonicalTree,
    benchmarkAuditReadiness,
    specGenerationAudit,
  };
}
