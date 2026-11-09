// @vitest-environment node
import { expect, it } from 'vitest';
import { createNimiRemoteAppSession } from '../src/remote-app-session.js';
import { prepareRuntimeClientLogin, completeRuntimeClientLogin } from '@nimiplatform/sdk/realm/runtime-client';

it('restoring a callback never replaces the current website account with the stored attempt', async () => {
  let websiteUser = 'verified-site-user-A';
  let stored: string | null = null;
  let connections = 0;
  let observedUser: string | null = null;
  const config = { appId: 'test.website', clientId: 'test.web', realmEnvironmentId: 'unit', realmBaseUrl: 'https://site.example',
    officialWebBaseUrl: 'https://nimi.example', redirectUri: 'https://site.example/', currentUserContext: () => websiteUser };
  const platform: Parameters<typeof createNimiRemoteAppSession>[1] = {
    storage: { getItem: () => stored, setItem: (_key, value) => { stored = value; }, removeItem: () => { stored = null; } },
    navigate() {}, clearCallback() {}, randomId: () => 'local-attempt-only',
    prepare: async options => ({ authorizationUrl: 'https://nimi.example/account/connect', transaction: {
      ...config, applicationUserContext: options.currentUserContext()!, state: 'state', codeVerifier: 'verifier',
    } }),
    complete: async options => { observedUser = options.currentUserContext(); throw Object.assign(new Error('context changed'), { reasonCode: 'RUNTIME_CLIENT_CONTEXT_INVALID' }); },
    connect: async () => { connections++; throw new Error('must not connect'); },
  };
  const first = createNimiRemoteAppSession(config, platform);
  await first.signIn(); first.dispose();
  websiteUser = 'verified-site-user-B';
  const second = createNimiRemoteAppSession(config, platform);
  await second.restore('https://site.example/?code=unit&state=state');
  expect(observedUser).toBe('verified-site-user-B');
  expect(connections).toBe(0);
  expect(stored).toBeNull();
  expect(second.getSnapshot().phase).toBe('signed-out');
  expect(second.getSnapshot().error?.reasonCode).toBe('RUNTIME_CLIENT_CONTEXT_INVALID');
  second.dispose();
});

it('a Realm-cleaned session permits another official login while network failure remains pending', async () => {
  for (const cleaned of [true, false]) {
    let saved: string | null = null;
    const navigations: string[] = [];
    const config = { appId: 'unit.app', clientId: 'unit.web', realmEnvironmentId: 'unit', realmBaseUrl: 'https://site.example',
      officialWebBaseUrl: 'https://nimi.example', redirectUri: 'https://site.example/' };
    const token = { realmEnvironmentId: config.realmEnvironmentId, appId: config.appId, clientId: config.clientId, contextId: 'context-A', accountId: 'user-A', displayName: 'A',
      expiresAt: new Date(Date.now() + 10000).toISOString(), contextToken: 't'.repeat(43) };
    const session = createNimiRemoteAppSession({ ...config, fetch: async input => {
      if (String(input).endsWith('/token')) return Response.json(token);
      return Response.json({ reasonCode: cleaned ? 'RUNTIME_CLIENT_CONTEXT_INVALID' : 'REALM_UNAVAILABLE' }, { status: cleaned ? 401 : 503 });
    } }, {
      storage: { getItem: () => saved, setItem: (_key, value) => { saved = value; }, removeItem: () => { saved = null; } },
      navigate: url => { navigations.push(url); }, clearCallback() {},
      prepare: prepareRuntimeClientLogin, complete: completeRuntimeClientLogin,
      connect: async () => { throw new Error('No peer selected by this session test.'); },
    });
    await session.signIn();
    expect(session.getSnapshot().error).toBeNull();
    const transaction = JSON.parse(saved!);
    await session.restore(`${config.redirectUri}?code=${'c'.repeat(43)}&state=${transaction.state}`);
    await session.signIn();
    expect(navigations).toHaveLength(cleaned ? 2 : 1);
    expect(session.getSnapshot().pendingRevocation).toBe(!cleaned);
    session.dispose();
  }
});
