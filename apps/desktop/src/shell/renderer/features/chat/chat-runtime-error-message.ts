import { asNimiError, getRuntimeReasonCodeMessage } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { i18n } from '@renderer/i18n';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

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
  const entry = getRuntimeReasonCodeMessage(reasonCode);
  if (!entry) {
    return null;
  }
  return translateMessage(`BridgeErrors.codes.${entry.reasonCode}`, entry.defaultMessage);
}

function shouldUseRawMessage(rawMessage: string, actionHint: string, fallbackMessage: string): boolean {
  if (!rawMessage) {
    return false;
  }
  const normalizedRaw = rawMessage.toLowerCase();
  if (actionHint && normalizedRaw === actionHint.toLowerCase()) {
    return false;
  }
  return normalizedRaw !== 'runtime call failed'
    && normalizedRaw !== fallbackMessage.toLowerCase();
}

export function toChatUserFacingRuntimeError(
  error: unknown,
  fallbackMessage: string,
): { code: string; message: string } {
  const normalized = asNimiError(error);
  const code = String(normalized.reasonCode || ReasonCode.RUNTIME_CALL_FAILED).trim() || ReasonCode.RUNTIME_CALL_FAILED;
  const rawMessage = normalizeText(normalized.message);
  const actionHint = normalizeText(normalized.actionHint);
  const reasonCodeMessage = chatRuntimeReasonCodeMessage(code);

  return {
    code,
    message: shouldUseRawMessage(rawMessage, actionHint, fallbackMessage)
      ? rawMessage
      : (reasonCodeMessage || rawMessage || fallbackMessage),
  };
}
