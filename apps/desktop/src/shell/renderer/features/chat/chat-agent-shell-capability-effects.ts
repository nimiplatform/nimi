import { useEffect } from 'react';
import type { ConversationCapability } from './conversation-capability';
import {
  refreshAgentEffectiveCapabilityResolution,
  refreshConversationCapabilityProjections,
} from './conversation-capability-projection';

const AGENT_CONVERSATION_BOOTSTRAP_CAPABILITIES: readonly ConversationCapability[] = [
  'text.generate',
];
const AGENT_CONVERSATION_DEFERRED_CAPABILITIES: readonly ConversationCapability[] = [
  'image.generate',
  'image.edit',
  'video.generate',
  'audio.synthesize',
  'audio.transcribe',
  'voice_workflow.tts_v2v',
  'voice_workflow.tts_t2v',
];

type UseAgentConversationCapabilityEffectsInput = {
  bootstrapReady: boolean;
  textCapabilityProjection: unknown;
  imageCapabilityProjection?: unknown;
};

export function useAgentConversationCapabilityEffects(
  input: UseAgentConversationCapabilityEffectsInput,
): void {
  // Initial projection build on bootstrap. Ongoing config-change driven refresh
  // is handled by the surface subscription (S-AICONF-006 via bindProjectionRefreshToSurface).
  useEffect(() => {
    if (!input.bootstrapReady) return;
    void refreshConversationCapabilityProjections(AGENT_CONVERSATION_BOOTSTRAP_CAPABILITIES);
    void refreshConversationCapabilityProjections(AGENT_CONVERSATION_DEFERRED_CAPABILITIES);
  }, [input.bootstrapReady]);

  useEffect(() => {
    refreshAgentEffectiveCapabilityResolution();
  }, [input.imageCapabilityProjection, input.textCapabilityProjection]);
}
