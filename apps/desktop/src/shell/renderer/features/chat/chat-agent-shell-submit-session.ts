import type {
  AgentLocalDraftRecord,
  AgentLocalMessageError,
  AgentLocalMessageRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '@renderer/bridge/runtime-bridge/types';
import type { ConversationTurnEvent } from '@nimiplatform/nimi-kit/features/chat/headless';
import {
  createEmptyAgentThreadBundle,
  overlayAgentAssistantVisibleState,
  replaceAgentBundleMessage,
} from './chat-agent-shell-bundle';
import {
  resolveCompletedAgentHostInteraction,
  resolveInterruptedAgentHostInteraction,
  resolveProjectionRefreshAgentHostInteraction,
  type AgentHostInteractionPatch,
} from './chat-agent-shell-host-interaction';
import {
  createInitialAgentTurnLifecycleState,
  reduceAgentTurnLifecycleState,
  type AgentTurnLifecycleState,
} from './chat-agent-shell-lifecycle';
import type {
  StreamEvent,
  StreamState,
} from '../turns/stream-controller';

const VISIBLE_BUNDLE_FLUSH_CHARS = 32;

export type AgentSubmitSessionState = {
  fallbackThread: AgentLocalThreadRecord;
  assistantMessageId: string;
  assistantPlaceholder: AgentLocalMessageRecord;
  submittedText: string;
  streamedText: string;
  streamedReasoningText: string;
  runtimeTraceId: string | null;
  promptTraceId: string | null;
  assistantVisible: boolean;
  workingBundle: AgentLocalThreadBundle | null;
  lifecycle: AgentTurnLifecycleState;
  lastBundleFlushLength: number;
};

export type AgentSubmitSessionStep = {
  state: AgentSubmitSessionState;
  streamEvent?: StreamEvent;
  visibleBundle?: AgentLocalThreadBundle;
};

export type AgentSubmitSessionProjectionRefreshResult = {
  state: AgentSubmitSessionState;
  hostInteractionPatch: AgentHostInteractionPatch | null;
};

export type AgentSubmitSessionCompletedResult = {
  state: AgentSubmitSessionState;
  hostInteractionPatch: AgentHostInteractionPatch | null;
};

export type AgentSubmitSessionInterruptedResult = {
  state: AgentSubmitSessionState;
  errorStreamEvent?: StreamEvent;
  hostInteractionPatch: AgentHostInteractionPatch;
};

function syncSessionLifecycle(
  state: AgentSubmitSessionState,
  lifecycle: AgentTurnLifecycleState,
): AgentSubmitSessionState {
  if (
    lifecycle === state.lifecycle
    && lifecycle.traceId === state.runtimeTraceId
    && lifecycle.promptTraceId === state.promptTraceId
  ) {
    return state;
  }
  return {
    ...state,
    lifecycle,
    streamedText: lifecycle.outputText || state.streamedText,
    streamedReasoningText: lifecycle.reasoningText || state.streamedReasoningText,
    runtimeTraceId: lifecycle.traceId || state.runtimeTraceId,
    promptTraceId: lifecycle.promptTraceId || state.promptTraceId,
  };
}

function createVisibleBundle(
  state: AgentSubmitSessionState,
  input: {
    partialText: string;
    partialReasoningText: string;
    updatedAtMs: number;
  },
): AgentLocalThreadBundle {
  return overlayAgentAssistantVisibleState({
    bundle: state.workingBundle,
    fallbackThread: state.fallbackThread,
    assistantMessageId: state.assistantMessageId,
    assistantPlaceholder: state.assistantPlaceholder,
    partialText: input.partialText,
    partialReasoningText: input.partialReasoningText,
    updatedAtMs: input.updatedAtMs,
  });
}

function overlayPendingImageBeat(input: {
  state: AgentSubmitSessionState;
  beatIndex: number;
  updatedAtMs: number;
}): AgentLocalThreadBundle {
  const base = input.state.workingBundle || createEmptyAgentThreadBundle(input.state.fallbackThread);
  const messageId = `${input.state.assistantMessageId.split(':message:')[0]}:message:${input.beatIndex}`;
  return {
    ...base,
    messages: replaceAgentBundleMessage(base.messages, {
      id: messageId,
      threadId: base.thread.id,
      role: 'assistant',
      status: 'pending',
      kind: 'image',
      contentText: 'Generating image...',
      reasoningText: null,
      error: null,
      traceId: null,
      parentMessageId: input.state.assistantMessageId,
      mediaUrl: null,
      mediaMimeType: null,
      artifactId: null,
      metadataJson: null,
      createdAtMs: input.updatedAtMs,
      updatedAtMs: input.updatedAtMs,
    }),
  };
}

function resolveTraceId(
  state: AgentSubmitSessionState,
  streamSnapshot: StreamState,
): string | null {
  return streamSnapshot.traceId
    || state.lifecycle.traceId
    || state.runtimeTraceId
    || state.promptTraceId
    || null;
}

export function createInitialAgentSubmitSessionState(input: {
  fallbackThread: AgentLocalThreadRecord;
  assistantMessageId: string;
  assistantPlaceholder: AgentLocalMessageRecord;
  submittedText: string;
  workingBundle: AgentLocalThreadBundle | null;
}): AgentSubmitSessionState {
  return {
    fallbackThread: input.fallbackThread,
    assistantMessageId: input.assistantMessageId,
    assistantPlaceholder: input.assistantPlaceholder,
    submittedText: input.submittedText,
    streamedText: '',
    streamedReasoningText: '',
    runtimeTraceId: null,
    promptTraceId: null,
    assistantVisible: false,
    workingBundle: input.workingBundle,
    lifecycle: createInitialAgentTurnLifecycleState(),
    lastBundleFlushLength: 0,
  };
}

export function reduceAgentSubmitSessionEvent(
  state: AgentSubmitSessionState,
  input: {
    event: ConversationTurnEvent;
    updatedAtMs: number;
  },
): AgentSubmitSessionStep {
  switch (input.event.type) {
    case 'turn-started':
    case 'beat-delivery-started':
    case 'beat-delivered':
    case 'artifact-ready':
      return { state };
    case 'beat-planned': {
      if (input.event.modality !== 'image') {
        return { state };
      }
      const pendingImageBundle = overlayPendingImageBeat({
        state,
        beatIndex: input.event.beatIndex,
        updatedAtMs: input.updatedAtMs,
      });
      return {
        state: {
          ...state,
          workingBundle: pendingImageBundle,
        },
        visibleBundle: pendingImageBundle,
      };
    }
    case 'reasoning-delta':
      return {
        state: {
          ...state,
          streamedReasoningText: state.streamedReasoningText + input.event.textDelta,
        },
        streamEvent: {
          type: 'reasoning_delta',
          textDelta: input.event.textDelta,
        },
      };
    case 'text-delta': {
      const nextStreamedText = state.streamedText + input.event.textDelta;
      const nextStateBase = {
        ...state,
        streamedText: nextStreamedText,
      };
      if (!nextStateBase.assistantVisible) {
        return {
          state: nextStateBase,
          streamEvent: {
            type: 'text_delta',
            textDelta: input.event.textDelta,
          },
        };
      }
      const shouldFlush = nextStreamedText.length - state.lastBundleFlushLength >= VISIBLE_BUNDLE_FLUSH_CHARS;
      if (!shouldFlush) {
        return {
          state: nextStateBase,
          streamEvent: {
            type: 'text_delta',
            textDelta: input.event.textDelta,
          },
        };
      }
      const visibleBundle = createVisibleBundle(nextStateBase, {
        partialText: nextStreamedText,
        partialReasoningText: nextStateBase.streamedReasoningText,
        updatedAtMs: input.updatedAtMs,
      });
      return {
        state: {
          ...nextStateBase,
          workingBundle: visibleBundle,
          lastBundleFlushLength: nextStreamedText.length,
        },
        streamEvent: {
          type: 'text_delta',
          textDelta: input.event.textDelta,
        },
        visibleBundle,
      };
    }
    case 'message-sealed': {
      const sealedText = input.event.text || state.streamedText;
      const visibleBundle = createVisibleBundle({
        ...state,
        assistantVisible: true,
        streamedText: sealedText,
      }, {
        partialText: input.event.text,
        partialReasoningText: '',
        updatedAtMs: input.updatedAtMs,
      });
      return {
        state: {
          ...state,
          assistantVisible: true,
          streamedText: sealedText,
          workingBundle: visibleBundle,
        },
        visibleBundle,
      };
    }
    case 'projection-rebuilt':
      return {
        state: {
          ...state,
          lifecycle: reduceAgentTurnLifecycleState(state.lifecycle, input.event),
        },
      };
    case 'turn-completed': {
      const nextState = syncSessionLifecycle(
        state,
        reduceAgentTurnLifecycleState(state.lifecycle, input.event),
      );
      return {
        state: nextState,
        streamEvent: {
          type: 'done',
          usage: input.event.usage,
          finalText: input.event.outputText,
          finalReasoningText: input.event.reasoningText || undefined,
        },
      };
    }
    case 'turn-failed':
    case 'turn-canceled':
      return {
        state: syncSessionLifecycle(
          state,
          reduceAgentTurnLifecycleState(state.lifecycle, input.event),
        ),
      };
    default:
      return { state };
  }
}

export function resolveProjectionRefreshAgentSubmitSession(input: {
  state: AgentSubmitSessionState;
  requestedProjectionVersion: string;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  draftText: string;
  streamSnapshot: StreamState;
}): AgentSubmitSessionProjectionRefreshResult {
  const hostInteractionPatch = resolveProjectionRefreshAgentHostInteraction({
    requestedProjectionVersion: input.requestedProjectionVersion,
    latestProjectionVersion: input.state.lifecycle.projectionVersion,
    lifecycle: input.state.lifecycle,
    streamSnapshot: input.streamSnapshot,
    refreshedBundle: input.refreshedBundle,
    draftText: input.draftText,
  });
  if (!hostInteractionPatch) {
    return {
      state: input.state,
      hostInteractionPatch: null,
    };
  }
  return {
    state: {
      ...input.state,
      workingBundle: hostInteractionPatch.bundle,
    },
    hostInteractionPatch,
  };
}

export function resolveCompletedAgentSubmitSession(input: {
  state: AgentSubmitSessionState;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  streamSnapshot: StreamState;
}): AgentSubmitSessionCompletedResult {
  const hostInteractionPatch = resolveCompletedAgentHostInteraction({
    optimisticBundle: input.state.workingBundle,
    refreshedBundle: input.refreshedBundle,
    lifecycle: input.state.lifecycle,
    streamSnapshot: input.streamSnapshot,
  });
  if (!hostInteractionPatch) {
    return {
      state: input.state,
      hostInteractionPatch: null,
    };
  }
  return {
    state: {
      ...input.state,
      workingBundle: hostInteractionPatch.bundle,
    },
    hostInteractionPatch,
  };
}

export function resolveInterruptedAgentSubmitSession(input: {
  state: AgentSubmitSessionState;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  runtimeError: AgentLocalMessageError;
  draft: AgentLocalDraftRecord;
  updatedAtMs: number;
  streamSnapshot: StreamState;
}): AgentSubmitSessionInterruptedResult {
  const traceId = resolveTraceId(input.state, input.streamSnapshot);
  const interruptedStreamSnapshot = (
    input.streamSnapshot.phase === 'waiting' || input.streamSnapshot.phase === 'streaming'
  )
    ? {
      ...input.streamSnapshot,
      phase: 'error' as const,
      errorMessage: input.runtimeError.message,
      interrupted: true,
      reasonCode: input.runtimeError.code || null,
      traceId,
    }
    : input.streamSnapshot;
  const errorStreamEvent = (
    input.streamSnapshot.phase === 'waiting' || input.streamSnapshot.phase === 'streaming'
  )
    ? {
      type: 'error' as const,
      message: input.runtimeError.message,
      reasonCode: input.runtimeError.code,
      traceId: traceId || undefined,
    }
    : undefined;

  const hostInteractionPatch = resolveInterruptedAgentHostInteraction({
    optimisticBundle: input.state.workingBundle,
    refreshedBundle: input.refreshedBundle,
    fallbackThread: input.state.fallbackThread,
    assistantMessageId: input.state.assistantMessageId,
    assistantPlaceholder: input.state.assistantPlaceholder,
    partialText: interruptedStreamSnapshot.partialText || input.state.streamedText,
    partialReasoningText: interruptedStreamSnapshot.partialReasoningText || input.state.streamedReasoningText,
    runtimeError: input.runtimeError,
    traceId,
    draft: input.draft,
    submittedText: input.state.submittedText,
    updatedAtMs: input.updatedAtMs,
    lifecycle: input.state.lifecycle,
    streamSnapshot: interruptedStreamSnapshot,
  });

  return {
    state: {
      ...input.state,
      workingBundle: hostInteractionPatch.bundle,
    },
    errorStreamEvent,
    hostInteractionPatch,
  };
}
