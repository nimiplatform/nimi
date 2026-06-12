import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConnectorAuthKind,
  ConnectorKind,
  ConnectorOwnerType,
  ConnectorStatus,
} from '../core-generated/runtime-typed-client';
import {
  acquireNimiManagedConnectorCredential,
  type NimiConnectorAuthAcquisitionHost,
} from './index';

test('Nimi managed connector credential acquisition persists through Runtime connector API', async () => {
  const requests: string[] = [];
  const runtimeRequests: unknown[] = [];
  let now = Date.parse('2026-06-05T00:00:00.000Z');
  const accessToken = 'managed-access-token';
  const host: NimiConnectorAuthAcquisitionHost = {
    async proxyHttp(request) {
      requests.push(`${request.purpose}:${request.url}`);
      if (request.purpose === 'device_authorization') {
        return {
          status: 200,
          ok: true,
          body: JSON.stringify({
            user_code: 'USER-CODE',
            device_auth_id: 'device-auth-1',
            interval: 3,
            expires_in: 60,
            verification_uri_complete: 'https://auth.openai.com/device',
          }),
        };
      }
      return {
        status: 200,
        ok: true,
        body: JSON.stringify({
          authorization_code: 'auth-code',
          code_verifier: 'verifier',
        }),
      };
    },
    async openExternalUrl(url) {
      assert.equal(url, 'https://auth.openai.com/device');
      return { opened: true };
    },
    async oauthTokenExchange(input) {
      assert.equal(input.provider, 'CODEX');
      assert.equal(input.code, 'auth-code');
      assert.equal(input.codeVerifier, 'verifier');
      return {
        accessToken,
        refreshToken: 'refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'openid',
      };
    },
    async sleep(ms) {
      now += ms;
    },
    now: () => now,
  };

  const result = await acquireNimiManagedConnectorCredential({
    profileId: 'openai_codex',
    host,
    runtime: {
      async createConnector(request) {
        runtimeRequests.push(request);
        return {
          connector: {
            connectorId: 'conn-1',
            kind: ConnectorKind.REMOTE_MANAGED,
            ownerType: ConnectorOwnerType.USER,
            ownerId: 'user-1',
            provider: request.provider,
            endpoint: request.endpoint,
            label: request.label,
            status: ConnectorStatus.ACTIVE,
            localCategory: 0,
            hasCredential: true,
            authKind: request.authKind,
            providerAuthProfile: request.providerAuthProfile,
          },
        };
      },
      async updateConnector() {
        throw new Error('updateConnector should not be called for a new acquisition');
      },
    },
  });

  assert.equal(result.profileId, 'openai_codex');
  assert.equal(result.providerAuthProfile, 'openai_codex');
  assert.equal(result.connectorId, 'conn-1');
  assert.deepEqual(requests.map((item) => item.split(':')[0]), ['device_authorization', 'device_token']);
  assert.equal((runtimeRequests[0] as { authKind?: unknown }).authKind, ConnectorAuthKind.OAUTH_MANAGED);
  assert.equal((runtimeRequests[0] as { providerAuthProfile?: unknown }).providerAuthProfile, 'openai_codex');
  const credential = JSON.parse((runtimeRequests[0] as { credentialJson?: string }).credentialJson ?? '{}') as Record<string, unknown>;
  assert.equal(credential.access_token, accessToken);
  assert.equal(credential.refresh_token, 'refresh-token');
  assert.equal(credential.auth_mode, undefined);
  assert.equal(credential.source, undefined);
  assert.equal(credential.account_id, undefined);
});
