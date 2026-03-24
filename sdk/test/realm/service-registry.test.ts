import assert from 'node:assert/strict';
import test from 'node:test';

import { REALM_SERVICE_METHODS } from '../../src/realm/generated/operation-map.js';
import {
  createRealmServiceRegistry,
  type RealmRawRequestInput,
} from '../../src/realm/generated/service-registry.js';

test('createRealmServiceRegistry exposes every generated service', () => {
  const registry = createRealmServiceRegistry(async () => undefined);

  assert.deepEqual(
    Object.keys(registry).sort(),
    Object.keys(REALM_SERVICE_METHODS).sort(),
  );
});

test('service registry replaces and encodes path parameters', async () => {
  const seenInputs: RealmRawRequestInput[] = [];
  const registry = createRealmServiceRegistry(async (input) => {
    seenInputs.push(input);
    return { ok: true };
  });

  await registry.HumanChatsService.recallMessage('chat 1', 'msg/9');

  assert.equal(seenInputs.length, 1);
  assert.equal(seenInputs[0]?.path, '/api/human/chats/chat%201/messages/msg%2F9/recall');
});

test('service registry omits undefined query parameters', async () => {
  const seenInputs: RealmRawRequestInput[] = [];
  const registry = createRealmServiceRegistry(async (input) => {
    seenInputs.push(input);
    return { ok: true };
  });

  await registry.HumanChatsService.listMessages('chat-123');

  assert.equal(seenInputs.length, 1);
  assert.equal(seenInputs[0]?.path, '/api/human/chats/chat-123/messages');
  assert.equal(seenInputs[0]?.query, undefined);
});

test('service registry forwards tail options for body operations', async () => {
  const seenInputs: RealmRawRequestInput[] = [];
  const registry = createRealmServiceRegistry(async (input) => {
    seenInputs.push(input);
    return { ok: true };
  });

  await registry.AuthService.passwordLogin(
    { email: 'test@nimi.xyz', password: 'secret' },
    {
      headers: { 'x-test': '1' },
      timeoutMs: 250,
    },
  );

  assert.equal(seenInputs.length, 1);
  assert.equal(seenInputs[0]?.headers?.['x-test'], '1');
  assert.equal(seenInputs[0]?.timeoutMs, 250);
});

test('service registry forwards abort signals via tail options', async () => {
  const seenInputs: RealmRawRequestInput[] = [];
  const registry = createRealmServiceRegistry(async (input) => {
    seenInputs.push(input);
    return { ok: true };
  });
  const controller = new AbortController();

  await registry.AuthService.passwordLogin(
    { email: 'test@nimi.xyz', password: 'secret' },
    {
      signal: controller.signal,
    },
  );

  assert.equal(seenInputs.length, 1);
  assert.equal(seenInputs[0]?.signal, controller.signal);
});

test('service registry forwards bodies for body operations', async () => {
  const seenInputs: RealmRawRequestInput[] = [];
  const registry = createRealmServiceRegistry(async (input) => {
    seenInputs.push(input);
    return { ok: true };
  });

  const payload = {
    email: 'test@nimi.xyz',
    password: 'secret',
  };

  await registry.AuthService.passwordLogin(payload);

  assert.equal(seenInputs.length, 1);
  assert.equal(seenInputs[0]?.method, 'POST');
  assert.deepEqual(seenInputs[0]?.body, payload);
});

test('service registry throws when required path params are missing', async () => {
  const registry = createRealmServiceRegistry(async () => ({ ok: true }));

  await assert.rejects(
    () => registry.HumanChatsService.recallMessage(undefined as unknown as string, 'msg-1'),
    /missing required path param: chatId/,
  );
});
