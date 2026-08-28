import assert from 'node:assert/strict';
import test from 'node:test';

import type {
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
import { createAgentTextMessage } from './helpers/agent-chat-record-fixtures.js';

function sampleThread(): AgentLocalThreadRecord {
  return {
    id: 'thread-1',
    title: 'Companion',
    createdAtMs: 10,
    updatedAtMs: 20,
    lastMessageAtMs: 20,
    targetSnapshot: {
      displayName: 'Companion',
      handle: '~companion',
      avatarUrl: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
      greeting: null,
      builtinDocsContext: null,
    },
  };
}

function sampleBundle(): AgentLocalThreadBundle {
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
    }), createAgentTextMessage({
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'complete',
      contentText: 'sealed first beat',
      reasoningText: 'private chain',
      traceId: 'trace-sealed',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 102,
    })],
  };
}

test('agent shell bundle prefers refreshed projection over optimistic cache and prefers authoritative projection on success', () => {
  const optimisticBundle: AgentLocalThreadBundle = {
    ...sampleBundle(),
  };
  const refreshedBundle: AgentLocalThreadBundle = {
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
      traceId: 'trace-authoritative',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 999,
    })],
  };

  const nextBundle = resolveAuthoritativeAgentThreadBundle({
    optimisticBundle,
    refreshedBundle,
  });

  assert.ok(nextBundle);
  assert.equal(nextBundle?.thread.updatedAtMs, 999);
  assert.equal(nextBundle?.messages.at(-1)?.contentText, 'authoritative projection');
});

test('agent shell bundle falls back to optimistic bundle when no refreshed projection is available', () => {
  const optimisticBundle: AgentLocalThreadBundle = {
    ...sampleBundle(),
  };

  const nextBundle = resolveAuthoritativeAgentThreadBundle({
    optimisticBundle,
    refreshedBundle: null,
  });

  assert.ok(nextBundle);
  assert.equal(nextBundle?.messages.at(-1)?.contentText, 'sealed first beat');
});

test('agent shell bundle rejects empty refreshed projection for the current non-empty thread', () => {
  const optimisticBundle: AgentLocalThreadBundle = {
    ...sampleBundle(),
  };
  const emptyRefreshedBundle: AgentLocalThreadBundle = {
    thread: {
      ...sampleThread(),
      updatedAtMs: 1000,
      lastMessageAtMs: 1000,
    },
    messages: [],
  };

  const nextBundle = resolveAuthoritativeAgentThreadBundle({
    optimisticBundle,
    refreshedBundle: emptyRefreshedBundle,
  });

  assert.equal(nextBundle, optimisticBundle);
  assert.equal(nextBundle?.messages.at(-1)?.contentText, 'sealed first beat');
});

test('agent shell bundle resolves completed terminals by preferring refreshed projection and clearing composer text', () => {
  const optimisticBundle: AgentLocalThreadBundle = {
    ...sampleBundle(),
  };
  const refreshedBundle: AgentLocalThreadBundle = {
    ...sampleBundle(),
    thread: {
      ...sampleThread(),
      updatedAtMs: 1000,
      lastMessageAtMs: 1000,
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
      contentText: 'authoritative completion',
      traceId: 'trace-complete',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 1000,
    })],
  };

  const nextBundle = resolveCompletedAgentThreadBundle({
    optimisticBundle,
    refreshedBundle,
  });

  assert.ok(nextBundle);
  assert.equal(nextBundle?.messages.at(-1)?.contentText, 'authoritative completion');
  assert.equal(nextBundle?.thread.updatedAtMs, 1000);
});

test('agent shell bundle resolves completed terminals without wiping a non-empty thread on empty refresh', () => {
  const optimisticBundle: AgentLocalThreadBundle = {
    ...sampleBundle(),
  };
  const emptyRefreshedBundle: AgentLocalThreadBundle = {
    thread: {
      ...sampleThread(),
      updatedAtMs: 1000,
      lastMessageAtMs: 1000,
    },
    messages: [],
  };

  const nextBundle = resolveCompletedAgentThreadBundle({
    optimisticBundle,
    refreshedBundle: emptyRefreshedBundle,
  });

  assert.equal(nextBundle, optimisticBundle);
  assert.equal(nextBundle?.messages.length, 2);
});

test('agent shell bundle preserves sealed assistant content when abort lands after first beat', () => {
  const nextBundle = overlayAgentAssistantTerminalState({
    bundle: sampleBundle(),
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: createAgentTextMessage({
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'pending',
      contentText: '',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 101,
    }),
    partialText: 'tail that should not replace sealed content',
    partialReasoningText: 'tail reasoning',
    runtimeError: {
      code: 'OPERATION_ABORTED',
      message: 'Generation stopped.',
    },
    traceId: 'trace-tail',
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
});

test('agent shell bundle grows pending assistant content during streaming before projection rebuild seals authority', () => {
  const firstBeatBundle = overlayAgentAssistantVisibleState({
    bundle: {
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
    },
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: createAgentTextMessage({
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'pending',
      contentText: '',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 101,
    }),
    partialText: 'sealed first beat',
    partialReasoningText: '',
    updatedAtMs: 120,
  });

  const streamedBundle = overlayAgentAssistantVisibleState({
    bundle: firstBeatBundle,
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: createAgentTextMessage({
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'pending',
      contentText: '',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 101,
    }),
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
  };

  const nextBundle = overlayAgentAssistantVisibleState({
    bundle: authoritativeBundle,
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: createAgentTextMessage({
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'pending',
      contentText: '',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 101,
    }),
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
    messages: [createAgentTextMessage({
      id: 'user-1',
      threadId: 'thread-1',
      role: 'user',
      status: 'complete',
      contentText: 'hello',
      createdAtMs: 100,
      updatedAtMs: 100,
    })],
  };

  const nextBundle = overlayAgentAssistantTerminalState({
    bundle: baseBundle,
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: createAgentTextMessage({
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'pending',
      contentText: '',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 101,
    }),
    partialText: 'partial answer',
    partialReasoningText: 'stream reasoning',
    runtimeError: {
      code: 'RUNTIME_CALL_FAILED',
      message: 'runtime broke',
    },
    traceId: 'trace-1',
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
});

test('agent shell bundle resolves interrupted terminals against refreshed projection while keeping composer text', () => {
  const optimisticBundle: AgentLocalThreadBundle = {
    ...sampleBundle(),
  };
  const refreshedBundle: AgentLocalThreadBundle = {
    ...sampleBundle(),
    thread: {
      ...sampleThread(),
      updatedAtMs: 1200,
      lastMessageAtMs: 1200,
    },
  };

  const nextBundle = resolveInterruptedAgentThreadBundle({
    optimisticBundle,
    refreshedBundle,
    fallbackThread: sampleThread(),
    assistantMessageId: 'assistant-1',
    assistantPlaceholder: createAgentTextMessage({
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'pending',
      contentText: '',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 101,
    }),
    partialText: 'late tail',
    partialReasoningText: 'late reasoning',
    runtimeError: {
      code: 'OPERATION_ABORTED',
      message: 'Generation stopped.',
    },
    traceId: 'trace-tail',
    updatedAtMs: 1300,
  });

  assert.equal(nextBundle.thread.updatedAtMs, 1200);
  assert.equal(nextBundle.messages.at(-1)?.contentText, 'sealed first beat');
  assert.deepEqual(nextBundle.messages.at(-1)?.error, {
    code: 'OPERATION_ABORTED',
    message: 'Generation stopped.',
  });
});
