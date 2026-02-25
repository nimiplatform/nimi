import type { ProviderType } from '../types';
import type { LlmAdapterError } from './codes';
import { getStatus } from './http-classifier';

export function classifySpeechAdapterError(input: {
  error: unknown;
  message: string;
  provider?: ProviderType | string;
  model?: string;
}): LlmAdapterError | null {
  const lowerMessage = input.message.toLowerCase();
  if (!lowerMessage.includes('speech') && !lowerMessage.includes('audio')) {
    return null;
  }

  const status = getStatus(input.error);
  if (status !== undefined && status >= 500) {
    return {
      code: 'PROVIDER_UNREACHABLE',
      message: input.message,
      status,
      provider: input.provider,
      model: input.model,
      cause: input.error,
    };
  }

  return null;
}
