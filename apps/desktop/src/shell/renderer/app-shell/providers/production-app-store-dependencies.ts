import type { NimiAIConfig } from '@nimiplatform/sdk/ai';

import {
  getDesktopAIConfigService,
} from './desktop-ai-config-service.js';
import type { AppStoreDependencies } from './app-store-factory.js';
import {
  loadStoredChatThinkingPreference,
  persistStoredChatThinkingPreference,
} from '../../features/chat/chat-settings-storage.js';
import {
  getActiveScope,
  setActiveScopeForMode,
} from '../../features/chat/chat-shared-active-ai-config-scope.js';

export function createProductionAppStoreDependencies(): AppStoreDependencies {
  const initialActiveScope = getActiveScope();
  if (!initialActiveScope) {
    throw new Error(
      'production-app-store: default chat mode has no built-in NimiAIConfig scope',
    );
  }
  const aiConfigService = getDesktopAIConfigService();
  return Object.freeze({
    initialAIConfig: aiConfigService.aiConfig.get(initialActiveScope),
    commitAIConfig(config: NimiAIConfig) {
      aiConfigService.aiConfig.update(config.scopeRef, config);
    },
    initialChatThinkingPreference: loadStoredChatThinkingPreference(),
    persistChatThinkingPreference: persistStoredChatThinkingPreference,
    setActiveScopeForMode,
  });
}
