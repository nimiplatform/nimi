export function hasLabCapabilityRunInput(input: {
  requiresPrompt: boolean;
  prompt: string;
  hasAlternativeInput: boolean;
}): boolean {
  return !input.requiresPrompt || Boolean(input.prompt.trim()) || input.hasAlternativeInput;
}
