// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createNimiAppSession, type NimiAppAccountBinding, type NimiRemoteAppPlatform } from '../src/app-session.js';
import { prepareRuntimeClientLogin, completeRuntimeClientLogin } from '@nimiplatform/sdk/realm/runtime-client';

// Real SDK protocol and Kit composition; network/peer fixtures are not product acceptance.
function fixture(binding?: NimiAppAccountBinding, autoConnect = true) {
  let saved: string | null = null, callback = 'https://site.example/', invalid = false, outage = false, sourceRole = 'app';
  const navigation: string[] = []; let closes = 0, connects = 0;
  const token = { realmEnvironmentId: 'unit', appId: 'unit.app', clientId: 'unit.web', contextId: 'ctx', accountId: 'A', displayName: 'Alice',
    contextToken: 't'.repeat(43), expiresAt: new Date(Date.now() + 10000).toISOString() };
  const platform: NimiRemoteAppPlatform = {
    kind: 'remote', sourceKind: 'web', config: { appId: token.appId, clientId: token.clientId, realmEnvironmentId: 'unit', realmBaseUrl: 'https://site.example',
      officialWebBaseUrl: 'https://nimi.example', redirectUri: callback, accountBinding: binding, autoConnect,
      fetch: async input => {
        if (String(input).endsWith('/token')) return Response.json(token);
        if (outage) return Response.json({ reasonCode: 'REALM_UNAVAILABLE' }, { status: 503 });
        if (invalid) return Response.json({ reasonCode: 'RUNTIME_CLIENT_CONTEXT_INVALID' }, { status: 401 });
        return Response.json(String(input).endsWith('/end') ? { ended: true } : { ...token, stunUrls: [], source: { kind: 'web', role: sourceRole, appId: token.appId, clientId: token.clientId, displayName: 'Test App', origin: 'https://site.example', redirectUri: 'https://site.example/', sourceRevision: 1, appAccess: ['runtime.consume'], capabilityContractRefs: ['text.generate'] }, primary: null });
      } },
    storage: { getItem: () => saved, setItem: (_, value) => { saved = value; }, removeItem: () => { saved = null; } },
    callbackUrl: () => callback, clearCallback() {}, navigate: url => { navigation.push(url); },
    prepare: prepareRuntimeClientLogin, complete: completeRuntimeClientLogin,
    connect: async (_identity, options) => {
      connects++; let closed = false;
      return { role: 'app', primary: { displayName: 'PC' }, get closed() { return closed; }, close() { if (!closed) { closed = true; closes++; options?.onState?.('closed'); } } } as never;
    },
  };
  const create = () => createNimiAppSession(platform);
  async function login() {
    const initial = create(); if (initial.account.kind !== 'app-session') throw new Error('wrong mode');
    await initial.account.signIn(); const tx = JSON.parse(saved!); initial.dispose();
    callback = `https://site.example/?code=${'c'.repeat(43)}&state=${tx.state}`;
    const result = create(); await result.start(); return result;
  }
  return { platform, create, login, token, navigation, stats: () => ({ closes, connects }), invalidate: () => { invalid = true; }, failNetwork: () => { outage = true; }, useManager: () => { sourceRole = 'official_manager'; } };
}
it('keeps identity without a primary Runtime, and only emits verified identity to the captured website user', async () => {
  let notify = () => {}; let user = 'website-A'; const verified: unknown[] = [];
  const f = fixture({ current: () => user ? { contextKey: user } : null, subscribe: listener => { notify = listener; return () => {}; },
    onVerifiedIdentity: (identity, context) => { verified.push([identity.accountId, context]); } }, false);
  const session = await f.login();
  expect(session.getSnapshot().identity.status).toBe('signed-in');
  expect(session.getSnapshot().runtime.status).toBe('disconnected');
  expect(verified).toEqual([['A', 'website-A']]);
  const identity = session.getSnapshot().identity;
  user = 'website-B'; notify();
  expect(session.getSnapshot().identity.status).toBe('signed-out');
  expect(identity.status === 'signed-in' && identity.signal.aborted).toBe(true);
  session.dispose();
});
it('a delayed first association cannot publish into a changed website context', async () => {
  let user = 'website-A', notify = () => {}; const accepted = Promise.withResolvers<void>(); let entered = false;
  const f = fixture({ current: () => ({ contextKey: user }), subscribe: callback => { notify = callback; return () => {}; },
    onVerifiedIdentity: async () => { entered = true; await accepted.promise; } });
  const pending = f.login();
  while (!entered) await new Promise(resolve => setImmediate(resolve));
  user = 'website-B'; notify(); accepted.resolve();
  const session = await pending;
  expect(session.getSnapshot().identity.status).toBe('signed-out'); expect(f.stats().connects).toBe(0); session.dispose();
});
it('consumes a callback once and closes old connection scopes before reconnect', async () => {
  const f = fixture(), session = await f.login(); await session.start();
  const old = session.getSnapshot().runtime;
  session.disconnectRuntime();
  expect(old.status === 'connected' && old.scope.signal.aborted).toBe(true);
  expect(session.getSnapshot().identity.status).toBe('signed-in');
  await session.connectRuntime(); expect(f.stats().connects).toBe(2);
  expect(session.getSnapshot().runtime).not.toBe(old); session.dispose();
});
it('does not mount a late connection after explicit disconnect', async () => {
  const f = fixture(undefined, false), session = await f.login();
  let close = 0; const delayed = Promise.withResolvers<Awaited<ReturnType<NimiRemoteAppPlatform['connect']>>>();
  f.platform.connect = () => delayed.promise;
  const pending = session.connectRuntime(); session.disconnectRuntime();
  delayed.resolve({ role: 'app', closed: false, close: () => { close++; } } as never); await pending;
  expect(session.getSnapshot().runtime.status).toBe('disconnected'); expect(close).toBe(1); session.dispose();
});
it('terminates an identity-only session at its known expiry without polling', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(undefined, false), session = await f.login(); const identity = session.getSnapshot().identity;
    await vi.advanceTimersByTimeAsync(10001);
    expect(session.getSnapshot().identity.status).toBe('signed-out');
    expect(identity.status === 'signed-in' && identity.signal.aborted).toBe(true); session.dispose();
  } finally { vi.useRealTimers(); }
});
it('Realm invalidation clears identity but an outage preserves a still-valid session', async () => {
  for (const invalid of [true, false]) {
    const f = fixture(), session = await f.login();
    if (invalid) f.invalidate(); else f.failNetwork();
    await session.recheck();
    expect(session.getSnapshot().identity.status).toBe(invalid ? 'signed-out' : 'signed-in');
    session.dispose();
  }
});
it('a cleaned context permits new login, while uncertain revocation is explicitly pending', async () => {
  for (const invalid of [true, false]) {
    const f = fixture(), session = await f.login(); if (invalid) f.invalidate(); else f.failNetwork();
    if (session.account.kind !== 'app-session') throw new Error('wrong mode');
    await session.account.signIn();
    expect(f.navigation.length).toBe(invalid ? 2 : 1); expect(session.getSnapshot().pendingRevocation).toBe(!invalid); session.dispose();
  }
});
it('Desktop uses existing display and never gains an App-scoped logout or account credential', async () => {
  let status = 'session-bound', opened = 0;
  const session = createNimiAppSession({ kind: 'desktop', client: {
    auth: { status: async () => ({ sessionBound: status === 'session-bound', state: status }) },
    currentUser: { get: async () => { throw { reasonCode: 'SDK_LOCAL_APP_CURRENT_USER_UNAVAILABLE' }; } },
  } as never, openAccountOwner: async () => { opened++; } });
  await session.start(); expect(session.getSnapshot().identity).toMatchObject({ status: 'signed-in', user: null });
  expect(session.getSnapshot().runtime.status).toBe('connected'); expect(session.account.kind).toBe('home-managed');
  if (session.account.kind === 'home-managed') await session.account.openAccountOwner(); expect(opened).toBe(1);
  status = 'unavailable'; await session.recheck(); expect(session.getSnapshot().identity.status).toBe('unavailable'); session.dispose();
});

