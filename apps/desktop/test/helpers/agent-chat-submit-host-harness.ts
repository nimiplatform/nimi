import { createElement, type ReactNode } from 'react';
import type {
  AgentLocalDraftRecord,
  AgentLocalMessageError,
  AgentLocalTargetSnapshot,
  AgentLocalThreadBundle,
  AgentLocalThreadSummary,
} from '../../src/shell/renderer/bridge/runtime-bridge/types.js';
import type { AgentConversationSelection } from '../../src/shell/renderer/features/chat/chat-shell-types.js';
import { toConversationMessageViewModel } from '../../src/shell/renderer/features/chat/chat-agent-thread-model.js';
import { createInitialAgentTurnLifecycleState } from '../../src/shell/renderer/features/chat/chat-agent-shell-lifecycle.js';
import {
  reduceAgentSubmitDriverEvent,
  resolveAgentSubmitDriverProjectionRefresh,
  resolveCompletedAgentSubmitDriverCheckpoint,
  resolveInterruptedAgentSubmitDriverCheckpoint,
  type AgentSubmitDriverEffectQueue,
  type AgentSubmitDriverState,
} from '../../src/shell/renderer/features/chat/chat-agent-shell-submit-driver.js';
import {
  clearStream,
  feedStreamEvent,
  getStreamState,
  startStream,
} from '../../src/shell/renderer/features/turns/stream-controller.js';
import { resolveAgentFooterViewState } from '../../src/shell/renderer/features/chat/chat-agent-shell-footer-state.js';
import { resolveAgentConversationSurfaceState } from '../../src/shell/renderer/features/chat/chat-agent-shell-visible-state.js';
import {
  resolveAgentCanonicalMessages,
  resolveAgentSelectedTargetId,
  resolveAgentTargetSummaries,
} from '../../src/shell/renderer/features/chat/chat-agent-shell-view-model.js';
import { resolveAgentConversationHostView } from '../../src/shell/renderer/features/chat/chat-agent-shell-host-view.js';
import { resolveAgentConversationHostSnapshot } from '../../src/shell/renderer/features/chat/chat-agent-shell-host-snapshot.js';
import type { CanonicalMessageContentSlot, ConversationMessageViewModel } from '@nimiplatform/nimi-kit/features/chat/headless';
import type { ConversationTurnEvent } from '@nimiplatform/nimi-kit/features/chat/headless';

export type AgentHostHarnessState = {
  bundles: Record<string, AgentLocalThreadBundle | null>;
  threads: AgentLocalThreadSummary[];
  selection: AgentConversationSelection;
  currentDraftText: string;
  footerByThreadId: Record<string, AgentSubmitFooterState>;
  submittingThreadId: string | null;
};

type AgentSubmitFooterState = {
  footerState: 'hidden' | 'interrupted' | 'done';
  lifecycle: AgentSubmitDriverState['lifecycle'];
};

export type AgentHostConsumerSnapshot = {
  footerViewState: ReturnType<typeof resolveAgentFooterViewState>;
  surfaceState: ReturnType<typeof resolveAgentConversationSurfaceState>;
  footerContent: ReactNode;
  hostSnapshot: ReturnType<typeof resolveAgentConversationHostSnapshot>;
};

const AGENT_THEME = {
  roomSurface: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.94))',
  roomAura: 'linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.90))',
  accentSoft: 'rgba(148,163,184,0.12)',
  accentStrong: '#475569',
  border: 'rgba(148,163,184,0.20)',
  text: '#0f172a',
} as const;

function isEmptyPendingAssistantMessage(message: ConversationMessageViewModel): boolean {
  if (message.role !== 'assistant' || message.status !== 'pending') {
    return false;
  }
  const reasoningText = typeof message.metadata?.reasoningText === 'string'
    ? message.metadata.reasoningText.trim()
    : '';
  return !message.text.trim() && !reasoningText && !message.error;
}

const renderMessageContent: CanonicalMessageContentSlot = () => null;

function upsertThreadSummary(
  threads: readonly AgentLocalThreadSummary[],
  nextThread: AgentLocalThreadSummary,
): AgentLocalThreadSummary[] {
  const filtered = threads.filter((thread) => thread.id !== nextThread.id);
  filtered.push(nextThread);
  return filtered;
}

