import { runSurfaceValidatorCommand } from "./surface-validator-command.mjs";

export function runValidateProjectionEdges(args) {
  return runSurfaceValidatorCommand(args, "validate-projection-edges");
}
