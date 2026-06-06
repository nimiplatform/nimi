import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addRealmGroupAgent,
  commitRealmGroupMessageCandidate,
  createRealmGroupChat,
  createRealmGroupTextMessageInput,
  listRealmGroupChats,
  loadRealmGroupChat,
  loadRealmGroupMessages,
  markRealmGroupRead,
  removeRealmGroupAgent,
  sendRealmGroupMessage,
  syncRealmGroupEvents,
} from '../src/realm/extensions/group-chat.js';

function createRealm(events: string[]) {
  return {
    services: {
      GroupChatsService: {
        listGroups: async (limit: number) => {
          events.push(`list:${limit}`);
          return { items: [] };
        },
        getGroup: async (chatId: string) => {
          events.push(`get:${chatId}`);
          return { id: chatId };
        },
        listGroupMessages: async (chatId: string, limit: number) => {
          events.push(`messages:${chatId}:${limit}`);
          return { items: [] };
        },
        sendGroupMessage: async (chatId: string, input: Record<string, unknown>) => {
          events.push(`send:${chatId}:${String(input.clientMessageId)}:${String(input.text)}`);
          return { id: 'message-1', chatId };
        },
        commitRealmGroupMessageCandidate: async (chatId: string, input: Record<string, unknown>) => {
          events.push(`commit:${chatId}:${String(input.candidateId)}`);
          return { message: { id: 'message-committed', chatId } };
        },
        markGroupRead: async (chatId: string) => {
          events.push(`read:${chatId}`);
        },
        createGroup: async (input: Record<string, unknown>) => {
          events.push(`create:${String(input.title)}`);
          return { id: 'group-1' };
        },
        addGroupAgent: async (chatId: string, input: Record<string, unknown>) => {
          events.push(`add:${chatId}:${String(input.agentAccountId)}`);
          return { id: chatId };
        },
        removeGroupAgent: async (chatId: string, agentAccountId: string) => {
          events.push(`remove:${chatId}:${agentAccountId}`);
        },
        syncGroupEvents: async (chatId: string, limit: number, afterSeq: number) => {
          events.push(`sync:${chatId}:${limit}:${afterSeq}`);
          return { snapshot: { items: [] } };
        },
      },
    },
  };
}

test('createRealmGroupTextMessageInput builds the admitted text message envelope', () => {
  assert.deepEqual(createRealmGroupTextMessageInput(' hello ', ' cm-1 '), {
    clientMessageId: 'cm-1',
    type: 'TEXT',
    text: 'hello',
    payload: { content: 'hello' },
  });
  assert.throws(() => createRealmGroupTextMessageInput('', 'cm-1'), /REALM_GROUP_MESSAGE_TEXT_REQUIRED/);
  assert.throws(() => createRealmGroupTextMessageInput('hello', ''), /REALM_GROUP_MESSAGE_CLIENT_ID_REQUIRED/);
});

test('Realm group chat helpers call the typed Realm service facade', async () => {
  const events: string[] = [];
  const realm = createRealm(events) as never;

  await listRealmGroupChats(realm, 250);
  await loadRealmGroupChat(realm, ' group-1 ');
  await loadRealmGroupMessages(realm, 'group-1', 250);
  await sendRealmGroupMessage(realm, 'group-1', createRealmGroupTextMessageInput('hello', 'cm-1'));
  await commitRealmGroupMessageCandidate(realm, 'group-1', { candidateId: 'candidate-1' } as never);
  await markRealmGroupRead(realm, 'group-1');
  await createRealmGroupChat(realm, { title: 'Group', participantIds: [] } as never);
  await addRealmGroupAgent(realm, 'group-1', ' agent-1 ');
  await removeRealmGroupAgent(realm, 'group-1', ' agent-1 ');
  await syncRealmGroupEvents(realm, 'group-1', 12.8, 600);

  assert.deepEqual(events, [
    'list:100',
    'get:group-1',
    'messages:group-1:100',
    'send:group-1:cm-1:hello',
    'commit:group-1:candidate-1',
    'read:group-1',
    'create:Group',
    'add:group-1:agent-1',
    'remove:group-1:agent-1',
    'sync:group-1:500:12',
  ]);
});

test('Realm group chat helpers fail closed on missing ids', async () => {
  const realm = createRealm([]) as never;
  await assert.rejects(() => loadRealmGroupChat(realm, ' '), /REALM_GROUP_CHAT_ID_REQUIRED/);
  await assert.rejects(() => addRealmGroupAgent(realm, 'group-1', ' '), /REALM_GROUP_AGENT_ACCOUNT_ID_REQUIRED/);
  await assert.rejects(() => removeRealmGroupAgent(realm, 'group-1', ' '), /REALM_GROUP_AGENT_ACCOUNT_ID_REQUIRED/);
});
