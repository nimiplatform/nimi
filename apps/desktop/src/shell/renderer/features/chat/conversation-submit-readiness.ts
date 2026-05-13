import type { TFunction } from 'i18next';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type {
  AgentEffectiveCapabilityResolution,
  ConversationCapabilityProjection,
} from './conversation-capability';
import {
  buildAgentEffectiveCapabilityResolution,
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
  getTextCapabilityProjection: () => ConversationCapabilityProjection | null;
  getAgentResolution: () => AgentEffectiveCapabilityResolution | null;
};

function resolveAiSubmitRouteUnavailableMessage(
  t: TFunction,
  projection: ConversationCapabilityProjection | null,
): string {
  if (projection?.reasonCode === 'selection_missing' || projection?.reasonCode === 'selection_cleared') {
    return t('Chat.nimiSubmitRouteUnavailable', {
      defaultValue: 'Select a Nimi route before sending a message.',
    });
  }
  return t('Chat.nimiSubmitRouteUnavailable', {
    defaultValue: 'Choose a ready Nimi route before sending a message.',
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
  getTextCapabilityProjection: () => (
    useAppStore.getState().conversationCapabilityProjectionByCapability['text.generate'] || null
  ),
  getAgentResolution: () => useAppStore.getState().agentEffectiveCapabilityResolution,
};

function routeUnavailableError(t: TFunction): Error {
  return createNimiError({
    message: t('Chat.agentSubmitRouteUnavailable', {
      defaultValue: 'A local or cloud runtime route is required before sending a message.',
    }),
    reasonCode: ReasonCode.AI_INPUT_INVALID,
    actionHint: 'select_runtime_route_binding',
    source: 'sdk',
  });
}

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
  const textProjection = deps.getTextCapabilityProjection();
  if (textProjection?.supported && textProjection.resolvedBinding) {
    const rebuilt = buildAgentEffectiveCapabilityResolution({
      textProjection,
      imageProjection: resolution?.imageProjection || null,
      voiceProjection: resolution?.voiceProjection || null,
      voiceWorkflowCloneProjection: resolution?.voiceWorkflowProjections['voice_workflow.voice_clone'] || null,
      voiceWorkflowDesignProjection: resolution?.voiceWorkflowProjections['voice_workflow.voice_design'] || null,
    });
    if (rebuilt.ready) {
      return rebuilt;
    }
  }
  throw routeUnavailableError(input.t);
}
