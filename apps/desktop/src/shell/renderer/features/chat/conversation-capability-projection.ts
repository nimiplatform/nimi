import type { AppStoreApi } from '@renderer/app-shell/providers/app-store-factory';
import {
  buildAgentEffectiveCapabilityResolution,
  buildConversationCapabilityProjectionMap,
  getConversationCapabilityRouteRuntime,
  selectionStoreFromAIConfig,
} from './conversation-capability';
import {
  getDesktopAIConfigService,
} from '@renderer/app-shell/providers/desktop-ai-config-service';
import {
  getActiveScope,
  onActiveScopeChange,
} from './chat-shared-active-ai-config-scope';

export async function refreshConversationCapabilityProjections(
  store: AppStoreApi,
  capabilities?: readonly import('./conversation-capability').ConversationCapability[],
): Promise<void> {
  const appStore = store.getState();
  const selectionStore = selectionStoreFromAIConfig(appStore.aiConfig);
  const projections = await buildConversationCapabilityProjectionMap({
    capabilities,
    selectionStore,
    routeRuntime: getConversationCapabilityRouteRuntime(),
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

// ---------------------------------------------------------------------------
// Surface subscription — S-AICONF-006 driven projection refresh
// T3-1: follows the mode-aware active chat scope, rebinds on chat-mode switch.
// ---------------------------------------------------------------------------

/**
 * Bind the config subscription for the current active chat scope.
 * Unsubscribes from any previous scope first.
 *
 * When the active scope is `null` (Human / Group mode bind no built-in chat
 * NimiAIConfig scope) no subscription is bound — the chat path holds no generic
 * fallback scope subscription.
 */
function bindSubscriptionForScope(
  store: AppStoreApi,
  currentUnsubscribe: (() => void) | null,
): (() => void) | null {
  let surfaceSubscriptionUnsubscribe = currentUnsubscribe;
  if (surfaceSubscriptionUnsubscribe) {
    surfaceSubscriptionUnsubscribe();
  }
  const scopeRef = getActiveScope();
  if (!scopeRef) {
    return null;
  }
  const surface = getDesktopAIConfigService();
  surfaceSubscriptionUnsubscribe = surface.aiConfig.subscribe(scopeRef, () => {
    void refreshConversationCapabilityProjections(store);
  });
  return surfaceSubscriptionUnsubscribe;
}

/**
 * Bind projection refresh to the formal NimiAIConfig surface subscription (S-AICONF-006).
 * When NimiAIConfig changes through any surface write path (apply / update / setCapabilityBinding),
 * the subscription fires and triggers projection rebuild.
 *
 * T3-1: also listens for active chat scope changes and rebinds the subscription
 * to the new per-mode scope. Projection refresh always tracks the mode-aware
 * active chat scope.
 *
 * Bind once per renderer instance and invoke the returned disposer at unmount.
 */
export function bindProjectionRefreshToSurface(store: AppStoreApi): () => void {
  let surfaceSubscriptionUnsubscribe = bindSubscriptionForScope(store, null);

  // Rebind whenever active scope changes
  const activeScopeUnsubscribe = onActiveScopeChange(() => {
    surfaceSubscriptionUnsubscribe = bindSubscriptionForScope(
      store,
      surfaceSubscriptionUnsubscribe,
    );
    // Trigger immediate refresh for the new scope's config
    void refreshConversationCapabilityProjections(store);
  });
  return () => {
    activeScopeUnsubscribe();
    surfaceSubscriptionUnsubscribe?.();
    surfaceSubscriptionUnsubscribe = null;
  };
}