export function createAgentHostHarness(input: {
  threadId: string;
  initialBundle: AgentLocalThreadBundle;
}): AgentHostHarnessState {
  return {
    bundles: {
      [input.threadId]: input.initialBundle,
    },
    threads: [input.initialBundle.thread],
    selection: {
      threadId: input.threadId,
      agentId: input.initialBundle.thread.agentId,
      targetId: input.initialBundle.thread.agentId,
    },
    currentDraftText: '',
    footerByThreadId: {},
    submittingThreadId: null,
  };
}

export function beginAgentHostSubmit(
  state: AgentHostHarnessState,
  input: {
    threadId: string;
    submittedText: string;
  },
): AbortController {
  state.submittingThreadId = input.threadId;
  state.currentDraftText = input.submittedText;
  delete state.footerByThreadId[input.threadId];
  return startStream(input.threadId);
}

export function finishAgentHostSubmit(state: AgentHostHarnessState) {
  state.submittingThreadId = null;
}

export function closeAgentHostHarness(threadId: string) {
  clearStream(threadId);
}

function applyHostInteractionPatch(
  state: AgentHostHarnessState,
  threadId: string,
  effects: AgentSubmitDriverEffectQueue,
) {
  if (effects.hostPatchEffect) {
    state.threads = upsertThreadSummary(state.threads, effects.hostPatchEffect.bundle.thread);
    state.bundles[threadId] = effects.hostPatchEffect.bundle;
    state.selection = effects.hostPatchEffect.selection;
    state.currentDraftText = effects.hostPatchEffect.draftText;
    state.footerByThreadId[threadId] = {
      footerState: effects.hostPatchEffect.footerState,
      lifecycle: effects.hostPatchEffect.lifecycle,
    };
  }
}

export function applyAgentSubmitDriverEffects(
  state: AgentHostHarnessState,
  threadId: string,
  effects: AgentSubmitDriverEffectQueue,
): AgentSubmitDriverState {
  for (const streamEffect of effects.streamEffects) {
    feedStreamEvent(threadId, streamEffect);
  }
  for (const bundleEffect of effects.bundleEffects) {
    state.bundles[threadId] = bundleEffect;
  }
  applyHostInteractionPatch(state, threadId, effects);
  return effects.finalSession;
}

export function footerViewStateForHarness(state: AgentHostHarnessState, threadId: string) {
  const footerState = state.footerByThreadId[threadId];
  return resolveAgentFooterViewState({
    streamState: getStreamState(threadId),
    lifecycle: footerState?.lifecycle || createInitialAgentTurnLifecycleState(),
    currentHostFooterState: footerState?.footerState || 'hidden',
    isSubmitting: state.submittingThreadId === threadId,
  });
}

