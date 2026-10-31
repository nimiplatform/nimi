import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { RealmMessageViewDto } from '@nimiplatform/kit/features/chat/realm';
import type { RealmHumanChatData } from '../src/shell/renderer/features/chat/data/realm-human-chat-data.js';

test('read receipts advance to the latest visible confirmed message even when its ID sorts earlier', async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  let observe: IntersectionObserverCallback = () => {};
  let disconnected = false;
  class Observer {
    constructor(callback: IntersectionObserverCallback) { observe = callback; }
    observe() { disconnected = false; }
    disconnect() { disconnected = true; }
  }
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, React, IntersectionObserver: Observer, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { RealmHumanChatDataProvider } = await import('../src/shell/renderer/features/chat/data/realm-human-chat-data-context.js');
  const { useHumanTimelineModel } = await import('../src/shell/renderer/features/chat/chat-human-timeline-model.js');
  const { HumanReadMarker } = await import('../src/shell/renderer/features/chat/chat-human-canonical-components.js');
  const { ChatUploadPlaceholderProvider } = await import('../src/shell/renderer/features/turns/chat-upload-placeholder-context.js');
  const { createChatUploadPlaceholderStore } = await import('../src/shell/renderer/features/turns/chat-upload-placeholder-store.js');
  const { StreamControllerProvider } = await import('../src/shell/renderer/features/turns/stream-controller-context.js');
  const { createTestStreamController } = await import('./helpers/test-stream-controller.js');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  store.getState().applyRuntimeAccountProjection({ status: 'authenticated', user: { id: 'alice', realmEnvironmentId: 'realm' },
    sequence: '1', reasonCode: 0, accountReasonCode: 0, authorizationRevision: 'revision' });
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity } } });
  const uploads = createChatUploadPlaceholderStore(Date.now);
  const streams = createTestStreamController();
  const acknowledgements: string[] = [];
  let failNextReceipt = false;
  const chatData = { async markChatAsRead(chatId: string, id: string) {
    assert.equal(chatId, 'chat');
    acknowledgements.push(id);
    if (failNextReceipt) {
      failNextReceipt = false;
      throw new Error('Connection lost');
    }
  } } as RealmHumanChatData;
  function TimelineMarker() {
    const { newestMessageId, acknowledgeRead, readError } = useHumanTimelineModel('chat', null);
    return <>
      {newestMessageId && <HumanReadMarker messageId={newestMessageId} onVisible={acknowledgeRead} />}
      {readError && <button onClick={() => void acknowledgeRead(readError)}>Retry {readError}</button>}
    </>;
  }
  const message = (id: string, createdAt: string): RealmMessageViewDto => ({
    id, createdAt, chatId: 'chat', senderId: 'bob', type: 'TEXT', text: id, isRead: false, payload: { content: id },
  });
  const renderPages = async (...pages: RealmMessageViewDto[][]) => act(async () => {
    queryClient.setQueryData(['messages', 'chat', 'realm', 'alice'], {
      pages: pages.map(items => ({ items })), pageParams: pages.map((_, index) => index === 0 ? null : 'older'),
    });
    root.render(<QueryClientProvider client={queryClient}><AppStoreProvider store={store}>
      <ChatUploadPlaceholderProvider store={uploads}><StreamControllerProvider controller={streams}>
        <RealmHumanChatDataProvider resource={chatData}><TimelineMarker /></RealmHumanChatDataProvider>
      </StreamControllerProvider></ChatUploadPlaceholderProvider>
    </AppStoreProvider></QueryClientProvider>);
  });
  const intersect = (value: boolean) => act(async () => {
    observe([{ isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
  try {
    const first = message('z-first', '2026-10-01T12:00:00Z');
    const newest = message('a-newest', '2026-10-01T12:01:00Z');
    await renderPages([first]);
    await intersect(false);
    assert.deepEqual(acknowledgements, []);
    Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, value: 'hidden' });
    await intersect(true);
    assert.deepEqual(acknowledgements, []);
    Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => { dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange')); });
    assert.deepEqual(acknowledgements, ['z-first']);
    await act(async () => uploads.add(uploads.create({ chatId: 'chat', kind: 'image', previewUrl: 'blob:pending', senderId: 'alice',
      createdAt: '2026-10-01T12:02:00Z' })));
    await renderPages([newest, first]);
    assert.deepEqual(acknowledgements, ['z-first'], 'a background update does not acknowledge the newly loaded message');
    await intersect(true);
    assert.deepEqual(acknowledgements, ['z-first', 'a-newest']);
    await renderPages([newest, first], [message('zz-older', '2026-10-01T11:59:00Z')]);
    await intersect(true);
    assert.deepEqual(acknowledgements, ['z-first', 'a-newest'], 'an older page and repeat observation do not move the receipt');
    // The owner places this new message ahead of another from the same millisecond.
    const failed = message('0-retry', newest.createdAt);
    await renderPages([failed, newest]);
    failNextReceipt = true;
    await intersect(true);
    await renderPages([message('unseen', '2026-10-01T12:04:00Z'), failed]);
    const retry = dom.window.document.querySelector('button');
    assert.ok(retry);
    await act(async () => retry.click());
    assert.deepEqual(acknowledgements, ['z-first', 'a-newest', '0-retry', '0-retry'],
      'retry targets the previously seen message even after a newer one loads');
    await act(async () => root.unmount());
    assert.equal(disconnected, true);
    dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    assert.equal(acknowledgements.length, 4);
  } finally {
    queryClient.clear();
    streams.dispose();
    uploads.dispose();
    store.navigation.dispose();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
});
