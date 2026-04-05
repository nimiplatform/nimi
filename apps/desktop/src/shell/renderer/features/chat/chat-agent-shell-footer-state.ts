import type { AgentHostFlowFooterState } from './chat-agent-shell-host-flow';
import type { AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import type { StreamState } from '../turns/stream-controller';

export type AgentFooterDisplayState = 'streaming' | 'interrupted' | 'hidden';

export type AgentFooterViewState = {
  displayState: AgentFooterDisplayState;
  pendingFirstBeat: boolean;
};

function isStreamingState(streamState: StreamState | null): boolean {
  return streamState?.phase === 'waiting' || streamState?.phase === 'streaming';
}

function isInterruptedState(streamState: StreamState | null): boolean {
  return Boolean(
    streamState
    && (streamState.phase === 'error' || streamState.phase === 'cancelled')
    && streamState.interrupted,
  );
}

export function resolveAgentFooterViewState(input: {
  streamState: StreamState | null;
  lifecycle: AgentTurnLifecycleState;
  currentHostFooterState: AgentHostFlowFooterState;
}): AgentFooterViewState {
  const pendingFirstBeat = Boolean(
    input.streamState
    && input.streamState.phase === 'waiting'
    && !input.streamState.partialText
    && !input.streamState.partialReasoningText,
  );

  if (isStreamingState(input.streamState)) {
    return {
      displayState: 'streaming',
      pendingFirstBeat,
    };
  }

  if (input.currentHostFooterState === 'done' || input.lifecycle.terminal === 'completed') {
    return {
      displayState: 'hidden',
      pendingFirstBeat: false,
    };
  }

  if (isInterruptedState(input.streamState)) {
    return {
      displayState: 'interrupted',
      pendingFirstBeat: false,
    };
  }

  return {
    displayState: 'hidden',
    pendingFirstBeat: false,
  };
}
