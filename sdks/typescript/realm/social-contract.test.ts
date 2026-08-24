import assert from 'node:assert/strict';
import test from 'node:test';

import type { RealmGetMyPendingFriendRequestsOperationResponse } from '../core-generated/realm-typed-client';
import { ReasonCode } from '../types';
import { fetchNimiRealmPendingFriendRequests } from './index';

const PENDING_FRIEND_REQUESTS_FIXTURE = {
  received: [{
    userId: 'pending-1',
    requestedAt: '2026-06-05T00:00:00.000Z',
    requestMessage: null,
  }],
  sent: [],
} satisfies RealmGetMyPendingFriendRequestsOperationResponse;

function createPendingFriendRequestRealm(
  response: RealmGetMyPendingFriendRequestsOperationResponse,
) {
  return {
    generated: {
      async getMyPendingFriendRequests() {
        return response;
      },
    },
  };
}

function isRealmDecodeError(error: unknown): boolean {
  return (error as { readonly reasonCode?: string }).reasonCode
    === ReasonCode.SDK_REALM_RESPONSE_DECODE_FAILED;
}

test('Realm pending friend requests preserve the generated required response fields', async () => {
  const result = await fetchNimiRealmPendingFriendRequests(
    createPendingFriendRequestRealm(PENDING_FRIEND_REQUESTS_FIXTURE),
    () => assert.fail('valid pending friend response emitted an error'),
  );

  assert.deepEqual(result, {
    received: [{
      userId: 'pending-1',
      requestedAt: '2026-06-05T00:00:00.000Z',
      requestMessage: null,
    }],
    sent: [],
  });
});

test('Realm pending friend requests fail closed on malformed roots and collections', async () => {
  const emittedActions: string[] = [];
  const emitError = (action: string) => emittedActions.push(action);

  await assert.rejects(
    () => fetchNimiRealmPendingFriendRequests(
      createPendingFriendRequestRealm(
        {} as unknown as RealmGetMyPendingFriendRequestsOperationResponse,
      ),
      emitError,
    ),
    isRealmDecodeError,
  );
  await assert.rejects(
    () => fetchNimiRealmPendingFriendRequests(
      createPendingFriendRequestRealm(
        null as unknown as RealmGetMyPendingFriendRequestsOperationResponse,
      ),
      emitError,
    ),
    isRealmDecodeError,
  );
  await assert.rejects(
    () => fetchNimiRealmPendingFriendRequests(
      createPendingFriendRequestRealm(
        { received: 'not-an-array' } as unknown as RealmGetMyPendingFriendRequestsOperationResponse,
      ),
      emitError,
    ),
    isRealmDecodeError,
  );
  await assert.rejects(
    () => fetchNimiRealmPendingFriendRequests(
      createPendingFriendRequestRealm(
        { received: [{}] } as unknown as RealmGetMyPendingFriendRequestsOperationResponse,
      ),
      emitError,
    ),
    isRealmDecodeError,
  );

  assert.deepEqual(emittedActions, [
    'load-friend-requests',
    'load-friend-requests',
    'load-friend-requests',
    'load-friend-requests',
  ]);
});
