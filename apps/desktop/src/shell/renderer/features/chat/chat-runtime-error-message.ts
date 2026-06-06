import {
  getNimiRuntimeReasonCodeMessage,
  toNimiRuntimeUserFacingError,
} from '@nimiplatform/sdk/runtime';
import { i18n } from '@renderer/i18n';

function translateMessage(key: string, defaultValue: string): string {
  if (!i18n.isInitialized) {
    return defaultValue;
  }
  const translated = i18n.t(key, { defaultValue });
  return typeof translated === 'string' && translated.trim().length > 0
    ? translated
    : defaultValue;
}

export function chatRuntimeReasonCodeMessage(reasonCode: string): string | null {
  const entry = getNimiRuntimeReasonCodeMessage(reasonCode);
  if (!entry) {
    return null;
  }
  return translateMessage(`BridgeErrors.codes.${entry.reasonCode}`, entry.defaultMessage);
}

export function toChatUserFacingRuntimeError(
  error: unknown,
  fallbackMessage: string,
): { code: string; message: string } {
  return toNimiRuntimeUserFacingError(error, {
    fallbackMessage,
    resolveReasonCodeMessage: (reasonCode) => chatRuntimeReasonCodeMessage(reasonCode),
  });
}
