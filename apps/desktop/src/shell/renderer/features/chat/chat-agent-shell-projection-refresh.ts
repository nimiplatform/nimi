import type { AgentLocalThreadBundle } from '../../bridge/runtime-bridge/types';
import { resolveAuthoritativeAgentThreadBundle } from './chat-agent-shell-bundle';
import type { AgentConversationSelection } from './chat-shell-types';

type AgentTurnTerminalState = 'running' | 'completed' | 'failed' | 'canceled';

export type AgentProjectionRefreshOutcome = {
  bundle: AgentLocalThreadBundle;
  selection: AgentConversationSelection;
};

export function resolveAgentProjectionRefreshOutcome(input: {
  terminal: AgentTurnTerminalState;
  currentBundle?: AgentLocalThreadBundle | null | undefined;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
}): AgentProjectionRefreshOutcome | null {
  if (!input.refreshedBundle) {
    return null;
  }
  if (input.terminal === 'failed' || input.terminal === 'canceled') {
    return null;
  }
  const bundle = resolveAuthoritativeAgentThreadBundle({
    optimisticBundle: input.currentBundle,
    refreshedBundle: input.refreshedBundle,
  });
  if (!bundle || bundle !== input.refreshedBundle) {
    return null;
  }
  return {
    bundle,
    selection: {
      localAgentRef: bundle.thread.localAgentRef,
      targetId: bundle.thread.localAgentRef,
    },
  };
}
