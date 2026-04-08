import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  buildAgentEffectiveCapabilityResolution,
  buildConversationCapabilityProjectionMap,
  getConversationCapabilityRouteRuntime,
  selectionStoreFromAIConfig,
  type AgentCapabilityEligibility,
  type ConversationCapability,
} from './conversation-capability';
import {
  getDesktopAIConfigService,
} from '@renderer/app-shell/providers/desktop-ai-config-service';
import {
  getActiveScope,
  onActiveScopeChange,
} from './chat-active-ai-config-scope';

const IMAGE_PROFILE_REQUIRED_CAPABILITIES: Partial<Record<ConversationCapability, boolean>> = {
  'image.generate': true,
  'image.edit': true,
};

export async function refreshConversationCapabilityProjections(
  capabilities?: readonly ConversationCapability[],
): Promise<void> {
  const appStore = useAppStore.getState();
  const selectionStore = selectionStoreFromAIConfig(appStore.aiConfig);
  const projections = await buildConversationCapabilityProjectionMap({
    capabilities,
    selectionStore,
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

// ---------------------------------------------------------------------------
// Surface subscription — S-AICONF-006 driven projection refresh
// Phase 6: follows active scope, rebinds on scope switch.
// ---------------------------------------------------------------------------

let surfaceSubscriptionUnsubscribe: (() => void) | null = null;
let activeScopeUnsubscribe: (() => void) | null = null;

/**
 * Bind the config subscription for the current active scope.
 * Unsubscribes from any previous scope first.
 */
function bindSubscriptionForScope(): void {
  if (surfaceSubscriptionUnsubscribe) {
    surfaceSubscriptionUnsubscribe();
    surfaceSubscriptionUnsubscribe = null;
  }
  const surface = getDesktopAIConfigService();
  const scopeRef = getActiveScope();
  surfaceSubscriptionUnsubscribe = surface.aiConfig.subscribe(scopeRef, () => {
    void refreshConversationCapabilityProjections();
  });
}

/**
 * Bind projection refresh to the formal AIConfig surface subscription (S-AICONF-006).
 * When AIConfig changes through any surface write path (apply / update / setCapabilityBinding),
 * the subscription fires and triggers projection rebuild.
 *
 * Phase 6: also listens for active scope changes and rebinds the subscription
 * to the new scope. This means projection refresh always tracks the active scope.
 *
 * Must be called once at bootstrap time, after `bindDesktopAIConfigAppStore()`.
 */
export function bindProjectionRefreshToSurface(): void {
  if (activeScopeUnsubscribe) {
    return; // already bound
  }

  // Bind for the initial active scope
  bindSubscriptionForScope();

  // Rebind whenever active scope changes
  activeScopeUnsubscribe = onActiveScopeChange(() => {
    bindSubscriptionForScope();
    // Trigger immediate refresh for the new scope's config
    void refreshConversationCapabilityProjections();
  });
}
