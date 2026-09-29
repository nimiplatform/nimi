import type { StudioResultKind } from './module-registration.js';
import type { NimiAIConfigSnapshot } from '@nimiplatform/sdk/ai';

export function textStudioImageInputAvailable(snapshot: NimiAIConfigSnapshot): boolean {
  const selection = snapshot.effectiveSelections.find((item) => item.capabilityContract === 'text.generate');
  if (selection?.state !== 'ready') return false;
  const resource = selection.resource;
  if (resource?.oneofKind === 'cloud') {
    return resource.cloud.target.state === 'ready' && resource.cloud.target.supportedFeatures.includes('input.image');
  }
  if (resource?.oneofKind === 'local') {
    return resource.local.state === 'ready' && resource.local.configuredFeatures.includes('input.image')
      && resource.local.implementationSupportedFeatures.includes('input.image');
  }
  return false;
}

export function usesVerbatimStudioPrompt(capabilityId: string): boolean {
  return capabilityId === 'audio.synthesize'
    || capabilityId === 'audio.transcribe'
    || capabilityId === 'voice.create'
    || capabilityId === 'music.generate'
    || capabilityId === 'vision.locate';
}

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
  hasImageInput?: boolean;
}): boolean {
  return input.capabilityId === 'chat.stream'
    || (input.capabilityId === 'text.generate' && input.hasImageInput === true)
    || input.resultKind === 'artifacts'
    || input.resultKind === 'text-annotation'
    || input.resultKind === 'text-decision'
    || input.resultKind === 'transcript'
    || input.resultKind === 'vision-locate'
    || input.resultKind === 'voice-asset';
}
