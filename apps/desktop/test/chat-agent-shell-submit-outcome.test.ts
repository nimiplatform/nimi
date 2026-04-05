import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AgentLocalDraftRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import {
  resolveCompletedAgentSubmitOutcome,
  resolveInterruptedAgentSubmitOutcome,
} from '../src/shell/renderer/features/chat/chat-agent-shell-submit-outcome.js';

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

function sampleBundle(): AgentLocalThreadBundle {
  return {
    thread: sampleThread(),
    messages: [{
      id: 'user-1',
      threadId: 'thread-1',
      role: 'user',
      status: 'complete',
      contentText: 'hello',
      reasoningText: null,
      error: null,
      traceId: null,
      parentMessageId: null,
      createdAtMs: 100,
      updatedAtMs: 100,
    }, {
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'complete',
      contentText: 'sealed first beat',
      reasoningText: 'private chain',
      error: null,
      traceId: 'trace-sealed',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 102,
    }],
    draft: null,
  };
}

test('agent submit outcome clears draft text and syncs selection from authoritative completed bundle', () => {
  const outcome = resolveCompletedAgentSubmitOutcome({
    optimisticBundle: {
      ...sampleBundle(),
      draft: sampleDraft(),
    },
    refreshedBundle: {
      ...sampleBundle(),
      thread: {
        ...sampleThread(),
        updatedAtMs: 999,
        lastMessageAtMs: 999,
      },
      draft: sampleDraft(),
    },
  });

  assert.ok(outcome);
  assert.equal(outcome?.bundle.thread.updatedAtMs, 999);
  assert.equal(outcome?.draftText, '');
  assert.deepEqual(outcome?.selection, {
    threadId: 'thread-1',
    agentId: 'agent-1',
    targetId: 'agent-1',
  });
  assert.equal(outcome?.bundle.draft, null);
});

test('agent submit outcome keeps submitted draft text and syncs selection from interrupted bundle', () => {
  const outcome = resolveInterruptedAgentSubmitOutcome({
    optimisticBundle: sampleBundle(),
    refreshedBundle: {
      ...sampleBundle(),
      thread: {
        ...sampleThread(),
        updatedAtMs: 1200,
        lastMessageAtMs: 1200,
      },
      draft: null,
    },
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: {
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'pending',
      contentText: '',
      reasoningText: null,
      error: null,
      traceId: null,
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 101,
    },
    partialText: 'late tail',
    partialReasoningText: 'late reasoning',
    runtimeError: {
      code: 'OPERATION_ABORTED',
      message: 'Generation stopped.',
    },
    traceId: 'trace-tail',
    draft: sampleDraft(),
    submittedText: 'retry this',
    updatedAtMs: 1300,
  });

  assert.equal(outcome.bundle.thread.updatedAtMs, 1200);
  assert.equal(outcome.draftText, 'retry this');
  assert.deepEqual(outcome.selection, {
    threadId: 'thread-1',
    agentId: 'agent-1',
    targetId: 'agent-1',
  });
  assert.deepEqual(outcome.bundle.draft, sampleDraft());
  assert.deepEqual(outcome.bundle.messages.at(-1)?.error, {
    code: 'OPERATION_ABORTED',
    message: 'Generation stopped.',
  });
});
