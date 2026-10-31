import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountHandle,
  accountLoginUrl,
  accountReturnTo,
  profilePatch,
} from '../src/auth/account-center-model.js';
import { friendRequestFailure, loadAccountPeople } from '../src/auth/account-friends.js';
import { createNimiError } from '@nimiplatform/sdk/types';
import { accountReadProblem } from '../src/auth/account-center-copy.js';

test('sign-in returns to an admitted account page and preserves the selected request list', () => {
  const link = accountLoginUrl('/account/friends', '?view=received');
  assert.equal(
    accountReturnTo(new URL(link, 'https://nimi.test').search),
    '/account/friends?view=received',
  );
  assert.equal(accountReturnTo('?returnTo=%2Faccount%2Fprivacy'), '/account/privacy');
  for (const target of [
    'https://evil.test/account',
    '//evil.test/account',
    '/account/../login',
    '/account/not-real',
    'javascript:alert(1)',
  ]) {
    assert.equal(accountReturnTo(`?returnTo=${encodeURIComponent(target)}`), '/account');
  }
  assert.equal(
    accountReturnTo(
      `?returnTo=${encodeURIComponent('/account/friends?view=sent&token=do-not-propagate')}`,
    ),
    '/account/friends?view=sent',
  );
  assert.equal(accountReturnTo('?next=https%3A%2F%2Frealm.test%2Fauthorize'), '/account');
});

test('profile editing sends only changed fields and explicitly clears optional information', () => {
  const original = {
    displayName: 'Alice',
    bio: '  Authored spacing  ',
    city: 'Shanghai',
    countryCode: 'CN',
    gender: 'FEMALE',
  };
  assert.deepEqual(
    profilePatch(original, {
      displayName: 'Alice',
      bio: original.bio,
      city: 'Shanghai',
      countryCode: 'CN',
    }),
    {},
  );
  assert.deepEqual(
    profilePatch(original, {
      displayName: ' Alice New ',
      bio: '',
      city: 'Shanghai',
      countryCode: 'CN',
    }),
    { displayName: 'Alice New', bio: null },
  );
  assert.equal(accountHandle('@alice'), 'alice');
  assert.equal(accountHandle('alice'), 'alice');
});

test('request pages retain exact relationship identities and read only the requested direction', async () => {
  const calls: unknown[] = [];
  const realm = {
    generated: {
      getMyPendingFriendRequests: async (request: unknown) => {
        calls.push(request);
        return {
          items: [
            {
              userId: 'peer',
              displayName: 'Peer',
              handle: '@peer',
              avatarUrl: null,
              isDeleted: false,
              relationshipId: 'request-specific-id',
              requestMessage: 'Hello',
              requestedAt: '2026-10-31T00:00:00Z',
            },
          ],
          nextCursor: 'next-boundary',
          total: 29,
        };
      },
      getUser: () => assert.fail('A request list must not require a full profile read'),
    },
  };
  for (const direction of ['received', 'sent'] as const) {
    const page = await loadAccountPeople(realm as never, direction, 'start-boundary');
    assert.equal(page.items[0]?.id, 'peer');
    assert.equal(page.items[0]?.relationshipId, 'request-specific-id');
    assert.equal(page.total, 29);
    assert.equal(page.nextCursor, 'next-boundary');
  }
  assert.deepEqual(
    calls,
    ['received', 'sent'].map((direction) => ({
      path: {},
      query: { cursor: 'start-boundary', direction, limit: 20 },
    })),
  );
});

test('a failed people list remains a read error instead of a false empty list', async () => {
  const error = new Error('Realm unavailable');
  const realm = {
    generated: {
      getMyPendingFriendRequests: async () => {
        throw error;
      },
    },
  };
  await assert.rejects(loadAccountPeople(realm as never, 'received'), (value) => value === error);
});

test('account reads explain a rate limit without exposing server exception text or asking for login', () => {
  const failure = createNimiError({
    source: 'realm',
    reasonCode: 'REALM_REQUEST_FAILED',
    message: 'ThrottlerException: Too Many Requests',
    details: { status: 429 },
  });
  assert.equal(
    accountReadProblem(failure, (key) => key),
    'tooManyRequests',
  );
});

test('a rejected request can be corrected while an uncertain submission requires checking its result', () => {
  const failure = (status: number) =>
    createNimiError({
      source: 'realm',
      reasonCode: 'REALM_REQUEST_FAILED',
      message: 'Request failed',
      details: { status },
    });
  assert.deepEqual(friendRequestFailure(failure(404)), { uncertain: false, copy: 'userNotFound' });
  assert.deepEqual(friendRequestFailure(failure(403)), { uncertain: false, copy: 'requestDenied' });
  assert.equal(friendRequestFailure(failure(500)).uncertain, true);
  assert.equal(friendRequestFailure(failure(200)).uncertain, true);
  assert.equal(friendRequestFailure(failure(408)).uncertain, true);
  assert.equal(friendRequestFailure(new Error('connection lost')).uncertain, true);
});
