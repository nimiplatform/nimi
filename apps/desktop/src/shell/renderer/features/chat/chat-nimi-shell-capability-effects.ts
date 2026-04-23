import { useEffect } from 'react';
import type { ConversationCapability } from './conversation-capability';
import { refreshConversationCapabilityProjections } from './conversation-capability-projection';

const AI_CONVERSATION_BOOTSTRAP_CAPABILITIES: readonly ConversationCapability[] = [
  'text.generate',
];

type UseAiConversationCapabilityEffectsInput = {
  bootstrapReady: boolean;
  currentDraftTextRef: { current: string };
  draftText: string | null | undefined;
  draftUpdatedAtMs: number | null | undefined;
};

export function useAiConversationCapabilityEffects(
  input: UseAiConversationCapabilityEffectsInput,
): void {
  // Initial projection build on bootstrap. Ongoing config-change driven refresh
  // is handled by the surface subscription (S-AICONF-006 via bindProjectionRefreshToSurface).
  useEffect(() => {
    if (!input.bootstrapReady) return;
    void refreshConversationCapabilityProjections(AI_CONVERSATION_BOOTSTRAP_CAPABILITIES);
  }, [input.bootstrapReady]);

  useEffect(() => {
    input.currentDraftTextRef.current = input.draftText || '';
  }, [input.currentDraftTextRef, input.draftText, input.draftUpdatedAtMs]);
}
