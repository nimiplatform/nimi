import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
import type { AppStoreState } from '../../app-shell/providers/store-types';
import type { ConversationMode } from '@nimiplatform/kit/features/chat/headless';
import type { AgentConversationSelection } from './chat-shell-types.js';
import { projectCanonicalAgentTargetSnapshot } from './chat-agent-thread-model.js';

type AgentConversationLauncherInput = {
  target: AgentLocalTargetSnapshot;
  initialComposerText?: string | null;
  setActiveTab: AppStoreState['setActiveTab'];
  setChatMode: AppStoreState['setChatMode'];
  setSelectedTargetForSource: (source: ConversationMode, targetId: string | null) => void;
  setAgentConversationSelection: (selection: AgentConversationSelection) => void;
  setAgentConversationTargetSnapshot: AppStoreState['setAgentConversationTargetSnapshot'];
  setPendingAgentComposerPrefill?: AppStoreState['setPendingAgentComposerPrefill'];
};

export type AgentInteractionLaunchKind = 'chat' | 'voice';

export type AgentInteractionLaunchResult = {
  interaction: AgentInteractionLaunchKind;
  routedSurface: 'agent-conversation';
};

export async function launchAgentConversationFromDisplay(
  input: AgentConversationLauncherInput,
): Promise<AgentInteractionLaunchResult> {
  return launchAgentInteractionFromDisplay({
    ...input,
    interaction: 'chat',
  });
}

export async function launchAgentVoiceFromDisplay(
  input: AgentConversationLauncherInput,
): Promise<AgentInteractionLaunchResult> {
  return launchAgentInteractionFromDisplay({
    ...input,
    interaction: 'voice',
  });
}

async function launchAgentInteractionFromDisplay(
  input: AgentConversationLauncherInput & {
    interaction: AgentInteractionLaunchKind;
  },
): Promise<AgentInteractionLaunchResult> {
  const target = projectCanonicalAgentTargetSnapshot(input.target);
  const agentHandle = target.agentHandle!;
  const conversationAnchorId = target.conversationAnchorId!;

  input.setAgentConversationTargetSnapshot(target);
  input.setSelectedTargetForSource('agent', agentHandle);
  input.setAgentConversationSelection({
    agentHandle,
    conversationAnchorId,
    targetId: agentHandle,
  });
  const initialComposerText = String(input.initialComposerText || '').trim();
  if (initialComposerText) {
    input.setPendingAgentComposerPrefill?.({
      agentHandle,
      text: initialComposerText,
    });
  }
  input.setChatMode('agent');
  input.setActiveTab('chat');

  return {
    interaction: input.interaction,
    routedSurface: 'agent-conversation',
  };
}
