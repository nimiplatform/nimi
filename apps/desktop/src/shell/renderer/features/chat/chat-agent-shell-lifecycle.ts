import type {
  ConversationTurnError,
  ConversationTurnEvent,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import {
  parseAgentModelOutputDiagnostics,
  type AgentModelOutputDiagnostics,
} from './chat-agent-behavior-resolver';

type AgentTurnTerminalState = 'running' | 'completed' | 'failed' | 'canceled';

export type AgentRuntimeChatLifecycleEvidence = {
  transport: 'runtime.agent.turns';
  conversationAnchorId: string | null;
  runtimeTurnId: string | null;
  runtimeStreamId: string | null;
  route: string | null;
  modelId: string | null;
  connectorId: string | null;
};

export type AgentTurnLifecycleState = {
  projectionVersion: string | null;
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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeReasoningText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseRuntimeAgentTurnsLifecycleEvidence(value: unknown): AgentRuntimeChatLifecycleEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const nested = record.runtimeAgentTurns && typeof record.runtimeAgentTurns === 'object' && !Array.isArray(record.runtimeAgentTurns)
    ? record.runtimeAgentTurns as Record<string, unknown>
    : record;
  const transport = normalizeText(nested.transport);
  if (transport !== 'runtime.agent.turns') {
    return null;
  }
  return {
    transport: 'runtime.agent.turns',
    conversationAnchorId: normalizeText(nested.conversationAnchorId) || null,
    runtimeTurnId: normalizeText(nested.runtimeTurnId) || null,
    runtimeStreamId: normalizeText(nested.runtimeStreamId) || null,
    route: normalizeText(nested.route) || null,
    modelId: normalizeText(nested.modelId) || null,
    connectorId: normalizeText(nested.connectorId) || null,
  };
}

export function createInitialAgentTurnLifecycleState(): AgentTurnLifecycleState {
  return {
    projectionVersion: null,
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

export function reduceAgentTurnLifecycleState(
  state: AgentTurnLifecycleState,
  event: ConversationTurnEvent,
): AgentTurnLifecycleState {
  switch (event.type) {
    case 'projection-rebuilt':
      return {
        ...state,
        projectionVersion: event.projectionVersion,
      };
    case 'turn-completed':
      return {
        ...state,
        terminal: 'completed',
        outputText: event.outputText,
        reasoningText: normalizeReasoningText(event.reasoningText) || state.reasoningText,
        traceId: normalizeText(event.trace?.traceId) || state.traceId,
        promptTraceId: normalizeText(event.trace?.promptTraceId) || state.promptTraceId,
        runtimeAgentTurns: parseRuntimeAgentTurnsLifecycleEvidence(event.diagnostics) || state.runtimeAgentTurns,
        usage: event.usage,
        diagnostics: parseAgentModelOutputDiagnostics(event.diagnostics) || state.diagnostics,
      };
    case 'turn-failed':
      return {
        ...state,
        terminal: 'failed',
        outputText: normalizeText(event.outputText) || state.outputText,
        reasoningText: normalizeReasoningText(event.reasoningText) || state.reasoningText,
        traceId: normalizeText(event.trace?.traceId) || state.traceId,
        promptTraceId: normalizeText(event.trace?.promptTraceId) || state.promptTraceId,
        runtimeAgentTurns: parseRuntimeAgentTurnsLifecycleEvidence(event.diagnostics) || state.runtimeAgentTurns,
        error: event.error,
        usage: event.usage || state.usage,
        diagnostics: parseAgentModelOutputDiagnostics(event.diagnostics) || state.diagnostics,
      };
    case 'turn-canceled':
      return {
        ...state,
        terminal: 'canceled',
        outputText: normalizeText(event.outputText) || state.outputText,
        reasoningText: normalizeReasoningText(event.reasoningText) || state.reasoningText,
        traceId: normalizeText(event.trace?.traceId) || state.traceId,
        promptTraceId: normalizeText(event.trace?.promptTraceId) || state.promptTraceId,
        runtimeAgentTurns: parseRuntimeAgentTurnsLifecycleEvidence(event.diagnostics) || state.runtimeAgentTurns,
        usage: event.usage || state.usage,
        diagnostics: parseAgentModelOutputDiagnostics(event.diagnostics) || state.diagnostics,
      };
    default:
      return state;
  }
}

export function assertAgentTurnLifecycleCompleted(
  state: AgentTurnLifecycleState,
): AgentTurnLifecycleState & { terminal: 'completed' } {
  if (state.terminal !== 'completed') {
    throw new Error('agent-local-chat-v1 provider completed without a terminal success event');
  }
  return state as AgentTurnLifecycleState & { terminal: 'completed' };
}
