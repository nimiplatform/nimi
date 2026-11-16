import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { useHomeDestination } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { AgentCenter } from '@nimiplatform/kit/features/agent-center';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { sessionFor } from '../../../kit/features/agent-center/test/session-fixture.js';

// Component regression with the real Kit session and scripted owner projections;
// real Home acceptance is performed separately against its development renderer.
test('partner management navigation isolates the shared editor draft by partner', async () => {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { url: 'http://localhost' });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  const sessions = { a: await sessionFor(), b: await sessionFor() };
  const refreshCalls = { a: 0, b: 0 };
  for (const handle of ['a', 'b'] as const) {
    const refresh = sessions[handle].refresh.bind(sessions[handle]);
    Object.defineProperty(sessions[handle], 'refresh', { value: () => { refreshCalls[handle]++; return refresh(); } });
  }
  let messageCount = 0;
  const i18n = createInstance(); await i18n.init({ lng: 'en', resources: {}, initImmediate: false });
  const bindings = { sdk: {}, app: { commands: { runtimeConfigNavigation: {} } } } as DesktopCanonicalRendererBindings;
  function Sidebar() {
    const destination = useHomeDestination();
    const partner = destination.partner;
    const handle = partner?.localAgentRef as 'a' | 'b';
    if (!handle || !partner?.settingsSection) return null;
    return <AgentCenter key={handle} session={sessions[handle]} activeSection={partner.settingsSection}
      chrome="standalone" identity={{ displayName: handle === 'a' ? 'Partner A' : 'Partner B' }}
      i18n={{ language: 'en', exists: () => false, t: key => key }}
      onSectionChange={settingsSection => { void store.navigation.replace({ ...destination, partner: { ...partner, settingsSection } }); }}
      placementActions={{ close() {} }} />;
  }
  const select = (handle: 'a' | 'b') => store.navigation.push({ id: 'contacts', contactView: 'partners', partner: {
    localAgentRef: handle, settingsSection: store.navigation.getSnapshot().current.destination.partner?.settingsSection ?? 'behavior' } });
  try {
    await select('a');
    await act(async () => root.render(<I18nextProvider i18n={i18n}><AppStoreProvider store={store}><DesktopRendererBindingProvider bindings={bindings}><Sidebar /></DesktopRendererBindingProvider></AppStoreProvider></I18nextProvider>));
    const budgetSummary = Array.from(document.querySelectorAll('summary')).find(item => item.textContent?.includes('Background usage and limits'));
    assert.ok(budgetSummary);
    await act(async () => { budgetSummary.click(); await Promise.resolve(); });
    const daily = () => document.querySelector<HTMLInputElement>('input[aria-label="Tokens per 24-hour window"]')!;
    assert.equal(daily().value, '0');
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(daily(), '24680');
      daily().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    assert.equal(daily().value, '24680');
    assert.ok(document.body.textContent?.includes('You have unsaved changes.'), 'edit must reach the React form state');
    await act(async () => sessions.a.refresh());
    assert.equal(daily().value, '24680', 'same-partner refresh must preserve the unsaved draft');
    await act(async () => select('b'));
    assert.ok(document.body.textContent?.includes('Partner B'));
    assert.equal(document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('id'), 'agent-center-tab-behavior');
    assert.equal(daily().value, '0', 'A draft must not become B form state');
    await act(async () => select('a'));
    assert.equal(daily().value, '0', 'departing form follows existing discard-on-unmount behavior');
  } finally {
    await act(async () => root.unmount()); sessions.a.dispose(); sessions.b.dispose(); store.navigation.dispose();
    dom.window.close();
    for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
  }
});
