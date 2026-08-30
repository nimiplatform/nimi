import {
  isNimiLocalAppAgentSelectorMismatchError,
  type NimiLocalAppAgentHandle,
  type NimiLocalAppAgentReferencesClient,
  type NimiLocalAppConversationClient,
} from '@nimiplatform/sdk/app';

type AvatarSessionAgentBindingInput = {
  readonly agents: NimiLocalAppAgentReferencesClient;
  readonly conversation: NimiLocalAppConversationClient;
  readonly conversationAnchorId: string;
  readonly onHandleChange?: (agentHandle: NimiLocalAppAgentHandle) => void | Promise<void>;
};

export type AvatarSessionAgentBinding = {
  readonly current: () => NimiLocalAppAgentHandle;
  readonly generation: () => number;
  readonly refresh: () => Promise<NimiLocalAppAgentHandle>;
  readonly run: <T>(operation: (agentHandle: NimiLocalAppAgentHandle) => Promise<T>) => Promise<T>;
};

// @nimi-authority: rule.nimi.avatar.embodiment.r023
/**
 * Resolves the caller-Host Runtime-revalidated Conversation continuity fence
 * to the opaque Agent handle minted for Avatar's own current App session. A
 * handle from the launching App is deliberately never accepted as an Avatar
 * session selector.
 */
export async function resolveAvatarSessionAgentHandle(input: {
  readonly agents: NimiLocalAppAgentReferencesClient;
  readonly conversation: NimiLocalAppConversationClient;
  readonly conversationAnchorId: string;
}): Promise<NimiLocalAppAgentHandle> {
  const references = await input.agents.listReferences();
  for (const reference of references) {
    try {
      const snapshot = await input.conversation.snapshot({
        agentHandle: reference.agentHandle,
        conversationAnchorId: input.conversationAnchorId,
      });
      if (snapshot.conversationAnchorId === input.conversationAnchorId) {
        return reference.agentHandle;
      }
    } catch (error) {
      if (isNimiLocalAppAgentSelectorMismatchError(error)) {
        continue;
      }
      throw error;
    }
  }
  throw Object.assign(
    new Error('Avatar could not bind the handed-off Conversation to its current App session.'),
    {
      reasonCode: 'AVATAR_AGENT_SESSION_BINDING_UNAVAILABLE',
      actionHint: 'relaunch_avatar_from_the_current_conversation',
      retryable: true,
    },
  );
}

export async function createAvatarSessionAgentBinding(
  input: AvatarSessionAgentBindingInput,
): Promise<AvatarSessionAgentBinding> {
  let currentHandle: NimiLocalAppAgentHandle | null = null;
  let currentGeneration = 0;
  let refreshInFlight: Promise<NimiLocalAppAgentHandle> | null = null;

  const refresh = (): Promise<NimiLocalAppAgentHandle> => {
    refreshInFlight ??= resolveAvatarSessionAgentHandle(input)
      .then(async (agentHandle) => {
        if (agentHandle !== currentHandle) {
          await input.onHandleChange?.(agentHandle);
          currentHandle = agentHandle;
          currentGeneration += 1;
        }
        return agentHandle;
      })
      .finally(() => {
        refreshInFlight = null;
      });
    return refreshInFlight;
  };

  await refresh();
  return Object.freeze({
    current: () => {
      if (!currentHandle) {
        throw new Error('Avatar Agent session binding is not initialized.');
      }
      return currentHandle;
    },
    generation: () => currentGeneration,
    refresh,
    run: async <T>(operation: (agentHandle: NimiLocalAppAgentHandle) => Promise<T>): Promise<T> => {
      try {
        return await operation(currentHandle ?? await refresh());
      } catch (error) {
        if (!isNimiLocalAppAgentSelectorMismatchError(error)) {
          throw error;
        }
        return operation(await refresh());
      }
    },
  });
}
