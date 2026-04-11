import { runValidatorCommand, validateAcceptance } from "../lib/validators.mjs";

export function runValidateAcceptance(args) {
  return runValidatorCommand(args, "validate-acceptance", validateAcceptance);
}
