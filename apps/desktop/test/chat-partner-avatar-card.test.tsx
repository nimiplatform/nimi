import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { resolvePartnerForHandle } from '../src/shell/renderer/features/agents/partner-directory-model.js';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';

const records = ['a', 'b'].map(id => ({ localAgentRef: `local-agent:${id}`, ownerUserId: 'owner', displayName: `Partner ${id.toUpperCase()}`, lifecycleStatus: 2 }));
function sdkFor(handles: Record<string, string | Error> = { 'local-agent:a': 'handle-a', 'local-agent:b': 'handle-b' }) {
  return {
    withRuntimeProtectedScopes: async (_scopes: unknown, call: (options: object) => unknown) => call({}),
    accountProduct: () => ({ agents: { listAgents: async () => ({ agents: records, nextPageToken: '' }) } }),
    resolveDesktopAgentReference: async ({ localAgentRef }: { localAgentRef: string }) => {
      const handle = handles[localAgentRef]; if (handle instanceof Error) throw handle;
      return { reference: { agentHandle: handle, displayName: 'Unused seed' } };
    },
    conversation: () => { throw new Error('Preview/navigation must never open a conversation'); },
    realm: () => { throw new Error('Missing provenance must not block partner navigation'); },
  } as unknown as DesktopRendererSdkPort;
}

test('preview joins the exact current handle without requiring source readiness or selecting by name', async () => {
  const result = await resolvePartnerForHandle(sdkFor(), 'owner', 'handle-b');
  assert.equal(result.partner.localAgentRef, 'local-agent:b');
  assert.equal(result.partner.sourceRef, null);
  await assert.rejects(resolvePartnerForHandle(sdkFor(), 'another-owner', 'handle-b'), /identity/);
  await assert.rejects(resolvePartnerForHandle(sdkFor(), 'owner', 'missing'));
  await assert.rejects(resolvePartnerForHandle(sdkFor({ 'local-agent:a': 'same', 'local-agent:b': 'same' }), 'owner', 'same'));
});

test('mounted preview routes each action to its own partner, supports keyboard entry, and retires on account change', async () => {
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
  const { PartnerVoicePreview } = await import('../src/shell/renderer/features/chat/chat-partner-card-content.js');
  const { ChatPartnerAvatarCard } = await import('../src/shell/renderer/features/chat/chat-partner-avatar-card.js');
  await initI18n(); await changeLocale('en');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  const authenticate = (id: string) => store.getState().applyRuntimeAccountProjection({ status: 'authenticated', user: { id, realmEnvironmentId: 'realm' }, sequence: '1', reasonCode: 0, accountReasonCode: 0, authorizationRevision: id });
  authenticate('owner');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const bindings = { sdk: sdkFor(), clock: { schedule: (delay: number, fn: (value: { ok: boolean }) => void) => { const timer = setTimeout(() => fn({ ok: true }), delay); return () => clearTimeout(timer); } } } as never;
  const root = createRoot(dom.window.document.getElementById('root')!);
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  let selects = 0;
  const render = async (placement: 'composer' | 'rail') => act(async () => root.render(<QueryClientProvider client={client}><AppStoreProvider store={store}><DesktopRendererBindingProvider bindings={bindings}>
    <ChatPartnerAvatarCard agentHandle="handle-b" name="Seed B" placement={placement} onSelect={() => { selects++; }}><button data-testid="trigger">Avatar B</button></ChatPartnerAvatarCard>
  </DesktopRendererBindingProvider></AppStoreProvider></QueryClientProvider>));
  const trigger = () => dom.window.document.querySelector<HTMLButtonElement>('[data-testid="trigger"]')!;
  const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>('[data-testid="chat-partner-card"] button')].find(node => node.textContent?.trim() === label)!;
  try {
    await render('composer');
    for (const [label, section] of [['View profile', undefined], ['Memory', 'cognition'], ['Partner settings', 'overview']] as const) {
      await act(async () => trigger().click()); await settle();
      assert.match(dom.window.document.body.textContent ?? '', /Partner B/);
      if (section === 'overview') await act(async () => dom.window.document.querySelector<HTMLElement>('.partner-preview-more summary')!.click());
      assert.equal(button(label).disabled, false);
      await act(async () => button(label).click());
      assert.deepEqual(store.navigation.getSnapshot().current.destination.partner, { localAgentRef: 'local-agent:b', ...(section ? { settingsSection: section } : {}) });
      await settle();
    }
    await render('rail');
    await act(async () => trigger().click());
    assert.equal(selects, 1, 'rail click retains chat selection');
    await act(async () => trigger().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    await settle();
    assert.equal(dom.window.document.activeElement?.getAttribute('data-testid'), 'chat-partner-card');
    await act(async () => authenticate('another-owner'));
    await settle();
    assert.equal(dom.window.document.querySelector('[data-testid="chat-partner-card"]'), null, 'old account preview is retired');
    let played = 0, paused = 0;
    dom.window.HTMLMediaElement.prototype.play = async function () { played++; this.dispatchEvent(new dom.window.Event('play')); };
    dom.window.HTMLMediaElement.prototype.pause = function () { paused++; this.dispatchEvent(new dom.window.Event('pause')); };
    const voice = { url: 'https://example.test/preview.mp3', durationSec: 15 };
    await act(async () => root.render(<PartnerVoicePreview voice={voice} active />));
    const audio = dom.window.document.querySelector('audio')!;
    assert.equal(audio.preload, 'none'); assert.equal(played, 0, 'opening a card never auto-plays');
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('.partner-preview-voice button')!.click());
    assert.equal(played, 1);
    assert.equal(dom.window.document.querySelector('.partner-preview-voice button')!.getAttribute('aria-pressed'), 'true');
    await act(async () => root.render(<PartnerVoicePreview voice={voice} active={false} />));
    assert.ok(paused > 0, 'closing the card stops audio');
    assert.equal(dom.window.document.querySelector('.partner-preview-voice button')!.getAttribute('aria-pressed'), 'false');

  } finally {
    await act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
