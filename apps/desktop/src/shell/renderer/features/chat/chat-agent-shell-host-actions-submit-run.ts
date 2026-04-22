import {
  matchConversationTurnEvent,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import type {
  AgentLocalThreadBundle,
} from '@renderer/bridge/runtime-bridge/types';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import {
  assertAgentTurnLifecycleCompleted,
} from './chat-agent-shell-lifecycle';
import {
  reduceAgentSubmitDriverEvent,
  resolveCompletedAgentSubmitDriverCheckpoint,
  resolveAgentSubmitDriverProjectionRefresh,
} from './chat-agent-shell-submit-driver';
import {
  getStreamState,
} from '../turns/stream-controller';
import {
  toAbortError,
  toStructuredProviderError,
} from './chat-agent-shell-core';
import type { AgentSubmitDriverState } from './chat-agent-shell-submit-driver';
import type {
  ActiveAgentSubmit,
  UseAgentConversationHostActionsInput,
} from './chat-agent-shell-host-actions-types';

export async function runActiveAgentSubmit(input: {
  activeSubmit: ActiveAgentSubmit;
  input: UseAgentConversationHostActionsInput;
  threadId: string;
  conversationAnchorId: string;
  turnId: string;
  userMessage: {
    id: string;
    text: string;
    attachments: Parameters<UseAgentConversationHostActionsInput['runAgentTurn']>[0]['userMessage']['attachments'];
  };
  history: Parameters<UseAgentConversationHostActionsInput['runAgentTurn']>[0]['history'];
  signal: AbortSignal;
  agentResolution: Parameters<UseAgentConversationHostActionsInput['runAgentTurn']>[0]['agentResolution'];
  textExecutionSnapshot: Parameters<UseAgentConversationHostActionsInput['runAgentTurn']>[0]['textExecutionSnapshot'];
  imageExecutionSnapshot: Parameters<UseAgentConversationHostActionsInput['runAgentTurn']>[0]['imageExecutionSnapshot'];
  voiceExecutionSnapshot: Parameters<UseAgentConversationHostActionsInput['runAgentTurn']>[0]['voiceExecutionSnapshot'];
  voiceWorkflowExecutionSnapshotByCapability: Parameters<UseAgentConversationHostActionsInput['runAgentTurn']>[0]['voiceWorkflowExecutionSnapshotByCapability'];
  latestVoiceCapture: Parameters<UseAgentConversationHostActionsInput['runAgentTurn']>[0]['latestVoiceCapture'];
  textModelContextTokens: number | null;
  textMaxOutputTokensRequested: number | null;
  target: Parameters<UseAgentConversationHostActionsInput['runAgentTurn']>[0]['target'];
  submitSession: AgentSubmitDriverState;
  currentDraftText: () => string;
  releaseSubmittingIfCurrent: () => void;
}): Promise<AgentSubmitDriverState> {
  let submitSession = input.submitSession;
  let submittingReleasedForVisibleMessage = false;

  for await (const event of input.input.runAgentTurn({
    threadId: input.threadId,
    conversationAnchorId: input.conversationAnchorId,
    turnId: input.turnId,
    userMessage: input.userMessage,
    history: input.history,
    signal: input.signal,
    agentResolution: input.agentResolution,
    textExecutionSnapshot: input.textExecutionSnapshot,
    imageExecutionSnapshot: input.imageExecutionSnapshot,
    voiceExecutionSnapshot: input.voiceExecutionSnapshot,
    voiceWorkflowExecutionSnapshotByCapability: input.voiceWorkflowExecutionSnapshotByCapability,
    latestVoiceCapture: input.latestVoiceCapture,
    textModelContextTokens: input.textModelContextTokens,
    textMaxOutputTokensRequested: input.textMaxOutputTokensRequested,
    target: input.target,
  })) {
    if (event.type === 'message-sealed' && !submittingReleasedForVisibleMessage) {
      submittingReleasedForVisibleMessage = true;
      input.activeSubmit.interruptible = true;
      input.releaseSubmittingIfCurrent();
    }
    if (event.type === 'projection-rebuilt') {
      const projectionEffects = reduceAgentSubmitDriverEvent({
        state: submitSession,
        event,
        updatedAtMs: Date.now(),
      });
      submitSession = input.input.applyDriverEffects(input.threadId, projectionEffects);
      if (projectionEffects.awaitRefresh) {
        const rebuiltBundle = event.bundle && typeof event.bundle === 'object'
          ? event.bundle as AgentLocalThreadBundle
          : null;
        const refreshedBundle = rebuiltBundle || await chatAgentStoreClient.getThreadBundle(input.threadId);
        submitSession = input.input.applyDriverEffects(input.threadId, resolveAgentSubmitDriverProjectionRefresh({
          state: submitSession,
          requestedProjectionVersion: projectionEffects.awaitRefresh.requestedProjectionVersion,
          streamSnapshot: getStreamState(input.threadId),
          refreshedBundle,
          draftText: input.currentDraftText(),
        }));
      }
      continue;
    }
    matchConversationTurnEvent(event, {
      'turn-started': () => undefined,
      'reasoning-delta': (nextEvent) => {
        submitSession = input.input.applyDriverEffects(input.threadId, reduceAgentSubmitDriverEvent({
          state: submitSession,
          event: nextEvent,
          updatedAtMs: Date.now(),
        }));
      },
      'text-delta': (nextEvent) => {
        submitSession = input.input.applyDriverEffects(input.threadId, reduceAgentSubmitDriverEvent({
          state: submitSession,
          event: nextEvent,
          updatedAtMs: Date.now(),
        }));
      },
      'message-sealed': (nextEvent) => {
        submitSession = input.input.applyDriverEffects(input.threadId, reduceAgentSubmitDriverEvent({
          state: submitSession,
          event: nextEvent,
          updatedAtMs: Date.now(),
        }));
      },
      'beat-planned': (nextEvent) => {
        submitSession = input.input.applyDriverEffects(input.threadId, reduceAgentSubmitDriverEvent({
          state: submitSession,
          event: nextEvent,
          updatedAtMs: Date.now(),
        }));
      },
      'beat-delivery-started': () => undefined,
      'beat-delivered': () => undefined,
      'artifact-ready': () => undefined,
      'projection-rebuilt': () => undefined,
      'turn-completed': (nextEvent) => {
        submitSession = input.input.applyDriverEffects(input.threadId, reduceAgentSubmitDriverEvent({
          state: submitSession,
          event: nextEvent,
          updatedAtMs: Date.now(),
        }));
      },
      'turn-failed': (nextEvent) => {
        submitSession = input.input.applyDriverEffects(input.threadId, reduceAgentSubmitDriverEvent({
          state: submitSession,
          event: nextEvent,
          updatedAtMs: Date.now(),
        }));
      },
      'turn-canceled': (nextEvent) => {
        submitSession = input.input.applyDriverEffects(input.threadId, reduceAgentSubmitDriverEvent({
          state: submitSession,
          event: nextEvent,
          updatedAtMs: Date.now(),
        }));
      },
    });
  }

  const refreshedBundle = submitSession.lifecycle.projectionVersion
    ? await chatAgentStoreClient.getThreadBundle(input.threadId)
    : null;
  submitSession = input.input.applyDriverEffects(input.threadId, resolveCompletedAgentSubmitDriverCheckpoint({
    state: submitSession,
    refreshedBundle,
    streamSnapshot: getStreamState(input.threadId),
  }));

  if (submitSession.lifecycle.terminal === 'failed' && submitSession.lifecycle.error) {
    throw toStructuredProviderError(submitSession.lifecycle.error);
  }
  if (submitSession.lifecycle.terminal === 'canceled') {
    if (input.activeSubmit.overrideRequested) {
      return submitSession;
    }
    throw toAbortError(input.input.t('Chat.agentGenerationStopped', { defaultValue: 'Generation stopped.' }));
  }
  assertAgentTurnLifecycleCompleted(submitSession.lifecycle);
  return submitSession;
}
