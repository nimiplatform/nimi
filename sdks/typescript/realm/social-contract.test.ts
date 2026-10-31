import assert from 'node:assert/strict';
import test from 'node:test';
import type { RealmGetMyPendingFriendRequestsOperationResponse } from '../core-generated/realm-typed-client';
import { ReasonCode } from '../types';
import { fetchNimiRealmPendingFriendRequests } from './index';

const PAGE = {
  items: [{ relationshipId: 'request-1', userId: 'peer-1', displayName: 'Private contact', handle: null, avatarUrl: null, isDeleted: false,
    requestedAt: '2026-06-05T00:00:00.000Z', requestMessage: null }],
  nextCursor: 'owner-page-2', total: 2,
} satisfies RealmGetMyPendingFriendRequestsOperationResponse;

function realm(response: unknown) {
  return { generated: { async getMyPendingFriendRequests() { return response as RealmGetMyPendingFriendRequestsOperationResponse; } } };
}

test('pending pages preserve minimal identities, exact relationship identity and pagination', async () => {
  let request: unknown;
  const result = await fetchNimiRealmPendingFriendRequests({ generated: {
    async getMyPendingFriendRequests(input) { request = input; return PAGE; },
  } }, () => assert.fail('valid response'), { direction: 'sent', limit: 20, cursor: 'prior-page' });
  assert.deepEqual(request, { path: {}, query: { direction: 'sent', limit: 20, cursor: 'prior-page' } });
  assert.deepEqual(result, PAGE);
});

test('pending pages fail closed on missing identity, direction-independent malformed pages and missing pagination', async () => {
  for (const malformed of [null, {}, { items: [] }, { ...PAGE, items: [{}] },
    { ...PAGE, items: [{ ...PAGE.items[0], relationshipId: '' }] }, { ...PAGE, total: -1 }]) {
    const actions: string[] = [];
    await assert.rejects(() => fetchNimiRealmPendingFriendRequests(realm(malformed), action => actions.push(action), { direction: 'received' }),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_REALM_RESPONSE_DECODE_FAILED);
    assert.deepEqual(actions, ['load-friend-requests']);
  }
});
