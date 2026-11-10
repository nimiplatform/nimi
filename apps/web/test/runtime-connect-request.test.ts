import assert from 'node:assert/strict';
import test from 'node:test';
import { accountLoginUrl, accountReturnTo } from '../src/auth/account-center-model.js';
import { readRuntimeConnectRequest, runtimeConnectSearch } from '../src/auth/runtime-connect-request.js';

const request = { clientId: 'publisher.editor.web', redirectUri: 'https://editor.example/nimi/callback',
  codeChallenge: 'a'.repeat(43), codeChallengeMethod: 'S256' as const, state: 'b'.repeat(43) };

test('official sign-in preserves only the client PKCE request and never a bearer or open redirect', () => {
  const search = '?' + runtimeConnectSearch(request);
  assert.deepEqual(readRuntimeConnectRequest(search), request);
  const url = new URL(accountLoginUrl('/account/connect', search + '&token=never-retain'), 'https://nimi.example');
  const returned = accountReturnTo(url.search);
  assert.equal(returned, '/account/connect' + search);
  assert.equal(returned.includes('never-retain'), false);
  for (const patch of [{ redirectUri: 'https://user:pass@editor.example/cb' }, { redirectUri: 'javascript:alert(1)' },
    { redirectUri: 'https://editor.example/cb#token' }, { codeChallenge: '' }, { state: '' }]) {
    const bad = '?' + runtimeConnectSearch({ ...request, ...patch });
    assert.equal(readRuntimeConnectRequest(bad), null);
    assert.equal(accountReturnTo('?returnTo=' + encodeURIComponent('/account/connect' + bad)), '/account');
  }
});

test('official sign-in accepts canonical private-use callbacks without treating an arbitrary scheme as admitted', () => {
  const local = { ...request, redirectUri: 'ai.nimi.editor.dev:/oauth/callback' };
  assert.deepEqual(readRuntimeConnectRequest('?' + runtimeConnectSearch(local)), local);
  assert.equal(accountReturnTo('?returnTo=' + encodeURIComponent('/account/connect?' + runtimeConnectSearch(local))),
    '/account/connect?' + runtimeConnectSearch(local));
  for (const uri of ['javascript:alert(1)', 'myapp:/callback', 'ai.nimi.editor.dev://host/callback',
    'ai.nimi.editor.dev:/callback#fragment', 'ai.nimi.editor.dev:/callback?next=other']) {
    assert.equal(readRuntimeConnectRequest('?' + runtimeConnectSearch({ ...request, redirectUri: uri })), null);
  }
});
