import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
import type { AppStoreState } from '../../app-shell/providers/store-types';
import type { ConversationMode } from '@nimiplatform/kit/features/chat/headless';
import type { AgentConversationSelection } from './chat-shell-types.js';

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
	const agentHandle = String(input.target.agentHandle || '').trim();
	const conversationAnchorId = String(input.target.conversationAnchorId || '').trim();
	if (!agentHandle || !conversationAnchorId) {
	  throw new Error('Agent conversation launch requires a canonical Agent handle and Conversation anchor');
  }

  input.setAgentConversationTargetSnapshot(input.target);
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
