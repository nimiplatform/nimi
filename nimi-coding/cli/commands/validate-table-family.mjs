import { runSurfaceValidatorCommand } from "./surface-validator-command.mjs";

export function runValidateTableFamily(args) {
  return runSurfaceValidatorCommand(args, "validate-table-family");
}
