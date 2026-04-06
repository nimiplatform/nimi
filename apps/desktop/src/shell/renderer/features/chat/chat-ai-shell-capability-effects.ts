import { useEffect } from 'react';
import { CONVERSATION_CAPABILITIES, type ConversationCapability } from './conversation-capability';
import { refreshConversationCapabilityProjections } from './conversation-capability-projection';

const AI_CONVERSATION_REFRESHED_CAPABILITIES: readonly ConversationCapability[] = CONVERSATION_CAPABILITIES;

type UseAiConversationCapabilityEffectsInput = {
  bootstrapReady: boolean;
  conversationCapabilitySelectionStore: unknown;
  currentDraftTextRef: { current: string };
  draftText: string | null | undefined;
  draftUpdatedAtMs: number | null | undefined;
};

export function useAiConversationCapabilityEffects(
  input: UseAiConversationCapabilityEffectsInput,
): void {
  useEffect(() => {
    void refreshConversationCapabilityProjections(AI_CONVERSATION_REFRESHED_CAPABILITIES);
  }, [input.bootstrapReady, input.conversationCapabilitySelectionStore]);

  useEffect(() => {
    input.currentDraftTextRef.current = input.draftText || '';
  }, [input.currentDraftTextRef, input.draftText, input.draftUpdatedAtMs]);
}
