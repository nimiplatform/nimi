import type { ProviderAdapterConfig } from '../../types';
import { OpenAICompatibleAdapter } from '../openai-compatible/adapter';

export class DashScopeCompatibleAdapter extends OpenAICompatibleAdapter {
  constructor(config: ProviderAdapterConfig) {
    super('DASHSCOPE_COMPATIBLE', config);
  }
}
