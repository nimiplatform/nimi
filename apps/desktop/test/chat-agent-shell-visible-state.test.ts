import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentResolvedStatusCue } from '../src/shell/renderer/features/chat/chat-agent-behavior.js';
import {
  resolveAgentConversationSurfaceState,
  type RuntimeCommittedStatusProjection,
} from '../src/shell/renderer/features/chat/chat-agent-shell-visible-state.js';
import type { AgentFooterViewState } from '../src/shell/renderer/features/chat/chat-agent-shell-footer-state.js';
import type { AgentVoiceSessionShellState } from '../src/shell/renderer/features/chat/chat-agent-voice-session.js';
import {
  beginAgentHostSubmit,
  closeAgentHostHarness,
  createAgentHostHarness,
  finishAgentHostSubmit,
  applyCompletedCheckpointToHarness,
  applyInterruptedCheckpointToHarness,
  applyProjectionRefreshToHarness,
  applySubmitDriverEventToHarness,
  footerViewStateForHarness,
} from './helpers/agent-chat-submit-host-harness.js';
import { createInitialAgentSubmitDriverState } from '../src/shell/renderer/features/chat/chat-agent-shell-submit-driver.js';
import type {
  AgentLocalDraftRecord,
  AgentLocalTargetSnapshot,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import { cancelStream } from '../src/shell/renderer/features/turns/stream-controller.js';
import { createAgentTextMessage } from './helpers/agent-chat-record-fixtures.js';

const runtimeGlobal = globalThis as typeof globalThis & {
  window?: Window & typeof globalThis & {
    __NIMI_HTML_BOOT_ID__?: string;
  };
  sessionStorage?: Storage;
};

runtimeGlobal.window = {
  __NIMI_HTML_BOOT_ID__: 'renderer-session-test',
} as unknown as Window & typeof globalThis & {
  __NIMI_HTML_BOOT_ID__?: string;
};
runtimeGlobal.sessionStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
} as unknown as Storage;

function sampleTarget(): AgentLocalTargetSnapshot {
  return {
    agentId: 'agent-1',
    displayName: 'Companion',
    handle: 'companion',
    avatarUrl: null,
    presentationProfile: {
      backendKind: 'canvas2d',
      avatarAssetRef: 'fallback://companion',
      expressionProfileRef: null,
      idlePreset: null,
      interactionPolicyRef: null,
      defaultVoiceReference: null,
    },
    worldId: null,
    worldName: null,
    bio: 'friend agent',
    ownershipType: null,
  };
}

function sampleThread(): AgentLocalThreadRecord {
  return {
    id: 'thread-1',
    agentId: 'agent-1',
    title: 'Companion',
    createdAtMs: 10,
    updatedAtMs: 20,
    lastMessageAtMs: 20,
    archivedAtMs: null,
    targetSnapshot: sampleTarget(),
  };
}

function sampleDraft(): AgentLocalDraftRecord {
  return {
    threadId: 'thread-1',
    text: 'retry this',
    updatedAtMs: 300,
  };
}

function baseUserBundle(): AgentLocalThreadBundle {
  return {
    thread: sampleThread(),
    messages: [createAgentTextMessage({
      id: 'user-1',
      threadId: 'thread-1',
      role: 'user',
      status: 'complete',
      contentText: 'hello',
      createdAtMs: 100,
      updatedAtMs: 100,
    })],
    draft: null,
  };
}

function assistantPlaceholder() {
  return createAgentTextMessage({
    id: 'assistant-1',
    threadId: 'thread-1',
    role: 'assistant' as const,
    status: 'pending' as const,
    contentText: '',
    parentMessageId: 'user-1',
    createdAtMs: 101,
    updatedAtMs: 101,
  });
}

function authoritativeBundle(): AgentLocalThreadBundle {
  return {
    thread: {
      ...sampleThread(),
      updatedAtMs: 999,
      lastMessageAtMs: 999,
    },
    messages: [createAgentTextMessage({
      id: 'user-1',
      threadId: 'thread-1',
      role: 'user',
      status: 'complete',
      contentText: 'hello',
      createdAtMs: 100,
      updatedAtMs: 100,
    }), createAgentTextMessage({
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'complete',
      contentText: 'authoritative projection',
      reasoningText: 'authoritative reasoning',
      traceId: 'trace-authoritative',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 999,
    })],
    draft: null,
  };
}

