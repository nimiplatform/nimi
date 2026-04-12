import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAgentConversationSurfaceState } from '../src/shell/renderer/features/chat/chat-agent-shell-visible-state.js';
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
  submittingThreadId: string | null;
  footerViewState: AgentFooterViewState;
  voiceSessionState?: AgentVoiceSessionShellState;
}) {
  return resolveAgentConversationSurfaceState({
    ...input,
    labels: {
      title: 'Agent Chat',
      sendingDisabledReason: 'The agent is replying…',
      composerPlaceholderWithTarget: `Talk to ${input.activeTarget?.displayName || 'this agent'}…`,
      composerPlaceholderWithoutTarget: 'Select an agent to start chatting…',
      voiceHandsFreeLabel: 'Hands-free on (foreground only)',
      voiceListeningLabel: 'Listening',
      voiceTranscribingLabel: 'Transcribing…',
    },
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
  });
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
