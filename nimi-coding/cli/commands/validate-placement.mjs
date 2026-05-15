import { runSurfaceValidatorCommand } from "./surface-validator-command.mjs";

export function runValidatePlacement(args) {
  return runSurfaceValidatorCommand(args, "validate-placement");
}
