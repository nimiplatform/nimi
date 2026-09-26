import {
  getNimiRuntimeReasonCodeMessage,
  toNimiRuntimeUserFacingError,
} from '@nimiplatform/sdk/runtime';
import type { TFunction } from 'i18next';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';

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
  if (reasonCode === 'AGENT_BUSY' || reasonCode === 'agent-busy') {
    return translateMessage(t, 'Chat.agentBusyRetry', 'This partner is busy with another request. Your input is saved here; try sending again shortly.');
  }
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
  const reason = extractNimiErrorFields(error).reasonCode;
  if (reason === 'AGENT_BUSY' || reason === 'agent-busy') {
    return { code: reason, message: chatRuntimeReasonCodeMessage(reason, t)! };
  }
  return toNimiRuntimeUserFacingError(error, {
    fallbackMessage,
    resolveReasonCodeMessage: (reasonCode) => chatRuntimeReasonCodeMessage(reasonCode, t),
  });
}
