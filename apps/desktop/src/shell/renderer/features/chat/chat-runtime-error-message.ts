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
  if (reasonCode === 'AI_REMOTE_MODEL_CATALOG_STALE') {
    return translateMessage(t, 'Chat.nimiCatalogStale', 'The saved cloud model changed. Choose it again in AI Capabilities, then send your message.');
  }
  if (reasonCode === 'CAPABILITY_CATALOG_MISMATCH') {
    return translateMessage(t, 'Chat.nimiCatalogMismatch', 'This model lacks verified details needed to run. Choose another model in AI Capabilities, then send your message.');
  }
  if (reasonCode === 'AI_CONFIG_INVALID') {
    return translateMessage(t, 'Chat.nimiConfigInvalid', 'The selected model cannot run. Choose another model in AI Capabilities, then send your message.');
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