function createSubmitSession() {
  return createInitialAgentSubmitDriverState({
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: assistantPlaceholder(),
    submittedText: 'retry this',
    workingBundle: baseUserBundle(),
  });
}

function resolveSurfaceState(input: {
  composerReady: boolean;
  activeTarget: AgentLocalTargetSnapshot | null;
  activeThreadId?: string | null;
  submittingThreadId: string | null;
  footerViewState: AgentFooterViewState;
  voiceSessionState?: AgentVoiceSessionShellState;
  latestStatusCue?: AgentResolvedStatusCue | null;
  runtimeCommittedStatus?: RuntimeCommittedStatusProjection | null;
  voiceCaptureState?: {
    active: boolean;
    amplitude: number;
  } | null;
  voicePlaybackState?: {
    conversationAnchorId: string;
    messageId: string;
    active: boolean;
    amplitude: number;
    visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null;
  } | null;
}) {
  return resolveAgentConversationSurfaceState({
    ...input,
    activeThreadId: input.activeThreadId ?? 'thread-1',
    activeConversationAnchorId: input.activeThreadId ?? 'thread-1',
    labels: {
      title: 'Agent Chat',
      sendingDisabledReason: 'The agent is replying…',
      composerPlaceholderWithTarget: `Talk to ${input.activeTarget?.displayName || 'this agent'}…`,
      composerPlaceholderWithoutTarget: 'Select an agent to start chatting…',
      voiceSpeakingLabel: 'Speaking…',
      voiceHandsFreeLabel: 'Hands-free on (foreground only)',
      voiceListeningLabel: 'Listening',
      voiceTranscribingLabel: 'Transcribing…',
    },
    latestStatusCue: input.latestStatusCue ?? null,
    runtimeCommittedStatus: input.runtimeCommittedStatus ?? null,
    voiceCaptureState: input.voiceCaptureState ?? null,
    voicePlaybackState: input.voicePlaybackState ?? null,
    voiceSessionState: input.voiceSessionState || {
      status: 'idle',
      mode: 'push-to-talk',
      message: null,
    },
  });
}

test('agent visible state disables composer and marks character thinking while submitting', () => {
  const surfaceState = resolveSurfaceState({
    composerReady: true,
    activeTarget: sampleTarget(),
    submittingThreadId: 'thread-1',
    footerViewState: {
      displayState: 'streaming',
      pendingFirstBeat: true,
    },
  });

  assert.equal(surfaceState.composer?.disabled, true);
  assert.equal(surfaceState.composer?.disabledReason, 'The agent is replying…');
  assert.equal(surfaceState.composer?.placeholder, 'Talk to Companion…');
  assert.deepEqual(surfaceState.character.interactionState, {
    phase: 'thinking',
    busy: true,
    emotion: 'focus',
    amplitude: 0.42,
  });
  assert.deepEqual(surfaceState.character.avatarPresentationProfile, sampleTarget().presentationProfile);
  assert.equal(surfaceState.footer.shouldRender, true);
  assert.equal(surfaceState.footer.pendingFirstBeat, true);
});

test('agent visible state falls back to targetless placeholder and idle character when not submitting', () => {
  const surfaceState = resolveSurfaceState({
    composerReady: true,
    activeTarget: null,
    submittingThreadId: null,
    footerViewState: {
      displayState: 'hidden',
      pendingFirstBeat: false,
    },
  });

  assert.equal(surfaceState.composer?.disabled, false);
  assert.equal(surfaceState.composer?.placeholder, 'Select an agent to start chatting…');
  assert.equal(surfaceState.character.name, 'Agent Chat');
  assert.deepEqual(surfaceState.character.interactionState, {
    phase: 'idle',
    busy: false,
    emotion: 'neutral',
    amplitude: 0.08,
  });
  assert.equal(surfaceState.footer.shouldRender, false);
});

test('agent visible state surfaces foreground hands-free as an admitted idle label', () => {
  const surfaceState = resolveSurfaceState({
    composerReady: true,
    activeTarget: sampleTarget(),
    submittingThreadId: null,
    footerViewState: {
      displayState: 'hidden',
      pendingFirstBeat: false,
    },
    voiceSessionState: {
      status: 'idle',
      mode: 'hands-free',
      message: null,
    },
  });

  assert.deepEqual(surfaceState.character.interactionState, {
    phase: 'idle',
    busy: false,
    label: 'Hands-free on (foreground only)',
    emotion: 'calm',
    amplitude: 0.14,
  });
});

