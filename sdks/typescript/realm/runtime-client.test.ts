import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { completeRuntimeClientLogin, prepareRuntimeClientLogin, readRuntimeClientSource, type RuntimeClientLoginOptions, type RuntimeClientLoginTransaction } from '@nimiplatform/sdk/realm/runtime-client';

function fixture() {
  let user = 'verified-app-session-A';
  const requests: Array<{ path: string; init: RequestInit }> = [];
  const token = { realmEnvironmentId: 'test-realm', accountId: 'nimi-user-A', displayName: 'A',
    appId: 'publisher.editor', clientId: 'publisher.editor.web', contextId: 'd214aa08-6e81-4a49-af85-d71bed06dcd8',
    expiresAt: new Date(Date.now() + 60000).toISOString(), contextToken: 't'.repeat(43) };
  const state = { ...token, stunUrls: [], source: { kind: 'web', appId: token.appId, clientId: token.clientId, displayName: 'Editor', origin: 'https://editor.test',
    redirectUri: 'https://editor.test/callback', sourceRevision: 1, role: 'app', appAccess: ['runtime.consume'], capabilityContractRefs: ['text.generate'] }, primary: null };
  let respond = (path: string): Promise<Response> => Promise.resolve(Response.json(path.endsWith('/token') ? token : path.endsWith('/end') ? { ended: true } : state,
    { status: path.endsWith('/context') ? 200 : 201 }));
  const options: RuntimeClientLoginOptions = { realmBaseUrl: 'https://realm.test', officialWebBaseUrl: 'https://nimi.test',
    realmEnvironmentId: token.realmEnvironmentId, appId: token.appId, clientId: token.clientId, redirectUri: 'https://editor.test/callback',
    currentUserContext: () => user, fetch: async (input, init = {}) => { const path = new URL(String(input)).pathname; requests.push({ path, init }); return respond(path); } };
  return { options, token, state, requests, switchUser: () => { user = 'verified-app-session-B'; },
    respond: (next: typeof respond) => { respond = next; } };
}
function callback(transaction: RuntimeClientLoginTransaction) {
  return `${transaction.redirectUri}?code=${'c'.repeat(43)}&state=${transaction.state}`;
}

test('PKCE login returns an app-bound session and sends no account cookies or automatic redirects', async () => {
  const f = fixture(), prepared = await prepareRuntimeClientLogin(f.options, 'nimi-user-A');
  const url = new URL(prepared.authorizationUrl);
  assert.equal(url.origin, 'https://nimi.test'); assert.equal(url.pathname, '/account/connect');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(prepared.transaction.codeVerifier).digest('base64url'));
  assert.notEqual(url.searchParams.get('code_challenge'), prepared.transaction.codeVerifier);
  const session = await completeRuntimeClientLogin(f.options, prepared.transaction, callback(prepared.transaction));
  assert.equal(session.identity.accountId, 'nimi-user-A'); assert.equal('contextToken' in session.identity, false);
  assert.equal((await session.read()).primary, null);
  assert.equal(f.requests[0].init.credentials, 'omit'); assert.equal(f.requests[0].init.redirect, 'error');
  assert.equal(new Headers(f.requests[0].init.headers).has('authorization'), false);
  assert.equal(new Headers(f.requests[1].init.headers).get('authorization'), 'Bearer ' + f.token.contextToken);
  await session.end(); assert.equal(session.closed, true);
  await assert.rejects(session.read(), { reasonCode: 'RUNTIME_CLIENT_CONTEXT_INVALID' });
  assert.deepEqual(f.requests.map(r => r.path), ['/api/runtime-access/token', '/api/runtime-access/context', '/api/runtime-access/context/end']);
});

test('wrong state, callback, stored association and application session cannot be accepted', async () => {
  const f = fixture(), prepared = await prepareRuntimeClientLogin(f.options, 'different-nimi-user');
  await assert.rejects(completeRuntimeClientLogin(f.options, prepared.transaction, callback(prepared.transaction).replace('editor.test', 'other.test')));
  await assert.rejects(completeRuntimeClientLogin(f.options, prepared.transaction, callback(prepared.transaction).replace(prepared.transaction.state, 's'.repeat(43))));
  assert.equal(f.requests.length, 0);
  await assert.rejects(completeRuntimeClientLogin(f.options, prepared.transaction, callback(prepared.transaction)), { reasonCode: 'RUNTIME_CLIENT_CONTEXT_INVALID' });
  assert.equal(f.requests.at(-1)?.path, '/api/runtime-access/context/end');
  f.requests.length = 0; f.switchUser();
  await assert.rejects(completeRuntimeClientLogin(f.options, prepared.transaction, callback(prepared.transaction)), { reasonCode: 'RUNTIME_CLIENT_CONTEXT_INVALID' });
  assert.equal(f.requests.length, 0);
});

