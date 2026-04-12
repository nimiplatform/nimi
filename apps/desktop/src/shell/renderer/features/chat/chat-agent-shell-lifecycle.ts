import type {
  ConversationTurnError,
  ConversationTurnEvent,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import {
  parseAgentModelOutputDiagnostics,
  type AgentModelOutputDiagnostics,
} from './chat-agent-behavior-resolver';

type AgentTurnTerminalState = 'running' | 'completed' | 'failed' | 'canceled';

export type AgentTurnLifecycleState = {
  projectionVersion: string | null;
  terminal: AgentTurnTerminalState;
  outputText: string;
  reasoningText: string;
  traceId: string | null;
  promptTraceId: string | null;
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

export function createInitialAgentTurnLifecycleState(): AgentTurnLifecycleState {
  return {
    projectionVersion: null,
    terminal: 'running',
    outputText: '',
    reasoningText: '',
    traceId: null,
    promptTraceId: null,
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
