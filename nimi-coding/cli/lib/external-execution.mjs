import path from "node:path";

import {
  EXTERNAL_EXECUTION_ARTIFACTS_CONFIG_REF,
  HIGH_RISK_EXECUTION_ARTIFACT_HARD_CONSTRAINTS,
  HIGH_RISK_EXECUTION_ARTIFACT_ROOTS,
  HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF,
  HOST_ADAPTER_CONFIG_REF,
} from "../constants.mjs";
import { readTextIfFile } from "./fs-helpers.mjs";
import { arraysEqual, isPlainObject, toStringArray } from "./value-helpers.mjs";
import { parseYamlText } from "./yaml-helpers.mjs";

function parseExternalExecutionArtifactsConfig(text) {
  const parsed = parseYamlText(text);
  const root = parsed?.external_execution_artifacts;
  const artifactRoots = isPlainObject(root?.artifact_roots) ? root.artifact_roots : null;
  const hardConstraints = toStringArray(root?.hard_constraints);

  const artifactRootsOk = Boolean(artifactRoots)
    && Object.entries(HIGH_RISK_EXECUTION_ARTIFACT_ROOTS).every(
      ([field, expectedPath]) => String(artifactRoots[field] ?? "") === expectedPath,
    )
    && Object.keys(artifactRoots).length === Object.keys(HIGH_RISK_EXECUTION_ARTIFACT_ROOTS).length;

  return {
    ok: String(root?.skill_id ?? "") === "high_risk_execution"
      && String(root?.host_adapter_ref ?? "") === HOST_ADAPTER_CONFIG_REF
      && String(root?.result_contract_ref ?? "") === HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF
      && String(root?.locality ?? "") === "local_only"
      && artifactRootsOk
      && arraysEqual(hardConstraints, HIGH_RISK_EXECUTION_ARTIFACT_HARD_CONSTRAINTS),
    artifactRoots: artifactRootsOk
      ? Object.fromEntries(
        Object.entries(HIGH_RISK_EXECUTION_ARTIFACT_ROOTS).map(([field]) => [field, artifactRoots[field]]),
      )
      : null,
    hardConstraints,
  };
}

function normalizeRef(ref) {
  return path.posix.normalize(String(ref ?? "")).replace(/^\.\/+/, "");
}

function isRefUnderRoot(ref, root) {
  const normalizedRef = normalizeRef(ref);
  const normalizedRoot = normalizeRef(root);

  return normalizedRef === normalizedRoot || normalizedRef.startsWith(`${normalizedRoot}/`);
}

export async function loadExternalExecutionArtifactsConfig(projectRoot) {
  const text = await readTextIfFile(
    path.join(projectRoot, EXTERNAL_EXECUTION_ARTIFACTS_CONFIG_REF),
  );

  return {
    path: EXTERNAL_EXECUTION_ARTIFACTS_CONFIG_REF,
    text,
    ...parseExternalExecutionArtifactsConfig(text),
  };
}

export function validateHighRiskExecutionArtifactRefs(summary, config) {
  if (!config.ok || !config.artifactRoots) {
    return {
      ok: false,
      reason: "external execution artifacts config is missing or malformed",
    };
  }

  for (const field of [
    "packet_ref",
    "orchestration_state_ref",
    "prompt_ref",
    "worker_output_ref",
  ]) {
    const expectedRoot = config.artifactRoots[field];
    if (!isRefUnderRoot(summary[field], expectedRoot)) {
      return {
        ok: false,
        reason: `high_risk_execution summary.${field} must stay under ${expectedRoot}`,
      };
    }
  }

  const evidenceRoot = config.artifactRoots.evidence_refs;
  for (const ref of summary.evidence_refs) {
    if (!isRefUnderRoot(ref, evidenceRoot)) {
      return {
        ok: false,
        reason: `high_risk_execution summary.evidence_refs entries must stay under ${evidenceRoot}`,
      };
    }
  }

  return {
    ok: true,
  };
}
