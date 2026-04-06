import { useEffect } from 'react';
import { CONVERSATION_CAPABILITIES, type AgentCapabilityEligibility, type ConversationCapability } from './conversation-capability';
import {
  refreshAgentEffectiveCapabilityResolution,
  refreshConversationCapabilityProjections,
} from './conversation-capability-projection';

const AGENT_CONVERSATION_REFRESHED_CAPABILITIES: readonly ConversationCapability[] = CONVERSATION_CAPABILITIES;

type UseAgentConversationCapabilityEffectsInput = {
  agentRouteData: AgentCapabilityEligibility | null | undefined;
  bootstrapReady: boolean;
  conversationCapabilitySelectionStore: unknown;
  textCapabilityProjection: unknown;
};

export function useAgentConversationCapabilityEffects(
  input: UseAgentConversationCapabilityEffectsInput,
): void {
  useEffect(() => {
    void refreshConversationCapabilityProjections(AGENT_CONVERSATION_REFRESHED_CAPABILITIES);
  }, [input.bootstrapReady, input.conversationCapabilitySelectionStore]);

  useEffect(() => {
    refreshAgentEffectiveCapabilityResolution(input.agentRouteData || null);
  }, [input.agentRouteData, input.textCapabilityProjection]);
}
