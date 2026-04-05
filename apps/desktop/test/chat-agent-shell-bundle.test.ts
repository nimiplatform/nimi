import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AgentLocalDraftRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import {
  overlayAgentAssistantVisibleState,
  overlayAgentAssistantTerminalState,
  resolveCompletedAgentThreadBundle,
  resolveAuthoritativeAgentThreadBundle,
  resolveInterruptedAgentThreadBundle,
} from '../src/shell/renderer/features/chat/chat-agent-shell-bundle.js';

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

test('agent shell bundle prefers refreshed projection over optimistic cache and clears stale draft on success', () => {
  const optimisticBundle: AgentLocalThreadBundle = {
    ...sampleBundle(),
    draft: sampleDraft(),
  };
  const refreshedBundle: AgentLocalThreadBundle = {
    thread: {
      ...sampleThread(),
      updatedAtMs: 999,
      lastMessageAtMs: 999,
    },
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
      contentText: 'authoritative projection',
      reasoningText: null,
      error: null,
      traceId: 'trace-authoritative',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 999,
    }],
    draft: sampleDraft(),
  };

  const nextBundle = resolveAuthoritativeAgentThreadBundle({
    optimisticBundle,
    refreshedBundle,
    clearDraft: true,
  });

  assert.ok(nextBundle);
  assert.equal(nextBundle?.thread.updatedAtMs, 999);
  assert.equal(nextBundle?.messages.at(-1)?.contentText, 'authoritative projection');
  assert.equal(nextBundle?.draft, null);
});

test('agent shell bundle falls back to optimistic bundle when no refreshed projection is available', () => {
  const optimisticBundle: AgentLocalThreadBundle = {
    ...sampleBundle(),
    draft: sampleDraft(),
  };

  const nextBundle = resolveAuthoritativeAgentThreadBundle({
    optimisticBundle,
    refreshedBundle: null,
    clearDraft: false,
  });

  assert.ok(nextBundle);
  assert.equal(nextBundle?.messages.at(-1)?.contentText, 'sealed first beat');
  assert.deepEqual(nextBundle?.draft, sampleDraft());
});

test('agent shell bundle resolves completed terminals by preferring refreshed projection and clearing draft', () => {
  const optimisticBundle: AgentLocalThreadBundle = {
    ...sampleBundle(),
    draft: sampleDraft(),
  };
  const refreshedBundle: AgentLocalThreadBundle = {
    ...sampleBundle(),
    thread: {
      ...sampleThread(),
      updatedAtMs: 1000,
      lastMessageAtMs: 1000,
    },
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
      contentText: 'authoritative completion',
      reasoningText: null,
      error: null,
      traceId: 'trace-complete',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 1000,
    }],
    draft: sampleDraft(),
  };

  const nextBundle = resolveCompletedAgentThreadBundle({
    optimisticBundle,
    refreshedBundle,
  });

  assert.ok(nextBundle);
  assert.equal(nextBundle?.messages.at(-1)?.contentText, 'authoritative completion');
  assert.equal(nextBundle?.thread.updatedAtMs, 1000);
  assert.equal(nextBundle?.draft, null);
});

test('agent shell bundle preserves sealed assistant content when abort lands after first beat', () => {
  const nextBundle = overlayAgentAssistantTerminalState({
    bundle: sampleBundle(),
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
    partialText: 'tail that should not replace sealed content',
    partialReasoningText: 'tail reasoning',
    runtimeError: {
      code: 'OPERATION_ABORTED',
      message: 'Generation stopped.',
    },
    traceId: 'trace-tail',
    draft: sampleDraft(),
    updatedAtMs: 400,
  });

  const assistantMessage = nextBundle.messages.find((message) => message.id === 'assistant-1');
  assert.ok(assistantMessage);
  assert.equal(assistantMessage?.contentText, 'sealed first beat');
  assert.equal(assistantMessage?.reasoningText, 'private chain');
  assert.deepEqual(assistantMessage?.error, {
    code: 'OPERATION_ABORTED',
    message: 'Generation stopped.',
  });
  assert.equal(assistantMessage?.traceId, 'trace-sealed');
  assert.deepEqual(nextBundle.draft, sampleDraft());
});

