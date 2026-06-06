import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONNECTOR_AUTH_ACQUISITION_PROFILES,
  acquireManagedConnectorCredential,
  type ConnectorAuthAcquisitionHttpRequest,
  type PersistManagedConnectorCredentialInput,
} from '../../src/runtime/index.js';

function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

test('connector auth acquisition profile is generated from sdk spec table', () => {
  const profile = CONNECTOR_AUTH_ACQUISITION_PROFILES.openai_codex;

  assert.equal(profile.profileId, 'openai_codex');
  assert.equal(profile.providerAuthProfile, 'openai_codex');
  assert.equal(profile.issuer, 'https://auth.openai.com');
  assert.equal(profile.clientId, 'app_EMoamEEZ73f0CkXaXp7hrann');
  assert.equal(profile.deviceAuthorizationUrl, 'https://auth.openai.com/api/accounts/deviceauth/usercode');
  assert.equal(profile.deviceTokenUrl, 'https://auth.openai.com/api/accounts/deviceauth/token');
  assert.equal(profile.redirectUri, 'https://auth.openai.com/deviceauth/callback');
  assert.equal(profile.fallbackVerificationUrl, 'https://auth.openai.com/codex/device');
  assert.equal(profile.tokenExchangeProvider, 'CODEX');
});

test('acquireManagedConnectorCredential completes device-code flow and persists secret through injected callback', async () => {
  const accessToken = createJwt({
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_test_789',
    },
  });
  const proxyCalls: ConnectorAuthAcquisitionHttpRequest[] = [];
  const pendingStates: string[] = [];
  const persisted: PersistManagedConnectorCredentialInput[] = [];
  let pollAttempts = 0;

  const result = await acquireManagedConnectorCredential({
    profileId: 'openai_codex',
    host: {
      proxyHttp: async (payload) => {
        proxyCalls.push(payload);
        if (payload.url.includes('/deviceauth/usercode')) {
          return {
            status: 200,
            ok: true,
            headers: {},
            body: JSON.stringify({
              user_code: 'ABCD-1234',
              device_auth_id: 'device-auth-id',
              interval: 1,
              expires_in: 600,
              verification_uri_complete: 'https://auth.openai.com/codex/device?user_code=ABCD-1234',
            }),
          };
        }
        pollAttempts += 1;
        if (pollAttempts === 1) {
          return {
            status: 404,
            ok: false,
            headers: {},
            body: '',
          };
        }
        return {
          status: 200,
          ok: true,
          headers: {},
          body: JSON.stringify({
            authorization_code: 'authorization-code',
            code_verifier: 'code-verifier',
          }),
        };
      },
      openExternalUrl: async (url: string) => {
        pendingStates.push(url);
        return { opened: true };
      },
      oauthTokenExchange: async (payload) => {
        assert.equal(payload.provider, 'CODEX');
        assert.equal(payload.clientId, 'app_EMoamEEZ73f0CkXaXp7hrann');
        assert.equal(payload.code, 'authorization-code');
        assert.equal(payload.codeVerifier, 'code-verifier');
        return {
          accessToken,
          refreshToken: 'refresh-token',
          tokenType: 'Bearer',
          expiresIn: 7200,
          scope: 'openid profile offline_access',
          raw: {},
        };
      },
      sleep: async () => {},
      now: () => Date.parse('2026-04-23T12:00:00.000Z'),
    },
    onPending: (pending) => {
      pendingStates.push(`${pending.userCode}@${pending.verificationUrl}`);
    },
    persistCredential: async (input) => {
      persisted.push(input);
      return { connectorId: 'connector-openai-codex' };
    },
  });

  assert.equal(proxyCalls.length, 3);
  assert.equal(proxyCalls[0]?.profileId, 'openai_codex');
  assert.equal(proxyCalls[0]?.purpose, 'device_authorization');
  assert.equal(proxyCalls[1]?.profileId, 'openai_codex');
  assert.equal(proxyCalls[1]?.purpose, 'device_token');
  assert.equal(proxyCalls[2]?.profileId, 'openai_codex');
  assert.equal(proxyCalls[2]?.purpose, 'device_token');
  assert.equal(proxyCalls[0]?.url.endsWith('/deviceauth/usercode'), true);
  assert.equal(proxyCalls[1]?.url.endsWith('/deviceauth/token'), true);
  assert.equal(proxyCalls[2]?.url.endsWith('/deviceauth/token'), true);
  assert.ok(pendingStates.includes('ABCD-1234@https://auth.openai.com/codex/device?user_code=ABCD-1234'));
  assert.ok(pendingStates.includes('https://auth.openai.com/codex/device?user_code=ABCD-1234'));
  assert.equal(result.connectorId, 'connector-openai-codex');
  assert.equal(result.accountId, 'acct_test_789');
  assert.equal(result.providerAuthProfile, 'openai_codex');
  assert.equal('credentialJson' in result, false);
  assert.equal('accessToken' in result, false);

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]?.profileId, 'openai_codex');
  assert.equal(persisted[0]?.providerAuthProfile, 'openai_codex');
  assert.equal(persisted[0]?.accountId, 'acct_test_789');
  const parsed = JSON.parse(String(persisted[0]?.credentialJson || '')) as Record<string, unknown>;
  assert.equal(parsed.access_token, accessToken);
  assert.equal(parsed.refresh_token, 'refresh-token');
  assert.equal(parsed.account_id, 'acct_test_789');
  assert.equal(parsed.auth_mode, 'chatgpt');
  assert.equal(parsed.source, 'device-code');
  assert.equal(parsed.issuer, 'https://auth.openai.com');
  assert.equal(parsed.expires_at, '2026-04-23T14:00:00.000Z');
});

