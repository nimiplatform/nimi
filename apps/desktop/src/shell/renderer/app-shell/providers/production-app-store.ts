import { createAppStore } from './app-store-factory.js';
import { scopeKeyFromRef } from './desktop-ai-config-storage.js';
import { bindDesktopAIConfigAppStore } from './desktop-ai-config-service.js';
import { createProductionAppStoreDependencies } from './production-app-store-dependencies.js';
import { getActiveScope } from '../../features/chat/chat-shared-active-ai-config-scope.js';
import { bindProjectionRefreshToSurface } from '../../features/chat/conversation-capability-projection.js';

export const productionAppStore = createAppStore(createProductionAppStoreDependencies());

bindDesktopAIConfigAppStore((updatedScopeKey, config) => {
  const activeScope = getActiveScope();
  if (activeScope && updatedScopeKey === scopeKeyFromRef(activeScope)) {
    productionAppStore.setState({ aiConfig: config });
  }
});
export const disposeProductionProjectionRefresh = bindProjectionRefreshToSurface(productionAppStore);
