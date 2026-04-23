import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acquireCodexManagedCredential,
  buildCodexManagedCredentialJson,
  codexAccountIdFromAccessToken,
} from '../src/shell/renderer/features/runtime-config/runtime-config-codex-oauth';

function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

test('codexAccountIdFromAccessToken extracts ChatGPT account id from JWT payload', () => {
  const accessToken = createJwt({
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_test_123',
    },
  });

  assert.equal(codexAccountIdFromAccessToken(accessToken), 'acct_test_123');
});

test('buildCodexManagedCredentialJson preserves managed OAuth metadata', () => {
  const accessToken = createJwt({
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_test_456',
    },
  });

  const credentialJson = buildCodexManagedCredentialJson({
    accessToken,
    refreshToken: 'refresh-token',
    tokenType: 'Bearer',
    scope: 'openid profile offline_access',
    expiresIn: 3600,
    now: Date.parse('2026-04-23T10:00:00.000Z'),
  });

  const parsed = JSON.parse(credentialJson) as Record<string, unknown>;
  assert.equal(parsed.access_token, accessToken);
  assert.equal(parsed.refresh_token, 'refresh-token');
  assert.equal(parsed.account_id, 'acct_test_456');
  assert.equal(parsed.auth_mode, 'chatgpt');
  assert.equal(parsed.source, 'device-code');
  assert.equal(parsed.expires_at, '2026-04-23T11:00:00.000Z');
});

test('acquireCodexManagedCredential completes device-code flow and returns managed payload', async () => {
  const accessToken = createJwt({
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_test_789',
    },
  });
  const proxyCalls: Array<{ url: string; body: string }> = [];
  const pendingStates: string[] = [];
  let pollAttempts = 0;

  const result = await acquireCodexManagedCredential({
    bridge: {
      proxyHttp: async (payload) => {
        proxyCalls.push({
          url: String(payload.url || ''),
          body: String(payload.body || ''),
        });
        if (String(payload.url).includes('/deviceauth/usercode')) {
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
    },
    onPending: (pending) => {
      pendingStates.push(`${pending.userCode}@${pending.verificationUrl}`);
    },
    sleep: async () => {},
    now: () => Date.parse('2026-04-23T12:00:00.000Z'),
  });

  assert.equal(proxyCalls.length, 3);
  assert.equal(proxyCalls[0]?.url.endsWith('/deviceauth/usercode'), true);
  assert.equal(proxyCalls[1]?.url.endsWith('/deviceauth/token'), true);
  assert.equal(proxyCalls[2]?.url.endsWith('/deviceauth/token'), true);
  assert.ok(pendingStates.includes('ABCD-1234@https://auth.openai.com/codex/device?user_code=ABCD-1234'));
  assert.ok(pendingStates.includes('https://auth.openai.com/codex/device?user_code=ABCD-1234'));
  assert.equal(result.accessToken, accessToken);
  assert.equal(result.refreshToken, 'refresh-token');
  assert.equal(result.accountId, 'acct_test_789');

  const parsed = JSON.parse(result.credentialJson) as Record<string, unknown>;
  assert.equal(parsed.account_id, 'acct_test_789');
  assert.equal(parsed.refresh_token, 'refresh-token');
  assert.equal(parsed.expires_at, '2026-04-23T14:00:00.000Z');
});
