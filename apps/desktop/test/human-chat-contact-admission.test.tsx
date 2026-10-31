import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('contact permission reads only the selected peer and retires an old peer result', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { useHumanContactAdmission } = await import('../src/shell/renderer/features/chat/chat-human-contact-admission.js');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  store.getState().applyRuntimeAccountProjection({ status: 'authenticated', user: { id: 'alice', realmEnvironmentId: 'realm' }, sequence: '1', reasonCode: 0, accountReasonCode: 0, authorizationRevision: 'revision' });
  const calls: string[] = [];
  let finishBob!: (value: { canMessage: boolean; blockedByMe: boolean }) => void;
  const sdk = { realm: () => ({ social: { getMyRelationshipWithUser: async ({ path }: { path: { id: string } }) => {
    calls.push(path.id);
    if (path.id === 'bob') return new Promise(resolve => { finishBob = resolve; });
    return { canMessage: false, blockedByMe: false };
  } } }) };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  function Probe({ peer }: { peer: string | null }) { const result = useHumanContactAdmission(peer); return <div>{peer}:{result.state}</div>; }
  const render = async (peer: string | null) => act(async () => {
    root.render(<QueryClientProvider client={client}><AppStoreProvider store={store}><DesktopRendererBindingProvider bindings={{ sdk } as never}><Probe peer={peer} /></DesktopRendererBindingProvider></AppStoreProvider></QueryClientProvider>);
    await new Promise(resolve => setTimeout(resolve, 5));
  });
  try {
    await render(null); assert.deepEqual(calls, []);
    await render('bob'); assert.deepEqual(calls, ['bob']);
    assert.match(dom.window.document.body.textContent || '', /bob:loading/);
    await render('carol');
    await act(async () => { finishBob({ canMessage: true, blockedByMe: false }); await new Promise(resolve => setTimeout(resolve, 5)); });
    assert.deepEqual(calls, ['bob', 'carol']);
    assert.match(dom.window.document.body.textContent || '', /carol:denied/);
  } finally {
    await act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
  }
});
