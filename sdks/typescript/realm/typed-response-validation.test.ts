import assert from 'node:assert/strict';
import test from 'node:test';

import { CoreClient, type CoreTransport } from '../core-client';
import {
  RealmTypedClient,
  type RealmCheckHandleOperationRequest,
  type RealmWorldCoreControllerListWorldRelationshipsOperationRequest,
} from '../core-generated/realm-typed-client';

const request: RealmCheckHandleOperationRequest = {
  path: {},
  query: { handle: 'malformed' },
};

test('generated Realm client rejects missing required response fields', async () => {
  const transport: CoreTransport = {
    async unary() {
      return {};
    },
    async *serverStream() {
      return;
    },
  };
  const client = new RealmTypedClient(new CoreClient({ transport }));

  await assert.rejects(client.checkHandle(request), (error: unknown) => {
    return (
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'SDK_REALM_RESPONSE_DECODE_FAILED'
    );
  });
});

test('generated Realm client rejects wrong scalar response types', async () => {
  const transport: CoreTransport = {
    async unary() {
      return { available: 'yes', message: 'malformed' };
    },
    async *serverStream() {
      return;
    },
  };
  const client = new RealmTypedClient(new CoreClient({ transport }));

  await assert.rejects(client.checkHandle(request), /expected boolean/);
});

test('generated Realm client accepts null inside unconstrained JSON values', async () => {
  const response = [{
    id: 'relationship-1',
    schemaVersion: '1',
    contentRevision: 1,
    contentHash: 'relationship-hash',
    origin: { kind: 'import' },
    worldId: 'world-1',
    sourceEntityId: 'entity-1',
    targetEntityId: 'entity-2',
    type: 'authored',
    core: {
      attributes: {
        year: null,
        nested: { value: null },
        values: [null],
      },
      endpoints: {
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        type: 'authored',
      },
      presentation: {},
      evidence: {
        sourceRefs: ['source-1'],
        confidence: 'recorded',
      },
      authoring: {
        source: 'seed',
      },
    },
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  }];
  const transport: CoreTransport = {
    async unary() {
      return response;
    },
    async *serverStream() {
      return;
    },
  };
  const client = new RealmTypedClient(new CoreClient({ transport }));
  const relationshipRequest: RealmWorldCoreControllerListWorldRelationshipsOperationRequest = {
    path: { worldId: 'world-1' },
    query: {},
  };

  assert.deepEqual(
    await client.worldCoreControllerListWorldRelationships(relationshipRequest),
    response,
  );
});
