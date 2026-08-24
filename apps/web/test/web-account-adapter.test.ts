import assert from 'node:assert/strict';
import test from 'node:test';
import { ReasonCode, createNimiError } from '@nimiplatform/sdk/types';
import { loadWebCurrentAccount } from '../src/auth/web-account-adapter.js';

test('current-account loader returns the Realm account record', async () => {
  await assert.doesNotReject(async () => {
    const user = await loadWebCurrentAccount(async () => ({
      id: 'account-1',
      handle: 'alice',
      displayName: 'Alice',
      createdAt: '2026-08-24T00:00:00.000Z',
      role: 'USER',
    }));
    assert.equal(user?.id, 'account-1');
  });
});

test('current-account loader maps only classified anonymous session errors to null', async () => {
  for (const reasonCode of [
    'AUTH_REQUIRED',
    'AUTH_TOKEN_EXPIRED',
  ]) {
    const result = await loadWebCurrentAccount(async () => {
      throw createNimiError({
        message: 'No active Realm browser session.',
        reasonCode,
        source: 'sdk',
      });
    });
    assert.equal(result, null);
  }
});

test('current-account loader propagates Realm outages, offline failures, and decode errors', async () => {
  const unavailable = createNimiError({
    message: 'Realm unavailable.',
    reasonCode: ReasonCode.REALM_UNAVAILABLE,
    source: 'sdk',
  });
  await assert.rejects(
    loadWebCurrentAccount(async () => { throw unavailable; }),
    (error) => error === unavailable,
  );

  const offline = new TypeError('fetch failed');
  await assert.rejects(
    loadWebCurrentAccount(async () => { throw offline; }),
    (error) => error === offline,
  );

  const unclassifiedUnauthorized = new Error('HTTP_401 unauthorized');
  await assert.rejects(
    loadWebCurrentAccount(async () => { throw unclassifiedUnauthorized; }),
    (error) => error === unclassifiedUnauthorized,
  );

  const invalidResponse = createNimiError({
    message: 'Realm response decode failed.',
    reasonCode: ReasonCode.SDK_REALM_AUTH_RESPONSE_INVALID,
    source: 'sdk',
  });
  await assert.rejects(
    loadWebCurrentAccount(async () => { throw invalidResponse; }),
    (error) => error === invalidResponse,
  );
});

test('current-account loader rejects malformed success payloads', async () => {
  for (const payload of [null, {}, { id: 'account-1' }]) {
    await assert.rejects(
      loadWebCurrentAccount(async () => payload),
      (error: unknown) => (
        typeof error === 'object'
        && error !== null
        && (error as { reasonCode?: unknown }).reasonCode === ReasonCode.SDK_REALM_AUTH_RESPONSE_INVALID
      ),
    );
  }
});
