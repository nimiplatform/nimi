import assert from 'node:assert/strict';
import test from 'node:test';

process.env['VITE_NIMI_REALM_BASE_URL'] = 'https://api.example.test';

const {
  callFreshOauthBrowserSession,
  loginFreshOauthPasswordWithBrowserSession,
  shouldUseFreshOauthBrowserSessionLogin,
  verifyFreshOauthTwoFactorWithBrowserSession,
} = await import('../src/desktop-adapter/web-realm-session.js');

test('fresh OAuth browser login is admitted only inside the Web adapter', async () => {
  const oauthNext = 'https://api.example.test/api/auth/oauth/authorize?client_id=nimi-web&prompt=login&state=state-123';
  const search = `?fresh_oauth=1&oauth_next=${encodeURIComponent(oauthNext)}`;
  assert.equal(shouldUseFreshOauthBrowserSessionLogin(search), true);

  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await loginFreshOauthPasswordWithBrowserSession({
    search,
    identifier: 'me@example.test',
    password: 'secret-password',
    fetchImpl: async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({
        loginState: 'ok',
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
  assert.equal(new Headers(calls[0]?.init.headers).get('x-nimi-auth-response'), 'browser-session');
  assert.equal(result.tokens, undefined);
});

test('fresh OAuth routes every enabled login completion through the credentialed API transport', async () => {
  const oauthNext =
    'https://api.example.test/api/auth/oauth/authorize?client_id=nimi-web&prompt=login&state=state-123';
  const search = `?fresh_oauth=1&oauth_next=${encodeURIComponent(oauthNext)}`;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ loginState: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  await callFreshOauthBrowserSession({
    search,
    fetchImpl,
    call: (realm) =>
      realm.auth.verifyEmailOtp({
        path: {},
        body: { email: 'me@example.test', code: '123456' },
      }),
  });
  await callFreshOauthBrowserSession({
    search,
    fetchImpl,
    call: (realm) =>
      realm.auth.walletLogin({
        path: {},
        body: {
          walletAddress: '0x123',
          walletType: 'metamask',
          message: 'message',
          signature: 'signature',
          nonce: 'nonce',
        },
      }),
  });
  await callFreshOauthBrowserSession({
    search,
    fetchImpl,
    call: (realm) =>
      realm.auth.oauthLogin({
        path: {},
        body: { provider: 'GOOGLE', idToken: 'id-token' },
      }),
  });

  assert.deepEqual(
    calls.map((entry) => new URL(entry.url).pathname),
    ['/api/auth/email/otp/verify', '/api/auth/wallet/login', '/api/auth/oauth/login'],
  );
  for (const call of calls) {
    assert.equal(call.init.credentials, 'include');
    assert.equal(new Headers(call.init.headers).get('x-nimi-auth-response'), 'browser-session');
  }
});

test('fresh OAuth 2FA accepts the cookie-only 204 completion without reading tokens', async () => {
  const oauthNext =
    'https://api.example.test/api/auth/oauth/authorize?client_id=nimi-web&prompt=login&state=state-123';
  const search = `?fresh_oauth=1&oauth_next=${encodeURIComponent(oauthNext)}`;
  const calls: Array<{ url: string; init: RequestInit }> = [];

  await verifyFreshOauthTwoFactorWithBrowserSession({
    search,
    tempToken: 'temporary-token',
    code: '123456',
    fetchImpl: async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.example.test/api/auth/2fa/verify');
  assert.equal(calls[0]?.init.credentials, 'include');
  assert.equal(new Headers(calls[0]?.init.headers).get('x-nimi-auth-response'), 'browser-session');
});
