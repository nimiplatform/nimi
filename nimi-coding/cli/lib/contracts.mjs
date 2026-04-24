import path from "node:path";

import {
  loadBlueprintReference as loadBlueprintReferenceInternal,
  loadCommandGatingMatrix as loadCommandGatingMatrixInternal,
  loadAuditSweepContract as loadAuditSweepContractInternal,
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
import { readTextIfFile } from "./fs-helpers.mjs";
import { parseYamlText } from "./yaml-helpers.mjs";
import { matchCommandGatingRule } from "./internal/contracts-parse.mjs";
import {
  validateAuditSweepSummary as validateAuditSweepSummaryInternal,
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

export function loadAuditSweepContract(projectRoot) {
  return loadAuditSweepContractInternal(projectRoot);
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

export function validateAuditSweepSummary(summary, contract, verifiedAt) {
  return validateAuditSweepSummaryInternal(summary, contract, verifiedAt);
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

async function loadYamlWithFallback(projectRoot, primaryRef, fallbackRef) {
  const primaryText = await readTextIfFile(path.join(projectRoot, primaryRef));
  if (primaryText !== null) {
    return {
      path: primaryRef,
      text: primaryText,
      data: parseYamlText(primaryText),
    };
  }

  const fallbackText = await readTextIfFile(path.join(projectRoot, fallbackRef));
  return {
    path: fallbackRef,
    text: fallbackText,
    data: parseYamlText(fallbackText),
  };
}

export async function loadTopicRuntimeContracts(projectRoot) {
  const [
    topicSchema,
    waveSchema,
    packetSchema,
    resultSchema,
    closeoutSchema,
    remediationSchema,
    decisionReviewSchema,
    pendingNoteSchema,
    topicStepDecisionSchema,
    topicRunLedgerSchema,
    forbiddenShortcutsCatalog,
    lifecycleReport,
    fourClosurePolicy,
    validationPolicy,
  ] = await Promise.all([
    loadYamlWithFallback(projectRoot, ".nimi/contracts/topic.schema.yaml", "nimi-coding/contracts/topic.schema.yaml"),
    loadYamlWithFallback(projectRoot, ".nimi/contracts/wave.schema.yaml", "nimi-coding/contracts/wave.schema.yaml"),
    loadYamlWithFallback(projectRoot, ".nimi/contracts/packet.schema.yaml", "nimi-coding/contracts/packet.schema.yaml"),
    loadYamlWithFallback(projectRoot, ".nimi/contracts/result.schema.yaml", "nimi-coding/contracts/result.schema.yaml"),
    loadYamlWithFallback(projectRoot, ".nimi/contracts/closeout.schema.yaml", "nimi-coding/contracts/closeout.schema.yaml"),
    loadYamlWithFallback(projectRoot, ".nimi/contracts/remediation.schema.yaml", "nimi-coding/contracts/remediation.schema.yaml"),
    loadYamlWithFallback(projectRoot, ".nimi/contracts/decision-review.schema.yaml", "nimi-coding/contracts/decision-review.schema.yaml"),
    loadYamlWithFallback(projectRoot, ".nimi/contracts/pending-note.schema.yaml", "nimi-coding/contracts/pending-note.schema.yaml"),
    loadYamlWithFallback(projectRoot, ".nimi/contracts/topic-step-decision.schema.yaml", "nimi-coding/contracts/topic-step-decision.schema.yaml"),
    loadYamlWithFallback(projectRoot, ".nimi/contracts/topic-run-ledger.schema.yaml", "nimi-coding/contracts/topic-run-ledger.schema.yaml"),
    loadYamlWithFallback(projectRoot, ".nimi/contracts/forbidden-shortcuts.catalog.yaml", "nimi-coding/contracts/forbidden-shortcuts.catalog.yaml"),
    loadYamlWithFallback(projectRoot, ".nimi/methodology/topic-lifecycle-report.yaml", "nimi-coding/methodology/topic-lifecycle-report.yaml"),
    loadYamlWithFallback(projectRoot, ".nimi/methodology/four-closure-policy.yaml", "nimi-coding/methodology/four-closure-policy.yaml"),
    loadYamlWithFallback(projectRoot, ".nimi/methodology/topic-validation-policy.yaml", "nimi-coding/methodology/topic-validation-policy.yaml"),
  ]);

  return {
    topicSchema,
    waveSchema,
    packetSchema,
    resultSchema,
    closeoutSchema,
    remediationSchema,
    decisionReviewSchema,
    pendingNoteSchema,
    topicStepDecisionSchema,
    topicRunLedgerSchema,
    forbiddenShortcutsCatalog,
    lifecycleReport,
    fourClosurePolicy,
    validationPolicy,
  };
}
