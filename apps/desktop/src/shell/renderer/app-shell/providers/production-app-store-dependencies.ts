import type { AppStoreDependencies } from './app-store-factory.js';
import {
  loadStoredChatThinkingPreference,
  persistStoredChatThinkingPreference,
} from '../../features/chat/chat-settings-storage.js';

export function createProductionAppStoreDependencies(): AppStoreDependencies {
  return Object.freeze({
    initialChatThinkingPreference: loadStoredChatThinkingPreference(),
    persistChatThinkingPreference: persistStoredChatThinkingPreference,
  });
}
