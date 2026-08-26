import {
  getNimiRuntimeReasonCodeMessage,
  toNimiRuntimeUserFacingError,
} from '@nimiplatform/sdk/runtime';
import type { TFunction } from 'i18next';

function translateMessage(
  t: TFunction,
  key: string,
  defaultValue: string,
): string {
  const translated = t(key, { defaultValue });
  return typeof translated === 'string' && translated.trim().length > 0
    ? translated
    : defaultValue;
}

export function chatRuntimeReasonCodeMessage(
  reasonCode: string,
  t: TFunction,
): string | null {
  const entry = getNimiRuntimeReasonCodeMessage(reasonCode);
  if (!entry) {
    return null;
  }
  return translateMessage(t, `BridgeErrors.codes.${entry.reasonCode}`, entry.defaultMessage);
}

export function toChatUserFacingRuntimeError(
  error: unknown,
  fallbackMessage: string,
  t: TFunction,
): { code: string; message: string } {
  return toNimiRuntimeUserFacingError(error, {
    fallbackMessage,
    resolveReasonCodeMessage: (reasonCode) => chatRuntimeReasonCodeMessage(reasonCode, t),
  });
}
