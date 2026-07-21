import { useEffect } from 'react';
import type { ConversationCapability } from './conversation-capability';
import {
  refreshAgentEffectiveCapabilityResolution,
  refreshConversationCapabilityProjections,
} from './conversation-capability-projection';
import { useAppStoreApi } from '@renderer/app-shell/providers/app-store';

const AGENT_CONVERSATION_BOOTSTRAP_CAPABILITIES: readonly ConversationCapability[] = [
  'text.generate',
];
const AGENT_CONVERSATION_DEFERRED_CAPABILITIES: readonly ConversationCapability[] = [
  'image.generate',
  'image.edit',
  'video.generate',
  'audio.synthesize',
  'audio.transcribe',
  'voice_workflow.voice_clone',
  'voice_workflow.voice_design',
];

type UseAgentConversationCapabilityEffectsInput = {
  bootstrapReady: boolean;
  textCapabilityProjection: unknown;
  imageCapabilityProjection?: unknown;
};

export function useAgentConversationCapabilityEffects(
  input: UseAgentConversationCapabilityEffectsInput,
): void {
  const store = useAppStoreApi();
  // Initial projection build on bootstrap. Ongoing config-change driven refresh
  // is handled by the surface subscription (S-AICONF-006 via bindProjectionRefreshToSurface).
  useEffect(() => {
    if (!input.bootstrapReady) return;
    void refreshConversationCapabilityProjections(store, AGENT_CONVERSATION_BOOTSTRAP_CAPABILITIES);
    void refreshConversationCapabilityProjections(store, AGENT_CONVERSATION_DEFERRED_CAPABILITIES);
  }, [input.bootstrapReady, store]);

  useEffect(() => {
    refreshAgentEffectiveCapabilityResolution(store);
  }, [input.imageCapabilityProjection, input.textCapabilityProjection, store]);
}
