import assert from 'node:assert/strict';
import test from 'node:test';

process.env['VITE_NIMI_REALM_BASE_URL'] = 'https://api.example.test';

const {
  loginFreshOauthPasswordWithBrowserSession,
  shouldUseFreshOauthBrowserSessionLogin,
} = await import('../src/shell/renderer/features/auth/fresh-oauth-browser-session-login.js');

test('shouldUseFreshOauthBrowserSessionLogin only enables the browser-cookie login path for validated prompt=login OAuth continuations', () => {
  const oauthNext = 'https://api.example.test/api/auth/oauth/authorize?client_id=nimi-desktop&prompt=login&state=state-123';

  assert.equal(
    shouldUseFreshOauthBrowserSessionLogin('?fresh_oauth=1&oauth_next=' + encodeURIComponent(oauthNext)),
    true,
  );
  assert.equal(
    shouldUseFreshOauthBrowserSessionLogin('?oauth_next=' + encodeURIComponent(oauthNext)),
    false,
  );
  assert.equal(
    shouldUseFreshOauthBrowserSessionLogin('?fresh_oauth=1&oauth_next=' + encodeURIComponent(
      'https://attacker.example/api/auth/oauth/authorize?prompt=login&state=state-123',
    )),
    false,
  );
});

test('loginFreshOauthPasswordWithBrowserSession posts through browser fetch with credentials included', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} });
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
  };

  const result = await loginFreshOauthPasswordWithBrowserSession({
    realmBaseUrl: 'https://api.example.test/',
    identifier: 'me@example.test',
    password: 'secret-password',
    fetchImpl,
  });

  assert.equal(result.loginState, 'ok');
  assert.equal(result.tokens?.accessToken, 'access-123');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.example.test/api/auth/password/login');
  assert.equal(calls[0]?.init.method, 'POST');
  assert.equal(calls[0]?.init.credentials, 'include');
  assert.equal(calls[0]?.init.headers instanceof Headers, true);
  assert.equal((calls[0]?.init.headers as Headers).get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    identifier: 'me@example.test',
    password: 'secret-password',
  });
});