test('agent visible state consumes the latest accepted statusCue during idle fallback', () => {
  const surfaceState = resolveSurfaceState({
    composerReady: true,
    activeTarget: sampleTarget(),
    submittingThreadId: null,
    latestStatusCue: {
      sourceMessageId: 'message-0',
      mood: 'playful',
      label: 'Feeling playful',
      intensity: 0.58,
    },
    footerViewState: {
      displayState: 'hidden',
      pendingFirstBeat: false,
    },
  });

  assert.deepEqual(surfaceState.character.interactionState, {
    phase: 'idle',
    busy: false,
    label: 'Feeling playful',
    emotion: 'playful',
    amplitude: 0.58,
  });
});

test('agent visible state consumes runtime committed projection when no fresh statusCue exists', () => {
  const surfaceState = resolveSurfaceState({
    composerReady: true,
    activeTarget: sampleTarget(),
    submittingThreadId: null,
    runtimeCommittedStatus: {
      lifecycleStatus: 'active',
      executionState: 'life-running',
      statusText: 'Out exploring',
    },
    footerViewState: {
      displayState: 'hidden',
      pendingFirstBeat: false,
    },
  });

  assert.deepEqual(surfaceState.character.interactionState, {
    phase: 'idle',
    busy: false,
    label: 'Out exploring',
    amplitude: 0.12,
  });
});

test('agent visible state falls back to runtime execution label when status text is absent', () => {
  const surfaceState = resolveSurfaceState({
    composerReady: true,
    activeTarget: sampleTarget(),
    submittingThreadId: null,
    runtimeCommittedStatus: {
      lifecycleStatus: 'active',
      executionState: 'life-running',
      statusText: null,
    },
    footerViewState: {
      displayState: 'hidden',
      pendingFirstBeat: false,
    },
  });

  assert.deepEqual(surfaceState.character.interactionState, {
    phase: 'idle',
    busy: false,
    label: 'Life running',
    amplitude: 0.12,
  });
});

test('agent visible state keeps the latest accepted statusCue ahead of runtime committed projection', () => {
  const surfaceState = resolveSurfaceState({
    composerReady: true,
    activeTarget: sampleTarget(),
    submittingThreadId: null,
    latestStatusCue: {
      sourceMessageId: 'message-0',
      mood: 'playful',
      label: 'Feeling playful',
      intensity: 0.58,
    },
    runtimeCommittedStatus: {
      lifecycleStatus: 'active',
      executionState: 'life-running',
      statusText: 'Out exploring',
    },
    footerViewState: {
      displayState: 'hidden',
      pendingFirstBeat: false,
    },
  });

  assert.deepEqual(surfaceState.character.interactionState, {
    phase: 'idle',
    busy: false,
    label: 'Feeling playful',
    emotion: 'playful',
    amplitude: 0.58,
  });
});

test('agent visible state preserves loading over the latest accepted statusCue', () => {
  const surfaceState = resolveSurfaceState({
    composerReady: true,
    activeTarget: sampleTarget(),
    submittingThreadId: null,
    latestStatusCue: {
      sourceMessageId: 'message-0',
      mood: 'joy',
      label: 'Feeling bright',
      intensity: 0.72,
    },
    footerViewState: {
      displayState: 'hidden',
      pendingFirstBeat: false,
    },
    voiceSessionState: {
      status: 'transcribing',
      mode: 'push-to-talk',
      message: null,
    },
  });

  assert.deepEqual(surfaceState.character.interactionState, {
    phase: 'loading',
    busy: true,
    label: 'Transcribing…',
    emotion: 'focus',
    amplitude: 0.18,
  });
});

test('agent visible state preserves loading over runtime committed projection', () => {
  const surfaceState = resolveSurfaceState({
    composerReady: true,
    activeTarget: sampleTarget(),
    submittingThreadId: null,
    runtimeCommittedStatus: {
      lifecycleStatus: 'active',
      executionState: 'life-running',
      statusText: 'Out exploring',
    },
    footerViewState: {
      displayState: 'hidden',
      pendingFirstBeat: false,
    },
    voiceSessionState: {
      status: 'transcribing',
      mode: 'push-to-talk',
      message: null,
    },
  });

  assert.deepEqual(surfaceState.character.interactionState, {
    phase: 'loading',
    busy: true,
    label: 'Transcribing…',
    emotion: 'focus',
    amplitude: 0.18,
  });
});

