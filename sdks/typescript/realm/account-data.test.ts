import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requestNimiRealmAccountDeletion,
  requestNimiRealmDataExport,
  type NimiRealmAccountDataApi,
} from './index';
import { ReasonCode } from '../types';

test('Realm account-data helpers project generated success responses', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown }> = [];
  const realm = {
    account: {
      async requestAccountDeletion(request) {
        calls.push({ method: 'requestAccountDeletion', request });
        return {
          accepted: true,
          status: 'PENDING',
        };
      },
      async requestDataExport(request) {
        calls.push({ method: 'requestDataExport', request });
        return {
          accepted: true,
          taskId: 'export-1',
          status: 'PROCESSING',
          requestedAt: '2026-06-05T00:00:00Z',
        };
      },
    },
  } as unknown as NimiRealmAccountDataApi;

  assert.deepEqual(await requestNimiRealmAccountDeletion(realm, { reason: 'user_request' }), {
    accepted: true,
    taskId: undefined,
    status: 'PENDING',
    reasonCode: undefined,
    actionHint: undefined,
    message: undefined,
    scheduledDeletionAt: undefined,
  });
  assert.deepEqual(await requestNimiRealmDataExport(realm, { format: 'JSON' }), {
    accepted: true,
    taskId: 'export-1',
    status: 'PROCESSING',
    reasonCode: undefined,
    actionHint: undefined,
    message: undefined,
    requestedAt: '2026-06-05T00:00:00Z',
  });
  assert.deepEqual(calls, [
    {
      method: 'requestAccountDeletion',
      request: {
        path: {},
        body: { reason: 'user_request' },
      },
    },
    {
      method: 'requestDataExport',
      request: {
        path: {},
        body: { format: 'JSON' },
      },
    },
  ]);
});

test('Realm account-data helper preserves explicit rejection payload', async () => {
  const realm = {
    account: {
      async requestAccountDeletion() {
        return {
          accepted: false,
          status: 'UNAVAILABLE',
          reasonCode: 'ACCOUNT_DELETE_DISABLED',
          actionHint: 'contact_support',
          message: 'Deletion is temporarily disabled.',
        };
      },
      async requestDataExport() {
        return { accepted: false, status: 'FAILED' };
      },
    },
  } as unknown as NimiRealmAccountDataApi;

  assert.deepEqual(await requestNimiRealmAccountDeletion(realm), {
    accepted: false,
    taskId: undefined,
    status: 'UNAVAILABLE',
    reasonCode: 'ACCOUNT_DELETE_DISABLED',
    actionHint: 'contact_support',
    message: 'Deletion is temporarily disabled.',
    scheduledDeletionAt: undefined,
  });
});

test('Realm account-data helper fails closed on missing acceptance evidence', async () => {
  const realm = {
    account: {
      async requestAccountDeletion() {
        return {};
      },
      async requestDataExport() {
        return { status: 'PENDING' };
      },
    },
  } as unknown as NimiRealmAccountDataApi;

  await assert.rejects(
    () => requestNimiRealmAccountDeletion(realm),
    (error: unknown) => {
      const record = error as { readonly reasonCode?: string; readonly actionHint?: string; readonly source?: string };
      assert.equal(record.reasonCode, ReasonCode.SDK_REALM_RESPONSE_DECODE_FAILED);
      assert.equal(record.actionHint, 'check_realm_account_data_response');
      assert.equal(record.source, 'realm');
      return true;
    },
  );
  await assert.rejects(
    () => requestNimiRealmDataExport(realm),
    (error: unknown) => (error as { readonly reasonCode?: string }).reasonCode
      === ReasonCode.SDK_REALM_RESPONSE_DECODE_FAILED,
  );
});

test('Realm account-data helper fail-closes unavailable backend errors', async () => {
  const realm = {
    account: {
      async requestAccountDeletion() {
        throw {
          reasonCode: ReasonCode.REALM_NOT_FOUND,
          message: 'not found',
          details: { httpStatus: 404 },
        };
      },
      async requestDataExport() {
        return {};
      },
    },
  } as unknown as NimiRealmAccountDataApi;

  await assert.rejects(
    () => requestNimiRealmAccountDeletion(realm),
    (error: unknown) => {
      const record = error as { readonly reasonCode?: string; readonly actionHint?: string; readonly source?: string };
      assert.equal(record.reasonCode, ReasonCode.REALM_UNAVAILABLE);
      assert.equal(record.actionHint, 'upgrade_realm_account_data_api');
      assert.equal(record.source, 'realm');
      return true;
    },
  );
});
