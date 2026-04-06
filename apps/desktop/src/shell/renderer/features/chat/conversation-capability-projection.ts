import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  buildAgentEffectiveCapabilityResolution,
  buildConversationCapabilityProjectionMap,
  getConversationCapabilityRouteRuntime,
  type AgentCapabilityEligibility,
  type ConversationCapability,
} from './conversation-capability';

const IMAGE_PROFILE_REQUIRED_CAPABILITIES: Partial<Record<ConversationCapability, boolean>> = {
  'image.generate': true,
  'image.edit': true,
};

export async function refreshConversationCapabilityProjections(
  capabilities?: readonly ConversationCapability[],
): Promise<void> {
  const appStore = useAppStore.getState();
  const projections = await buildConversationCapabilityProjectionMap({
    capabilities,
    selectionStore: appStore.conversationCapabilitySelectionStore,
    routeRuntime: getConversationCapabilityRouteRuntime(),
    requiresImageProfileRefByCapability: IMAGE_PROFILE_REQUIRED_CAPABILITIES,
  });
  useAppStore.getState().setConversationCapabilityProjections(projections);
}

export function refreshAgentEffectiveCapabilityResolution(
  eligibility: AgentCapabilityEligibility | null,
): void {
  const textProjection = useAppStore.getState().conversationCapabilityProjectionByCapability['text.generate'] || null;
  useAppStore.getState().setAgentEffectiveCapabilityResolution(
    buildAgentEffectiveCapabilityResolution({
      textProjection,
      eligibility,
    }),
  );
}
