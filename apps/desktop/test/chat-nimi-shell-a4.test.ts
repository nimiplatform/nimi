import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AI_NEW_CONVERSATION_TITLE,
  resolveAiConversationActiveThreadId,
  resolveThreadTitleAfterFirstSend,
} from '../src/shell/renderer/features/chat/chat-nimi-thread-model.js';
import { upsertThreadSummary } from '../src/shell/renderer/features/chat/chat-nimi-shell-core.js';
import { resolveChatThinkingConfig } from '../src/shell/renderer/features/chat/chat-shared-thinking.js';

test('chat ai a4: active thread restore prefers explicit selection before last selected', () => {
  const threads = [{
    id: 'thread-a',
    title: 'alpha',
    updatedAtMs: 10,
    lastMessageAtMs: 10,
  }, {
    id: 'thread-b',
    title: 'beta',
    updatedAtMs: 20,
    lastMessageAtMs: 20,
  }];

  assert.equal(resolveAiConversationActiveThreadId({
    threads,
    selectionThreadId: 'thread-a',
    lastSelectedThreadId: 'thread-b',
  }), 'thread-a');
  assert.equal(resolveAiConversationActiveThreadId({
    threads,
    selectionThreadId: 'missing-thread',
    lastSelectedThreadId: 'thread-b',
  }), 'thread-b');
});

test('chat ai a4: first successful send replaces placeholder thread title', () => {
  assert.equal(
    resolveThreadTitleAfterFirstSend(AI_NEW_CONVERSATION_TITLE, '  first user message  '),
    'first user message',
  );
  assert.equal(
    resolveThreadTitleAfterFirstSend('Existing title', 'ignored'),
    'Existing title',
  );
});

test('chat ai a4: first successful send keeps the persisted thread selectable before refetch', () => {
  const persistedThread = {
    id: 'thread-first-send',
    title: 'first user message',
    createdAtMs: 10,
    updatedAtMs: 20,
    lastMessageAtMs: 20,
  };
  const projectedThreads = upsertThreadSummary([], persistedThread);

  assert.equal(resolveAiConversationActiveThreadId({
    threads: projectedThreads,
    selectionThreadId: persistedThread.id,
    lastSelectedThreadId: null,
  }), persistedThread.id);
});

test('chat ai a4: resolveChatThinkingConfig stays fail-close when thinking is unsupported', () => {
  assert.deepEqual(
    resolveChatThinkingConfig('on', {
      supported: false,
      reason: 'thinking_unsupported',
    }),
    {
      mode: 'off',
      traceMode: 'hide',
    },
  );
});
