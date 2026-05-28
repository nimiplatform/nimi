import type { AgentLocalThreadBundle } from '@renderer/bridge/runtime-bridge/types';
import type { AgentConversationSelection } from './chat-shell-types';

type AgentTurnTerminalState = 'running' | 'completed' | 'failed' | 'canceled';

export type AgentProjectionRefreshOutcome = {
  bundle: AgentLocalThreadBundle;
  selection: AgentConversationSelection;
};

export function resolveAgentProjectionRefreshOutcome(input: {
  terminal: AgentTurnTerminalState;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
}): AgentProjectionRefreshOutcome | null {
  if (!input.refreshedBundle) {
    return null;
  }
  if (input.terminal === 'failed' || input.terminal === 'canceled') {
    return null;
  }
  return {
    bundle: input.refreshedBundle,
    selection: {
      threadId: input.refreshedBundle.thread.id,
      localAgentRef: input.refreshedBundle.thread.localAgentRef,
      targetId: input.refreshedBundle.thread.localAgentRef,
    },
  };
}