test('agent visible state uses live microphone amplitude while listening', () => {
  const surfaceState = resolveSurfaceState({
    composerReady: true,
    activeTarget: sampleTarget(),
    submittingThreadId: null,
    footerViewState: {
      displayState: 'hidden',
      pendingFirstBeat: false,
    },
    voiceSessionState: {
      status: 'listening',
      mode: 'push-to-talk',
      message: null,
    },
    voiceCaptureState: {
      active: true,
      amplitude: 0.47,
    },
  });

  assert.deepEqual(surfaceState.character.interactionState, {
    phase: 'listening',
    busy: true,
    label: 'Listening',
    emotion: 'calm',
    amplitude: 0.47,
  });
});

test('agent visible state prefers active thread voice playback cues for speaking avatar state', () => {
  const surfaceState = resolveSurfaceState({
    composerReady: true,
    activeTarget: sampleTarget(),
    activeThreadId: 'thread-1',
    submittingThreadId: null,
    footerViewState: {
      displayState: 'hidden',
      pendingFirstBeat: false,
    },
    voicePlaybackState: {
      conversationAnchorId: 'thread-1',
      messageId: 'assistant-voice-1',
      active: true,
      amplitude: 0.58,
      visemeId: 'oh',
    },
  });

  assert.deepEqual(surfaceState.character.interactionState, {
    phase: 'speaking',
    busy: true,
    label: 'Speaking…',
    emotion: 'joy',
    amplitude: 0.58,
    visemeId: 'oh',
  });
});

test('agent visible state derives focused speaking emotion from front visemes', () => {
  const surfaceState = resolveSurfaceState({
    composerReady: true,
    activeTarget: sampleTarget(),
    activeThreadId: 'thread-1',
    submittingThreadId: null,
    footerViewState: {
      displayState: 'hidden',
      pendingFirstBeat: false,
    },
    voicePlaybackState: {
      conversationAnchorId: 'thread-1',
      messageId: 'assistant-voice-3',
      active: true,
      amplitude: 0.44,
      visemeId: 'ee',
    },
  });

  assert.deepEqual(surfaceState.character.interactionState, {
    phase: 'speaking',
    busy: true,
    label: 'Speaking…',
    emotion: 'focus',
    amplitude: 0.44,
    visemeId: 'ee',
  });
});

test('agent visible state keeps quiet speaking tails calm when amplitude is low and viseme is absent', () => {
  const surfaceState = resolveSurfaceState({
    composerReady: true,
    activeTarget: sampleTarget(),
    activeThreadId: 'thread-1',
    submittingThreadId: null,
    footerViewState: {
      displayState: 'hidden',
      pendingFirstBeat: false,
    },
    voicePlaybackState: {
      conversationAnchorId: 'thread-1',
      messageId: 'assistant-voice-4',
      active: true,
      amplitude: 0.18,
      visemeId: null,
    },
  });

  assert.deepEqual(surfaceState.character.interactionState, {
    phase: 'speaking',
    busy: true,
    label: 'Speaking…',
    emotion: 'calm',
    amplitude: 0.18,
  });
});

test('agent visible state ignores voice playback cues from a different anchor', () => {
  const surfaceState = resolveSurfaceState({
    composerReady: true,
    activeTarget: sampleTarget(),
    activeThreadId: 'thread-1',
    submittingThreadId: null,
    footerViewState: {
      displayState: 'hidden',
      pendingFirstBeat: false,
    },
    voicePlaybackState: {
      conversationAnchorId: 'thread-2',
      messageId: 'assistant-voice-2',
      active: true,
      amplitude: 0.88,
      visemeId: 'aa',
    },
  });

  assert.deepEqual(surfaceState.character.interactionState, {
    phase: 'idle',
    busy: false,
    emotion: 'neutral',
    amplitude: 0.08,
  });
});

