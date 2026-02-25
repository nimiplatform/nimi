import type { ProviderType } from '../types';
import type { LlmAdapterError } from './codes';
import { classifyHttpStatusError, parseRetryAfterHeader, toRecord } from './http-classifier';
import { classifyProviderMessageError } from './provider-classifier';
import { classifySpeechAdapterError } from './speech-classifier';

function getMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || error.name;

  const rec = toRecord(error);
  if (!rec) return 'Unknown error';

  const direct = rec.message;
  if (typeof direct === 'string' && direct.trim()) return direct;

  const nestedError = toRecord(rec.error);
  if (nestedError) {
    if (typeof nestedError.message === 'string' && nestedError.message.trim()) {
      return nestedError.message;
    }
    if (typeof nestedError.code === 'string' && nestedError.code.trim()) {
      return nestedError.code;
    }
  }

  const cause = toRecord(rec.cause);
  if (cause && typeof cause.message === 'string' && cause.message.trim()) {
    return cause.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

export { parseRetryAfterHeader };

export function classifyError(
  error: unknown,
  context?: { provider?: ProviderType | string; model?: string },
): LlmAdapterError {
  const message = getMessage(error);

  const byHttpStatus = classifyHttpStatusError({
    error,
    message,
    provider: context?.provider,
    model: context?.model,
  });
  if (byHttpStatus) return byHttpStatus;

  const bySpeech = classifySpeechAdapterError({
    error,
    message,
    provider: context?.provider,
    model: context?.model,
  });
  if (bySpeech) return bySpeech;

  const byProviderMessage = classifyProviderMessageError({
    error,
    message,
    provider: context?.provider,
    model: context?.model,
  });
  if (byProviderMessage) return byProviderMessage;

  return {
    code: 'UNKNOWN',
    message,
    provider: context?.provider,
    model: context?.model,
    cause: error,
  };
}
