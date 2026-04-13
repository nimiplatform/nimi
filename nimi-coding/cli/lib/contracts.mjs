import {
  loadBlueprintReference as loadBlueprintReferenceInternal,
  loadCommandGatingMatrix as loadCommandGatingMatrixInternal,
  loadDocSpecAuditContract as loadDocSpecAuditContractInternal,
  loadExternalHostCompatibilityContract as loadExternalHostCompatibilityContractInternal,
  loadHighRiskAdmissionContract as loadHighRiskAdmissionContractInternal,
  loadHighRiskExecutionContract as loadHighRiskExecutionContractInternal,
  loadHighRiskSchemaContracts as loadHighRiskSchemaContractsInternal,
  loadSpecGenerationAuditContract as loadSpecGenerationAuditContractInternal,
  loadSpecGenerationInputsConfig as loadSpecGenerationInputsConfigInternal,
  loadSpecGenerationInputsContract as loadSpecGenerationInputsContractInternal,
  loadSpecReconstructionContract as loadSpecReconstructionContractInternal,
  loadSpecTreeModelContract as loadSpecTreeModelContractInternal,
} from "./internal/contracts-loaders.mjs";
import { matchCommandGatingRule } from "./internal/contracts-parse.mjs";
import {
  validateDocSpecAuditSummary as validateDocSpecAuditSummaryInternal,
  validateHighRiskAdmissionRecord as validateHighRiskAdmissionRecordInternal,
  validateHighRiskAdmissionsSpec as validateHighRiskAdmissionsSpecInternal,
  validateHighRiskExecutionSummary as validateHighRiskExecutionSummaryInternal,
  validateSpecReconstructionSummary as validateSpecReconstructionSummaryInternal,
} from "./internal/contracts-validators.mjs";

export function findCommandGatingRule(commandGatingMatrix, command, skillId = null) {
  return matchCommandGatingRule(commandGatingMatrix, command, skillId);
}

export function loadSpecReconstructionContract(projectRoot) {
  return loadSpecReconstructionContractInternal(projectRoot);
}

export function loadSpecTreeModelContract(projectRoot) {
  return loadSpecTreeModelContractInternal(projectRoot);
}

export function loadSpecGenerationInputsContract(projectRoot) {
  return loadSpecGenerationInputsContractInternal(projectRoot);
}

export function loadSpecGenerationAuditContract(projectRoot) {
  return loadSpecGenerationAuditContractInternal(projectRoot);
}

export function loadSpecGenerationInputsConfig(projectRoot) {
  return loadSpecGenerationInputsConfigInternal(projectRoot);
}

export function loadCommandGatingMatrix(projectRoot) {
  return loadCommandGatingMatrixInternal(projectRoot);
}

export function loadBlueprintReference(projectRoot) {
  return loadBlueprintReferenceInternal(projectRoot);
}

export function loadDocSpecAuditContract(projectRoot) {
  return loadDocSpecAuditContractInternal(projectRoot);
}

export function loadHighRiskExecutionContract(projectRoot) {
  return loadHighRiskExecutionContractInternal(projectRoot);
}

export function loadHighRiskAdmissionContract(projectRoot) {
  return loadHighRiskAdmissionContractInternal(projectRoot);
}

export function loadExternalHostCompatibilityContract(projectRoot) {
  return loadExternalHostCompatibilityContractInternal(projectRoot);
}

export function loadHighRiskSchemaContracts(projectRoot) {
  return loadHighRiskSchemaContractsInternal(projectRoot);
}

export function validateSpecReconstructionSummary(summary, contract, verifiedAt) {
  return validateSpecReconstructionSummaryInternal(summary, contract, verifiedAt);
}

export function validateDocSpecAuditSummary(summary, contract, verifiedAt) {
  return validateDocSpecAuditSummaryInternal(summary, contract, verifiedAt);
}

export function validateHighRiskExecutionSummary(summary, contract, verifiedAt) {
  return validateHighRiskExecutionSummaryInternal(summary, contract, verifiedAt);
}

export function validateHighRiskAdmissionRecord(record, contract) {
  return validateHighRiskAdmissionRecordInternal(record, contract);
}

export function validateHighRiskAdmissionsSpec(spec, contract) {
  return validateHighRiskAdmissionsSpecInternal(spec, contract);
}