test('acquireManagedConnectorCredential uses fallback verification URL from profile', async () => {
  let openedUrl = '';

  await acquireManagedConnectorCredential({
    profileId: 'openai_codex',
    host: {
      proxyHttp: async (payload) => {
        if (payload.url.includes('/deviceauth/usercode')) {
          return {
            status: 200,
            ok: true,
            headers: {},
            body: JSON.stringify({
              user_code: 'FALLBACK',
              device_auth_id: 'device-auth-id',
              interval: 1,
              expires_in: 10,
            }),
          };
        }
        return {
          status: 200,
          ok: true,
          headers: {},
          body: JSON.stringify({
            authorization_code: 'authorization-code',
            code_verifier: 'code-verifier',
          }),
        };
      },
      openExternalUrl: async (url: string) => {
        openedUrl = url;
        return { opened: true };
      },
      oauthTokenExchange: async () => ({
        accessToken: createJwt({}),
        raw: {},
      }),
      sleep: async () => {},
      now: () => Date.parse('2026-04-23T12:00:00.000Z'),
    },
    persistCredential: async () => ({ connectorId: 'connector-openai-codex' }),
  });

  assert.equal(openedUrl, 'https://auth.openai.com/codex/device');
});

test('acquireManagedConnectorCredential surfaces poll timeout details when authorization never completes', async () => {
  let currentNow = 0;
  let pollAttempts = 0;

  await assert.rejects(
    () => acquireManagedConnectorCredential({
      profileId: 'openai_codex',
      host: {
        proxyHttp: async (payload) => {
          if (payload.url.includes('/deviceauth/usercode')) {
            return {
              status: 200,
              ok: true,
              headers: {},
              body: JSON.stringify({
                user_code: 'ZXCV-9876',
                device_auth_id: 'device-auth-timeout',
                interval: 1,
                expires_in: 7,
                verification_uri_complete: 'https://auth.openai.com/codex/device?user_code=ZXCV-9876',
              }),
            };
          }
          pollAttempts += 1;
          return {
            status: pollAttempts === 2 ? 403 : 404,
            ok: false,
            headers: {},
            body: JSON.stringify({
              error: pollAttempts === 2 ? 'slow_down' : 'authorization_pending',
              error_description: pollAttempts === 2 ? 'authorization still pending' : 'pending approval',
            }),
          };
        },
        openExternalUrl: async () => ({ opened: true }),
        oauthTokenExchange: async () => {
          throw new Error('token exchange should not run');
        },
        sleep: async (ms) => {
          currentNow += ms;
        },
        now: () => currentNow,
      },
      persistCredential: async () => {
        throw new Error('persist should not run');
      },
    }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.match((error as Error).message, /timed out before authorization completed/);
      assert.match((error as Error).message, /attempts=3/);
      assert.match((error as Error).message, /lastStatus=404/);
      assert.match((error as Error).message, /lastError=authorization_pending/);
      return true;
    },
  );
});