it('a slow older Desktop check cannot replace a newer unavailable posture', async () => {
  const delayed = Promise.withResolvers<unknown>(); let reads = 0;
  const session = createNimiAppSession({ kind: 'desktop', client: {
    auth: { status: () => ++reads === 1 ? delayed.promise : Promise.resolve({ sessionBound: false, state: 'unavailable' }) },
    currentUser: { get: async () => ({ displayName: 'Old user' }) },
  } as never, openAccountOwner: async () => {} });
  const first = session.start(); await session.recheck();
  delayed.resolve({ sessionBound: true, state: 'session-bound' }); await first;
  expect(session.getSnapshot().identity.status).toBe('unavailable'); session.dispose();
});

it('keeps the owner recovery hint for denied status and thrown failures', async () => {
  for (const thrown of [false, true]) {
    const failure = { reasonCode: 'runtime-permission-denied', actionHint: 'review_app_access_in_home' };
    const session = createNimiAppSession({ kind: 'desktop', client: {
      auth: { status: async () => {
        if (thrown) throw Object.assign(new Error('Access denied'), failure);
        return { state: 'unavailable', sessionBound: false, ...failure };
      } },
    } as never, openAccountOwner: async () => {} });
    await session.start();
    expect(session.getSnapshot().issue).toMatchObject(failure);
    expect(session.getSnapshot().runtime.status).toBe('unavailable');
    session.dispose();
  }
});

