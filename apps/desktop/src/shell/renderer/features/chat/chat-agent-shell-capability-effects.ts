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
  textCapabilityProjection: unknown;
};

export function useAgentConversationCapabilityEffects(
  input: UseAgentConversationCapabilityEffectsInput,
): void {
  // Initial projection build on bootstrap. Ongoing config-change driven refresh
  // is handled by the surface subscription (S-AICONF-006 via bindProjectionRefreshToSurface).
  useEffect(() => {
    if (!input.bootstrapReady) return;
    void refreshConversationCapabilityProjections(AGENT_CONVERSATION_REFRESHED_CAPABILITIES);
  }, [input.bootstrapReady]);

  useEffect(() => {
    refreshAgentEffectiveCapabilityResolution(input.agentRouteData || null);
  }, [input.agentRouteData, input.textCapabilityProjection]);
}
