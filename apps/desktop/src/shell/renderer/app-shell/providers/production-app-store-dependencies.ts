import {
  createEmptyNimiAIConfig,
  projectNimiRuntimeLocalAgentAIScopeRef,
} from '@nimiplatform/sdk/ai';
import type { AppStoreDependencies } from './app-store-factory.js';
import {
  loadStoredChatThinkingPreference,
  persistStoredChatThinkingPreference,
} from '../../features/chat/chat-settings-storage.js';

export function createProductionAppStoreDependencies(): AppStoreDependencies {
  return Object.freeze({
    // Temporary C3c input only. It is an in-memory projection for the legacy
    // Agent adapter and is never persisted or used by Nimi Chat.
    initialAIConfig: createEmptyNimiAIConfig(
      projectNimiRuntimeLocalAgentAIScopeRef('runtime.local-agent-subsystem'),
    ),
    commitAIConfig() {
      throw new Error('DESKTOP_RENDERER_AI_CONFIG_WRITE_RETIRED');
    },
    initialChatThinkingPreference: loadStoredChatThinkingPreference(),
    persistChatThinkingPreference: persistStoredChatThinkingPreference,
  });
}
