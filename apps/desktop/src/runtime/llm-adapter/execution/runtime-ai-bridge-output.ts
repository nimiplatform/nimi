import { extractRuntimeReasonCodeFromError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';

const RUNTIME_REASON_CODE_TO_LOCAL_AI: Record<string, string> = {
  AI_MODEL_NOT_FOUND: ReasonCode.AI_MODEL_NOT_FOUND,
  AI_MODEL_NOT_READY: 'LOCAL_AI_CAPABILITY_MISSING',
  AI_MODALITY_NOT_SUPPORTED: ReasonCode.AI_MODALITY_NOT_SUPPORTED,
  AI_MEDIA_OPTION_UNSUPPORTED: ReasonCode.AI_MEDIA_OPTION_UNSUPPORTED,
  AI_PROVIDER_UNAVAILABLE: 'LOCAL_AI_SERVICE_UNREACHABLE',
  AI_PROVIDER_TIMEOUT: 'LOCAL_AI_PROVIDER_TIMEOUT',
  AI_ROUTE_UNSUPPORTED: 'LOCAL_AI_CAPABILITY_MISSING',
  AI_ROUTE_FALLBACK_DENIED: 'LOCAL_AI_CAPABILITY_MISSING',
  AI_INPUT_INVALID: ReasonCode.AI_INPUT_INVALID,
  AI_OUTPUT_INVALID: 'LOCAL_AI_PROVIDER_INTERNAL_ERROR',
  AI_STREAM_BROKEN: 'LOCAL_AI_PROVIDER_INTERNAL_ERROR',
  AI_CONTENT_FILTER_BLOCKED: 'LOCAL_AI_CAPABILITY_MISSING',
};

export function extractRuntimeReasonCode(error: unknown): string | null {
  return extractRuntimeReasonCodeFromError(error);
}

export function toLocalRuntimeReasonCode(error: unknown): string | null {
  const runtimeCode = extractRuntimeReasonCode(error);
  if (!runtimeCode) return null;
  return RUNTIME_REASON_CODE_TO_LOCAL_AI[runtimeCode] || null;
}
