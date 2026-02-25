import type { ProviderAdapterConfig, ProviderType } from '../types';
import type { ProviderAdapter } from './base';
import { DashScopeCompatibleAdapter } from './dashscope-compatible';
import { FallbackAdapter } from './fallback';
import { LocalAiNativeAdapter } from './localai-native';
import { OpenAICompatibleAdapter } from './openai-compatible/adapter';
import { VolcengineCompatibleAdapter } from './volcengine-compatible';

export function createProviderAdapter(type: ProviderType, config: ProviderAdapterConfig): ProviderAdapter {
  if (type === 'LOCALAI_NATIVE') {
    return new LocalAiNativeAdapter(config);
  }
  if (type === 'DASHSCOPE_COMPATIBLE') {
    return new DashScopeCompatibleAdapter(config);
  }
  if (type === 'VOLCENGINE_COMPATIBLE') {
    return new VolcengineCompatibleAdapter(config);
  }
  if (type === 'OPENAI_COMPATIBLE' || type === 'CLOUD_API') {
    return new OpenAICompatibleAdapter(type, config);
  }

  return new FallbackAdapter(config);
}
