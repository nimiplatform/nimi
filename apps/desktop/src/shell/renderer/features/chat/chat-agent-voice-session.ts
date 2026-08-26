import type { ChatComposerVoiceState } from '@nimiplatform/kit/features/chat/types';

export type AgentVoiceSessionMode = 'push-to-talk' | 'hands-free';

export type AgentVoiceSessionShellState =
  | { status: 'idle'; mode: AgentVoiceSessionMode; conversationAnchorId: null; message: null }
  | { status: 'listening'; mode: AgentVoiceSessionMode; conversationAnchorId: string; message: null }
  | { status: 'transcribing'; mode: AgentVoiceSessionMode; conversationAnchorId: string; message: null }
  | { status: 'playing'; mode: AgentVoiceSessionMode; conversationAnchorId: string; message: null }
  | { status: 'failed'; mode: AgentVoiceSessionMode; conversationAnchorId: string | null; message: string };

export type AgentVoiceTranscriptProjection = {
  readonly text: string;
  readonly final: boolean;
};

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
  transcript?: AgentVoiceTranscriptProjection | null;
}): ChatComposerVoiceState {
  return {
    status: input.state.status === 'listening'
      ? 'recording'
      : input.state.status === 'transcribing'
        ? 'transcribing'
        : input.state.status === 'playing'
          ? 'playing'
        : input.state.status === 'failed'
          ? 'failed'
          : 'idle',
    onToggle: input.onToggle,
    onCancel: input.onCancel,
    transcript: input.transcript || null,
  };
}
