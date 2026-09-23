import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendOptimisticUserMessage,
  createEmptyBundle,
  replaceMessage,
  restoreDraftAfterFailedSend,
} from '../src/shell/renderer/features/chat/chat-nimi-shell-core.js';
import { createPlainTextMessageContent } from '../src/shell/renderer/features/chat/chat-nimi-thread-model.js';
import type { ChatAiMessageRecord, ChatAiThreadRecord } from '../src/shell/shared/chat-ai-store-types.js';

const thread: ChatAiThreadRecord = {
  id: 'thread-fresh',
  title: 'New conversation',
  createdAtMs: 100,
  updatedAtMs: 100,
  lastMessageAtMs: null,
};

function userMessage(id: string, text: string, createdAtMs: number): ChatAiMessageRecord {
  return {
    id,
    threadId: thread.id,
    role: 'user',
    status: 'pending',
    contentText: text,
    content: createPlainTextMessageContent(text),
    error: null,
    traceId: null,
    parentMessageId: null,
    createdAtMs,
    updatedAtMs: createdAtMs,
  };
}

test('optimistic send: a fresh thread shows the sent text before Runtime answers', () => {
  const bundle = appendOptimisticUserMessage(undefined, thread, userMessage('m1', '你好啊，你是谁？', 101));

  assert.equal(bundle.thread.id, thread.id);
  assert.deepEqual(bundle.messages.map((message) => [message.id, message.status, message.contentText]), [
    ['m1', 'pending', '你好啊，你是谁？'],
  ]);
  assert.equal(bundle.draft, null);
});

test('optimistic send: an existing thread keeps its history and clears the stored draft', () => {
  const current = {
    ...createEmptyBundle(thread),
    messages: [userMessage('m0', 'earlier', 50)],
    draft: { threadId: thread.id, text: 'typed', attachments: [], updatedAtMs: 60 },
  };
  const bundle = appendOptimisticUserMessage(current, thread, userMessage('m1', 'later', 101));

  assert.deepEqual(bundle.messages.map((message) => message.id), ['m0', 'm1']);
  assert.equal(bundle.draft, null);
});

test('optimistic send: the persisted user message replaces its optimistic twin by id', () => {
  const bundle = appendOptimisticUserMessage(undefined, thread, userMessage('m1', 'hello', 101));
  const persisted: ChatAiMessageRecord = { ...userMessage('m1', 'hello', 101), status: 'complete' };
  const messages = replaceMessage(bundle.messages, persisted);

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.status, 'complete');
});

test('optimistic send: a failed send removes the pending message and restores the draft', () => {
  const bundle = appendOptimisticUserMessage(undefined, thread, userMessage('m1', 'hello', 101));
  const draft = { threadId: thread.id, text: 'hello', attachments: [], updatedAtMs: 200 };
  const restored = restoreDraftAfterFailedSend(bundle, 'm1', draft);

  assert.ok(restored);
  assert.deepEqual(restored.messages, []);
  assert.deepEqual(restored.draft, draft);
  assert.equal(restoreDraftAfterFailedSend(null, 'm1', draft), null);
});
