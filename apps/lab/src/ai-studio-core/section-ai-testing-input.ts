import type { StudioResultKind } from './module-registration.js';
import type { NimiAIConfigSnapshot } from '@nimiplatform/sdk/ai';

export const STUDIO_TEXT_MEDIA_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/wav',
  'audio/mpeg',
  'video/mp4',
] as const;

export type StudioTextMediaMime = (typeof STUDIO_TEXT_MEDIA_MIMES)[number];

const STUDIO_TEXT_MEDIA_EXTENSIONS: Readonly<Record<StudioTextMediaMime, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
};

export function isSupportedStudioTextMediaMime(value: string): value is StudioTextMediaMime {
  return (STUDIO_TEXT_MEDIA_MIMES as readonly string[]).includes(value);
}

export function studioTextMediaExtension(mimeType: StudioTextMediaMime): string {
  return STUDIO_TEXT_MEDIA_EXTENSIONS[mimeType];
}

export function textStudioMediaInputAvailable(snapshot: NimiAIConfigSnapshot, mediaType?: string): boolean {
  const required = mediaType ? mediaType.startsWith('image/') ? 'input.image' : mediaType.startsWith('audio/') ? 'input.audio' : mediaType.startsWith('video/') ? 'input.video' : '' : undefined;
  if (required === '') return false;
  const selection = snapshot.effectiveSelections.find((item) => item.capabilityContract === 'text.generate');
  if (selection?.state !== 'ready') return false;
  const resource = selection.resource;
  if (resource?.oneofKind === 'cloud') {
    return resource.cloud.target.state === 'ready' && (required ? resource.cloud.target.supportedFeatures.includes(required) : ['input.image', 'input.audio', 'input.video'].some((feature) => resource.cloud.target.supportedFeatures.includes(feature)));
  }
  if (resource?.oneofKind === 'local') {
    return resource.local.state === 'ready' && (required ? resource.local.configuredFeatures.includes(required) && resource.local.implementationSupportedFeatures.includes(required) : ['input.image', 'input.audio', 'input.video'].some((feature) => resource.local.configuredFeatures.includes(feature) && resource.local.implementationSupportedFeatures.includes(feature)));
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
  hasMediaInput?: boolean;
}): boolean {
  return input.capabilityId === 'chat.stream'
    || (input.capabilityId === 'text.generate' && input.hasMediaInput === true)
    || input.resultKind === 'text-exchange'
    || input.resultKind === 'artifacts'
    || input.resultKind === 'text-annotation'
    || input.resultKind === 'text-decision'
    || input.resultKind === 'transcript'
    || input.resultKind === 'vision-locate'
    || input.resultKind === 'speaker-embedding'
    || input.resultKind === 'voice-asset';
}
