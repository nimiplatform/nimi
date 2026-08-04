import type { ConversationRuntimeAdapter } from '@nimiplatform/kit/features/chat/headless';
import { createNimiError, ReasonCode } from '@nimiplatform/sdk/types';

/**
 * C3 App-owner hard cut: Nimi Chat no longer derives execution identity from
 * renderer-local AIConfig, route projections, models, or target refs. C5 will
 * connect this surface to Runtime's owner-driven immutable Job composition.
 */
function appAIConfigExecutionPending(): never {
  throw createNimiError({
    message: 'Nimi Chat execution is unavailable until Runtime App AIConfig composition is active.',
    reasonCode: ReasonCode.AI_ROUTE_UNSUPPORTED,
    actionHint: 'wait_for_app_ai_config_execution_support',
    source: 'runtime',
  });
}

/** Retained only as a stable fail-closed export for direct callers/tests. */
export function resolveChatAiConversationRuntimeRequest(): never {
  return appAIConfigExecutionPending();
}

export function createChatAiConversationRuntimeAdapter(): ConversationRuntimeAdapter {
  return {
    async streamText() {
      return appAIConfigExecutionPending();
    },
  };
}
