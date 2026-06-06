import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acquireNimiManagedConnectorCredential,
  type NimiConnectorAuthAcquisitionHost,
  type NimiPersistManagedConnectorCredentialInput,
} from './index';

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

test('Nimi managed connector credential acquisition persists generated profile credential payload', async () => {
  const requests: string[] = [];
  const persisted: NimiPersistManagedConnectorCredentialInput[] = [];
  let now = Date.parse('2026-06-05T00:00:00.000Z');
  const accessToken = [
    base64UrlJson({ alg: 'none' }),
    base64UrlJson({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'account-1',
      },
    }),
    'sig',
  ].join('.');
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
    persistCredential: async (input) => {
      persisted.push(input);
      return { connectorId: 'conn-1' };
    },
  });

  assert.equal(result.profileId, 'openai_codex');
  assert.equal(result.providerAuthProfile, 'openai_codex');
  assert.equal(result.connectorId, 'conn-1');
  assert.equal(result.accountId, 'account-1');
  assert.deepEqual(requests.map((item) => item.split(':')[0]), ['device_authorization', 'device_token']);
  const credential = JSON.parse(persisted[0]?.credentialJson ?? '{}') as Record<string, unknown>;
  assert.equal(credential.access_token, accessToken);
  assert.equal(credential.refresh_token, 'refresh-token');
  assert.equal(credential.account_id, 'account-1');
  assert.equal(credential.auth_mode, 'chatgpt');
  assert.equal(credential.source, 'device-code');
});
