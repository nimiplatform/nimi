import type {
  ConversationGenerationAdapter,
  ConversationOrchestrationProvider,
  ConversationVoiceAdapter,
} from './contracts.js';

export type ConversationCapabilityGuardKey =
  | 'voiceInput'
  | 'voiceOutput'
  | 'imageGeneration'
  | 'videoGeneration';

export function hasConversationCapability(
  provider: Pick<ConversationOrchestrationProvider, 'capabilities'>,
  capability: ConversationCapabilityGuardKey,
): boolean {
  return provider.capabilities[capability];
}

export function requireConversationVoiceAdapter(
  provider: Pick<ConversationOrchestrationProvider, 'modeId' | 'capabilities'>,
  capability: 'voiceInput' | 'voiceOutput',
  adapter: ConversationVoiceAdapter | null | undefined,
): ConversationVoiceAdapter {
  if (!provider.capabilities[capability]) {
    throw new Error(`Conversation provider "${provider.modeId}" does not support ${capability}`);
  }
  if (!adapter) {
    throw new Error(`Conversation voice adapter is required for ${capability}`);
  }
  return adapter;
}

export function requireConversationGenerationAdapter(
  provider: Pick<ConversationOrchestrationProvider, 'modeId' | 'capabilities'>,
  capability: 'imageGeneration' | 'videoGeneration',
  adapter: ConversationGenerationAdapter | null | undefined,
): ConversationGenerationAdapter {
  if (!provider.capabilities[capability]) {
    throw new Error(`Conversation provider "${provider.modeId}" does not support ${capability}`);
  }
  if (!adapter) {
    throw new Error(`Conversation generation adapter is required for ${capability}`);
  }
  return adapter;
}
