import assert from 'node:assert/strict';
import test from 'node:test';

import { CoreClient, type CoreTransport } from '../core-client';
import {
  RealmTypedClient,
  type RealmCheckHandleOperationRequest,
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
