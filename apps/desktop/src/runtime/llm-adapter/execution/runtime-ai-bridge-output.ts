import {
  extractRuntimeReasonCodeFromError,
  mapRuntimeErrorToLocalAiReasonCode,
} from '@nimiplatform/sdk/runtime';

export function extractRuntimeReasonCode(error: unknown): string | null {
  return extractRuntimeReasonCodeFromError(error);
}

export function toLocalRuntimeReasonCode(error: unknown): string | null {
  return mapRuntimeErrorToLocalAiReasonCode(error);
}
