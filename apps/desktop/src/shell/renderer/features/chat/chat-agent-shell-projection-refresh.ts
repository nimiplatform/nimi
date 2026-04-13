import type { AgentLocalThreadBundle } from '@renderer/bridge/runtime-bridge/types';
import type { AgentConversationSelection } from './chat-shell-types';

type AgentTurnTerminalState = 'running' | 'completed' | 'failed' | 'canceled';

export type AgentProjectionRefreshOutcome = {
  bundle: AgentLocalThreadBundle;
  selection: AgentConversationSelection;
};

export function resolveAgentProjectionRefreshOutcome(input: {
  requestedProjectionVersion: string;
  latestProjectionVersion: string | null;
  terminal: AgentTurnTerminalState;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
}): AgentProjectionRefreshOutcome | null {
  if (!input.refreshedBundle) {
    return null;
  }
  if (input.terminal === 'failed' || input.terminal === 'canceled') {
    return null;
  }
  if (input.latestProjectionVersion !== input.requestedProjectionVersion) {
    return null;
  }
  return {
    bundle: input.refreshedBundle,
    selection: {
      threadId: input.refreshedBundle.thread.id,
      agentId: input.refreshedBundle.thread.agentId,
      targetId: input.refreshedBundle.thread.agentId,
    },
  };
}
