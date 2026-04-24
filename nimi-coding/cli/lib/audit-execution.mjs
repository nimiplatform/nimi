import path from "node:path";

import {
  AUDIT_EXECUTION_ARTIFACTS_CONFIG_REF,
  AUDIT_SWEEP_ARTIFACT_HARD_CONSTRAINTS,
  AUDIT_SWEEP_ARTIFACT_ROOTS,
  AUDIT_SWEEP_RESULT_CONTRACT_REF,
  HOST_ADAPTER_CONFIG_REF,
} from "../constants.mjs";
import { readTextIfFile } from "./fs-helpers.mjs";
import { arraysEqual, isPlainObject, toStringArray } from "./value-helpers.mjs";
import { parseYamlText } from "./yaml-helpers.mjs";

function parseAuditExecutionArtifactsConfig(text) {
  const parsed = parseYamlText(text);
  const root = parsed?.audit_execution_artifacts;
  const artifactRoots = isPlainObject(root?.artifact_roots) ? root.artifact_roots : null;
  const hardConstraints = toStringArray(root?.hard_constraints);

  const artifactRootsOk = Boolean(artifactRoots)
    && Object.entries(AUDIT_SWEEP_ARTIFACT_ROOTS).every(
      ([field, expectedPath]) => String(artifactRoots[field] ?? "") === expectedPath,
    )
    && Object.keys(artifactRoots).length === Object.keys(AUDIT_SWEEP_ARTIFACT_ROOTS).length;

  return {
    ok: String(root?.skill_id ?? "") === "audit_sweep"
      && String(root?.host_adapter_ref ?? "") === HOST_ADAPTER_CONFIG_REF
      && String(root?.result_contract_ref ?? "") === AUDIT_SWEEP_RESULT_CONTRACT_REF
      && String(root?.locality ?? "") === "local_only"
      && artifactRootsOk
      && arraysEqual(hardConstraints, AUDIT_SWEEP_ARTIFACT_HARD_CONSTRAINTS),
    artifactRoots: artifactRootsOk
      ? Object.fromEntries(
        Object.entries(AUDIT_SWEEP_ARTIFACT_ROOTS).map(([field]) => [field, artifactRoots[field]]),
      )
      : null,
    hardConstraints,
  };
}

export async function loadAuditExecutionArtifactsConfig(projectRoot) {
  const text = await readTextIfFile(
    path.join(projectRoot, AUDIT_EXECUTION_ARTIFACTS_CONFIG_REF),
  );

  return {
    path: AUDIT_EXECUTION_ARTIFACTS_CONFIG_REF,
    text,
    ...parseAuditExecutionArtifactsConfig(text),
  };
}
