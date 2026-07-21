import type { AppStoreApi } from '../../app-shell/providers/app-store-factory.js';
import { getDesktopAIConfigService } from '../../app-shell/providers/desktop-ai-config-service.js';
import {
  getActiveScope,
  onActiveScopeChange,
} from './chat-shared-active-ai-config-scope.js';
import { refreshConversationCapabilityProjections } from './conversation-capability-projection.js';
import { getProductionConversationCapabilityRouteRuntime } from './production-conversation-route-runtime-state.js';

function bindSubscriptionForScope(
  store: AppStoreApi,
  currentUnsubscribe: (() => void) | null,
): (() => void) | null {
  currentUnsubscribe?.();
  const scopeRef = getActiveScope();
  if (!scopeRef) return null;
  const surface = getDesktopAIConfigService();
  return surface.aiConfig.subscribe(scopeRef, () => {
    void refreshConversationCapabilityProjections(store, undefined, getProductionConversationCapabilityRouteRuntime());
  });
}

export function bindProductionProjectionRefreshToSurface(store: AppStoreApi): () => void {
  let surfaceSubscriptionUnsubscribe = bindSubscriptionForScope(store, null);
  const activeScopeUnsubscribe = onActiveScopeChange(() => {
    surfaceSubscriptionUnsubscribe = bindSubscriptionForScope(
      store,
      surfaceSubscriptionUnsubscribe,
    );
    void refreshConversationCapabilityProjections(store, undefined, getProductionConversationCapabilityRouteRuntime());
  });
  return () => {
    activeScopeUnsubscribe();
    surfaceSubscriptionUnsubscribe?.();
    surfaceSubscriptionUnsubscribe = null;
  };
}
