import { invokeChecked } from '../../bridge/runtime-bridge/invoke.js';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';

type AgentConversationLauncherInput = {
  target: AgentLocalTargetSnapshot;
  initialComposerText?: string | null;
  messageId?: string | null;
};

export type AgentInteractionLaunchResult = {
  interaction: 'chat';
  routedSurface: 'zhiyu';
};

export async function launchAgentConversationFromDisplay(
  input: AgentConversationLauncherInput,
): Promise<AgentInteractionLaunchResult> {
  const conversationAnchorId = input.target.conversationAnchorId;
  if (!input.target.agentHandle || !conversationAnchorId) throw new Error('Canonical Agent target requires agentHandle and Conversation anchor.');

  const text = input.initialComposerText ?? '';
  await invokeChecked('bundled_zhiyu_open', { target: {
    conversationAnchorId, ...(input.messageId ? { messageId: input.messageId } : {}), ...(text ? { text } : {}),
  } }, value => {
    if (!value || typeof value !== 'object' || (value as { opened?: unknown }).opened !== true) throw new Error('Zhiyu did not open this conversation.');
    return value;
  });

  return {
    interaction: 'chat',
    routedSurface: 'zhiyu',
  };
}