test('agent visible state converges to idle composer and hidden footer after completed authoritative submit', () => {
  const threadId = 'thread-1';
  const harness = createAgentHostHarness({
    threadId,
    initialBundle: baseUserBundle(),
  });
  let submitSession = createSubmitSession();
  beginAgentHostSubmit(harness, {
    threadId,
    submittedText: 'retry this',
  });

  try {
    submitSession = applySubmitDriverEventToHarness({
      state: harness,
      submitSession,
      threadId,
      event: {
        type: 'message-sealed',
        turnId: 'turn-1',
        beatId: 'beat-1',
        text: 'sealed first beat',
      },
      updatedAtMs: 130,
    });
    submitSession = applySubmitDriverEventToHarness({
      state: harness,
      submitSession,
      threadId,
      event: {
        type: 'projection-rebuilt',
        threadId,
        projectionVersion: 'truth:10:t1',
      },
      updatedAtMs: 140,
    });
    submitSession = applyProjectionRefreshToHarness({
      state: harness,
      submitSession,
      threadId,
      requestedProjectionVersion: 'truth:10:t1',
      refreshedBundle: authoritativeBundle(),
      draftText: '',
    });
    submitSession = applySubmitDriverEventToHarness({
      state: harness,
      submitSession,
      threadId,
      event: {
        type: 'turn-completed',
        turnId: 'turn-1',
        outputText: 'authoritative projection',
        reasoningText: 'authoritative reasoning',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
        },
        trace: {
          traceId: 'trace-done',
          promptTraceId: 'prompt-done',
        },
      },
      updatedAtMs: 150,
    });
    applyCompletedCheckpointToHarness({
      state: harness,
      submitSession,
      threadId,
      refreshedBundle: authoritativeBundle(),
    });
    finishAgentHostSubmit(harness);

    const surfaceState = resolveSurfaceState({
      composerReady: true,
      activeTarget: sampleTarget(),
      submittingThreadId: harness.submittingThreadId,
      footerViewState: footerViewStateForHarness(harness, threadId),
    });

    assert.equal(surfaceState.composer?.disabled, false);
    assert.equal(surfaceState.character.interactionState.phase, 'idle');
    assert.equal(surfaceState.footer.shouldRender, false);
    assert.equal(harness.currentDraftText, '');
  } finally {
    closeAgentHostHarness(threadId);
  }
});

test('agent visible state preserves idle composer and hidden footer after tail cancel with sealed first-beat', () => {
  const threadId = 'thread-1';
  const harness = createAgentHostHarness({
    threadId,
    initialBundle: baseUserBundle(),
  });
  let submitSession = createSubmitSession();
  beginAgentHostSubmit(harness, {
    threadId,
    submittedText: 'retry this',
  });

  try {
    submitSession = applySubmitDriverEventToHarness({
      state: harness,
      submitSession,
      threadId,
      event: {
        type: 'message-sealed',
        turnId: 'turn-1',
        beatId: 'beat-1',
        text: 'sealed first beat',
      },
      updatedAtMs: 130,
    });
    cancelStream(threadId);
    submitSession = applySubmitDriverEventToHarness({
      state: harness,
      submitSession,
      threadId,
      event: {
        type: 'turn-canceled',
        turnId: 'turn-1',
        scope: 'tail',
        outputText: 'sealed first beat',
        reasoningText: '',
        trace: {
          traceId: 'trace-cancel',
          promptTraceId: 'prompt-cancel',
        },
      },
      updatedAtMs: 150,
    });
    applyInterruptedCheckpointToHarness({
      state: harness,
      submitSession,
      threadId,
      refreshedBundle: null,
      runtimeError: {
        code: 'OPERATION_ABORTED',
        message: 'Generation stopped.',
      },
      draft: sampleDraft(),
      updatedAtMs: 160,
    });
    finishAgentHostSubmit(harness);

    const surfaceState = resolveSurfaceState({
      composerReady: true,
      activeTarget: sampleTarget(),
      submittingThreadId: harness.submittingThreadId,
      footerViewState: footerViewStateForHarness(harness, threadId),
    });

    assert.equal(surfaceState.composer?.disabled, false);
    assert.equal(surfaceState.character.interactionState.phase, 'idle');
    assert.equal(surfaceState.footer.displayState, 'hidden');
    assert.equal(surfaceState.footer.shouldRender, false);
    assert.equal(harness.currentDraftText, 'retry this');
    assert.equal(harness.bundles[threadId]?.messages.at(-1)?.contentText, 'sealed first beat');
  } finally {
    closeAgentHostHarness(threadId);
  }
});