export function resolveAgentConsumerSnapshotForHarness(input: {
  state: AgentHostHarnessState;
  threadId: string;
  targets: readonly AgentLocalTargetSnapshot[];
  activeTarget: AgentLocalTargetSnapshot | null;
  composerReady?: boolean;
  loading?: boolean;
  error?: string | null;
  title?: string;
}): AgentHostConsumerSnapshot {
  const activeThreadId = input.state.selection.threadId;
  const bundle = input.state.bundles[input.threadId] || null;
  const footerViewState = footerViewStateForHarness(input.state, input.threadId);
  const title = input.title || 'Agent Chat';
  const surfaceState = resolveAgentConversationSurfaceState({
    composerReady: input.composerReady ?? true,
    activeTarget: input.activeTarget,
    activeThreadId,
    activeConversationAnchorId: activeThreadId,
    submittingThreadId: input.state.submittingThreadId,
    voiceCaptureState: null,
    voicePlaybackState: null,
    voiceSessionState: {
      status: 'idle',
      mode: 'push-to-talk',
      message: null,
    },
    footerViewState,
    labels: {
      title,
      sendingDisabledReason: 'The agent is replying…',
      composerPlaceholderWithTarget: `Talk to ${input.activeTarget?.displayName || 'this agent'}…`,
      composerPlaceholderWithoutTarget: 'Select an agent to start chatting…',
      voiceSpeakingLabel: 'Speaking…',
      voiceHandsFreeLabel: 'Hands-free on (foreground only)',
      voiceListeningLabel: 'Listening',
      voiceTranscribingLabel: 'Transcribing…',
    },
  });
  const characterData = {
    ...surfaceState.character,
    theme: AGENT_THEME,
  };
  const messages = (bundle?.messages || [])
    .map((message) => toConversationMessageViewModel(message))
    .filter((message) => !isEmptyPendingAssistantMessage(message));
  const targetSummaries = resolveAgentTargetSummaries({
    targets: input.targets,
    threads: input.state.threads,
  });
  const selectedTargetId = resolveAgentSelectedTargetId({
    selectionAgentId: input.state.selection.agentId,
    activeTargetId: input.activeTarget?.agentId || null,
  });
  const canonicalMessages = resolveAgentCanonicalMessages({
    messages,
    activeThreadId,
    activeConversationAnchorId: activeThreadId,
    activeTargetId: input.activeTarget?.agentId || null,
    character: {
      name: characterData.name,
      avatarUrl: characterData.avatarUrl,
      handle: characterData.handle,
    },
  });
  const footerContent = activeThreadId && surfaceState.footer.shouldRender
    ? createElement('span', {
      'data-testid': `footer-${surfaceState.footer.displayState}`,
    })
    : null;
  const hostView = resolveAgentConversationHostView({
    threads: targetSummaries,
    selectedTargetId,
    loading: input.loading ?? false,
    error: input.error || null,
    footerViewState: surfaceState.footer,
    footerContent,
    labels: {
      emptyEyebrow: 'Agent',
      emptyTitle: 'Start the local agent conversation',
      emptyDescription: 'Send a message to start the local agent conversation.',
      loadingLabel: 'Loading local agent conversation…',
    },
    renderMessageContent,
  });
  return {
    footerViewState,
    surfaceState,
    footerContent,
    hostSnapshot: resolveAgentConversationHostSnapshot({
      activeThreadId,
      targets: targetSummaries,
      selectedTargetId: hostView.selectedTargetId ?? null,
      messages: canonicalMessages,
      characterData,
      hostView,
    }),
  };
}

export function applySubmitDriverEventToHarness(input: {
  state: AgentHostHarnessState;
  submitSession: AgentSubmitDriverState;
  threadId: string;
  event: ConversationTurnEvent;
  updatedAtMs: number;
}): AgentSubmitDriverState {
  return applyAgentSubmitDriverEffects(
    input.state,
    input.threadId,
    reduceAgentSubmitDriverEvent({
      state: input.submitSession,
      event: input.event,
      updatedAtMs: input.updatedAtMs,
    }),
  );
}

export function applyProjectionRefreshToHarness(input: {
  state: AgentHostHarnessState;
  submitSession: AgentSubmitDriverState;
  threadId: string;
  requestedProjectionVersion: string;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  draftText: string;
}): AgentSubmitDriverState {
  return applyAgentSubmitDriverEffects(
    input.state,
    input.threadId,
    resolveAgentSubmitDriverProjectionRefresh({
      state: input.submitSession,
      requestedProjectionVersion: input.requestedProjectionVersion,
      refreshedBundle: input.refreshedBundle,
      draftText: input.draftText,
      streamSnapshot: getStreamState(input.threadId),
    }),
  );
}

export function applyCompletedCheckpointToHarness(input: {
  state: AgentHostHarnessState;
  submitSession: AgentSubmitDriverState;
  threadId: string;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
}): AgentSubmitDriverState {
  return applyAgentSubmitDriverEffects(
    input.state,
    input.threadId,
    resolveCompletedAgentSubmitDriverCheckpoint({
      state: input.submitSession,
      refreshedBundle: input.refreshedBundle,
      streamSnapshot: getStreamState(input.threadId),
    }),
  );
}

export function applyInterruptedCheckpointToHarness(input: {
  state: AgentHostHarnessState;
  submitSession: AgentSubmitDriverState;
  threadId: string;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  runtimeError: AgentLocalMessageError;
  draft: AgentLocalDraftRecord;
  updatedAtMs: number;
}): AgentSubmitDriverState {
  return applyAgentSubmitDriverEffects(
    input.state,
    input.threadId,
    resolveInterruptedAgentSubmitDriverCheckpoint({
      state: input.submitSession,
      refreshedBundle: input.refreshedBundle,
      runtimeError: input.runtimeError,
      draft: input.draft,
      updatedAtMs: input.updatedAtMs,
      streamSnapshot: getStreamState(input.threadId),
    }),
  );
}
