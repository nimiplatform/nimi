import type { ChatComposerVoiceState } from '@nimiplatform/nimi-kit/features/chat';

export type AgentVoiceSessionMode = 'push-to-talk' | 'hands-free';

export type AgentVoiceSessionShellState =
  | { status: 'idle'; mode: AgentVoiceSessionMode; message: null }
  | { status: 'listening'; mode: AgentVoiceSessionMode; message: null }
  | { status: 'transcribing'; mode: AgentVoiceSessionMode; message: null }
  | { status: 'failed'; mode: AgentVoiceSessionMode; message: string };

export function createInitialAgentVoiceSessionShellState(): AgentVoiceSessionShellState {
  return {
    status: 'idle',
    mode: 'push-to-talk',
    message: null,
  };
}

export function createForegroundHandsFreeAgentVoiceSessionShellState(): AgentVoiceSessionShellState {
  return {
    status: 'idle',
    mode: 'hands-free',
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
