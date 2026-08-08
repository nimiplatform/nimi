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

export type ChatContextCapacityFailure = {
  readonly requiredInputTokens: number;
  readonly availableInputTokens: number;
  readonly requiredWindowTokens?: number;
  readonly currentWindowTokens?: number;
};

export function projectChatContextCapacityFailure(error: unknown): ChatContextCapacityFailure | null {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    } else {
      messages.push(String(current));
      break;
    }
  }
  const match = messages.join('\n').match(
    /context_capacity_exceeded:\s*required=(\d+)\s+available=(\d+)(?:\s+required_window=(\d+)\s+current_window=(\d+))?/iu,
  );
  if (!match) return null;
  const requiredInputTokens = Number(match[1]);
  const availableInputTokens = Number(match[2]);
  const requiredWindowTokens = match[3] ? Number(match[3]) : undefined;
  const currentWindowTokens = match[4] ? Number(match[4]) : undefined;
  if (!Number.isSafeInteger(requiredInputTokens) || !Number.isSafeInteger(availableInputTokens)) {
    return null;
  }
  return {
    requiredInputTokens,
    availableInputTokens,
    ...(Number.isSafeInteger(requiredWindowTokens) ? { requiredWindowTokens } : {}),
    ...(Number.isSafeInteger(currentWindowTokens) ? { currentWindowTokens } : {}),
  };
}

export function chatContextCapacityFailureMessage(
  failure: ChatContextCapacityFailure,
  t: TFunction,
): string {
  if (failure.requiredWindowTokens !== undefined && failure.currentWindowTokens !== undefined) {
    return t('Chat.contextCapacityExceeded', {
      defaultValue: 'This local model is using a {{current}}-token context, but this agent needs at least {{required}}. Switch Context capacity to Automatic in Local AI Configurations.',
      current: failure.currentWindowTokens,
      required: failure.requiredWindowTokens,
    });
  }
  return t('Chat.contextCapacityExceededInputBudget', {
    defaultValue: 'This agent needs {{required}} input tokens, but only {{available}} are available. Switch Context capacity to Automatic in Local AI Configurations.',
    required: failure.requiredInputTokens,
    available: failure.availableInputTokens,
  });
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
  const capacity = projectChatContextCapacityFailure(error);
  if (capacity) {
    return {
      code: 'AI_CONFIG_INVALID',
      message: chatContextCapacityFailureMessage(capacity, t),
    };
  }
  return toNimiRuntimeUserFacingError(error, {
    fallbackMessage,
    resolveReasonCodeMessage: (reasonCode) => chatRuntimeReasonCodeMessage(reasonCode, t),
  });
}
