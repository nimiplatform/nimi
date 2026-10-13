import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
import type { AppStoreState } from '../../app-shell/providers/store-types';
import type { HomeNavigation } from '../../app-shell/providers/home-navigation.js';
import { projectCanonicalAgentTargetSnapshot } from './chat-agent-thread-model.js';

type AgentConversationLauncherInput = {
  target: AgentLocalTargetSnapshot;
  initialComposerText?: string | null;
  navigation: HomeNavigation;
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

  const generation = input.navigation.getSnapshot().generation;
  const result = await input.navigation.push({ id: 'chat', chat: { mode: 'agent', agentHandle, conversationAnchorId, targetId: agentHandle } });
  if (result.status !== 'committed' && result.status !== 'unchanged') throw new Error(`Chat navigation was ${result.status}.`);
  if (input.navigation.getSnapshot().generation !== generation) throw new Error('Chat scope changed before the action completed.');
  input.setAgentConversationTargetSnapshot(target);
  const initialComposerText = String(input.initialComposerText || '').trim();
  if (initialComposerText) {
    input.setPendingAgentComposerPrefill?.({
      agentHandle,
      text: initialComposerText,
    });
  }

  return {
    interaction: input.interaction,
    routedSurface: 'agent-conversation',
  };
}
