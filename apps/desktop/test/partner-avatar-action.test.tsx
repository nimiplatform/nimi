import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { PartnerAvatarAction } from '../src/shell/renderer/features/agents/partner-avatar-action.js';
import { sessionFor, TEST_AGENT_HANDLE } from '../../../kit/features/agent-center/test/session-fixture.js';

test('partner Avatar action keeps configuration, exact launch and late-navigation cancellation separate', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
    CustomEvent: dom.window.CustomEvent, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  store.getState().setAuthSession({ id: 'account-a' });
  const origin = { id: 'contacts', contactView: 'partners', partner: { localAgentRef: 'local-agent:a', activity: {} } } as const;
  await store.navigation.push(origin);
  const empty = await sessionFor();
  const ready = await sessionFor({ appearance: { status: 'ready', backendKind: 'vrm', avatarAssetRef: 'vrm_123456789abc', avatarAssetValid: true } });
  const i18n = createInstance(); await i18n.init({ lng: 'en', resources: {}, initImmediate: false });
  const launches: unknown[] = [];
  let configured = 0, reads = 0, release: (() => void) | undefined, deferRead = false;
  const bindings = { sdk: {
    withRuntimeProtectedScopes: async (_scope: unknown, call: (options: object) => unknown) => call({}),
    accountProduct: () => ({ agents: { getAgent: async ({ agentId }: { agentId: string }) => {
      reads++; assert.equal(agentId, 'local-agent:a'); if (deferRead) await new Promise<void>(resolve => { release = resolve; });
      return { agent: { localAgentRef: agentId, ownerUserId: 'account-a', runtimeSourceRef: 'source-a', displayName: 'Partner', lifecycleStatus: AgentLifecycleStatus.ACTIVE } };
    } } }),
    resolveDesktopAgentReference: async () => ({ reference: { agentHandle: TEST_AGENT_HANDLE, displayName: 'Partner' } }),
    conversation: () => ({ open: async () => ({ conversationAnchorId: 'anchor-a' }) }),
  }, app: { commands: { avatarHandoff: { available: () => true, launch: async (input: unknown) => { launches.push(input); return { opened: true }; } } } } } as unknown as DesktopCanonicalRendererBindings;
  const render = (session: typeof ready) => root.render(<I18nextProvider i18n={i18n}><AppStoreProvider store={store}><DesktopRendererBindingProvider bindings={bindings}>
    <PartnerAvatarAction session={session} accountId="account-a" localAgentRef="local-agent:a" onConfigure={() => { configured++; }} />
  </DesktopRendererBindingProvider></AppStoreProvider></I18nextProvider>);
  try {
    await act(async () => render(empty));
    await act(async () => document.querySelector('button')!.click());
    assert.equal(configured, 1); assert.equal(reads, 0); assert.equal(launches.length, 0);
    await act(async () => render(ready));
    await act(async () => document.querySelector('button')!.click());
    assert.deepEqual(launches, [{ agentHandle: TEST_AGENT_HANDLE, conversationAnchorId: 'anchor-a',
      avatarInstanceId: `desktop-avatar-${TEST_AGENT_HANDLE.toLowerCase().replaceAll('_', '-')}`, launchSource: 'home-partners' }]);
    assert.deepEqual(store.navigation.getSnapshot().current.destination, origin);
    deferRead = true;
    await act(async () => document.querySelector('button')!.click());
    assert.ok(release);
    await act(async () => store.navigation.push({ id: 'contacts', contactView: 'partners', partner: { localAgentRef: 'local-agent:b' } }));
    await act(async () => release!());
    assert.equal(launches.length, 1, 'late resolution must not launch the departed partner');
  } finally {
    await act(async () => root.unmount()); empty.dispose(); ready.dispose(); store.navigation.dispose(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
