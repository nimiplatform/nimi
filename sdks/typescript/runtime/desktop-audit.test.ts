import assert from 'node:assert/strict';
import test from 'node:test';

import { CallerKind, ReasonCode } from '../core-generated/runtime-typed-client';
import {
  NimiDesktopAuditProjectionContractError,
  createNimiDesktopAuditProjectionClient,
  type NimiDesktopAuditProjectionRuntime,
} from './desktop-audit';

const fromTime = { seconds: '1000', nanos: 0 };
const toTime = { seconds: String(1000 + 24 * 60 * 60), nanos: 0 };

function validRequest() {
  return {
    traceId: '',
    requestId: '',
    appId: '',
    domain: 'runtime.agent',
    operation: '',
    reasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
    callerKind: CallerKind.UNSPECIFIED,
    fromTime,
    toTime,
    pageSize: 50,
    pageToken: '',
  };
}

test('desktop audit client calls only the exact projection and returns whitelisted fields', async () => {
  let captured: unknown;
  const runtime: NimiDesktopAuditProjectionRuntime = {
    async listDesktopAuditEvents(request) {
      captured = request;
      return {
        events: [{
          auditId: 'audit-1',
          requestId: 'request-1',
          appId: 'nimi.desktop',
          domain: 'runtime.agent',
          operation: 'inventory.list',
          reasonCode: ReasonCode.ACTION_EXECUTED,
          traceId: 'trace-1',
          timestamp: fromTime,
          callerKind: CallerKind.DESKTOP_CORE,
        }],
        nextPageToken: '',
      };
    },
  };
  const response = await createNimiDesktopAuditProjectionClient({ runtime }).listEvents(validRequest());
  assert.deepEqual(Object.keys(captured as Record<string, unknown>).sort(), [
    'appId',
    'callerKind',
    'domain',
    'fromTime',
    'operation',
    'pageSize',
    'pageToken',
    'reasonCode',
    'requestId',
    'toTime',
    'traceId',
  ]);
  assert.deepEqual(Object.keys(response.events[0] ?? {}).sort(), [
    'appId',
    'auditId',
    'callerKind',
    'domain',
    'operation',
    'reasonCode',
    'requestId',
    'timestamp',
    'traceId',
  ]);
});

test('desktop audit client rejects unbounded requests before transport', async () => {
  let calls = 0;
  const runtime: NimiDesktopAuditProjectionRuntime = {
    async listDesktopAuditEvents() {
      calls += 1;
      return { events: [], nextPageToken: '' };
    },
  };
  const client = createNimiDesktopAuditProjectionClient({ runtime });
  await assert.rejects(
    client.listEvents({
      ...validRequest(),
      toTime: { seconds: String(1000 + 8 * 24 * 60 * 60), nanos: 0 },
    }),
    NimiDesktopAuditProjectionContractError,
  );
  await assert.rejects(
    client.listEvents({ ...validRequest(), pageSize: 101 }),
    NimiDesktopAuditProjectionContractError,
  );
  assert.equal(calls, 0);
});

test('desktop audit client rejects raw or credential-adjacent response fields', async () => {
  const runtime = {
    async listDesktopAuditEvents() {
      return {
        events: [{
          auditId: 'audit-1',
          requestId: '',
          appId: 'nimi.desktop',
          domain: 'runtime.auth',
          operation: 'session.open',
          reasonCode: ReasonCode.ACTION_EXECUTED,
          traceId: 'trace-1',
          timestamp: fromTime,
          callerKind: CallerKind.DESKTOP_CORE,
          payload: { accessToken: 'forbidden' },
          tokenId: 'forbidden',
        }],
        nextPageToken: '',
      };
    },
  } as unknown as NimiDesktopAuditProjectionRuntime;
  await assert.rejects(
    createNimiDesktopAuditProjectionClient({ runtime }).listEvents(validRequest()),
    /forbidden fields/u,
  );
});

test('desktop audit client rejects request-only generic proxy fields', async () => {
  const runtime: NimiDesktopAuditProjectionRuntime = {
    async listDesktopAuditEvents() {
      return { events: [], nextPageToken: '' };
    },
  };
  const request = { ...validRequest(), methodId: '/arbitrary', requestBytes: new Uint8Array() };
  await assert.rejects(
    createNimiDesktopAuditProjectionClient({ runtime }).listEvents(request),
    /forbidden fields/u,
  );
});
