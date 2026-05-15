import { runSurfaceValidatorCommand } from "./surface-validator-command.mjs";

export function runClassifySpecTree(args) {
  return runSurfaceValidatorCommand(args, "classify-spec-tree");
}
