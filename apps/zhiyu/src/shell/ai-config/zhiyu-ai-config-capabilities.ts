import type { NimiRuntimeRouteAppCapability } from '@nimiplatform/sdk/runtime';

export const ZHIYU_AI_CONFIG_ENABLED_CAPABILITIES = [
  'text.generate',
  'chat.stream',
  'text.embed',
  'image.generate',
  'audio.synthesize',
] as const;

export type ZhiyuAIConfigEnabledCapability = (typeof ZHIYU_AI_CONFIG_ENABLED_CAPABILITIES)[number];

export const ZHIYU_AI_CONFIG_BINDING_CAPABILITIES: Readonly<Record<ZhiyuAIConfigEnabledCapability, NimiRuntimeRouteAppCapability>> = {
  'text.generate': 'text.generate',
  'chat.stream': 'text.generate',
  'text.embed': 'text.embed',
  'image.generate': 'image.generate',
  'audio.synthesize': 'audio.synthesize',
};
