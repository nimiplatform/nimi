import assert from 'node:assert/strict';
import test from 'node:test';

import { ConnectorGrantStatus } from '../core-generated/runtime-typed-client.js';
import {
  createNimiRuntimeConnectorGrantClient,
  type NimiRuntimeConnectorGrantRpcClient,
} from './connector-grants.js';

const CREATED_AT = { seconds: '1785888000', nanos: 0 };
const REVOKED_AT = { seconds: '1785888060', nanos: 0 };

function activeGrant(grantId: string, connectorId: string) {
  return {
    grantId,
    connectorId,
    accountId: 'account-1',
    status: ConnectorGrantStatus.ACTIVE,
    createdAt: CREATED_AT,
  };
}

function revokedGrant(grantId: string, connectorId: string) {
  return {
    ...activeGrant(grantId, connectorId),
    status: ConnectorGrantStatus.REVOKED,
    revokedAt: REVOKED_AT,
  };
}

test('ConnectorGrant client creates, paginates, and revokes account authorization without target fields', async () => {
  const calls: Array<{ method: string; request: unknown; idempotencyKey?: string }> = [];
  const runtime = {
    async createConnectorGrant(request, options) {
      calls.push({ method: 'create', request, idempotencyKey: options?.metadata?.idempotencyKey });
      return { grant: activeGrant('grant-1', request.connectorId) };
    },
    async listConnectorGrants(request) {
      calls.push({ method: 'list', request });
      return request.pageToken
        ? { grants: [revokedGrant('grant-0', 'connector-0')], nextPageToken: '' }
        : { grants: [activeGrant('grant-1', 'connector-1')], nextPageToken: 'page-2' };
    },
    async revokeConnectorGrant(request, options) {
      calls.push({ method: 'revoke', request, idempotencyKey: options?.metadata?.idempotencyKey });
      return { grant: revokedGrant(request.grantId, 'connector-1') };
    },
  } satisfies NimiRuntimeConnectorGrantRpcClient;
  const client = createNimiRuntimeConnectorGrantClient({ runtime });

  const created = await client.create('connector-1');
  const listed = await client.list();
  const revoked = await client.revoke('grant-1');

  assert.deepEqual(created, {
    grantId: 'grant-1',
    connectorId: 'connector-1',
    status: 'active',
    createdAt: '2026-08-05T00:00:00.000Z',
    revokedAt: null,
  });
  assert.deepEqual(listed.map((grant) => grant.status), ['active', 'revoked']);
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.revokedAt, '2026-08-05T00:01:00.000Z');
  assert.match(calls[0]?.idempotencyKey ?? '', /^connector-grant-create-/u);
  assert.match(calls[3]?.idempotencyKey ?? '', /^connector-grant-revoke-/u);
  assert.doesNotMatch(JSON.stringify(calls), /provider|model|target/iu);
});

test('ConnectorGrant client rejects malformed lifecycle projections and inexact identifiers', async () => {
  const runtime = {
    async createConnectorGrant() {
      return { grant: { ...activeGrant('grant-1', 'connector-1'), revokedAt: REVOKED_AT } };
    },
    async listConnectorGrants() {
      return { grants: [], nextPageToken: '' };
    },
    async revokeConnectorGrant() {
      return { grant: activeGrant('grant-1', 'connector-1') };
    },
  } satisfies NimiRuntimeConnectorGrantRpcClient;
  const client = createNimiRuntimeConnectorGrantClient({ runtime });
  assert.throws(
    () => createNimiRuntimeConnectorGrantClient({ runtime, maxPages: 201 }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_CONNECTOR_GRANT_INPUT_INVALID',
  );

  await assert.rejects(
    () => client.create(' connector-1 '),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_CONNECTOR_GRANT_INPUT_INVALID',
  );
  await assert.rejects(
    () => client.create('connector-1'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_CONNECTOR_GRANT_RESPONSE_INVALID',
  );
  await assert.rejects(
    () => client.revoke('grant-1'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_CONNECTOR_GRANT_RESPONSE_INVALID',
  );
});