test('a late code exchange is revoked and never applied to the new application user', async () => {
  const f = fixture(), prepared = await prepareRuntimeClientLogin(f.options);
  let deliver!: () => void;
  f.respond(path => path.endsWith('/token') ? new Promise(resolve => { deliver = () => resolve(Response.json(f.token, { status: 201 })); }) : Promise.resolve(Response.json({ ended: true }, { status: 201 })));
  const completion = completeRuntimeClientLogin(f.options, prepared.transaction, callback(prepared.transaction));
  while (!deliver) await new Promise(resolve => setImmediate(resolve));
  f.switchUser(); deliver();
  await assert.rejects(completion, { reasonCode: 'RUNTIME_CLIENT_CONTEXT_INVALID' });
  assert.deepEqual(f.requests.map(r => r.path), ['/api/runtime-access/token', '/api/runtime-access/context/end']);
});

test('a late discovery result is discarded after user switch and local closure survives failed revocation', async () => {
  const f = fixture(), prepared = await prepareRuntimeClientLogin(f.options);
  const session = await completeRuntimeClientLogin(f.options, prepared.transaction, callback(prepared.transaction));
  let deliver!: () => void;
  f.respond(path => path.endsWith('/context') ? new Promise(resolve => { deliver = () => resolve(Response.json(f.state)); }) : Promise.resolve(Response.json({ reasonCode: 'REALM_UNAVAILABLE' }, { status: 503 })));
  const pending = session.read();
  while (!deliver) await new Promise(resolve => setImmediate(resolve));
  f.switchUser(); deliver();
  await assert.rejects(pending, { reasonCode: 'RUNTIME_CLIENT_CONTEXT_INVALID' });
  assert.equal(session.closed, true);
  await assert.rejects(session.end());
  await assert.rejects(session.read(), { reasonCode: 'RUNTIME_CLIENT_CONTEXT_INVALID' });
  f.respond(() => Promise.resolve(Response.json({ ended: true }, { status: 201 })));
  await session.end();
});

test('ending a Realm-cleaned context is terminal while unrelated authorization failures remain errors', async () => {
  for (const reasonCode of ['RUNTIME_CLIENT_CONTEXT_INVALID', 'PRINCIPAL_UNAUTHORIZED']) {
    const f = fixture(), prepared = await prepareRuntimeClientLogin(f.options);
    const session = await completeRuntimeClientLogin(f.options, prepared.transaction, callback(prepared.transaction));
    f.respond(() => Promise.resolve(Response.json({ reasonCode }, { status: 401 })));
    if (reasonCode === 'RUNTIME_CLIENT_CONTEXT_INVALID') {
      await session.end();
      await session.end();
      assert.equal(f.requests.filter(request => request.path.endsWith('/end')).length, 1);
    } else {
      await assert.rejects(session.end(), { reasonCode });
    }
    assert.equal(session.closed, true);
    assert.equal(session.active, false);
  }
});

test('Realm-confirmed invalid context closes every context operation, but outages do not revoke identity', async () => {
  for (const operation of ['read', 'create', 'poll'] as const) for (const invalid of [true, false]) {
    const f = fixture(), prepared = await prepareRuntimeClientLogin(f.options);
    const session = await completeRuntimeClientLogin(f.options, prepared.transaction, callback(prepared.transaction));
    const reasonCode = invalid ? 'RUNTIME_CLIENT_CONTEXT_INVALID' : 'REALM_UNAVAILABLE';
    f.respond(() => Promise.resolve(Response.json({ reasonCode }, { status: invalid ? 401 : 503 })));
    const call = operation === 'read' ? session.read() : operation === 'create' ? session.createConnection('offer', 'binding') : session.readConnection('connection', 'binding');
    await assert.rejects(call, { reasonCode });
    assert.equal(session.closed, invalid); assert.equal(session.signal.aborted, invalid);
    assert.equal(session.active, !invalid);
    f.respond(() => Promise.resolve(Response.json({ ended: true })));
    await session.end();
  }
});

test('source preflight exposes only the selected public source and preserves the cookie-free transport', async () => {
  const f = fixture(); f.respond(async () => Response.json(f.state.source));
  const source = await readRuntimeClientSource(f.options);
  assert.equal(source.clientId, f.options.clientId); assert.equal(source.kind, 'web');
  assert.equal(f.requests[0].init.credentials, 'omit'); assert.equal(f.requests[0].init.redirect, 'error');
  assert.equal(new Headers(f.requests[0].init.headers).has('authorization'), false);
  f.respond(async () => Response.json({ ...f.state.source, appId: 'another.app' }));
  await assert.rejects(readRuntimeClientSource(f.options), { reasonCode: 'RUNTIME_CLIENT_INPUT_INVALID' });
});
