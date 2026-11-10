import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMobileNimiAppSession } from '../src/app/mobile.js';

// Real SDK + Kit flow with native/event/peer fixtures. This does not certify
// Android signature/domain verification, native HTTP or a mobile device journey.
const host = vi.hoisted(() => ({
  events: new Map<string, (event: any) => void>(),
  verifySource: vi.fn(), request: vi.fn(), cancelRequest: vi.fn(), open: vi.fn(), close: vi.fn(), connect: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android', isPluginAvailable: () => true },
  registerPlugin: () => ({ verifySource: host.verifySource, request: host.request, cancelRequest: host.cancelRequest }),
}));
vi.mock('@capacitor/app', () => ({ App: {
  addListener: async (name: string, callback: (event: any) => void) => { host.events.set(name, callback); return { remove: async () => { host.events.delete(name); } }; },
  getLaunchUrl: async () => undefined,
} }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: host.open, close: host.close } }));
vi.mock('@nimiplatform/sdk/runtime/remote', () => ({ connectRemoteRuntime: host.connect }));

const config = { appId: 'unit.mobile', clientId: 'unit.mobile.android', realmBaseUrl: 'https://realm.example',
  officialWebBaseUrl: 'https://nimi.example', realmEnvironmentId: 'unit', redirectUri: 'https://mobile.example/nimi/callback' };
const source = { ...config, kind: 'android-app-link', role: 'app', origin: 'https://mobile.example',
  displayName: 'Mobile', androidPackageName: 'unit.mobile', androidCertificateSha256: Array(32).fill('A1').join(':'),
  appAccess: ['runtime.consume'], capabilityContractRefs: [], sourceRevision: 1 };
const identity = { ...config, accountId: 'user-A', displayName: 'A', contextId: 'context', contextToken: 't'.repeat(43) };
let invalid = false;
let activeSource = source;
let active: ReturnType<typeof createMobileNimiAppSession> | undefined;
beforeEach(() => {
  vi.clearAllMocks(); host.events.clear(); sessionStorage.clear(); invalid = false; activeSource = source;
  host.verifySource.mockResolvedValue(undefined); host.open.mockResolvedValue(undefined); host.close.mockResolvedValue(undefined);
  host.request.mockImplementation(async (input: { url: string }) => {
    const path = new URL(input.url).pathname;
    const token = { ...identity, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    const denied = invalid && path.endsWith('/context');
    return { status: denied ? 401 : 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(
      denied ? { reasonCode: 'RUNTIME_CLIENT_CONTEXT_INVALID' } : path.includes('/auth/runtime-clients/') ? activeSource
        : path.endsWith('/token') ? token : path.endsWith('/end') ? { ended: true } : { ...token, source: activeSource, primary: null, stunUrls: [] }),
    };
  });
  host.connect.mockImplementation(async (_session, options) => ({ role: 'app', primary: { displayName: 'PC' }, closed: false,
    close() { options.onState('closed'); },
  }));
});
afterEach(() => { active?.dispose(); active = undefined; });

it('stays signed out when OS source verification fails and does not open the official browser', async () => {
  host.verifySource.mockRejectedValue({ code: 'NIMI_MOBILE_APP_LINK_UNVERIFIED', message: 'Not verified.' });
  active = createMobileNimiAppSession(config); await active.start();
  if (active.account.kind !== 'app-session') throw new Error('wrong account owner');
  await active.account.signIn();
  expect(active.getSnapshot().identity.status).toBe('signed-out');
  expect(active.getSnapshot().issue?.reasonCode).toBe('NIMI_MOBILE_APP_LINK_UNVERIFIED');
  expect(host.open).not.toHaveBeenCalled(); expect(host.connect).not.toHaveBeenCalled();
  expect(host.request).toHaveBeenCalledTimes(1);
});

it('receives a warm callback, replaces the backgrounded scope, and stops reconnecting on identity loss', async () => {
  active = createMobileNimiAppSession(config); await active.start();
  if (active.account.kind !== 'app-session') throw new Error('wrong account owner');
  await active.account.signIn();
  const state = new URL(host.open.mock.calls[0][0].url).searchParams.get('state');
  host.events.get('appUrlOpen')!({ url: `${config.redirectUri}?code=${'c'.repeat(43)}&state=${state}` });
  await vi.waitFor(() => expect(active!.getSnapshot().runtime.status).toBe('connected'));
  const first = active.getSnapshot().runtime;
  host.events.get('appStateChange')!({ isActive: false });
  expect(first.status === 'connected' && first.scope.signal.aborted).toBe(true);
  expect(active.getSnapshot().identity.status).toBe('signed-in');
  host.events.get('appStateChange')!({ isActive: true });
  await vi.waitFor(() => expect(host.connect).toHaveBeenCalledTimes(2));
  const second = active.getSnapshot().runtime;
  expect(second.status === 'connected' && first.status === 'connected' && second.scope.viewKey !== first.scope.viewKey).toBe(true);
  host.events.get('appStateChange')!({ isActive: false }); invalid = true;
  host.events.get('appStateChange')!({ isActive: true });
  await vi.waitFor(() => expect(active!.getSnapshot().identity.status).toBe('signed-out'));
  expect(host.connect).toHaveBeenCalledTimes(2); expect(host.open).toHaveBeenCalledTimes(1);
});

it('uses an admitted development scheme in the existing native flow and ignores a different scheme before exchanging', async () => {
  const configDev = { ...config, redirectUri: 'unit.mobile.dev:/oauth/callback' };
  activeSource = { ...source, kind: 'android-dev-scheme', origin: 'unit.mobile.dev:/', redirectUri: configDev.redirectUri };
  active = createMobileNimiAppSession(configDev); await active.start();
  if (active.account.kind !== 'app-session') throw new Error('wrong account owner');
  await active.account.signIn();
  const state = new URL(host.open.mock.calls[0][0].url).searchParams.get('state');
  expect(host.verifySource).toHaveBeenCalledWith(expect.objectContaining({ kind: 'android-dev-scheme', redirectUri: configDev.redirectUri }));
  expect(await active.acceptCallback(`unit.other.dev:/oauth/callback?code=${'c'.repeat(43)}&state=${state}`)).toBe(false);
  expect(host.request.mock.calls.some(([input]) => input.url.endsWith('/token'))).toBe(false);
  host.events.get('appUrlOpen')!({ url: `${configDev.redirectUri}?code=${'c'.repeat(43)}&state=${state}` });
  await vi.waitFor(() => expect(active!.getSnapshot().runtime.status).toBe('connected'));
  expect(host.close).toHaveBeenCalledTimes(1);
});
