import { expect, it } from 'vitest';
import { createNimiRemoteAppSession } from '../src/remote-app-session.js';

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
