import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
let root: Root | undefined;
function render(node: React.ReactNode) { const container = document.createElement('div'); document.body.append(container); root = createRoot(container); act(() => root!.render(node)); }
function text(value: string) { return document.body.textContent?.includes(value) ?? false; }
function cleanup() { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); }
import { afterEach, expect, it, vi } from 'vitest';
import { NimiAppAccessGate, NimiAppSessionProvider } from '../src/app/index.js';
import { createNimiAppSession } from '../../core/src/app-session.js';
import type { NimiAppSession, NimiAppSessionSnapshot } from '../../core/src/app-session.js';

afterEach(cleanup);
it('offers sign-out and binding guidance when the signed-in account has no primary Runtime', () => {
  const signOut = vi.fn(async () => {});
  const snapshot: NimiAppSessionSnapshot = {
    identity: { status: 'signed-in', user: { displayName: 'Other account' }, viewKey: 'fixture', signal: new AbortController().signal },
    runtime: { status: 'unavailable' }, busy: 'none', pendingRevocation: false,
    issue: { area: 'runtime', message: 'Unbound', reasonCode: 'PRIMARY_RUNTIME_NOT_BOUND' },
  };
  const session = { getSnapshot: () => snapshot, subscribe: () => () => {}, account: { kind: 'app-session', signOut } } as unknown as NimiAppSession;
  render(<NimiAppSessionProvider session={session}><NimiAppAccessGate language="en">{() => <p>Private view</p>}</NimiAppAccessGate></NimiAppSessionProvider>);
  expect(text('Other account')).toBe(true);
  expect(text('Bind a primary Runtime for this account')).toBe(true);
  expect(text('Private view')).toBe(false);
  act(() => Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Sign out of this App')!.click());
  expect(signOut).toHaveBeenCalledOnce();
});
for (const language of ['zh', 'en'] as const) it(language + ' source admission failure directs users to the developer and keeps the raw error in details', () => {
  const message = 'Realm operation getRuntimeClientSource failed with HTTP 400.';
  const snapshot: NimiAppSessionSnapshot = { identity: { status: 'signed-out' }, runtime: { status: 'disconnected' },
    busy: 'none', pendingRevocation: false,
    issue: { area: 'identity', message, reasonCode: 'RUNTIME_CLIENT_NOT_ADMITTED', actionHint: 'inspect_realm_http_response' } };
  const session = { getSnapshot: () => snapshot, subscribe: () => () => {}, account: { kind: 'app-session' } } as unknown as NimiAppSession;
  render(<NimiAppSessionProvider session={session}><NimiAppAccessGate language={language}>{() => <p>Private view</p>}</NimiAppAccessGate></NimiAppSessionProvider>);
  const details = document.querySelector('details')!;
  expect(details.open).toBe(false);
  expect(details.textContent).toContain(message);
  expect(details.textContent).toContain('RUNTIME_CLIENT_NOT_ADMITTED');
  const visibleCopy = Array.from(document.querySelectorAll('p')).filter(node => !node.closest('details')).map(node => node.textContent).join(' ');
  expect(visibleCopy).toContain(language === 'zh' ? '请联系应用开发者检查接入配置' : 'Contact its developer');
  expect(visibleCopy).not.toContain('HTTP 400');
  expect(text('Private view')).toBe(false);
});
for (const area of ['identity', 'runtime'] as const) it(area + ' failure details preserve the owner hint without mounting private content', () => {
  const snapshot: NimiAppSessionSnapshot = { identity: { status: 'signed-in', user: null, viewKey: 'fixture', signal: new AbortController().signal },
    runtime: { status: 'unavailable' }, busy: 'none', pendingRevocation: false,
    issue: { area, message: 'The requested operation is unavailable.', reasonCode: 'APP_SCOPE_FORBIDDEN', actionHint: 'review_app_access_in_home' } };
  const session = { getSnapshot: () => snapshot, subscribe: () => () => {}, account: { kind: 'app-session' } } as unknown as NimiAppSession;
  render(<NimiAppSessionProvider session={session}><NimiAppAccessGate>{() => <p>Private view</p>}</NimiAppAccessGate></NimiAppSessionProvider>);
  const details = document.querySelector('details')!;
  expect(details.open).toBe(false);
  expect(details.textContent).toContain('APP_SCOPE_FORBIDDEN');
  expect(details.textContent).toContain('review_app_access_in_home');
  expect(text('Private view')).toBe(false);
});
it('a signed-in user with temporarily unavailable display still enters the native product; invalidation unmounts it', async () => {
  let ready = true;
  const session = createNimiAppSession({ kind: 'desktop', openAccountOwner: async () => {}, client: {
    auth: { status: async () => ({ sessionBound: ready, state: ready ? 'session-bound' : 'unavailable' }) },
    currentUser: { get: async () => { throw { reasonCode: 'SDK_LOCAL_APP_CURRENT_USER_UNAVAILABLE' }; } },
  } as never });
  render(<NimiAppSessionProvider session={session}><NimiAppAccessGate>{() => <p>Private partner view</p>}</NimiAppAccessGate></NimiAppSessionProvider>);
  await act(async () => session.start()); expect(text('Private partner view')).toBeTruthy();
  ready = false; await act(async () => session.recheck());
  expect(text('Private partner view')).toBe(false);
  expect(text('在 Nimi Home 管理账号')).toBeTruthy();
  session.dispose();
});
it('identity-only content is removed on identity loss even after Runtime was detached', async () => {
  let ready = true;
  const session = createNimiAppSession({ kind: 'desktop', openAccountOwner: async () => {}, client: {
    auth: { status: async () => ({ sessionBound: ready, state: ready ? 'session-bound' : 'account-changed' }) },
    currentUser: { get: async () => ({ displayName: 'A', handle: 'a', avatarUrl: null }) },
  } as never });
  render(<NimiAppSessionProvider session={session}><NimiAppAccessGate requireRuntime={false}><p>Private identity view</p></NimiAppAccessGate></NimiAppSessionProvider>);
  await act(async () => session.start()); act(() => session.disconnectRuntime());
  expect(text('Private identity view')).toBeTruthy();
  ready = false; await act(async () => session.recheck());
  expect(text('Private identity view')).toBe(false); session.dispose();
});
