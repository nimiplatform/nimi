import type { TFunction } from 'i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type {
  AgentEffectiveCapabilityResolution,
  ConversationCapabilityProjection,
} from './conversation-capability';
import {
  refreshAgentEffectiveCapabilityResolution,
  refreshConversationCapabilityProjections,
} from './conversation-capability-projection';

type EnsureAiConversationSubmitRouteReadyDeps = {
  refreshConversationCapabilityProjections: typeof refreshConversationCapabilityProjections;
  getTextCapabilityProjection: () => ConversationCapabilityProjection | null;
};

type EnsureAgentConversationSubmitRouteReadyDeps = {
  refreshConversationCapabilityProjections: typeof refreshConversationCapabilityProjections;
  refreshAgentEffectiveCapabilityResolution: typeof refreshAgentEffectiveCapabilityResolution;
  getAgentResolution: () => AgentEffectiveCapabilityResolution | null;
};

function resolveAiSubmitRouteUnavailableMessage(
  t: TFunction,
  projection: ConversationCapabilityProjection | null,
): string {
  if (projection?.reasonCode === 'selection_missing' || projection?.reasonCode === 'selection_cleared') {
    return t('Chat.aiSubmitRouteUnavailable', {
      defaultValue: 'Select an AI route before sending a message.',
    });
  }
  return t('Chat.aiSubmitRouteUnavailable', {
    defaultValue: 'Choose a ready AI route before sending a message.',
  });
}

const DEFAULT_AI_DEPS: EnsureAiConversationSubmitRouteReadyDeps = {
  refreshConversationCapabilityProjections,
  getTextCapabilityProjection: () => (
    useAppStore.getState().conversationCapabilityProjectionByCapability['text.generate'] || null
  ),
};

const DEFAULT_AGENT_DEPS: EnsureAgentConversationSubmitRouteReadyDeps = {
  refreshConversationCapabilityProjections,
  refreshAgentEffectiveCapabilityResolution,
  getAgentResolution: () => useAppStore.getState().agentEffectiveCapabilityResolution,
};

export async function ensureAiConversationSubmitRouteReady(input: {
  t: TFunction;
  deps?: Partial<EnsureAiConversationSubmitRouteReadyDeps>;
}): Promise<ConversationCapabilityProjection> {
  const deps = {
    ...DEFAULT_AI_DEPS,
    ...input.deps,
  };
  await deps.refreshConversationCapabilityProjections(['text.generate']);
  const projection = deps.getTextCapabilityProjection();
  if (projection?.supported && projection.resolvedBinding) {
    return projection;
  }
  throw new Error(resolveAiSubmitRouteUnavailableMessage(input.t, projection));
}

export async function ensureAgentConversationSubmitRouteReady(input: {
  t: TFunction;
  deps?: Partial<EnsureAgentConversationSubmitRouteReadyDeps>;
}): Promise<AgentEffectiveCapabilityResolution> {
  const deps = {
    ...DEFAULT_AGENT_DEPS,
    ...input.deps,
  };
  await deps.refreshConversationCapabilityProjections(['text.generate']);
  deps.refreshAgentEffectiveCapabilityResolution();
  const resolution = deps.getAgentResolution();
  if (resolution?.ready && resolution.textProjection?.supported && resolution.textProjection.resolvedBinding) {
    return resolution;
  }
  throw new Error(input.t('Chat.agentSubmitRouteUnavailable', {
    defaultValue: 'Choose a ready AI route before sending a message.',
  }));
}
