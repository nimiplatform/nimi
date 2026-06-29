import assert from 'node:assert/strict';
import test from 'node:test';

import { assertGroupTriggerMessageMatchesChat } from '../src/shell/renderer/features/chat/data/realm-group-trigger-evidence';

const baseTriggerMessage = {
  id: 'message-1',
  chatId: 'group-1',
  senderId: 'user-1',
  author: {
    accountId: 'user-1',
    avatarUrl: null,
    displayName: 'User One',
    runtimeParticipantSlot: null,
    runtimeSourceRef: null,
    sourceOwnerId: null,
    sourceRef: null,
    type: 'human',
  },
  createdAt: '2026-06-05T00:00:00.000Z',
  text: '@Source hello',
  payload: null,
  type: 'TEXT',
} as const;

test('group trigger evidence boundary accepts a committed trigger message from the same chat and actor', () => {
  assert.equal(
    assertGroupTriggerMessageMatchesChat({
      chatId: 'group-1',
      currentUserId: 'user-1',
      triggerMessage: baseTriggerMessage,
    }),
    'message-1',
  );
});

test('group trigger evidence boundary rejects a trigger message from another chat', () => {
  assert.throws(
    () => assertGroupTriggerMessageMatchesChat({
      chatId: 'group-1',
      currentUserId: 'user-1',
      triggerMessage: {
        ...baseTriggerMessage,
        chatId: 'group-2',
      },
    }),
    /trigger message chatId must match the target group chat/u,
  );
});

test('group trigger evidence boundary rejects a trigger message from another author', () => {
  assert.throws(
    () => assertGroupTriggerMessageMatchesChat({
      chatId: 'group-1',
      currentUserId: 'user-1',
      triggerMessage: {
        ...baseTriggerMessage,
        senderId: 'user-2',
        author: {
          ...baseTriggerMessage.author,
          accountId: 'user-2',
        },
      },
    }),
    /trigger message author must match the authenticated actor/u,
  );
});
