import type { ConversationTurnError } from '@nimiplatform/kit/features/chat/headless';
import type { AgentModelOutputDiagnostics } from './chat-agent-runtime-output-types';

type AgentTurnTerminalState = 'running' | 'completed' | 'failed' | 'canceled';

export type AgentRuntimeChatLifecycleEvidence = {
  transport: 'runtime.agent.turns';
  conversationAnchorId: string | null;
  runtimeTurnId: string | null;
  runtimeStreamId: string | null;
};

export type AgentTurnLifecycleState = {
  terminal: AgentTurnTerminalState;
  outputText: string;
  reasoningText: string;
  traceId: string | null;
  promptTraceId: string | null;
  runtimeAgentTurns: AgentRuntimeChatLifecycleEvidence | null;
  error: ConversationTurnError | null;
  usage: { inputTokens?: number; outputTokens?: number } | undefined;
  diagnostics: AgentModelOutputDiagnostics | null;
};

export function createInitialAgentTurnLifecycleState(): AgentTurnLifecycleState {
  return {
    terminal: 'running',
    outputText: '',
    reasoningText: '',
    traceId: null,
    promptTraceId: null,
    runtimeAgentTurns: null,
    error: null,
    usage: undefined,
    diagnostics: null,
  };
}
