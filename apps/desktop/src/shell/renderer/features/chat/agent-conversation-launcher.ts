import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import type { AppStoreState } from '@renderer/app-shell/providers/store-types';
import type { ConversationMode } from '@nimiplatform/kit/features/chat/headless';
import type { AgentConversationSelection } from './chat-shell-types.js';

type AgentConversationLauncherInput = {
  target: AgentLocalTargetSnapshot;
  setActiveTab: AppStoreState['setActiveTab'];
  setChatMode: AppStoreState['setChatMode'];
  setSelectedTargetForSource: (source: ConversationMode, targetId: string | null) => void;
  setAgentConversationSelection: (selection: AgentConversationSelection) => void;
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
  const localAgentRef = String(input.target.localAgentRef || '').trim();
  if (!localAgentRef) {
    throw new Error('Agent conversation launch requires localAgentRef');
  }

  input.setSelectedTargetForSource('agent', localAgentRef);
  input.setAgentConversationSelection({
    localAgentRef,
    targetId: localAgentRef,
  });
  input.setChatMode('agent');
  input.setActiveTab('chat');

  return {
    interaction: input.interaction,
    routedSurface: 'agent-conversation',
  };
}
