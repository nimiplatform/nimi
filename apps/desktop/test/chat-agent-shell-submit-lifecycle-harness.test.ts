import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AgentLocalDraftRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import {
  cancelStream,
  getStreamState,
} from '../src/shell/renderer/features/turns/stream-controller.js';
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
  resolveAgentConsumerSnapshotForHarness,
} from './helpers/agent-chat-submit-host-harness.js';
import { createInitialAgentSubmitDriverState } from '../src/shell/renderer/features/chat/chat-agent-shell-submit-driver.js';
import { createAgentTextMessage } from './helpers/agent-chat-record-fixtures.js';

const runtimeGlobal = globalThis as typeof globalThis & {
  window?: {
    __NIMI_HTML_BOOT_ID__?: string;
  };
  sessionStorage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  };
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

function sampleThread(): AgentLocalThreadRecord {
  return {
    id: 'thread-1',
    agentId: 'agent-1',
    title: 'Companion',
    createdAtMs: 10,
    updatedAtMs: 20,
    lastMessageAtMs: 20,
    archivedAtMs: null,
    targetSnapshot: {
      agentId: 'agent-1',
      displayName: 'Companion',
      handle: '~companion',
      avatarUrl: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
    },
  };
}

function sampleDraft(): AgentLocalDraftRecord {
  return {
    threadId: 'thread-1',
    text: 'retry this',
    updatedAtMs: 300,
  };
}

function sampleTarget() {
  return sampleThread().targetSnapshot;
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

test('agent host submit harness converges completed submit to authoritative bundle, hidden footer, and cleared submitting state', () => {
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
        type: 'first-beat-sealed',
        turnId: 'turn-1',
        beatId: 'beat-1',
        text: 'sealed first beat',
      },
      updatedAtMs: 130,
    });
    assert.equal(harness.submittingThreadId, threadId);
    assert.equal(harness.bundles[threadId]?.messages.at(-1)?.contentText, 'sealed first beat');

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

    assert.equal(harness.submittingThreadId, null);
    assert.equal(harness.selection.threadId, threadId);
    assert.equal(harness.currentDraftText, '');
    assert.equal(harness.bundles[threadId]?.messages.at(-1)?.contentText, 'authoritative projection');
    assert.deepEqual(footerViewStateForHarness(harness, threadId), {
      displayState: 'hidden',
      pendingFirstBeat: false,
    });
    assert.equal(getStreamState(threadId).phase, 'done');

    const consumerSnapshot = resolveAgentConsumerSnapshotForHarness({
      state: harness,
      threadId,
      targets: [sampleTarget()],
      activeTarget: sampleTarget(),
    });
    assert.ok(consumerSnapshot.hostSnapshot.messages);
    assert.ok(consumerSnapshot.hostSnapshot.characterData);
    const completedCharacter = consumerSnapshot.hostSnapshot.characterData;
    assert.ok(completedCharacter.interactionState);
    assert.equal(consumerSnapshot.hostSnapshot.mode, 'agent');
    assert.equal(consumerSnapshot.hostSnapshot.activeThreadId, threadId);
    assert.equal(consumerSnapshot.hostSnapshot.selectedTargetId, 'agent-1');
    assert.equal(consumerSnapshot.hostSnapshot.availability.badge, 1);
    assert.equal(consumerSnapshot.hostSnapshot.messages.at(-1)?.text, 'authoritative projection');
    assert.equal(consumerSnapshot.hostSnapshot.messages.at(-1)?.senderKind, 'agent');
    assert.equal(completedCharacter.interactionState.phase, 'idle');
    assert.equal(consumerSnapshot.hostSnapshot.transcriptProps?.pendingFirstBeat, false);
    assert.equal(consumerSnapshot.hostSnapshot.transcriptProps?.footerContent, null);
    assert.equal(consumerSnapshot.hostSnapshot.stagePanelProps?.footerContent, null);
  } finally {
    closeAgentHostHarness(threadId);
  }
});

