import { runSurfaceValidatorCommand } from "./surface-validator-command.mjs";

export function runValidateDomainAdmission(args) {
  return runSurfaceValidatorCommand(args, "validate-domain-admission");
}
