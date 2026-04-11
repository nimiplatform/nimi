import { runValidatorCommand, validateWorkerOutput } from "../lib/validators.mjs";

export function runValidateWorkerOutput(args) {
  return runValidatorCommand(args, "validate-worker-output", validateWorkerOutput);
}
