import path from "node:path";

import {
  ACCEPTANCE_SCHEMA_REF,
  BLUEPRINT_REFERENCE_REF,
  COMMAND_GATING_MATRIX_REF,
  DOC_SPEC_AUDIT_RESULT_CONTRACT_REF,
  EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF,
  EXECUTION_PACKET_SCHEMA_REF,
  HIGH_RISK_ADMISSION_CONTRACT_REF,
  HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF,
  ORCHESTRATION_STATE_SCHEMA_REF,
  PROMPT_SCHEMA_REF,
  SPEC_GENERATION_AUDIT_CONTRACT_REF,
  SPEC_GENERATION_INPUTS_CONTRACT_REF,
  SPEC_GENERATION_INPUTS_REF,
  SPEC_RECONSTRUCTION_RESULT_CONTRACT_REF,
  SPEC_TREE_MODEL_REF,
  WORKER_OUTPUT_SCHEMA_REF,
} from "../../constants.mjs";
import { readTextIfFile } from "../fs-helpers.mjs";
import {
  parseBlueprintReference,
  parseCommandGatingMatrix,
  parseDocSpecAuditContract,
  parseExternalHostCompatibilityContract,
  parseHighRiskAdmissionContract,
  parseHighRiskExecutionContract,
  parseHighRiskSchemaContract,
  parseSpecGenerationAuditContract,
  parseSpecGenerationInputsConfig,
  parseSpecGenerationInputsContract,
  parseSpecReconstructionContract,
  parseSpecTreeModel,
} from "./contracts-parse.mjs";

async function loadParsedYaml(projectRoot, relativePath, parse) {
  const text = await readTextIfFile(path.join(projectRoot, relativePath));
  return {
    path: relativePath,
    text,
    ...parse(text),
  };
}

export function loadSpecReconstructionContract(projectRoot) {
  return loadParsedYaml(
    projectRoot,
    SPEC_RECONSTRUCTION_RESULT_CONTRACT_REF,
    parseSpecReconstructionContract,
  );
}

export function loadSpecTreeModelContract(projectRoot) {
  return loadParsedYaml(projectRoot, SPEC_TREE_MODEL_REF, parseSpecTreeModel);
}

export function loadSpecGenerationInputsContract(projectRoot) {
  return loadParsedYaml(
    projectRoot,
    SPEC_GENERATION_INPUTS_CONTRACT_REF,
    parseSpecGenerationInputsContract,
  );
}

export function loadSpecGenerationAuditContract(projectRoot) {
  return loadParsedYaml(
    projectRoot,
    SPEC_GENERATION_AUDIT_CONTRACT_REF,
    parseSpecGenerationAuditContract,
  );
}

export function loadSpecGenerationInputsConfig(projectRoot) {
  return loadParsedYaml(projectRoot, SPEC_GENERATION_INPUTS_REF, parseSpecGenerationInputsConfig);
}

export function loadCommandGatingMatrix(projectRoot) {
  return loadParsedYaml(projectRoot, COMMAND_GATING_MATRIX_REF, parseCommandGatingMatrix);
}

export function loadBlueprintReference(projectRoot) {
  return loadParsedYaml(projectRoot, BLUEPRINT_REFERENCE_REF, parseBlueprintReference);
}

export function loadDocSpecAuditContract(projectRoot) {
  return loadParsedYaml(projectRoot, DOC_SPEC_AUDIT_RESULT_CONTRACT_REF, parseDocSpecAuditContract);
}

export function loadHighRiskExecutionContract(projectRoot) {
  return loadParsedYaml(projectRoot, HIGH_RISK_EXECUTION_RESULT_CONTRACT_REF, parseHighRiskExecutionContract);
}

export function loadHighRiskAdmissionContract(projectRoot) {
  return loadParsedYaml(projectRoot, HIGH_RISK_ADMISSION_CONTRACT_REF, parseHighRiskAdmissionContract);
}

export function loadExternalHostCompatibilityContract(projectRoot) {
  return loadParsedYaml(
    projectRoot,
    EXTERNAL_HOST_COMPATIBILITY_CONTRACT_REF,
    parseExternalHostCompatibilityContract,
  );
}

export async function loadHighRiskSchemaContracts(projectRoot) {
  const contractRefs = [
    EXECUTION_PACKET_SCHEMA_REF,
    ORCHESTRATION_STATE_SCHEMA_REF,
    PROMPT_SCHEMA_REF,
    WORKER_OUTPUT_SCHEMA_REF,
    ACCEPTANCE_SCHEMA_REF,
  ];

  const results = [];
  for (const schemaRef of contractRefs) {
    const text = await readTextIfFile(path.join(projectRoot, schemaRef));
    results.push({
      path: schemaRef,
      text,
      ...parseHighRiskSchemaContract(text, schemaRef),
    });
  }

  return results;
}