test('agent host submit harness preserves sealed first-beat, restores draft, and ignores late refresh after tail cancel', () => {
  const threadId = 'thread-1';
  const harness = createAgentHostHarness({
    threadId,
    initialBundle: baseUserBundle(),
  });
  let submitSession = createSubmitSession();
  const draft = sampleDraft();
  beginAgentHostSubmit(harness, {
    threadId,
    submittedText: draft.text,
  });

  try {
    submitSession = applySubmitDriverEventToHarness({
      state: harness,
      submitSession,
      threadId,
      event: {
        type: 'first-beat-sealed',
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
    submitSession = applyInterruptedCheckpointToHarness({
      state: harness,
      submitSession,
      threadId,
      refreshedBundle: null,
      runtimeError: {
        code: 'OPERATION_ABORTED',
        message: 'Generation stopped.',
      },
      draft,
      updatedAtMs: 160,
    });
    finishAgentHostSubmit(harness);

    applyProjectionRefreshToHarness({
      state: harness,
      submitSession,
      threadId,
      requestedProjectionVersion: 'truth:10:t1',
      refreshedBundle: authoritativeBundle(),
      draftText: draft.text,
    });

    assert.equal(harness.submittingThreadId, null);
    assert.equal(harness.currentDraftText, draft.text);
    assert.equal(harness.selection.threadId, threadId);
    assert.equal(harness.bundles[threadId]?.messages.at(-1)?.contentText, 'sealed first beat');
    assert.deepEqual(footerViewStateForHarness(harness, threadId), {
      displayState: 'hidden',
      pendingFirstBeat: false,
    });
    assert.equal(getStreamState(threadId).phase, 'cancelled');

    const consumerSnapshot = resolveAgentConsumerSnapshotForHarness({
      state: harness,
      threadId,
      targets: [sampleTarget()],
      activeTarget: sampleTarget(),
    });
    assert.ok(consumerSnapshot.hostSnapshot.messages);
    assert.ok(consumerSnapshot.hostSnapshot.characterData);
    const canceledCharacter = consumerSnapshot.hostSnapshot.characterData;
    assert.ok(canceledCharacter.interactionState);
    assert.equal(consumerSnapshot.hostSnapshot.selectedTargetId, 'agent-1');
    assert.equal(consumerSnapshot.hostSnapshot.messages.at(-1)?.text, 'sealed first beat');
    assert.equal(canceledCharacter.interactionState.phase, 'idle');
    assert.equal(consumerSnapshot.hostSnapshot.transcriptProps?.pendingFirstBeat, false);
    assert.equal(consumerSnapshot.hostSnapshot.transcriptProps?.footerContent, null);
    assert.equal(consumerSnapshot.hostSnapshot.stagePanelProps?.footerContent, null);
  } finally {
    closeAgentHostHarness(threadId);
  }
});

test('agent host submit harness restores draft and clears submitting state when runtime fails before first-beat', () => {
  const threadId = 'thread-1';
  const harness = createAgentHostHarness({
    threadId,
    initialBundle: baseUserBundle(),
  });
  const submitSession = createSubmitSession();
  const draft = sampleDraft();
  beginAgentHostSubmit(harness, {
    threadId,
    submittedText: draft.text,
  });

  try {
    applyInterruptedCheckpointToHarness({
      state: harness,
      submitSession,
      threadId,
      refreshedBundle: null,
      runtimeError: {
        code: 'RUNTIME_CALL_FAILED',
        message: 'runtime broke',
      },
      draft,
      updatedAtMs: 140,
    });
    finishAgentHostSubmit(harness);

    assert.equal(harness.submittingThreadId, null);
    assert.equal(harness.currentDraftText, draft.text);
    assert.equal(harness.selection.threadId, threadId);
    assert.equal(harness.bundles[threadId]?.messages.at(-1)?.error?.message, 'runtime broke');
    assert.deepEqual(footerViewStateForHarness(harness, threadId), {
      displayState: 'hidden',
      pendingFirstBeat: false,
    });
    assert.equal(getStreamState(threadId).phase, 'error');

    const consumerSnapshot = resolveAgentConsumerSnapshotForHarness({
      state: harness,
      threadId,
      targets: [sampleTarget()],
      activeTarget: sampleTarget(),
    });
    assert.ok(consumerSnapshot.hostSnapshot.messages);
    assert.ok(consumerSnapshot.hostSnapshot.characterData);
    const failedCharacter = consumerSnapshot.hostSnapshot.characterData;
    assert.ok(failedCharacter.interactionState);
    assert.equal(consumerSnapshot.hostSnapshot.selectedTargetId, 'agent-1');
    assert.equal(consumerSnapshot.hostSnapshot.messages.at(-1)?.error, 'runtime broke');
    assert.equal(failedCharacter.interactionState.phase, 'idle');
    assert.equal(consumerSnapshot.hostSnapshot.transcriptProps?.pendingFirstBeat, false);
    assert.equal(consumerSnapshot.hostSnapshot.transcriptProps?.footerContent, null);
    assert.equal(consumerSnapshot.surfaceState.composer?.disabled, false);
  } finally {
    closeAgentHostHarness(threadId);
  }
});
