import type { ProviderAdapterConfig } from '../../types';
import { OpenAICompatibleAdapter } from '../openai-compatible/adapter';

export class LocalAiNativeAdapter extends OpenAICompatibleAdapter {
  constructor(config: ProviderAdapterConfig) {
    super('LOCALAI_NATIVE', config);
  }
}
