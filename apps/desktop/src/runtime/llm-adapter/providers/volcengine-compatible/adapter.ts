import type { ProviderAdapterConfig } from '../../types';
import { OpenAICompatibleAdapter } from '../openai-compatible/adapter';

export class VolcengineCompatibleAdapter extends OpenAICompatibleAdapter {
  constructor(config: ProviderAdapterConfig) {
    super('VOLCENGINE_COMPATIBLE', config);
  }
}
