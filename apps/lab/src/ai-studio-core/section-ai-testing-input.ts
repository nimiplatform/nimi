import type { StudioResultKind } from './module-registration.js';

export function hasStudioCapabilityRunInput(input: {
  requiresPrompt: boolean;
  prompt: string;
  hasAlternativeInput: boolean;
}): boolean {
  return !input.requiresPrompt || Boolean(input.prompt.trim()) || input.hasAlternativeInput;
}

export function canCancelStudioCapabilityRun(input: {
  capabilityId: string;
  resultKind: StudioResultKind;
}): boolean {
  return input.capabilityId === 'chat.stream'
    || input.resultKind === 'artifacts'
    || input.resultKind === 'transcript'
    || input.resultKind === 'voice-asset';
}
