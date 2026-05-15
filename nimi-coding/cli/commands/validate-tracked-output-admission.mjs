import { runSurfaceValidatorCommand } from "./surface-validator-command.mjs";

export function runValidateTrackedOutputAdmission(args) {
  return runSurfaceValidatorCommand(args, "validate-tracked-output-admission");
}
