import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AppPermissionGrantDto,
  RealmTypedCallOptions,
} from '../core-generated/realm-typed-client';
import {
  createAppScopeRef,
  createPermissionClient,
  type PermissionScopeRef,
} from '../core/app';
import { createNimiRealmPermissionTransport, type NimiRealmPermissionGrantModule } from './index';

const scopeRef = createAppScopeRef({ appId: 'tester.app', surfaceId: 'settings' });
const permissionScope: PermissionScopeRef = {
  appId: 'tester.app',
  scopeFamily: 'account',
  scopeName: 'account.read',
};

function realmGrant(input: Partial<AppPermissionGrantDto> = {}): AppPermissionGrantDto {
  return {
    grantId: 'grant-1',
    subjectAccountId: 'account-1',
    appId: 'tester.app',
    scopeFamily: 'account',
    scopeName: 'account.read',
    state: 'GRANTED',
    reason: 'settings diagnostics',
    version: 7,
    requestedAt: '2026-06-10T00:00:00.000Z',
    requestedByAccountId: 'account-1',
    ...input,
  };
}

test('Realm permission transport maps canonical lifecycle grants into SDK PermissionClient', async () => {
  const calls: string[] = [];
  let revokeExpectedVersion: number | undefined;
  const module: NimiRealmPermissionGrantModule = {
    async listMyAppPermissionGrants(request, _options?: RealmTypedCallOptions) {
      calls.push(`list:${request.query?.appId ?? ''}`);
      return { items: [realmGrant()] };
    },
    async getMyAppPermissionGrant(request) {
      calls.push(`get:${request.path.grantId}`);
      return realmGrant({ grantId: request.path.grantId });
    },
    async getMyAppPermissionGrantStatus(request) {
      calls.push(`status:${request.query?.appId ?? ''}`);
      return {
        generatedAt: '2026-06-10T00:00:01.000Z',
        grants: [realmGrant()],
      };
    },
    async requestMyAppPermissionGrant(request) {
      calls.push(`request:${request.body.appId}:${request.body.scopeName}`);
      return realmGrant({ grantId: 'grant-existing', state: 'GRANTED' });
    },
    async revokeMyAppPermissionGrant(request) {
      calls.push(`revoke:${request.path.grantId}`);
      revokeExpectedVersion = request.body.expectedVersion;
      return realmGrant({ grantId: request.path.grantId, state: 'REVOKED' });
    },
  };

  const client = createPermissionClient(createNimiRealmPermissionTransport({ permissionGrants: module }));

  assert.equal((await client.list(scopeRef))[0]?.state, 'granted');
  assert.equal((await client.status(scopeRef)).generatedAt, '2026-06-10T00:00:01.000Z');
  assert.equal((await client.request(scopeRef, { permissionScope, reason: 'settings diagnostics' })).state, 'granted');
  assert.equal((await client.revoke(scopeRef, 'grant-1')).state, 'revoked');
  assert.equal(revokeExpectedVersion, 7);
  assert.deepEqual(calls, [
    'list:tester.app',
    'status:tester.app',
    'request:tester.app:account.read',
    'get:grant-1',
    'revoke:grant-1',
  ]);
});

test('PermissionClient rejects live cross-app permission requests', async () => {
  const client = createPermissionClient(createNimiRealmPermissionTransport({
    permissionGrants: {
      async listMyAppPermissionGrants() { return { items: [] }; },
      async getMyAppPermissionGrant() { return realmGrant(); },
      async getMyAppPermissionGrantStatus() {
        return { generatedAt: '2026-06-10T00:00:01.000Z', grants: [] };
      },
      async requestMyAppPermissionGrant() { return realmGrant(); },
      async revokeMyAppPermissionGrant() { return realmGrant({ state: 'REVOKED' }); },
    },
  }));

  await assert.rejects(
    client.request(scopeRef, {
      permissionScope: { ...permissionScope, appId: 'other.app' },
      reason: 'cross-app access',
    }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode === 'SDK_PERMISSION_CROSS_APP_ACCESS_NOT_ADMITTED',
  );
});

test('Realm permission transport rejects explicit subject overrides', async () => {
  const client = createPermissionClient(createNimiRealmPermissionTransport({
    permissionGrants: {
      async listMyAppPermissionGrants() { return { items: [] }; },
      async getMyAppPermissionGrant() { return realmGrant(); },
      async getMyAppPermissionGrantStatus() {
        return { generatedAt: '2026-06-10T00:00:01.000Z', grants: [] };
      },
      async requestMyAppPermissionGrant() { return realmGrant(); },
      async revokeMyAppPermissionGrant() { return realmGrant({ state: 'REVOKED' }); },
    },
  }));

  await assert.rejects(
    client.request(scopeRef, {
      permissionScope,
      subjectUserId: 'other-account',
      reason: 'subject override',
    }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_PERMISSION_SUBJECT_NOT_ADMITTED',
  );
});
