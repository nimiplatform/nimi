import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoreTransport } from '../core-client';
import type { CoreStreamRequest, CoreUnaryRequest } from '../types';
import {
  addNimiRealmGroupSourceParticipant,
  addNimiRealmGroupParticipant,
  commitNimiRealmGroupSourceMessageCandidate,
  createNimiRealmGroupChat,
  createNimiRealmGroupTextMessageInput,
  createRealm,
  listNimiRealmGroupChats,
  loadNimiRealmGroupChat,
  loadNimiRealmGroupMessages,
  markNimiRealmGroupRead,
  removeNimiRealmGroupParticipant,
  removeNimiRealmGroupSourceParticipant,
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
    if (request.methodId === 'addGroupSourceParticipant') {
      return { accountId: 'slot-1', type: 'source' } as Response;
    }
    if (request.methodId === 'commitRealmGroupSourceMessageCandidate') {
      return { status: 'committed', message: { id: 'message-2' } } as Response;
    }
    return {} as Response;
  }

  async *serverStream<Response>(_request: CoreStreamRequest): AsyncIterable<Response> {
    throw new Error('Realm group chat helper must not use stream transport');
  }
}

function hasReasonCode(reasonCode: string): (error: unknown) => boolean {
  return (error: unknown) => (error as { reasonCode?: string }).reasonCode === reasonCode;
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
  await addNimiRealmGroupSourceParticipant(realm, 'group-1', {
    sourceRef: {
      kind: 'worldCharacter',
      worldId: 'world-1',
      sourceId: 'char-1',
      sourceContentHash: 'sha256:source',
    },
    runtimeSourceRef: 'runtime-source:worldCharacter:world-1:char-1:sha256:source',
    displayName: 'Source One',
    handle: 'source-one',
  });
  await commitNimiRealmGroupSourceMessageCandidate(realm, 'group-1', {
    candidateId: 'candidate-1',
    candidateKind: 'REALM_GROUP_MESSAGE_CANDIDATE',
    candidateEvidenceRef: 'runtime-candidate-evidence://candidate-1',
    evidenceHash: 'sha256:evidence',
    runtimeTraceRef: 'runtime-trace://trace-1',
    expectedRuntimeParticipantSlotId: 'slot-1',
    expectedRuntimeSourceRef: 'runtime-source:worldCharacter:world-1:char-1:sha256:source',
    triggerRef: 'realm://group-chats/group-1/messages/message-1',
    outputCandidateRef: 'runtime-output://candidate-1',
    auditLineageRef: 'runtime-audit://candidate-1',
    policyVerdictRef: 'runtime-policy://candidate-1',
    createdAt: '2026-06-18T00:00:00.000Z',
    expiresAt: '2026-06-18T00:05:00.000Z',
    commitDisposition: 'MESSAGE_CANDIDATE',
    messageType: 'TEXT',
    body: 'hello from source',
    bodyHash: 'sha256:body',
    idempotencyKey: 'rgmc-1',
  });
  await removeNimiRealmGroupSourceParticipant(realm, 'group-1', ' slot-1 ');
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
    'addGroupSourceParticipant',
    'commitRealmGroupSourceMessageCandidate',
    'removeGroupSourceParticipant',
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
    body: {
      sourceRef: {
        kind: 'worldCharacter',
        worldId: 'world-1',
        sourceId: 'char-1',
        sourceContentHash: 'sha256:source',
      },
      runtimeSourceRef: 'runtime-source:worldCharacter:world-1:char-1:sha256:source',
      displayName: 'Source One',
      handle: 'source-one',
    },
  });
  assert.deepEqual(transport.unaryCalls[9]?.body, {
    path: { chatId: 'group-1' },
    body: {
      candidateId: 'candidate-1',
      candidateKind: 'REALM_GROUP_MESSAGE_CANDIDATE',
      candidateEvidenceRef: 'runtime-candidate-evidence://candidate-1',
      evidenceHash: 'sha256:evidence',
      runtimeTraceRef: 'runtime-trace://trace-1',
      expectedRuntimeParticipantSlotId: 'slot-1',
      expectedRuntimeSourceRef: 'runtime-source:worldCharacter:world-1:char-1:sha256:source',
      triggerRef: 'realm://group-chats/group-1/messages/message-1',
      outputCandidateRef: 'runtime-output://candidate-1',
      auditLineageRef: 'runtime-audit://candidate-1',
      policyVerdictRef: 'runtime-policy://candidate-1',
      createdAt: '2026-06-18T00:00:00.000Z',
      expiresAt: '2026-06-18T00:05:00.000Z',
      commitDisposition: 'MESSAGE_CANDIDATE',
      messageType: 'TEXT',
      body: 'hello from source',
      bodyHash: 'sha256:body',
      idempotencyKey: 'rgmc-1',
    },
  });
  assert.deepEqual(transport.unaryCalls[10]?.body, {
    path: { chatId: 'group-1', runtimeParticipantSlotId: 'slot-1' },
  });
  assert.deepEqual(transport.unaryCalls[11]?.body, {
    path: { chatId: 'group-1' },
    query: { limit: 500, afterSeq: 3 },
  });
});

test('Realm group source helpers fail closed before transport calls', async () => {
  const transport = new FakeRealmTransport();
  const realm = createRealm({ transport });
  const sourceParticipantInput = {
    sourceRef: {
      kind: 'worldCharacter',
      worldId: 'world-1',
      sourceId: 'char-1',
      sourceContentHash: 'sha256:source',
    },
    runtimeSourceRef: 'runtime-source:worldCharacter:world-1:char-1:sha256:source',
    displayName: 'Source One',
    handle: 'source-one',
  } as const;
  const sourceMessageCandidateInput = {
    candidateId: 'candidate-1',
    candidateKind: 'REALM_GROUP_MESSAGE_CANDIDATE',
    candidateEvidenceRef: 'runtime-candidate-evidence://candidate-1',
    evidenceHash: 'sha256:evidence',
    runtimeTraceRef: 'runtime-trace://trace-1',
    expectedRuntimeParticipantSlotId: 'slot-1',
    expectedRuntimeSourceRef: 'runtime-source:worldCharacter:world-1:char-1:sha256:source',
    triggerRef: 'realm://group-chats/group-1/messages/message-1',
    outputCandidateRef: 'runtime-output://candidate-1',
    auditLineageRef: 'runtime-audit://candidate-1',
    policyVerdictRef: 'runtime-policy://candidate-1',
    createdAt: '2026-06-18T00:00:00.000Z',
    expiresAt: '2026-06-18T00:05:00.000Z',
    commitDisposition: 'MESSAGE_CANDIDATE',
    messageType: 'TEXT',
    body: 'hello from source',
    bodyHash: 'sha256:body',
    idempotencyKey: 'rgmc-1',
  } as const;

  await assert.rejects(
    () => addNimiRealmGroupSourceParticipant(realm, ' ', sourceParticipantInput),
    hasReasonCode('SDK_REALM_GROUP_CHAT_ID_REQUIRED'),
  );
  await assert.rejects(
    () => commitNimiRealmGroupSourceMessageCandidate(realm, '', sourceMessageCandidateInput),
    hasReasonCode('SDK_REALM_GROUP_CHAT_ID_REQUIRED'),
  );
  await assert.rejects(
    () => removeNimiRealmGroupSourceParticipant(realm, 'group-1', ' '),
    hasReasonCode('SDK_REALM_GROUP_RUNTIME_PARTICIPANT_SLOT_REQUIRED'),
  );
  assert.equal(transport.unaryCalls.length, 0);
});
