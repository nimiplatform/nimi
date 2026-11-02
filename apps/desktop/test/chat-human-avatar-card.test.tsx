import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('human preview keeps its own target, rechecks private data, and retires old account work', { timeout: 20000 }, async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), ResizeObserver: ResizeObserverStub, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { RealmSocialDataProvider } = await import('../src/shell/renderer/features/social/data/realm-social-data-context.js');
  const { RealmHumanChatDataProvider } = await import('../src/shell/renderer/features/chat/data/realm-human-chat-data-context.js');
  const { ChatHumanAvatarCard } = await import('../src/shell/renderer/features/chat/chat-human-avatar-card.js');
  await initI18n(); await changeLocale('en');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  const authenticate = (id: string) => store.getState().applyRuntimeAccountProjection({ status: 'authenticated', user: { id, realmEnvironmentId: 'realm' }, sequence: '1', reasonCode: 0, accountReasonCode: 0, authorizationRevision: id });
  authenticate('viewer');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const reads: string[] = [], writes: string[] = [];
  let restriction = false, delayed = false;
  let finish: (() => void) | undefined;
  const social = { loadUserProfile: async (id: string) => {
    reads.push(id);
    if (delayed) await new Promise<void>(resolve => { finish = resolve; });
    if (restriction) throw Object.assign(new Error('Private'), { status: 403 });
    return { id, displayName: `Profile ${id}`, handle: id, bio: 'Allowed biography', city: 'Allowed city', tags: ['Allowed tag'], languages: ['en', 'zh'] };
  } } as never;
  const relationship = { state: 'active', relationshipId: 'relationship-b', blockedByMe: false, canMessage: true, canRequest: false };
  const bindings = { sdk: { realm: () => ({ social: { getMyRelationshipWithUser: async () => relationship,
    blockUser: async () => { writes.push('block'); }, applyFriendshipAction: async () => { writes.push('friendship'); } } }) },
    clock: { schedule: (delay: number, fn: (value: { ok: boolean }) => void) => { const timer = setTimeout(() => fn({ ok: true }), delay); return () => clearTimeout(timer); } } } as never;
  const root = createRoot(dom.window.document.getElementById('root')!);
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  let selected = 0;
  const render = async (id = 'person-b', placement: 'composer' | 'rail' | 'message' = 'composer') => act(async () => root.render(<QueryClientProvider client={client}><AppStoreProvider store={store}><DesktopRendererBindingProvider bindings={bindings}>
    <RealmSocialDataProvider resource={social}><RealmHumanChatDataProvider resource={{ startChatWithTarget: () => { throw new Error('Preview must not start a chat'); } } as never}>
      <ChatHumanAvatarCard person={{ id, name: 'Seed identity', handle: id }} placement={placement} onSelect={() => { selected++; }}><button data-testid="trigger">Open preview</button></ChatHumanAvatarCard>
    </RealmHumanChatDataProvider></RealmSocialDataProvider>
  </DesktopRendererBindingProvider></AppStoreProvider></QueryClientProvider>));
  const trigger = () => dom.window.document.querySelector<HTMLButtonElement>('[data-testid="trigger"]')!;
  const card = () => dom.window.document.querySelector('[data-testid="chat-human-profile-card"]');
  const view = () => [...dom.window.document.querySelectorAll<HTMLButtonElement>('[data-testid="chat-human-profile-card"] button')].find(node => node.textContent?.trim() === 'View profile')!;
  const open = async () => { await act(async () => trigger().click()); await settle(); };
  try {
    await render(); assert.deepEqual(reads, [], 'closed avatar does not fetch a profile');
    await open(); assert.match(card()?.textContent ?? '', /Allowed biography/);
    await act(async () => view().click());
    assert.equal(store.navigation.getSnapshot().current.destination.profileId, 'person-b');
    await settle(); restriction = true; delayed = true;
    await open(); assert.doesNotMatch(card()?.textContent ?? '', /Allowed biography|Allowed city|Allowed tag/, 'do not display cached full facts while permission is rechecked');
    await act(async () => finish?.()); await settle();
    assert.match(card()?.textContent ?? '', /full profile is private/);
    assert.doesNotMatch(card()?.textContent ?? '', /Allowed biography|Allowed city|Allowed tag/);
    assert.equal(view().disabled, false, 'restricted profile still has a profile destination');
    await act(async () => view().click()); await settle();
    delayed = false; restriction = false;
    await render('viewer', 'message'); await open();
    assert.equal(card()?.querySelector('details'), null, 'self profile has no relationship mutations');
    await act(async () => view().click()); assert.equal(store.navigation.getSnapshot().current.destination.profileId, 'viewer'); await settle();
    await render('person-b', 'rail'); await act(async () => trigger().click()); assert.equal(selected, 1);
    await act(async () => trigger().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))); await settle();
    assert.equal(dom.window.document.activeElement?.getAttribute('data-testid'), 'chat-human-profile-card');
    await act(async () => authenticate('another-viewer')); await settle(); assert.equal(card(), null);
    delayed = true; await open();
    await act(async () => authenticate('third-viewer')); await act(async () => finish?.()); await settle();
    assert.equal(card(), null, 'late account response cannot reopen an old preview');
    assert.deepEqual(writes, [], 'preview and navigation never change a friendship or send a message');
  } finally {
    await act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
