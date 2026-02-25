import type { ProviderType } from '../types';
import {
  type LlmAdapterError,
  MODEL_NOT_FOUND_PATTERNS,
  OVERFLOW_PATTERNS,
  RATE_LIMIT_PATTERNS,
  TIMEOUT_PATTERNS,
} from './codes';
import { getStatus } from './http-classifier';

function isMatch(message: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(message));
}

export function classifyProviderMessageError(input: {
  error: unknown;
  message: string;
  provider?: ProviderType | string;
  model?: string;
}): LlmAdapterError | null {
  const status = getStatus(input.error);

  if (isMatch(input.message, OVERFLOW_PATTERNS)) {
    return {
      code: 'CONTEXT_OVERFLOW',
      message: input.message,
      status,
      provider: input.provider,
      model: input.model,
      cause: input.error,
    };
  }

  if (isMatch(input.message, RATE_LIMIT_PATTERNS)) {
    return {
      code: 'RATE_LIMITED',
      message: input.message,
      status,
      provider: input.provider,
      model: input.model,
      cause: input.error,
    };
  }

  if (isMatch(input.message, TIMEOUT_PATTERNS)) {
    return {
      code: 'TIMEOUT',
      message: input.message,
      status,
      provider: input.provider,
      model: input.model,
      cause: input.error,
    };
  }

  if (isMatch(input.message, MODEL_NOT_FOUND_PATTERNS)) {
    return {
      code: 'MODEL_NOT_FOUND',
      message: input.message,
      status,
      provider: input.provider,
      model: input.model,
      cause: input.error,
    };
  }

  return null;
}
