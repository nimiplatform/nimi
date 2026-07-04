import type { NimiRuntimeRouteAppCapability } from '@nimiplatform/sdk/runtime';

export const ZHIYU_AI_CONFIG_ENABLED_CAPABILITIES = [
  'text.generate',
  'audio.synthesize',
  'audio.transcribe',
  'voice_workflow.voice_clone',
  'voice_workflow.voice_design',
  'image.generate',
  'image.edit',
  'video.generate',
  'text.embed',
] as const satisfies readonly NimiRuntimeRouteAppCapability[];

export type ZhiyuAIConfigEnabledCapability = (typeof ZHIYU_AI_CONFIG_ENABLED_CAPABILITIES)[number];

export const ZHIYU_AI_CONFIG_BINDING_CAPABILITIES: Readonly<Record<ZhiyuAIConfigEnabledCapability, NimiRuntimeRouteAppCapability>> = {
  'text.generate': 'text.generate',
  'audio.synthesize': 'audio.synthesize',
  'audio.transcribe': 'audio.transcribe',
  'voice_workflow.voice_clone': 'voice_workflow.voice_clone',
  'voice_workflow.voice_design': 'voice_workflow.voice_design',
  'image.generate': 'image.generate',
  'image.edit': 'image.edit',
  'video.generate': 'video.generate',
  'text.embed': 'text.embed',
};
