import type { ChatComposerVoiceState } from '@nimiplatform/nimi-kit/features/chat';
import type { ChatAgentVoiceWorkflowReferenceAudio } from './chat-agent-runtime';

export type AgentVoiceSessionMode = 'push-to-talk' | 'hands-free';

export type AgentVoiceSessionAnchorBoundReferenceAudio = ChatAgentVoiceWorkflowReferenceAudio & {
  conversationAnchorId: string;
};

export type AgentVoiceSessionShellState =
  | { status: 'idle'; mode: AgentVoiceSessionMode; conversationAnchorId: null; message: null }
  | { status: 'listening'; mode: AgentVoiceSessionMode; conversationAnchorId: string; message: null }
  | { status: 'transcribing'; mode: AgentVoiceSessionMode; conversationAnchorId: string; message: null }
  | { status: 'failed'; mode: AgentVoiceSessionMode; conversationAnchorId: string | null; message: string };

export function normalizeAgentVoiceSessionConversationAnchorId(
  value: string | null | undefined,
): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

export function createInitialAgentVoiceSessionShellState(): AgentVoiceSessionShellState {
  return {
    status: 'idle',
    mode: 'push-to-talk',
    conversationAnchorId: null,
    message: null,
  };
}

export function createForegroundHandsFreeAgentVoiceSessionShellState(): AgentVoiceSessionShellState {
  return {
    status: 'idle',
    mode: 'hands-free',
    conversationAnchorId: null,
    message: null,
  };
}

export function resolveIdleAgentVoiceSessionShellState(
  mode: AgentVoiceSessionMode,
): AgentVoiceSessionShellState {
  return mode === 'hands-free'
    ? createForegroundHandsFreeAgentVoiceSessionShellState()
    : createInitialAgentVoiceSessionShellState();
}

export function resolveAgentComposerVoiceState(input: {
  state: AgentVoiceSessionShellState;
  onToggle: () => void;
  onCancel: () => void;
}): ChatComposerVoiceState {
  return {
    status: input.state.status === 'listening'
      ? 'recording'
      : input.state.status === 'transcribing'
        ? 'transcribing'
        : input.state.status === 'failed'
          ? 'failed'
          : 'idle',
    onToggle: input.onToggle,
    onCancel: input.onCancel,
  };
}
