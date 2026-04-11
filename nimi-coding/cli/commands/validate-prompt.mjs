import { runValidatorCommand, validatePrompt } from "../lib/validators.mjs";

export function runValidatePrompt(args) {
  return runValidatorCommand(args, "validate-prompt", validatePrompt);
}
