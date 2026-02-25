import type { AdapterCapability, AdapterFamily } from './adapter-family';

export type ProviderCapabilityEntry = {
  family: AdapterFamily;
  capability: AdapterCapability;
  streaming: boolean;
  websocket: boolean;
};

export const PROVIDER_CAPABILITY_MATRIX: ProviderCapabilityEntry[] = [
  { family: 'openai-compatible', capability: 'chat', streaming: true, websocket: false },
  { family: 'openai-compatible', capability: 'embedding', streaming: false, websocket: false },
  { family: 'openai-compatible', capability: 'image', streaming: false, websocket: false },
  { family: 'openai-compatible', capability: 'tts', streaming: true, websocket: false },
  { family: 'openai-compatible', capability: 'stt', streaming: false, websocket: false },
  { family: 'openai-compatible', capability: 'video', streaming: false, websocket: false },
  { family: 'dashscope-compatible', capability: 'chat', streaming: true, websocket: false },
  { family: 'dashscope-compatible', capability: 'embedding', streaming: false, websocket: false },
  { family: 'dashscope-compatible', capability: 'tts', streaming: false, websocket: true },
  { family: 'volcengine-compatible', capability: 'chat', streaming: true, websocket: false },
  { family: 'volcengine-compatible', capability: 'embedding', streaming: false, websocket: false },
  { family: 'volcengine-compatible', capability: 'tts', streaming: false, websocket: true },
  { family: 'localai-native', capability: 'chat', streaming: true, websocket: false },
  { family: 'localai-native', capability: 'tts', streaming: true, websocket: false },
];

export function supportsCapability(family: AdapterFamily, cap: AdapterCapability): boolean {
  return PROVIDER_CAPABILITY_MATRIX.some((entry) => entry.family === family && entry.capability === cap);
}