test('agent shell bundle grows pending assistant content during streaming before projection rebuild seals authority', () => {
  const firstBeatBundle = overlayAgentAssistantVisibleState({
    bundle: {
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
      }],
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
    partialText: 'sealed first beat',
    partialReasoningText: '',
    updatedAtMs: 120,
  });

  const streamedBundle = overlayAgentAssistantVisibleState({
    bundle: firstBeatBundle,
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
    partialText: 'sealed first beat plus tail',
    partialReasoningText: 'stream reasoning',
    updatedAtMs: 130,
  });

  assert.equal(streamedBundle.messages.at(-1)?.contentText, 'sealed first beat plus tail');
  assert.equal(streamedBundle.messages.at(-1)?.reasoningText, 'stream reasoning');
  assert.equal(streamedBundle.messages.at(-1)?.status, 'pending');
});

test('agent shell bundle does not let later partial deltas overwrite authoritative projection after refresh', () => {
  const authoritativeBundle: AgentLocalThreadBundle = {
    ...sampleBundle(),
    thread: {
      ...sampleThread(),
      updatedAtMs: 999,
      lastMessageAtMs: 999,
    },
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
      contentText: 'authoritative projection',
      reasoningText: 'authoritative reasoning',
      error: null,
      traceId: 'trace-authoritative',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 999,
    }],
    draft: null,
  };

  const nextBundle = overlayAgentAssistantVisibleState({
    bundle: authoritativeBundle,
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
    partialText: 'stale tail that should not win',
    partialReasoningText: 'stale reasoning',
    updatedAtMs: 1300,
  });

  assert.equal(nextBundle.messages.at(-1)?.contentText, 'authoritative projection');
  assert.equal(nextBundle.messages.at(-1)?.reasoningText, 'authoritative reasoning');
  assert.equal(nextBundle.messages.at(-1)?.status, 'complete');
});

test('agent shell bundle creates assistant error placeholder when no committed assistant beat exists yet', () => {
  const baseBundle: AgentLocalThreadBundle = {
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
    }],
    draft: null,
  };

  const nextBundle = overlayAgentAssistantTerminalState({
    bundle: baseBundle,
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
    partialText: 'partial answer',
    partialReasoningText: 'stream reasoning',
    runtimeError: {
      code: 'RUNTIME_CALL_FAILED',
      message: 'runtime broke',
    },
    traceId: 'trace-1',
    draft: sampleDraft(),
    updatedAtMs: 410,
  });

  const assistantMessage = nextBundle.messages.find((message) => message.id === 'assistant-1');
  assert.ok(assistantMessage);
  assert.equal(assistantMessage?.contentText, 'partial answer');
  assert.equal(assistantMessage?.reasoningText, 'stream reasoning');
  assert.deepEqual(assistantMessage?.error, {
    code: 'RUNTIME_CALL_FAILED',
    message: 'runtime broke',
  });
  assert.equal(assistantMessage?.traceId, 'trace-1');
  assert.deepEqual(nextBundle.draft, sampleDraft());
});

test('agent shell bundle resolves interrupted terminals against refreshed projection while keeping draft', () => {
  const optimisticBundle: AgentLocalThreadBundle = {
    ...sampleBundle(),
    draft: null,
  };
  const refreshedBundle: AgentLocalThreadBundle = {
    ...sampleBundle(),
    thread: {
      ...sampleThread(),
      updatedAtMs: 1200,
      lastMessageAtMs: 1200,
    },
    draft: null,
  };

  const nextBundle = resolveInterruptedAgentThreadBundle({
    optimisticBundle,
    refreshedBundle,
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
    updatedAtMs: 1300,
  });

  assert.equal(nextBundle.thread.updatedAtMs, 1200);
  assert.equal(nextBundle.messages.at(-1)?.contentText, 'sealed first beat');
  assert.deepEqual(nextBundle.messages.at(-1)?.error, {
    code: 'OPERATION_ABORTED',
    message: 'Generation stopped.',
  });
  assert.deepEqual(nextBundle.draft, sampleDraft());
});
