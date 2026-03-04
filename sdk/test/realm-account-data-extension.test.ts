import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '../src/types/index.js';
import type { Realm } from '../src/realm/client.js';
import {
  requestDataExport,
  requestAccountDeletion,
} from '../src/realm/extensions/account-data.js';

type RawRequestInput = {
  method: string;
  path: string;
  body?: unknown;
};

type FakeRealm = {
  raw: {
    request: (input: RawRequestInput) => Promise<unknown>;
  };
};

function createFakeRealm(handler: (input: RawRequestInput) => Promise<unknown>): FakeRealm {
  return {
    raw: {
      request: handler,
    },
  };
}

test('requestDataExport builds account-data export request and maps response', async () => {
  const requests: RawRequestInput[] = [];
  const realm = createFakeRealm(async (input) => {
    requests.push(input);
    return {
      accepted: true,
      taskId: 'exp_01',
      status: 'PENDING',
      requestedAt: '2026-03-04T00:00:00.000Z',
    };
  });

  const result = await requestDataExport(realm as unknown as Realm, {
    format: 'JSON',
    includeMedia: true,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, 'POST');
  assert.equal(requests[0]?.path, '/api/auth/me/data-export');
  assert.deepEqual(requests[0]?.body, {
    format: 'JSON',
    includeMedia: true,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.taskId, 'exp_01');
  assert.equal(result.status, 'PENDING');
});

test('requestAccountDeletion normalizes response aliases', async () => {
  const realm = createFakeRealm(async () => ({
    ok: true,
    id: 'del_42',
    state: 'PROCESSING',
    effective_at: '2026-03-05T00:00:00.000Z',
  }));

  const result = await requestAccountDeletion(
    realm as unknown as Realm,
    { reason: 'privacy' },
  );

  assert.equal(result.accepted, true);
  assert.equal(result.taskId, 'del_42');
  assert.equal(result.status, 'PROCESSING');
  assert.equal(result.scheduledDeletionAt, '2026-03-05T00:00:00.000Z');
});

test('account-data extension maps 404 backend gaps to UNAVAILABLE result', async () => {
  const error = new Error('not found') as Error & {
    reasonCode?: string;
    details?: Record<string, unknown>;
  };
  error.reasonCode = ReasonCode.REALM_NOT_FOUND;
  error.details = {
    httpStatus: 404,
  };
  const realm = createFakeRealm(async () => {
    throw error;
  });

  const exportResult = await requestDataExport(
    realm as unknown as Realm,
    {},
  );
  const deletionResult = await requestAccountDeletion(
    realm as unknown as Realm,
    {},
  );

  assert.equal(exportResult.accepted, false);
  assert.equal(exportResult.status, 'UNAVAILABLE');
  assert.equal(exportResult.reasonCode, 'REALM_ACCOUNT_DATA_UNAVAILABLE');

  assert.equal(deletionResult.accepted, false);
  assert.equal(deletionResult.status, 'UNAVAILABLE');
  assert.equal(deletionResult.reasonCode, 'REALM_ACCOUNT_DATA_UNAVAILABLE');
});
