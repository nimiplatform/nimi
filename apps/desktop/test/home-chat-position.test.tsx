import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { useHomeChatPosition } from '../src/shell/renderer/app-shell/providers/home-chat-position.js';
import { homeNavigationColumn, validateHomeDestination } from '../src/shell/renderer/app-shell/providers/home-navigation.js';

test('detail identity retains its owning column when history changes', async () => {
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  await store.navigation.push({ id: 'world-detail', worldId: 'world-a' });
  await store.navigation.push({ id: 'downloads' });
  assert.equal(homeNavigationColumn(store.navigation.getSnapshot().current.destination), 'downloads');
  await store.navigation.back();
  assert.equal(homeNavigationColumn(store.navigation.getSnapshot().current.destination), 'explore');
  assert.equal(homeNavigationColumn(validateHomeDestination({ id: 'settings', settingsSection: 'privacy' })), 'settings');
  assert.throws(() => validateHomeDestination({ id: 'privacy-policy' }), /Unknown Home destination/);
  store.navigation.dispose();
});

test('an exiting chat view and a late selection cannot replace a different page', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  await store.navigation.push({ id: 'chat', chat: { mode: 'ai', threadId: 'thread-a' } });
  let position!: ReturnType<typeof useHomeChatPosition>;
  function ExitingView() { position = useHomeChatPosition(); return null; }
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => root.render(<AppStoreProvider store={store}><ExitingView /></AppStoreProvider>));
    const lateSelection = position.selectNimiThread;
    await act(async () => { await store.navigation.push({ id: 'apps', appId: 'nimi.lab' }); });
    const entry = store.navigation.getSnapshot().current;
    await act(async () => { position.selectNimiThread({ threadId: 'fallback-thread' }); position.refine({ mode: 'ai', threadId: 'fallback-thread' }); lateSelection({ threadId: 'late-thread' }); });
    assert.equal(store.navigation.getSnapshot().current, entry);
    await act(async () => { await store.navigation.back(); });
    assert.equal(store.navigation.getSnapshot().current.destination.chat?.threadId, 'thread-a');
    await act(async () => { await store.navigation.push({ id: 'chat', chat: { mode: 'human', targetId: 'person-a', threadId: 'human-a' } }); });
    const explicit = store.navigation.getSnapshot().current;
    await act(async () => { position.resolveHumanThread(null); position.refine({ mode: 'human' }); });
    assert.equal(store.navigation.getSnapshot().current, explicit, 'loading, rejected or missing reads cannot clear an explicit reference');
    await act(async () => { position.open({ mode: 'human' }); });
    await act(async () => { position.resolveHumanThread('proven-default-thread'); });
    assert.equal(store.navigation.getSnapshot().current.destination.chat?.threadId, 'proven-default-thread', 'a legitimate unspecified entry can fill its proven thread');
    await act(async () => { position.open({ mode: 'agent', targetId: 'agent-target', agentHandle: 'agent-handle', conversationAnchorId: 'anchor-a' }); });
    const explicitAgent = store.navigation.getSnapshot().current;
    await act(async () => { position.selectAgentConversation({ targetId: null, agentHandle: null, conversationAnchorId: null }); position.selectNimiThread({ threadId: 'exiting-ai-default' }); });
    assert.equal(store.navigation.getSnapshot().current, explicitAgent, 'empty Agent reads and another mode default cannot replace explicit Agent references');
  } finally {
    await act(async () => root.unmount()); store.navigation.dispose(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});


test('flip always opens conversations or Nimi Chat without restoring a person, partner or thread', async () => {
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  const people = { mode: 'human', contactsSection: 'conversations' };
  const nimi = { mode: 'ai', targetId: 'ai:assistant' };
  try {
    await store.navigation.push({ id: 'chat', chat: { mode: 'human', targetId: 'person', threadId: 'human-thread' } });
    await store.navigation.switchChatSide('companion');
    assert.deepEqual(store.navigation.getSnapshot().current.destination.chat, nimi);
    await store.navigation.push({ id: 'chat', chat: { mode: 'agent', targetId: 'partner', agentHandle: 'handle', conversationAnchorId: 'anchor' } });
    await store.navigation.switchChatSide('human');
    assert.deepEqual(store.navigation.getSnapshot().current.destination.chat, people);
    await store.navigation.replace({ id: 'chat', chat: { mode: 'human', contactsSection: 'received' } });
    await store.navigation.switchChatSide('companion');
    assert.deepEqual(store.navigation.getSnapshot().current.destination.chat, nimi);
    await store.navigation.push({ id: 'chat', chat: { mode: 'ai', targetId: 'ai:assistant', threadId: 'nimi-thread' } });
    await store.navigation.switchChatSide('human');
    assert.deepEqual(store.navigation.getSnapshot().current.destination.chat, people);
    await store.navigation.switchChatSide('companion');
    assert.deepEqual(store.navigation.getSnapshot().current.destination.chat, nimi);
    const unregister = store.navigation.registerLeaveGuard(() => 'cancel');
    await store.navigation.switchChatSide('human');
    assert.deepEqual(store.navigation.getSnapshot().current.destination.chat, nimi, 'flip still respects controlled departure');
    unregister();
    store.navigation.reset({ id: 'home' });
    await store.navigation.switchChatSide('human');
    assert.deepEqual(store.navigation.getSnapshot().current.destination.chat, people);
    assert.equal(validateHomeDestination({ id: 'chat', chat: { mode: 'agent' } }).chat?.mode, 'ai');
    assert.throws(() => validateHomeDestination({ id: 'chat', chat: { mode: 'ai', contactsSection: 'friends' } }));
  } finally { store.navigation.dispose(); }
});