it('ordinary entry refuses manager qualification before publishing identity or first association', async () => {
  let associated = false;
  const f = fixture({ current: () => ({ contextKey: 'site-A' }), subscribe: () => () => {}, onVerifiedIdentity: () => { associated = true; } });
  f.useManager(); const session = await f.login();
  expect(session.getSnapshot().identity.status).toBe('signed-out');
  expect(session.getSnapshot().issue?.reasonCode).toBe('KIT_REMOTE_APP_SOURCE_REQUIRED');
  session.dispose();
  expect(associated).toBe(false); expect(f.stats().connects).toBe(0);
});

it('initial page resume cannot cancel an in-flight callback; explicitly abandoning sign-in can', async () => {
  for (const abandon of [false, true]) {
    const f = fixture(undefined, false);
    const first = f.create(); if (first.account.kind !== 'app-session') throw new Error('wrong mode');
    await first.account.signIn();
    const transaction = JSON.parse(f.platform.storage.getItem('ignored')!); first.dispose();
    f.platform.callbackUrl = () => `https://site.example/?code=${'c'.repeat(43)}&state=${transaction.state}`;
    const release = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
    const complete = f.platform.complete;
    f.platform.complete = async (...args) => { entered.resolve(); await release.promise; return complete(...args); };
    const session = f.create(), starting = session.start(); await entered.promise;
    await session.recheck();
    if (abandon) session.cancelSignIn();
    release.resolve(); await starting;
    expect(session.getSnapshot().identity.status).toBe(abandon ? 'signed-out' : 'signed-in');
    expect(session.getSnapshot().busy).toBe('none'); session.dispose();
  }
});

it('receives a warm native callback without a new controller and leaves unrelated callbacks unconsumed', async () => {
  const f = fixture(undefined, false), session = f.create(); await session.start();
  if (session.account.kind !== 'app-session') throw new Error('wrong mode');
  await session.account.signIn();
  const transaction = JSON.parse(f.platform.storage.getItem('unused')!);
  const matching = `https://site.example/?code=${'c'.repeat(43)}&state=${transaction.state}`;
  expect(await session.acceptCallback(`https://unrelated.example/?code=${'c'.repeat(43)}&state=${transaction.state}`)).toBe(false);
  expect(await session.acceptCallback(`https://site.example/?code=${'c'.repeat(43)}&state=${'x'.repeat(43)}`)).toBe(false);
  expect(f.platform.storage.getItem('unused')).not.toBeNull();
  const results = await Promise.all([session.acceptCallback(matching), session.acceptCallback(matching)]);
  expect(results.sort()).toEqual([false, true]);
  expect(session.getSnapshot().identity.status).toBe('signed-in'); session.dispose();
});
it('never emits an old identity after asynchronous platform source verification', async () => {
  let user = 'A', notify = () => {}; const gate = Promise.withResolvers<void>(); let entered = false;
  const verified = vi.fn();
  const f = fixture({ current: () => ({ contextKey: user }), subscribe: listener => { notify = listener; return () => {}; }, onVerifiedIdentity: verified });
  f.platform.verifySource = async () => { entered = true; await gate.promise; };
  const result = f.login(); while (!entered) await new Promise(resolve => setImmediate(resolve));
  user = 'B'; notify(); gate.resolve(); const session = await result;
  expect(verified).not.toHaveBeenCalled(); expect(session.getSnapshot().identity.status).toBe('signed-out'); session.dispose();
});
it('rejects a Web source in an Android platform adapter before mounting identity', async () => {
  const f = fixture(undefined, false); f.platform.sourceKind = 'android-app-link';
  const session = await f.login();
  expect(session.getSnapshot().identity.status).toBe('signed-out');
  expect(f.stats().connects).toBe(0); session.dispose();
});

it('ignores an old callback while a new native login preflight has not stored its transaction', async () => {
  const f = fixture(undefined, false), session = f.create(); await session.start();
  const ready = Promise.withResolvers<void>();
  f.platform.prepare = async (...args) => { await ready.promise; return prepareRuntimeClientLogin(...args); };
  if (session.account.kind !== 'app-session') throw new Error('wrong mode');
  const signingIn = session.account.signIn();
  expect(await session.acceptCallback(`https://site.example/?code=${'c'.repeat(43)}&state=${'s'.repeat(43)}`)).toBe(false);
  expect(session.getSnapshot().busy).toBe('sign-in');
  ready.resolve(); await signingIn;
  expect(f.navigation).toHaveLength(1); expect(f.platform.storage.getItem('unused')).not.toBeNull(); session.dispose();
});
