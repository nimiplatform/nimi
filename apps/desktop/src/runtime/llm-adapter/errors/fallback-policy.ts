import type { LlmAdapterError } from './codes';

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function isFallbackCandidate(error: LlmAdapterError) {
  return (
    error.code === 'RATE_LIMITED' ||
    error.code === 'TIMEOUT' ||
    error.code === 'PROVIDER_UNREACHABLE' ||
    error.code === 'MODEL_NOT_FOUND' ||
    error.code === 'AUTH_FAILED' ||
    error.code === 'CONTEXT_OVERFLOW'
  );
}
