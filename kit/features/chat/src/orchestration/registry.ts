import type {
  ConversationOrchestrationModeId,
  ConversationOrchestrationProvider,
} from './contracts.js';

export class ConversationProviderNotRegisteredError extends Error {
  readonly modeId: ConversationOrchestrationModeId;

  constructor(modeId: ConversationOrchestrationModeId) {
    super(`No conversation orchestration provider is registered for mode "${modeId}"`);
    this.name = 'ConversationProviderNotRegisteredError';
    this.modeId = modeId;
  }
}

export class ConversationOrchestrationRegistry {
  readonly #providers = new Map<
    ConversationOrchestrationModeId,
    ConversationOrchestrationProvider
  >();

  register(provider: ConversationOrchestrationProvider): void {
    const existing = this.#providers.get(provider.modeId);
    if (existing) {
      throw new Error(`Conversation orchestration provider "${provider.modeId}" is already registered`);
    }
    this.#providers.set(provider.modeId, provider);
  }

  resolve(modeId: ConversationOrchestrationModeId): ConversationOrchestrationProvider | null {
    return this.#providers.get(modeId) || null;
  }

  require(modeId: ConversationOrchestrationModeId): ConversationOrchestrationProvider {
    const provider = this.resolve(modeId);
    if (!provider) {
      throw new ConversationProviderNotRegisteredError(modeId);
    }
    return provider;
  }

  list(): readonly ConversationOrchestrationProvider[] {
    return [...this.#providers.values()];
  }
}
