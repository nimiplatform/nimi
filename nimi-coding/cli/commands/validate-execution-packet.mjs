import { runValidatorCommand, validateExecutionPacket } from "../lib/validators.mjs";

export function runValidateExecutionPacket(args) {
  return runValidatorCommand(args, "validate-execution-packet", validateExecutionPacket);
}
