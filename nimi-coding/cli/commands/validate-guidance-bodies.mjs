import { runSurfaceValidatorCommand } from "./surface-validator-command.mjs";

export function runValidateGuidanceBodies(args) {
  return runSurfaceValidatorCommand(args, "validate-guidance-bodies");
}
