import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoreTransport } from '../core-client';
import type { CoreStreamRequest, CoreUnaryRequest } from '../types';
import {
  addNimiRealmGroupParticipant,
  createNimiRealmGroupChat,
  createNimiRealmGroupTextMessageInput,
  createRealm,
  listNimiRealmGroupChats,
  loadNimiRealmGroupChat,
  loadNimiRealmGroupMessages,
  markNimiRealmGroupRead,
  removeNimiRealmGroupParticipant,
  sendNimiRealmGroupMessage,
  syncNimiRealmGroupEvents,
} from './index';

class FakeRealmTransport implements CoreTransport {
  readonly unaryCalls: CoreUnaryRequest[] = [];

  async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
    this.unaryCalls.push(request);
    if (request.methodId === 'listGroups') {
      return { items: [], nextCursor: '' } as Response;
    }
    if (request.methodId === 'listGroupMessages') {
      return { items: [], nextAfter: '', nextBefore: '' } as Response;
    }
    if (request.methodId === 'syncGroupEvents') {
      return { events: [], highWatermarkSeq: 10, mode: 'delta' } as Response;
    }
    if (request.methodId === 'sendGroupMessage') {
      return { id: 'message-1', chatId: 'group-1', type: 'TEXT', text: 'hello' } as Response;
    }
    if (request.methodId === 'getGroup' || request.methodId === 'createGroup') {
      return { id: 'group-1', type: 'GROUP', title: 'Group', participants: [] } as Response;
    }
    if (request.methodId === 'addGroupParticipant') {
      return { accountId: 'user-2', type: 'human' } as Response;
    }
    return {} as Response;
  }

  async *serverStream<Response>(_request: CoreStreamRequest): AsyncIterable<Response> {
    throw new Error('Realm group chat helper must not use stream transport');
  }
}

test('Realm group chat helpers normalize inputs and fail closed', () => {
  assert.deepEqual(createNimiRealmGroupTextMessageInput(' hello ', ' cm-1 '), {
    clientMessageId: 'cm-1',
    type: 'TEXT',
    text: 'hello',
    payload: { content: 'hello' },
  });

  assert.throws(
    () => createNimiRealmGroupTextMessageInput('', 'cm-1'),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_GROUP_MESSAGE_TEXT_REQUIRED',
  );
  assert.throws(
    () => createNimiRealmGroupTextMessageInput('hello', ''),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode ===
      'SDK_REALM_GROUP_MESSAGE_CLIENT_ID_REQUIRED',
  );
});

test('Realm group chat helpers build generated request envelopes', async () => {
  const transport = new FakeRealmTransport();
  const realm = createRealm({ transport });

  await listNimiRealmGroupChats(realm, 999);
  await loadNimiRealmGroupChat(realm, ' group-1 ');
  await loadNimiRealmGroupMessages(realm, 'group-1', 999);
  await sendNimiRealmGroupMessage(
    realm,
    'group-1',
    createNimiRealmGroupTextMessageInput('hello', 'cm-1'),
  );
  await markNimiRealmGroupRead(realm, 'group-1');
  await createNimiRealmGroupChat(realm, {
    title: 'Group',
    participantIds: ['user-2'],
    text: 'hello',
  });
  await addNimiRealmGroupParticipant(realm, 'group-1', ' user-2 ');
  await removeNimiRealmGroupParticipant(realm, 'group-1', ' user-2 ');
  await syncNimiRealmGroupEvents(realm, 'group-1', 3.9, 999);

  assert.deepEqual(transport.unaryCalls.map((call) => call.methodId), [
    'listGroups',
    'getGroup',
    'listGroupMessages',
    'sendGroupMessage',
    'markGroupRead',
    'createGroup',
    'addGroupParticipant',
    'removeGroupParticipant',
    'syncGroupEvents',
  ]);
  assert.deepEqual(transport.unaryCalls[0]?.body, { path: {}, query: { limit: 100 } });
  assert.deepEqual(transport.unaryCalls[1]?.body, { path: { chatId: 'group-1' } });
  assert.deepEqual(transport.unaryCalls[2]?.body, {
    path: { chatId: 'group-1' },
    query: { limit: 100 },
  });
  assert.deepEqual(transport.unaryCalls[3]?.body, {
    path: { chatId: 'group-1' },
    body: {
      clientMessageId: 'cm-1',
      type: 'TEXT',
      text: 'hello',
      payload: { content: 'hello' },
    },
  });
  assert.deepEqual(transport.unaryCalls[4]?.body, { path: { chatId: 'group-1' } });
  assert.deepEqual(transport.unaryCalls[5]?.body, {
    path: {},
    body: {
      title: 'Group',
      participantIds: ['user-2'],
      text: 'hello',
    },
  });
  assert.deepEqual(transport.unaryCalls[6]?.body, {
    path: { chatId: 'group-1' },
    body: { accountId: 'user-2' },
  });
  assert.deepEqual(transport.unaryCalls[7]?.body, {
    path: { chatId: 'group-1', accountId: 'user-2' },
  });
  assert.deepEqual(transport.unaryCalls[8]?.body, {
    path: { chatId: 'group-1' },
    query: { limit: 500, afterSeq: 3 },
  });
});
