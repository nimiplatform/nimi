import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { useHomeChatPosition } from '../src/shell/renderer/app-shell/providers/home-chat-position.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import { AgentConversationSettingsContent } from '../src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.js';
import type { UseAgentConversationPresentationInput } from '../src/shell/renderer/features/chat/chat-agent-shell-presentation-types.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { sessionFor } from '../../../kit/features/agent-center/test/session-fixture.js';

// Component regression with the real Kit session and scripted owner projections;
// real Home acceptance is performed separately against its development renderer.
test('Home sidebar keeps section and identity together and discards only the departing Agent form', async () => {
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
  let position!: ReturnType<typeof useHomeChatPosition>;
  function Sidebar() {
    position = useHomeChatPosition();
    const handle = position.agentSelection.agentHandle as 'a' | 'b';
    if (!handle || !position.agentCenterSection) return null;
    const input = { activeTarget: { agentHandle: handle, displayName: handle === 'a' ? 'Partner A' : 'Partner B', handle: '', worldName: null },
      activeConversationAnchorId: `anchor-${handle}`, messages: Array.from({ length: messageCount }, () => ({})), runtimeAgentCenterAdapter: sessions[handle],
      onCloseAgentCenter: () => position.setAgentCenterSection(undefined), t: (key: string) => key,
    } as unknown as UseAgentConversationPresentationInput;
    return <AgentConversationSettingsContent input={input} />;
  }
  const select = (handle: 'a' | 'b') => store.navigation.push({ id: 'chat', chat: { mode: 'agent',
    agentHandle: handle, conversationAnchorId: `anchor-${handle}`, targetId: handle,
    agentCenterSection: store.navigation.getSnapshot().current.destination.chat?.agentCenterSection ?? 'behavior' } });
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
    assert.ok(document.querySelector('[data-chat-agent-center]')?.textContent?.includes('Partner B'));
    assert.equal(document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('id'), 'agent-center-tab-behavior');
    assert.equal(daily().value, '0', 'A draft must not become B form state');
    await act(async () => select('a'));
    assert.equal(daily().value, '0', 'departing form follows existing discard-on-unmount behavior');
    await act(async () => position.setAgentCenterSection('ai-config'));
    await act(async () => position.selectAgentConversation({ agentHandle: 'a', conversationAnchorId: 'anchor-a', targetId: 'a' }));
    assert.equal(position.agentCenterSection, 'ai-config', 'reconciliation preserves the open section');
    await act(async () => store.navigation.push({ id: 'chat', chat: { mode: 'agent', managerAnchorId: 'anchor-b', agentCenterSection: 'ai-config' } }));
    assert.equal(document.querySelector('[data-chat-agent-center]'), null, 'pending correlation must not show the previous partner');
    await act(async () => position.resolveAgentCenterRequest({ agentHandle: 'b', conversationAnchorId: 'wrong', targetId: 'b' }));
    assert.equal(position.managerAnchorId, 'anchor-b');
    await act(async () => position.resolveAgentCenterRequest({ agentHandle: 'b', conversationAnchorId: 'anchor-b', targetId: 'b' }));
    assert.equal(position.agentCenterSection, 'ai-config');
    assert.ok(document.querySelector('[data-chat-agent-center]')?.textContent?.includes('Partner B'));
    await act(async () => position.setAgentCenterSection(undefined));
    assert.equal(document.querySelector('[data-chat-agent-center]'), null);
    const beforeReopen = refreshCalls.b;
    await act(async () => position.setAgentCenterSection('behavior'));
    assert.ok(refreshCalls.b > beforeReopen, 'reopening a loaded center must revalidate owner state');
    const beforeTurn = refreshCalls.b;
    messageCount++;
    await act(async () => position.setAgentCenterSection('overview'));
    assert.equal(refreshCalls.b, beforeTurn + 1, 'a later turn still asks for fresh Manager context');
    await act(async () => position.setAgentCenterSection('ai-config'));
    assert.equal(refreshCalls.b, beforeTurn + 1, 'changing tabs alone does not repeat a full owner read');
  } finally {
    await act(async () => root.unmount()); sessions.a.dispose(); sessions.b.dispose(); store.navigation.dispose();
    dom.window.close();
    for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
  }
});
