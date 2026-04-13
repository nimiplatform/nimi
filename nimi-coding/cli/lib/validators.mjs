import path from "node:path";

import {
  validateAcceptance as validateAcceptanceInternal,
  validateExecutionPacket as validateExecutionPacketInternal,
  validateOrchestrationState as validateOrchestrationStateInternal,
  validatePrompt as validatePromptInternal,
  validateWorkerOutput as validateWorkerOutputInternal,
} from "./internal/validators-artifacts.mjs";
import {
  normalizeArgv,
  VALIDATOR_CLI_RESULT_CONTRACT,
  VALIDATOR_NATIVE_REFUSAL_CODES,
} from "./internal/validators-shared.mjs";
import {
  validateSpecAudit as validateSpecAuditInternal,
  validateSpecTree as validateSpecTreeInternal,
} from "./internal/validators-spec.mjs";

export { VALIDATOR_NATIVE_REFUSAL_CODES };

export function validateExecutionPacket(filePath) {
  return validateExecutionPacketInternal(filePath);
}

export function validateOrchestrationState(filePath) {
  return validateOrchestrationStateInternal(filePath);
}

export function validatePrompt(filePath) {
  return validatePromptInternal(filePath);
}

export function validateWorkerOutput(filePath) {
  return validateWorkerOutputInternal(filePath);
}

export function validateAcceptance(filePath) {
  return validateAcceptanceInternal(filePath);
}

export function validateSpecTree(rootPath, options = {}) {
  return validateSpecTreeInternal(rootPath, options);
}

export function validateSpecAudit(auditPath, options = {}) {
  return validateSpecAuditInternal(auditPath, options);
}

export function buildValidatorCliReport(validator, filePath, report) {
  return {
    contract: VALIDATOR_CLI_RESULT_CONTRACT,
    validator,
    target_ref: filePath,
    ok: Boolean(report.ok),
    refusal: report.refusal || null,
    errors: report.errors || [],
    warnings: report.warnings || [],
    ...(report.summary ? { summary: report.summary } : {}),
    ...(report.signal ? { signal: report.signal } : {}),
  };
}

export async function runValidatorCommand(args, validator, validate) {
  const normalizedArgv = normalizeArgv(args);
  const [filePath, ...rest] = normalizedArgv;

  if (!filePath || rest.length > 0) {
    process.stderr.write(`nimicoding ${validator} refused: expected exactly one path argument.\n`);
    return 2;
  }

  const targetPath = path.resolve(process.cwd(), filePath);
  const report = await validate(targetPath);
  const cliReport = buildValidatorCliReport(validator, targetPath, report);
  process.stdout.write(`${JSON.stringify(cliReport, null, 2)}\n`);
  return report.ok ? 0 : 1;
}
