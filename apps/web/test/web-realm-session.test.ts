import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

process.env['VITE_NIMI_REALM_BASE_URL'] = 'https://api.example.test';

const {
  loginFreshOauthPasswordWithBrowserSession,
  shouldUseFreshOauthBrowserSessionLogin,
} = await import('../src/desktop-adapter/web-realm-session.js');

test('fresh OAuth browser login is admitted only inside the Web adapter', async () => {
  const oauthNext = 'https://api.example.test/api/auth/oauth/authorize?client_id=nimi-web&prompt=login&state=state-123';
  assert.equal(
    shouldUseFreshOauthBrowserSessionLogin(`?fresh_oauth=1&oauth_next=${encodeURIComponent(oauthNext)}`),
    true,
  );

  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await loginFreshOauthPasswordWithBrowserSession({
    realmBaseUrl: 'https://api.example.test/',
    identifier: 'me@example.test',
    password: 'secret-password',
    fetchImpl: async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({
        loginState: 'ok',
        tokens: {
          accessToken: 'access-123',
          refreshToken: 'refresh-123',
          tokenType: 'Bearer',
          expiresIn: 3600,
          user: { id: 'account-123' },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal(result.loginState, 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.example.test/api/auth/password/login');
  assert.equal(calls[0]?.init.credentials, 'include');
});

test('Desktop session source contains no bearer-capable Realm transport', () => {
  const desktopSource = readFileSync(
    new URL('../../desktop/src/shell/renderer/infra/sdk/desktop-nimi-client-session.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    desktopSource,
    /readonly\s+(?:accessToken|refreshToken)|authorization:\s*`Bearer|loginNimiRealmAuthPassword|createRealmFetchTransport/i,
  );
  assert.match(
    desktopSource,
    /createRuntimeAccountMediatedDesktopSourceReadinessRealmTransport/,
  );
});
