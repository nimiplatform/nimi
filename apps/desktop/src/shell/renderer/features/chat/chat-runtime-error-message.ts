import { asNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { i18n } from '@renderer/i18n';

const CHAT_RUNTIME_REASON_MESSAGE_MAP: Record<string, { key: string; defaultValue: string }> = {
  AI_PROVIDER_TIMEOUT: { key: 'BridgeErrors.codes.AI_PROVIDER_TIMEOUT', defaultValue: 'AI provider request timed out.' },
  AI_PROVIDER_UNAVAILABLE: { key: 'BridgeErrors.codes.AI_PROVIDER_UNAVAILABLE', defaultValue: 'AI provider is unavailable.' },
  AI_PROVIDER_RATE_LIMITED: { key: 'BridgeErrors.codes.AI_PROVIDER_RATE_LIMITED', defaultValue: 'AI provider rate limit was reached.' },
  AI_PROVIDER_INTERNAL: { key: 'BridgeErrors.codes.AI_PROVIDER_INTERNAL', defaultValue: 'AI provider returned an internal error.' },
  AI_PROVIDER_ENDPOINT_FORBIDDEN: { key: 'BridgeErrors.codes.AI_PROVIDER_ENDPOINT_FORBIDDEN', defaultValue: 'AI provider endpoint is forbidden.' },
  AI_PROVIDER_AUTH_FAILED: { key: 'BridgeErrors.codes.AI_PROVIDER_AUTH_FAILED', defaultValue: 'AI provider authentication failed.' },
  AI_STREAM_BROKEN: { key: 'BridgeErrors.codes.AI_STREAM_BROKEN', defaultValue: 'AI streaming response was interrupted.' },
  AI_CONNECTOR_CREDENTIAL_MISSING: { key: 'BridgeErrors.codes.AI_CONNECTOR_CREDENTIAL_MISSING', defaultValue: 'AI connector credentials are missing.' },
  AI_CONNECTOR_DISABLED: { key: 'BridgeErrors.codes.AI_CONNECTOR_DISABLED', defaultValue: 'AI connector is disabled.' },
  AI_CONNECTOR_NOT_FOUND: { key: 'BridgeErrors.codes.AI_CONNECTOR_NOT_FOUND', defaultValue: 'AI connector was not found.' },
  AI_CONNECTOR_INVALID: { key: 'BridgeErrors.codes.AI_CONNECTOR_INVALID', defaultValue: 'AI connector configuration is invalid.' },
  AI_MODEL_NOT_FOUND: { key: 'BridgeErrors.codes.AI_MODEL_NOT_FOUND', defaultValue: 'AI model was not found.' },
  AI_MODALITY_NOT_SUPPORTED: { key: 'BridgeErrors.codes.AI_MODALITY_NOT_SUPPORTED', defaultValue: 'AI modality is not supported.' },
  AI_MODEL_PROVIDER_MISMATCH: { key: 'BridgeErrors.codes.AI_MODEL_PROVIDER_MISMATCH', defaultValue: 'AI model does not match the selected provider.' },
  RUNTIME_UNAVAILABLE: { key: 'BridgeErrors.codes.RUNTIME_UNAVAILABLE', defaultValue: 'Runtime is unavailable.' },
  RUNTIME_BRIDGE_DAEMON_UNAVAILABLE: { key: 'BridgeErrors.codes.RUNTIME_BRIDGE_DAEMON_UNAVAILABLE', defaultValue: 'Runtime daemon is unavailable.' },
};

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

function resolveReasonCodeMessage(reasonCode: string): string | null {
  const entry = CHAT_RUNTIME_REASON_MESSAGE_MAP[reasonCode];
  if (!entry) {
    return null;
  }
  return translateMessage(entry.key, entry.defaultValue);
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
  const reasonCodeMessage = resolveReasonCodeMessage(code);

  return {
    code,
    message: shouldUseRawMessage(rawMessage, actionHint, fallbackMessage)
      ? rawMessage
      : (reasonCodeMessage || rawMessage || fallbackMessage),
  };
}
