import type { DesktopConversationModeHost } from './chat-mode-host-types';
import type { ConversationCanonicalMessage, ConversationCharacterData, ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat/headless';

export type AgentConversationHostSnapshot = Pick<
  DesktopConversationModeHost,
  | 'mode'
  | 'availability'
  | 'activeThreadId'
  | 'targets'
  | 'selectedTargetId'
  | 'messages'
  | 'characterData'
  | 'transcriptProps'
  | 'stagePanelProps'
>;

export function resolveAgentConversationHostSnapshot(input: {
  activeThreadId: string | null;
  targets: readonly ConversationTargetSummary[];
  selectedTargetId: string | null;
  messages: readonly ConversationCanonicalMessage[];
  characterData: ConversationCharacterData;
  hostView: Pick<DesktopConversationModeHost, 'availability' | 'transcriptProps' | 'stagePanelProps'>;
}): AgentConversationHostSnapshot {
  return {
    mode: 'agent',
    availability: input.hostView.availability,
    activeThreadId: input.activeThreadId,
    targets: input.targets,
    selectedTargetId: input.selectedTargetId,
    messages: input.messages,
    characterData: input.characterData,
    transcriptProps: input.hostView.transcriptProps,
    stagePanelProps: input.hostView.stagePanelProps,
  };
}
