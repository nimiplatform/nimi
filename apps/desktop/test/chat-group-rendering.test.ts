import assert from 'node:assert/strict';
import test from 'node:test';
import { groupMessageToCanonical } from '../src/shell/renderer/features/chat/chat-group-thread-model';

test('groupMessageToCanonical maps current user, other human, and source into distinct canonical roles', () => {
  const currentUserMessage = groupMessageToCanonical({
    id: 'msg_self',
    chatId: 'chat_1',
    senderId: 'user_self',
    text: 'hello',
    payload: null,
    createdAt: '2026-04-15T00:00:00.000Z',
    editedAt: null,
    author: {
      type: 'human',
      accountId: 'user_self',
      displayName: 'Halliday',
      avatarUrl: null,
      agentOwnerId: null,
    },
  } as never, 'user_self');
  assert.equal(currentUserMessage.role, 'user');

  const otherHumanMessage = groupMessageToCanonical({
    id: 'msg_other',
    chatId: 'chat_1',
    senderId: 'user_other',
    text: 'hi there',
    payload: null,
    createdAt: '2026-04-15T00:01:00.000Z',
    editedAt: null,
    author: {
      type: 'human',
      accountId: 'user_other',
      displayName: 'Amber',
      avatarUrl: null,
      agentOwnerId: null,
    },
  } as never, 'user_self');
  assert.equal(otherHumanMessage.role, 'assistant');
  assert.equal(otherHumanMessage.senderKind, 'human');

  const sourceMessage = groupMessageToCanonical({
    id: 'msg_source',
    chatId: 'chat_1',
    senderId: 'source_1',
    text: 'I can help.',
    payload: null,
    createdAt: '2026-04-15T00:02:00.000Z',
    editedAt: null,
    author: {
      type: 'source',
      accountId: 'source_1',
      displayName: 'CuiCui',
      avatarUrl: 'https://example.com/source.png',
      sourceOwnerId: 'user_self',
    },
  } as never, 'user_self');
  assert.equal(sourceMessage.role, 'assistant');
  assert.equal(sourceMessage.senderKind, 'source');
});
