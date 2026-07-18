import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CharacterSourceKindV3,
  RealmSourceMaterializationReasonCode,
} from '../core-generated/runtime-typed-client';
import type { CoreUnaryRequest } from '../types';
import { Runtime, type CoreTransport } from './index';
import { createNimiRuntimePlatformClient } from './platform-client';

function createTransport(): CoreTransport {
  return {
    async unary() {
      throw new Error('transport should not be called during platform client construction');
    },
    async *serverStream() {
      throw new Error('transport should not be called during platform client construction');
    },
  };
}

function createMaterializationTransport(calls: CoreUnaryRequest[]): CoreTransport {
  return {
    async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
      calls.push(request);
      assert.equal(
        request.methodId,
        '/nimi.runtime.v1.RuntimeAgentService/MaterializeRealmSource',
      );
      return {
        localAgentRef: `local-agent:${String((request.body as { requestId?: string }).requestId)}`,
        idempotentReplay: false,
        reasonCode: RealmSourceMaterializationReasonCode.NONE,
      } as Response;
    },
    async *serverStream() {
      throw new Error('platform materialization does not open streams');
    },
  };
}

test('createNimiRuntimePlatformClient owns Runtime construction for platform consumers', () => {
  const transport = createTransport();
  const client = createNimiRuntimePlatformClient({
    appId: 'nimi.desktop',
    transport,
    createRuntimeAuthMetadata: ({ accountRuntime }) => {
      assert.ok(accountRuntime instanceof Runtime);
      return async () => ({ authorization: 'Bearer runtime-session' });
    },
  });

  assert.ok(client.runtime instanceof Runtime);
  assert.ok(client.accountRuntime instanceof Runtime);
  assert.notEqual(client.runtime, client.accountRuntime);
  assert.equal(client.domains.runtimeAdmin, client.accountRuntime);
});

test('createNimiRuntimePlatformClient does not return singleton Runtime handles', () => {
  const first = createNimiRuntimePlatformClient({
    appId: 'nimi.desktop',
    transport: createTransport(),
  });
  const second = createNimiRuntimePlatformClient({
    appId: 'nimi.desktop',
    transport: createTransport(),
  });

  assert.notEqual(first.runtime, second.runtime);
  assert.notEqual(first.accountRuntime, second.accountRuntime);
});

test('platform client injects account session projection into both Runtime materialization facades', async () => {
  const calls: CoreUnaryRequest[] = [];
  const accountSessionProjection = { accountId: 'account-1' };
  const client = createNimiRuntimePlatformClient({
    appId: 'nimi.desktop',
    transport: createMaterializationTransport(calls),
    getSubjectUserId: () => accountSessionProjection.accountId,
    createRuntimeAuthMetadata: () => async () => ({ authorization: 'Bearer runtime-session' }),
  });
  const sourceRef = {
    kind: 'personaCharacter' as const,
    id: 'persona-1',
    worldId: 'world-1',
    ownerAccountId: 'account-1',
    sourceHash: 'a'.repeat(64),
  };

  const runtimeInput = { sourceRef, requestId: 'runtime-materialize-1' };
  const accountRuntimeInput = { sourceRef, requestId: 'account-runtime-materialize-1' };
  await client.runtime.materializeRealmSource(runtimeInput);
  await client.accountRuntime.materializeRealmSource(accountRuntimeInput);

  assert.deepEqual(Object.keys(runtimeInput).sort(), ['requestId', 'sourceRef']);
  assert.deepEqual(Object.keys(accountRuntimeInput).sort(), ['requestId', 'sourceRef']);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const body = call.body as {
      context?: Record<string, unknown>;
      requestId?: string;
      sourceRef?: unknown;
    };
    assert.deepEqual(body.context, {
      appId: 'nimi.desktop',
      subjectUserId: accountSessionProjection.accountId,
      ownerUserId: accountSessionProjection.accountId,
      runtimeSourceRef: '',
      localAgentRef: '',
    });
    assert.deepEqual(body.sourceRef, {
      source: {
        oneofKind: 'personaCharacter',
        personaCharacter: {
          kind: CharacterSourceKindV3.PERSONA_CHARACTER,
          id: 'persona-1',
          worldId: 'world-1',
          ownerAccountId: 'account-1',
          sourceHash: 'a'.repeat(64),
        },
      },
    });
    assert.equal('authorization' in body, false);
    assert.equal('bearer' in body, false);
    assert.equal('auth' in body, false);
  }
});

test('platform client materialization fails closed when account session projection is absent', async () => {
  const calls: CoreUnaryRequest[] = [];
  const accountSessionProjection: { accountId?: string } = {};
  const client = createNimiRuntimePlatformClient({
    appId: 'nimi.desktop',
    transport: createMaterializationTransport(calls),
    getSubjectUserId: () => accountSessionProjection.accountId,
  });

  await assert.rejects(
    client.runtime.materializeRealmSource({
      sourceRef: {
        kind: 'personaCharacter',
        id: 'persona-1',
        worldId: 'world-1',
        ownerAccountId: 'account-1',
        sourceHash: 'b'.repeat(64),
      },
      requestId: 'missing-account-session',
    }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_AGENT_SUBJECT_REQUIRED',
  );
  assert.equal(calls.length, 0);
});
