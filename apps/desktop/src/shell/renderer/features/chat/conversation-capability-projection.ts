import type { AppStoreApi } from '../../app-shell/providers/app-store-factory';
import {
  buildAgentEffectiveCapabilityResolution,
  buildConversationCapabilityProjectionMap,
  type ConversationCapabilityRouteRuntime,
  selectionStoreFromAIConfig,
} from './conversation-capability';

export async function refreshConversationCapabilityProjections(
  store: AppStoreApi,
  capabilities?: readonly import('./conversation-capability').ConversationCapability[],
  routeRuntime?: ConversationCapabilityRouteRuntime | null,
): Promise<void> {
  const appStore = store.getState();
  const selectionStore = selectionStoreFromAIConfig(appStore.aiConfig);
  const projections = await buildConversationCapabilityProjectionMap({
    capabilities,
    selectionStore,
    routeRuntime: routeRuntime || null,
  });
  store.getState().setConversationCapabilityProjections(projections);
  // Keep the derived agent execution resolution in sync even when the agent
  // conversation shell has not been mounted yet, so GROUP @mentions can run.
  refreshAgentEffectiveCapabilityResolution(store);
}

export function refreshAgentEffectiveCapabilityResolution(store: AppStoreApi): void {
  const state = store.getState();
  const textProjection = state.conversationCapabilityProjectionByCapability['text.generate'] || null;
  const imageProjection = state.conversationCapabilityProjectionByCapability['image.generate'] || null;
  const voiceProjection = state.conversationCapabilityProjectionByCapability['audio.synthesize'] || null;
  const voiceWorkflowCloneProjection = state.conversationCapabilityProjectionByCapability['voice_workflow.voice_clone'] || null;
  const voiceWorkflowDesignProjection = state.conversationCapabilityProjectionByCapability['voice_workflow.voice_design'] || null;
  state.setAgentEffectiveCapabilityResolution(
    buildAgentEffectiveCapabilityResolution({
      textProjection,
      imageProjection,
      voiceProjection,
      voiceWorkflowCloneProjection,
      voiceWorkflowDesignProjection,
    }),
  );
}
