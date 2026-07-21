import { useEffect } from 'react';
import type { ConversationCapability } from './conversation-capability';
import {
  refreshAgentEffectiveCapabilityResolution,
  refreshConversationCapabilityProjections,
} from './conversation-capability-projection';
import { useAppStoreApi } from '../../app-shell/providers/app-store';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';

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
  const sdk = useDesktopRendererSdk();
  // Initial projection build on bootstrap. Ongoing config-change driven refresh
  // is handled by the surface subscription (S-AICONF-006 via bindProjectionRefreshToSurface).
  useEffect(() => {
    if (!input.bootstrapReady) return;
    const routeRuntime = sdk.conversationCapabilityRuntime();
    void refreshConversationCapabilityProjections(store, AGENT_CONVERSATION_BOOTSTRAP_CAPABILITIES, routeRuntime);
    void refreshConversationCapabilityProjections(store, AGENT_CONVERSATION_DEFERRED_CAPABILITIES, routeRuntime);
  }, [input.bootstrapReady, sdk, store]);

  useEffect(() => {
    refreshAgentEffectiveCapabilityResolution(store);
  }, [input.imageCapabilityProjection, input.textCapabilityProjection, store]);
}
