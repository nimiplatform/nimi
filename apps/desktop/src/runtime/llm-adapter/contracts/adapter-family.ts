import type { ProviderType } from '../types';

export type AdapterFamily = 'openai-compatible' | 'dashscope-compatible' | 'volcengine-compatible' | 'localai-native';

export type AdapterCapability = 'chat' | 'embedding' | 'image' | 'tts' | 'stt' | 'video';

export type AdapterFamilyDescriptor = {
  family: AdapterFamily;
  providerTypes: ProviderType[];
  capabilities: AdapterCapability[];
  label: string;
};

export const ADAPTER_FAMILY_REGISTRY: AdapterFamilyDescriptor[] = [
  {
    family: 'openai-compatible',
    providerTypes: ['OPENAI_COMPATIBLE', 'CLOUD_API'],
    capabilities: ['chat', 'embedding', 'image', 'tts', 'stt', 'video'],
    label: 'OpenAI Compatible',
  },
  {
    family: 'dashscope-compatible',
    providerTypes: ['DASHSCOPE_COMPATIBLE'],
    capabilities: ['chat', 'embedding', 'tts'],
    label: 'DashScope Compatible',
  },
  {
    family: 'volcengine-compatible',
    providerTypes: ['VOLCENGINE_COMPATIBLE'],
    capabilities: ['chat', 'embedding', 'tts'],
    label: 'Volcengine Compatible',
  },
  {
    family: 'localai-native',
    providerTypes: ['LOCALAI_NATIVE'],
    capabilities: ['chat', 'embedding', 'image', 'tts', 'stt', 'video'],
    label: 'LocalAI Native',
  },
];

export function resolveAdapterFamily(providerType: ProviderType): AdapterFamily {
  const entry = ADAPTER_FAMILY_REGISTRY.find((item) => item.providerTypes.includes(providerType));
  return entry?.family ?? 'openai-compatible';
}

export function resolveProviderType(family: AdapterFamily): ProviderType {
  const entry = ADAPTER_FAMILY_REGISTRY.find((item) => item.family === family);
  return entry?.providerTypes[0] ?? 'OPENAI_COMPATIBLE';
}
