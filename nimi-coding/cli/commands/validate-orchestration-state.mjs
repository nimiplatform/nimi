import { runValidatorCommand, validateOrchestrationState } from "../lib/validators.mjs";

export function runValidateOrchestrationState(args) {
  return runValidatorCommand(args, "validate-orchestration-state", validateOrchestrationState);
}
