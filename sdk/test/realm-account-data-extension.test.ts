import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '../src/types/index.js';
import type { Realm } from '../src/realm/client.js';
import {
  requestDataExport,
  requestAccountDeletion,
} from '../src/realm/extensions/account-data.js';

type AccountDataRequestInput = {
  body?: unknown;
};

type FakeRealm = {
  services: {
    MeaccountdataService: {
      requestDataExport: (input?: unknown) => Promise<unknown>;
      requestAccountDeletion: (input?: unknown) => Promise<unknown>;
    };
  };
};

function createFakeRealm(handler: (input: AccountDataRequestInput) => Promise<unknown>): FakeRealm {
  return {
    services: {
      MeaccountdataService: {
        requestDataExport: async (input) => handler({ body: input }),
        requestAccountDeletion: async (input) => handler({ body: input }),
      },
    },
  };
}

test('requestDataExport builds account-data export request and maps response', async () => {
  const requests: AccountDataRequestInput[] = [];
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

test('account-data extension fails closed when export backend is unavailable', async () => {
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

  await assert.rejects(
    () => requestDataExport(realm as unknown as Realm, {}),
    (thrown: unknown) => {
      const normalized = thrown as {
        reasonCode?: string;
        actionHint?: string;
        details?: Record<string, unknown>;
      };
      assert.equal(normalized.reasonCode, ReasonCode.REALM_UNAVAILABLE);
      assert.equal(normalized.actionHint, 'upgrade_realm_account_data_api');
      assert.equal(normalized.details?.httpStatus, 404);
      assert.equal(normalized.details?.operation, 'export');
      assert.equal(normalized.details?.originalReasonCode, ReasonCode.REALM_NOT_FOUND);
      return true;
    },
  );
});

test('account-data extension fails closed when deletion backend is unavailable', async () => {
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

  await assert.rejects(
    () => requestAccountDeletion(realm as unknown as Realm, {}),
    (thrown: unknown) => {
      const normalized = thrown as {
        reasonCode?: string;
        actionHint?: string;
        details?: Record<string, unknown>;
      };
      assert.equal(normalized.reasonCode, ReasonCode.REALM_UNAVAILABLE);
      assert.equal(normalized.actionHint, 'upgrade_realm_account_data_api');
      assert.equal(normalized.details?.httpStatus, 404);
      assert.equal(normalized.details?.operation, 'delete');
      assert.equal(normalized.details?.originalReasonCode, ReasonCode.REALM_NOT_FOUND);
      return true;
    },
  );
});

test('requestDataExport treats 501 as backend unavailable error', async () => {
  const error = new Error('not implemented') as Error & {
    reasonCode?: string;
    details?: Record<string, unknown>;
  };
  error.details = {
    httpStatus: 501,
  };
  const realm = createFakeRealm(async () => {
    throw error;
  });

  await assert.rejects(
    () => requestDataExport(realm as unknown as Realm, {}),
    (thrown: unknown) => {
      const normalized = thrown as {
        reasonCode?: string;
        actionHint?: string;
        details?: Record<string, unknown>;
      };
      assert.equal(normalized.reasonCode, ReasonCode.REALM_UNAVAILABLE);
      assert.equal(normalized.actionHint, 'upgrade_realm_account_data_api');
      assert.equal(normalized.details?.httpStatus, 501);
      assert.equal(normalized.details?.operation, 'export');
      return true;
    },
  );
});

test('account-data extension rethrows non-availability errors', async () => {
  const error = new Error('boom') as Error & {
    reasonCode?: string;
    details?: Record<string, unknown>;
  };
  error.reasonCode = ReasonCode.REALM_UNAVAILABLE;
  error.details = {
    httpStatus: 500,
  };
  const realm = createFakeRealm(async () => {
    throw error;
  });

  await assert.rejects(
    () => requestAccountDeletion(realm as unknown as Realm, {}),
    (thrown: unknown) => {
      const normalized = thrown as { reasonCode?: string; details?: Record<string, unknown> };
      assert.equal(normalized.reasonCode, ReasonCode.REALM_UNAVAILABLE);
      assert.equal(normalized.details?.httpStatus, 500);
      return true;
    },
  );
});
